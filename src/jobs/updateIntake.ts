import type { TeamConfig } from '../types.js'
import type { LlmClient } from '../llm/types.js'
import type { PmClient, Story } from '../pm/types.js'
import type { RowStatus, StandupUpdate, Tracker, TrackerRow } from '../trackers/types.js'
import type { ExtractionOutput } from '../agents/schema.js'
import { extractUpdate } from '../agents/updateProcessor.js'
import { collapseRows } from '../trackers/rows.js'
import { sendBlockerAlert } from './blockerAlert.js'
import { alertNoSprint } from './noSprintAlert.js'
import { summaryHasRun } from '../store/firestore.js'
import { config } from '../config/env.js'

/**
 * One member's message, from arrival to filed (SPEC-004, FR-02/03/04/06).
 *
 * Agent 1 decides what the message says. Everything after that — turning it
 * into rows, writing it, alerting the Scrum Master — is code. The agent is
 * never given the means to do any of it.
 */

/**
 * How a message ended (SPEC-004 items 11–20). Every value has its own reply;
 * none of them is silent.
 */
export type IntakeOutcome =
  | 'recorded' // at least one verified item was written
  | 'nothingRecorded' // the message was an update, but no item could be verified
  | 'notUnderstood' // an update the model could not read (5b)
  | 'notUpdate' // not a stand-up update at all (item 15)
  | 'nothing' // "nothing to report" — not recorded, non-responder for now (item 16)
  | 'notLinked' // member has no Jira link, so ownership cannot be checked (item 20)
  | 'noSprint' // no active sprint, so nothing can be matched (item 12)

/** An item the member reported that was not written, and why (items 13–14). */
export type Refusal =
  | { reason: 'noWorkItem', words: string }
  | { reason: 'notYours', key: string, owner: string | null }

/** A row this message wrote, as the member is told about it (item 17). */
export interface RecordedItem { win: string, title: string | null, status: RowStatus, blocker: string | null }

export interface IntakeResult {
  outcome: IntakeOutcome
  /** False when nothing could be taken from the message and nothing was written (SPEC-004 5b). */
  understood: boolean
  recorded: RecordedItem[]
  refused: Refusal[]
  /** Blockers not tied to a verified work item: not written, but alerted (item 19). */
  unlinkedBlockers: string[]
  /** The member's open sprint items, offered back when a work item was not found (item 13). */
  openItems: Array<{ key: string, title: string }>
  /** False when no alert about a missing sprint could be sent; the reason says why. */
  noSprintAlertSent?: boolean
  /** Rows the member now has for the day, after merging (A11). */
  rows: number
  /** Rows this particular message contributed. */
  added: number
  blockers: number
  alertSent: boolean
  alertReason?: string
  extractionMs: number
  totalMs: number
  truncated: boolean
  confidence: 'high' | 'low'
}

/**
 * Agent 1's output becomes tracker rows here, not in the agent (SPEC-004).
 *
 * `description` is never taken from the model: it is the work item's real title
 * read from Jira, and stays empty when no work item was identified (A8). That
 * keeps the column trustworthy — it either holds what Jira says or nothing.
 */
export function toTrackerRows (
  output: Pick<ExtractionOutput, 'completed' | 'inProgress' | 'blockers'>, memberName: string, stories: Map<string, Story>
): TrackerRow[] {
  const titleOf = (key: string | null): string | null =>
    key === null ? null : stories.get(key)?.title ?? null

  const rows: TrackerRow[] = [
    ...output.completed.map((item): TrackerRow => ({
      win: item.storyRef,
      description: titleOf(item.storyRef),
      assignedTo: memberName,
      comment: item.comment,
      status: 'Completed',
      anyBlocker: null
    })),
    ...output.inProgress.map((item): TrackerRow => ({
      win: item.storyRef,
      description: titleOf(item.storyRef),
      assignedTo: memberName,
      comment: item.comment,
      status: 'In Progress',
      anyBlocker: null
    }))
  ]

  for (const blocker of output.blockers) {
    // A blocker against work already listed belongs on that row. One against
    // nothing in particular ("no VPN access") gets a row of its own, with the
    // text in AnyBlocker and Comment left empty so it is not duplicated.
    const attached = blocker.storyRef === null
      ? undefined
      : rows.find((row) => row.win === blocker.storyRef)

    if (attached !== undefined) {
      attached.anyBlocker = attached.anyBlocker === null
        ? blocker.description
        : `${attached.anyBlocker}; ${blocker.description}`
      // Work that is blocked is not progressing, and a Status filter for
      // Blocked must find it. Completed work stays completed: the member said
      // it is finished, and a blocker mentioned against it does not undo that.
      if (attached.status === 'In Progress') attached.status = 'Blocked'
      continue
    }

    rows.push({
      win: blocker.storyRef,
      description: titleOf(blocker.storyRef),
      assignedTo: memberName,
      comment: null,
      status: 'Blocked',
      anyBlocker: blocker.description
    })
  }

  // No General row (SPEC-004 item 11, 28 Sep 2026): an item that names no
  // verified work item is reported back to the member, never filed.
  return rows
}

/**
 * Adds a later message to what the member already said today (A11).
 *
 * The PRD assumption is that a member's messages are *combined* into one
 * update. Until now a second message replaced the first, which lost it:
 * reporting SCRUM-6 and SCRUM-7, then remembering SCRUM-21, left only
 * SCRUM-21 in the tracker. SPEC-002 recorded that as a knowing shortcut and
 * named this exact situation as the condition to undo it.
 *
 * Merging is by work item, because the tracker holds where each item stands,
 * not a transcript of what was said. Mentioning an item again updates its row;
 * items not mentioned again are left alone.
 */
export function mergeRows (existing: TrackerRow[], incoming: TrackerRow[]): TrackerRow[] {
  const supersededWins = new Set(
    incoming.map((row) => row.win).filter((win): win is string => win !== null)
  )

  const kept = existing.filter((row) => row.win === null || !supersededWins.has(row.win))
  const merged = [...kept]

  for (const row of incoming) {
    // A row with no work item cannot be matched on one, so it is added unless
    // the member has simply repeated themselves word for word.
    const duplicate = row.win === null && merged.some(
      (candidate) => candidate.win === null &&
        candidate.comment === row.comment &&
        candidate.anyBlocker === row.anyBlocker
    )
    if (!duplicate) merged.push(row)
  }
  return merged
}

/**
 * Splits the extraction into what may be written and what may not (items 11,
 * 13, 14, 19). Only a work item that exists in Jira **and** is assigned to the
 * sender is kept. Decided by code from Jira's own data, never by the model.
 */
export function verifyItems (
  output: ExtractionOutput, stories: Map<string, Story>, jiraAccountId: string
): { kept: Pick<ExtractionOutput, 'completed' | 'inProgress' | 'blockers'>, refused: Refusal[], unlinkedBlockers: string[] } {
  const refused: Refusal[] = []
  const refuse = (refusal: Refusal): void => {
    const seen = refused.some((r) => refusal.reason === 'notYours'
      ? r.reason === 'notYours' && r.key === refusal.key
      : r.reason === 'noWorkItem' && r.words === refusal.words)
    if (!seen) refused.push(refusal)
  }
  const check = (ref: string | null): 'ok' | 'missing' | 'notYours' => {
    if (ref === null) return 'missing'
    const story = stories.get(ref)
    if (story === undefined) return 'missing'
    // Unassigned counts as not theirs (user decision, 28 Sep 2026).
    return story.assigneeAccountId === jiraAccountId ? 'ok' : 'notYours'
  }
  const notYours = (ref: string): Refusal => ({ reason: 'notYours', key: ref, owner: stories.get(ref)?.assignee ?? null })

  const keepItems = (items: ExtractionOutput['completed']): ExtractionOutput['completed'] => items.filter((item) => {
    const verdict = check(item.storyRef)
    if (verdict === 'missing') refuse({ reason: 'noWorkItem', words: item.comment })
    if (verdict === 'notYours') refuse(notYours(item.storyRef as string))
    return verdict === 'ok'
  })

  const unlinkedBlockers: string[] = []
  const blockers = output.blockers.filter((blocker) => {
    const verdict = check(blocker.storyRef)
    if (verdict === 'missing') unlinkedBlockers.push(blocker.description)
    if (verdict === 'notYours') refuse(notYours(blocker.storyRef as string))
    return verdict === 'ok'
  })

  return {
    kept: { completed: keepItems(output.completed), inProgress: keepItems(output.inProgress), blockers },
    refused,
    unlinkedBlockers
  }
}

/** Reads the real titles for every work item the extraction referred to. */
async function resolveStories (output: ExtractionOutput, pm: PmClient, known: Story[]): Promise<Map<string, Story>> {
  const stories = new Map(known.map((story) => [story.key, story]))

  const referenced = new Set<string>()
  for (const item of [...output.completed, ...output.inProgress]) {
    if (item.storyRef !== null) referenced.add(item.storyRef)
  }
  for (const blocker of output.blockers) {
    if (blocker.storyRef !== null) referenced.add(blocker.storyRef)
  }

  for (const key of referenced) {
    if (stories.has(key)) continue
    try {
      const story = await pm.lookupStory(key)
      if (story !== undefined) stories.set(key, story)
    } catch (error) {
      // A lookup failure leaves the title empty. It must not lose the update.
      console.warn(JSON.stringify({ event: 'story.lookupFailed', key, error: String(error) }))
    }
  }
  return stories
}

/**
 * Raised when a member messages after the day's summary has gone out (A14).
 *
 * The stand-up closes when the summary runs: nothing is written to the tracker
 * and the member is sent to their Scrum Master. Thrown before the model is
 * called, so a message that will not be recorded is never paid for.
 */
export class StandupClosedError extends Error {
  constructor (public readonly localDate: string) {
    super(`the stand-up for ${localDate} closed when the summary was sent`)
    this.name = 'StandupClosedError'
  }
}

export async function processUpdate (
  team: TeamConfig,
  memberId: string,
  memberName: string,
  text: string,
  localDate: string,
  deps: {
    llm: LlmClient
    pm: PmClient
    tracker: Tracker
    /** Injected in tests; the store is the real source. */
    summaryHasRun?: (teamId: string, localDate: string) => Promise<boolean>
    /** Injected in tests; the real one messages the Scrum Master (item 12). */
    alertNoSprint?: (team: TeamConfig, localDate: string) => Promise<{ sent: boolean, reason?: string }>
  }
): Promise<IntakeResult> {
  const receivedAt = new Date()
  const member = team.members.find((entry) => entry.memberId === memberId)
  const jiraAccountId = member?.jiraAccountId ?? ''

  const closed = await (deps.summaryHasRun ?? summaryHasRun)(team.teamId, localDate)
  if (closed) throw new StandupClosedError(localDate)

  const base = (outcome: IntakeOutcome, extractionMs = 0, extra: Partial<IntakeResult> = {}): IntakeResult => ({
    outcome,
    understood: outcome !== 'notUnderstood',
    recorded: [],
    refused: [],
    unlinkedBlockers: [],
    openItems: [],
    rows: 0,
    added: 0,
    blockers: 0,
    alertSent: false,
    extractionMs,
    totalMs: Date.now() - receivedAt.getTime(),
    truncated: false,
    confidence: 'high',
    ...extra
  })

  // Item 20: without a Jira link, ownership cannot be checked, so nothing can
  // be recorded. Checked before the model is called — no call is spent.
  if (jiraAccountId === '') {
    console.log(JSON.stringify({ event: 'update.notLinked', teamId: team.teamId, memberId }))
    return base('notLinked')
  }

  const sprint = await deps.pm.getActiveSprint()

  // Read back from the tracker rather than from Firestore, because the tracker
  // is the only place update content lives (Privacy NFR). Today's rows are
  // merged into below; the member's open blockers go to the model so "that
  // issue is resolved" has something to attach to (SPEC-004 5a).
  const today = await deps.tracker.readToday(team.teamId, localDate)
  // SharePoint knows members by name only, so match on either.
  const openBlockers = (await deps.tracker.openBlockers(team.teamId))
    .filter((b) => b.memberId === memberId || b.member === memberName)

  const extraction = await extractUpdate(
    { text, memberId, memberName, teamId: team.teamId, jiraAccountId, activeBlockers: openBlockers },
    deps.llm,
    deps.pm,
    config.agent1
  )
  const output = extraction.output
  const openItems = extraction.openItems.map((item) => ({ key: item.key, title: item.title }))
  const common = {
    openItems,
    truncated: extraction.truncated,
    confidence: output.confidence
  }

  // Items 15, 16 and 5b: a message with nothing in it is never filed. The
  // model's label decides only which reply the member gets.
  const saidSomething = output.completed.length + output.inProgress.length + output.blockers.length > 0
  if (!saidSomething) {
    const outcome: IntakeOutcome = output.kind === 'not_update'
      ? 'notUpdate'
      : output.kind === 'nothing' ? 'nothing' : 'notUnderstood'
    console.log(JSON.stringify({
      event: 'update.notRecorded', outcome, teamId: team.teamId, memberId,
      confidence: output.confidence, extractionMs: extraction.durationMs
    }))
    const existing = today.find((update) => update.memberName === memberName)?.rows ?? []
    return base(outcome, extraction.durationMs, { ...common, rows: existing.length })
  }

  const stories = await resolveStories(output, deps.pm, extraction.openItems)
  const verified = verifyItems(output, stories, jiraAccountId)

  let result: IntakeResult
  if (sprint === undefined) {
    // Item 12: no sprint, no matching. Nothing is written; the Scrum Master is
    // told once a day. Blockers are still alerted below (FR-06).
    let noSprintAlertSent = false
    try {
      const alert = await (deps.alertNoSprint ?? alertNoSprint)(team, localDate)
      noSprintAlertSent = alert.sent || alert.reason === 'already alerted today'
      if (!alert.sent) console.log(JSON.stringify({ event: 'noSprintAlert.notSent', teamId: team.teamId, reason: alert.reason }))
    } catch (error) {
      console.error(JSON.stringify({ event: 'noSprintAlert.failed', teamId: team.teamId, error: String(error) }))
    }
    result = base('noSprint', extraction.durationMs, {
      ...common,
      noSprintAlertSent,
      unlinkedBlockers: output.blockers.map((b) => b.description)
    })
  } else {
    // Items 11, 13, 14, 18: only verified items are written; the rest go back
    // to the member with their reason in the same reply.
    const incoming = toTrackerRows(verified.kept, memberName, stories)
    const existing = today.find((update) => update.memberName === memberName)?.rows ?? []
    const rows = mergeRows(existing, incoming)

    if (incoming.length > 0) {
      const update: StandupUpdate = {
        teamId: team.teamId, memberId, memberName, localDate, rows, rawText: text, capturedAt: receivedAt
      }
      await deps.tracker.write(update)
    }

    const recorded: RecordedItem[] = collapseRows(incoming).map((row) => ({
      win: row.win as string, title: row.description, status: row.status, blocker: row.anyBlocker
    }))
    result = base(incoming.length > 0 ? 'recorded' : 'nothingRecorded', extraction.durationMs, {
      ...common,
      recorded,
      refused: verified.refused,
      unlinkedBlockers: verified.unlinkedBlockers,
      rows: rows.length,
      added: incoming.length
    })
  }

  // FR-06 is triggered from the validated extraction, after anything that was
  // going to be filed is filed: a failed alert must never cost the member their
  // update. Every blocker is alerted, written or not (item 19).
  result.blockers = output.blockers.length
  try {
    const alert = await sendBlockerAlert(
      team, memberId, memberName, localDate, output.blockers, stories, receivedAt
    )
    result.alertSent = alert.sent
    if (alert.reason !== undefined) result.alertReason = alert.reason
  } catch (error) {
    result.alertReason = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'blockerAlert.failed', teamId: team.teamId, memberId, error: result.alertReason }))
  }

  result.totalMs = Date.now() - receivedAt.getTime()
  // The Latency NFR is measured from this number, so it is the real elapsed
  // time from message received to tracker written and alert sent.
  console.log(JSON.stringify({
    event: 'update.processed',
    outcome: result.outcome,
    teamId: team.teamId,
    memberId,
    rows: result.rows,
    added: result.added,
    refused: result.refused.length,
    unlinkedBlockers: result.unlinkedBlockers.length,
    blockers: result.blockers,
    confidence: output.confidence,
    extractionMs: extraction.durationMs,
    totalMs: result.totalMs,
    withinLatencyBudget: result.totalMs <= 30_000
  }))
  return result
}
