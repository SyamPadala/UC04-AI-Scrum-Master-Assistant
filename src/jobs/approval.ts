import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Member, TeamConfig } from '../types.js'
import { trackerTitle, type PmClient, type Story } from '../pm/types.js'
import type { RowStatus, Tracker, TrackerRow } from '../trackers/types.js'
import { APPROVAL_ACTION, approvalCard, type ApprovalPayload } from '../cards/approval.js'
import { isConversationGone, sendProactive, sendProactiveCard } from '../bot/adapter.js'
import {
  decideApproval, forgetScrumMasterChat, releaseApproval, requestApproval, scrumMasterOf, summaryHasRun, waitingApprovals
} from '../store/index.js'
import { mergeRows } from './intakeRows.js'
import { config } from '../config/env.js'

/**
 * An update on someone else's story waits for the Scrum Master (SPEC-004 item 43).
 *
 * The member's Submit asks; the Scrum Master's Approve writes it, Reject does
 * not. Firestore holds only who, which story and when — what the member said
 * travels in the Scrum Master's card. Unanswered requests are chased before
 * the summary and expire when it runs.
 */

export interface ApprovalItem { status: RowStatus, comment: string | null, blocker: string | null }

const notReached = (key: string): string =>
  `I couldn't reach your Scrum Master, so ${key} was not recorded. Please tell them directly.`

/**
 * The member pressed Submit on someone else's story. Returns what they are told.
 * The Scrum Master's card is also the blocker alert when the update has one.
 */
export async function askScrumMaster (
  team: TeamConfig, member: { memberId: string, memberName: string }, story: Story, item: ApprovalItem, today: string
): Promise<string> {
  const owner = story.assignee ?? 'someone else'
  const requestId = randomUUID()
  const claim = await requestApproval({
    teamId: team.teamId,
    localDate: today,
    memberId: member.memberId,
    memberName: member.memberName,
    key: story.key,
    owner,
    requestId,
    state: 'waiting',
    requestedAt: new Date()
  })
  if (claim === 'already') return `An update on ${story.key} is already waiting for your Scrum Master's approval.`
  if (claim === 'error') return `I couldn't send ${story.key} to your Scrum Master for approval, so it was not recorded. Please try again in a moment.`
  const release = async (): Promise<void> => {
    await releaseApproval(team.teamId, today, member.memberId, story.key)
      .catch((error: unknown) => console.error(JSON.stringify({ event: 'approval.releaseFailed', teamId: team.teamId, error: String(error) })))
  }

  const scrumMaster = await scrumMasterOf(team)
  if (scrumMaster === undefined || (scrumMaster.conversationRef ?? '') === '') {
    await release()
    console.log(JSON.stringify({ event: 'approval.notSent', teamId: team.teamId, key: story.key, reason: scrumMaster === undefined ? 'noScrumMaster' : 'appNotInstalled' }))
    return notReached(story.key)
  }

  const card = approvalCard({
    memberName: member.memberName,
    owner,
    storyTitle: trackerTitle(story),
    storyUrl: story.url,
    summaryTime: team.summaryTime,
    payload: {
      action: APPROVAL_ACTION,
      requestId,
      teamId: team.teamId,
      localDate: today,
      memberId: member.memberId,
      item: { key: story.key, ...item }
    }
  })
  const detectedAt = Date.now()
  if (config.dryRun) {
    console.log(JSON.stringify({ event: 'approval.dryRun', teamId: team.teamId, key: story.key }))
  } else {
    try {
      await sendProactiveCard(scrumMaster.conversationRef as string, card, `${member.memberName} sent an update on ${story.key} for your approval`)
    } catch (error) {
      await release()
      if (!isConversationGone(error)) throw error
      await forgetScrumMasterChat(team).catch(() => {})
      return notReached(story.key)
    }
  }
  console.log(JSON.stringify({ event: 'approval.requested', teamId: team.teamId, memberId: member.memberId, key: story.key, blocker: item.blocker !== null }))
  if (item.blocker !== null) {
    // FR-06 evidence: this card is the blocker alert for this update.
    console.log(JSON.stringify({ event: 'blockerAlert.sent', teamId: team.teamId, memberId: member.memberId, blockers: 1, suppressed: 0, latencyMs: Date.now() - detectedAt, via: 'approval' }))
  }
  return `Your update on ${story.key} is waiting for your Scrum Master's approval.` +
    (item.blocker === null ? '' : ' Your Scrum Master has been told about the blocker.')
}

const approvalSchema = z.object({
  action: z.literal(APPROVAL_ACTION),
  decision: z.enum(['approve', 'reject']),
  requestId: z.string().min(1),
  teamId: z.string().min(1),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memberId: z.string().min(1),
  item: z.object({
    key: z.string().min(1),
    status: z.enum(['Completed', 'In Progress', 'Blocked']),
    // Teams leaves a null field out.
    comment: z.string().nullish().transform((v) => v ?? null),
    blocker: z.string().nullish().transform((v) => v ?? null)
  })
})

/** Approve or Reject on the Scrum Master's card, or undefined. */
export function parseApproval (value: unknown): ApprovalPayload | undefined {
  const data = typeof value === 'string' ? safeJson(value) : value
  const result = approvalSchema.safeParse(data)
  if (!result.success) {
    if ((data as { action?: unknown } | undefined)?.action === APPROVAL_ACTION) {
      console.error(JSON.stringify({ event: 'approval.badPayload', problems: result.error.issues.map((i) => `${i.path.join('.')} ${i.code}`) }))
    }
    return undefined
  }
  return result.data as ApprovalPayload
}

function safeJson (text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

/** True when the activity carries the approval card's data at all, valid or not. */
export function isApprovalPress (value: unknown): boolean {
  const data = typeof value === 'string' ? safeJson(value) : value
  return typeof data === 'object' && data !== null && (data as { action?: unknown }).action === APPROVAL_ACTION
}

/** Sends a plain message, reporting whether it went. Never throws. */
async function tell (reference: string | undefined, text: string, label: string): Promise<boolean> {
  if (reference === undefined || reference === '') return false
  if (config.dryRun) {
    console.log(JSON.stringify({ event: `${label}.dryRun` }))
    return true
  }
  try {
    await sendProactive(reference, text)
    return true
  } catch (error) {
    console.error(JSON.stringify({ event: `${label}.failed`, error: String(error).slice(0, 200) }))
    return false
  }
}

/**
 * The Scrum Master pressed Approve or Reject. Returns what they are told; the
 * member hears the result in their own chat.
 */
export async function decideRequest (
  team: TeamConfig,
  senderId: string,
  payload: ApprovalPayload,
  today: string,
  deps: {
    pm: PmClient
    tracker: Tracker
    summaryHasRun?: (teamId: string, localDate: string) => Promise<boolean>
    tell?: (reference: string | undefined, text: string, label: string) => Promise<boolean>
  }
): Promise<string> {
  const scrumMaster = await scrumMasterOf(team)
  if (senderId !== team.scrumMasterId && senderId !== scrumMaster?.memberId) {
    return `Only the Scrum Master of ${team.name} can approve or reject this.`
  }
  const { key } = payload.item
  const member: Member | undefined = team.members.find((m) => m.memberId === payload.memberId)
  const name = member?.displayName ?? 'The member'
  if (payload.localDate !== today || await (deps.summaryHasRun ?? summaryHasRun)(team.teamId, today)) {
    return `This request has expired: today's summary has gone out, so ${name}'s update on ${key} was not recorded.`
  }
  const send = deps.tell ?? tell

  if (payload.decision === 'reject' || member === undefined) {
    const decided = await decideApproval(team.teamId, today, payload.memberId, key, payload.requestId, 'rejected')
    if (decided.outcome !== 'decided') return alreadyDecided(name, key, decided.current?.state)
    if (member === undefined) return `${name} is no longer on ${team.name}, so the update on ${key} was not recorded.`
    const told = await send(member.conversationRef, `Your Scrum Master did not approve your update on ${key}, so it was not recorded.`, 'approval.memberNotice')
    console.log(JSON.stringify({ event: 'approval.rejected', teamId: team.teamId, memberId: member.memberId, key }))
    return `Rejected: ${name}'s update on ${key} was not recorded.` + (told ? ` ${name} has been told.` : ` I couldn't reach ${name} to tell them.`)
  }

  // Jira is read again: what is written is what Jira says now.
  const story = await deps.pm.lookupStory(key)
  if (story === undefined || story.assigneeAccountId === null) {
    await decideApproval(team.teamId, today, payload.memberId, key, payload.requestId, 'rejected')
    const why = story === undefined ? `${key} no longer exists in Jira` : `${key} is not assigned to anyone now`
    await send(member.conversationRef, `Your update on ${key} was not recorded: ${why}.`, 'approval.memberNotice')
    return `${why}, so ${name}'s update was not recorded.`
  }

  const decided = await decideApproval(team.teamId, today, payload.memberId, key, payload.requestId, 'approved')
  if (decided.outcome !== 'decided') return alreadyDecided(name, key, decided.current?.state)

  // As item 14a: under the story's owner, on the sender's row, so their
  // participation counts and nobody else's row is overwritten.
  const theirs = story.assigneeAccountId === (member.jiraAccountId ?? '')
  const owner = story.assignee ?? decided.current?.owner ?? ''
  const row: TrackerRow = {
    win: key,
    description: trackerTitle(story),
    assignedTo: theirs ? member.displayName : owner,
    comment: payload.item.comment,
    status: payload.item.status,
    anyBlocker: payload.item.blocker
  }
  try {
    const existing = (await deps.tracker.readToday(team.teamId, today)).find((u) => u.memberName === member.displayName)?.rows ?? []
    await deps.tracker.write({
      teamId: team.teamId,
      memberId: member.memberId,
      memberName: member.displayName,
      localDate: today,
      rows: mergeRows(existing, [row]),
      rawText: '',
      capturedAt: new Date()
    })
  } catch (error) {
    // Not written, so not approved: the same card can be pressed again.
    if (decided.current !== undefined) await requestApproval({ ...decided.current, state: 'waiting' }).catch(() => 'error')
    throw error
  }
  console.log(JSON.stringify({ event: 'approval.approved', teamId: team.teamId, memberId: member.memberId, key }))

  const told = await send(
    member.conversationRef,
    `Your Scrum Master approved your update on ${key}. It is recorded in the tracker under ${owner}, as updated by you.`,
    'approval.memberNotice'
  )
  return `Approved: ${name}'s update on ${key} is recorded in the tracker.` + (told ? ` ${name} has been told.` : ` I couldn't reach ${name} to tell them.`)
}

function alreadyDecided (name: string, key: string, state: string | undefined): string {
  if (state === 'approved') return `${name}'s update on ${key} was already approved.`
  if (state === 'rejected') return `${name}'s update on ${key} was already rejected.`
  if (state === 'expired') return `This request has expired, so ${name}'s update on ${key} was not recorded.`
  if (state === 'waiting') return `This card is out of date: ${name} sent a newer update on ${key}. Please use the latest card.`
  return `I couldn't find this request any more, so nothing was recorded.`
}

/** "Ravi → SCRUM-25, Anu → SCRUM-31" */
const listOf = (waiting: Array<{ memberName: string, key: string }>): string =>
  waiting.map((a) => `${a.memberName} → ${a.key}`).join(', ')

const keysOf = (keys: string[]): string =>
  keys.length === 1 ? keys[0] : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`

/**
 * The 'approvals' job: before the summary, the Scrum Master and each waiting
 * member hear what is still waiting (SPEC-004 item 43).
 */
export async function remindApprovals (
  team: TeamConfig, today: string,
  deps: { tell?: (reference: string | undefined, text: string, label: string) => Promise<boolean> } = {}
): Promise<{ sent: number, failed: number, skipped: number, detail: string }> {
  const waiting = await waitingApprovals(team.teamId, today)
  if (waiting.length === 0) return { sent: 0, failed: 0, skipped: 0, detail: 'nothing waiting for approval' }
  const send = deps.tell ?? tell
  let sent = 0
  let failed = 0
  let skipped = 0
  const count = (ok: boolean, reference: string | undefined): void => {
    if (ok) sent++
    else if (reference === undefined || reference === '') skipped++
    else failed++
  }

  const scrumMaster = await scrumMasterOf(team)
  const smText = `${waiting.length === 1 ? '1 update is' : `${waiting.length} updates are`} waiting for your approval: ${listOf(waiting)}. ` +
    `${waiting.length === 1 ? 'It' : 'They'} won't be in today's summary unless approved by ${team.summaryTime}.`
  count(await send(scrumMaster?.conversationRef, smText, 'approval.reminder'), scrumMaster?.conversationRef)

  const byMember = new Map<string, string[]>()
  for (const a of waiting) byMember.set(a.memberId, [...(byMember.get(a.memberId) ?? []), a.key])
  for (const [memberId, keys] of byMember) {
    const reference = team.members.find((m) => m.memberId === memberId)?.conversationRef
    const text = `Your update on ${keysOf(keys)} is still waiting for your Scrum Master's approval. Please contact them. ` +
      `If it isn't approved by ${team.summaryTime}, it won't be in today's summary.`
    count(await send(reference, text, 'approval.memberReminder'), reference)
  }
  return { sent, failed, skipped, detail: `${waiting.length} waiting (${listOf(waiting)}): ${sent} reminded, ${failed} failed, ${skipped} not reachable` }
}

/**
 * At summary time whatever is still waiting expires, and its member is told
 * (SPEC-004 item 43). Nothing is written.
 */
export async function expireApprovals (
  team: TeamConfig, today: string,
  deps: { tell?: (reference: string | undefined, text: string, label: string) => Promise<boolean> } = {}
): Promise<number> {
  const send = deps.tell ?? tell
  let expired = 0
  for (const a of await waitingApprovals(team.teamId, today)) {
    const decided = await decideApproval(team.teamId, today, a.memberId, a.key, a.requestId, 'expired')
    if (decided.outcome !== 'decided') continue
    expired++
    const reference = team.members.find((m) => m.memberId === a.memberId)?.conversationRef
    await send(reference, `Your update on ${a.key} wasn't approved before today's summary, so it wasn't recorded.`, 'approval.expiryNotice')
  }
  if (expired > 0) console.log(JSON.stringify({ event: 'approval.expired', teamId: team.teamId, localDate: today, count: expired }))
  return expired
}
