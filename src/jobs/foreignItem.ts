import { z } from 'zod'
import type { TeamConfig } from '../types.js'
import type { PmClient } from '../pm/types.js'
import type { Tracker, TrackerRow } from '../trackers/types.js'
import { FOREIGN_ITEM_ACTION, type ForeignItemPayload } from '../cards/foreignItem.js'
import { STORY_PICK_ACTION, type StoryPickPayload } from '../cards/storyPicker.js'
import { mergeRows, StandupClosedError } from './updateIntake.js'
import { summaryHasRun } from '../store/firestore.js'

/**
 * Submit or Cancel on the "someone else's story" card (SPEC-004 item 14a).
 *
 * The card's data came back from a Teams client, so it is validated like any
 * other input and the story is re-read from Jira: what is written is what Jira
 * says now, not what the card remembers.
 */

const payloadSchema = z.object({
  action: z.literal(FOREIGN_ITEM_ACTION),
  choice: z.enum(['submit', 'cancel']),
  teamId: z.string().min(1),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memberId: z.string().min(1),
  // Teams leaves empty (null) fields out of a card's data (found live, 29 Sep
  // 2026: every press was dropped), so an absent field reads as null.
  item: z.object({
    key: z.string().min(1),
    title: z.string().nullish().transform((v) => v ?? null),
    owner: z.string(),
    status: z.enum(['Completed', 'In Progress', 'Blocked']),
    comment: z.string().nullish().transform((v) => v ?? null),
    blocker: z.string().nullish().transform((v) => v ?? null)
  })
})

const pickSchema = z.object({
  action: z.literal(STORY_PICK_ACTION),
  // Teams leaves a null field out, so a missing pick is "None of these".
  pick: z.string().min(1).nullish().transform((v) => v ?? null),
  teamId: z.string().min(1),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memberId: z.string().min(1),
  item: z.object({
    words: z.string(),
    status: z.enum(['Completed', 'In Progress', 'Blocked'])
  })
})

/** True when the activity carries one of our cards' data at all, valid or not (item 26). */
export function isForeignItemPress (value: unknown): boolean {
  const data = typeof value === 'string' ? safeJson(value) : value
  const action = typeof data === 'object' && data !== null ? (data as { action?: unknown }).action : undefined
  return action === FOREIGN_ITEM_ACTION || action === STORY_PICK_ACTION
}

/**
 * A press on the "Which story is this?" card (item 24), turned into the same
 * shape as a Submit on the confirmation card: the choice is the confirmation.
 */
export function parseStoryPick (value: unknown): ForeignItemPayload | undefined {
  const data = typeof value === 'string' ? safeJson(value) : value
  const result = pickSchema.safeParse(data)
  if (!result.success) {
    if ((data as { action?: unknown } | undefined)?.action === STORY_PICK_ACTION) {
      console.error(JSON.stringify({
        event: 'storyPick.badPayload',
        fields: Object.keys(data as object),
        problems: result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.code}`)
      }))
    }
    return undefined
  }
  const pick = result.data as StoryPickPayload
  return {
    action: FOREIGN_ITEM_ACTION,
    choice: pick.pick === null ? 'cancel' : 'submit',
    teamId: pick.teamId,
    localDate: pick.localDate,
    memberId: pick.memberId,
    item: { key: pick.pick ?? '', title: null, owner: '', status: pick.item.status, comment: pick.item.words, blocker: null }
  }
}

/** The card's button data, or undefined when this activity is not a valid press on that card. */
export function parseForeignItemPayload (value: unknown): ForeignItemPayload | undefined {
  const data = typeof value === 'string' ? safeJson(value) : value
  const result = payloadSchema.safeParse(data)
  if (!result.success && isForeignItemPress(data)) {
    // Field names and problems only: the data holds the member's words.
    console.error(JSON.stringify({
      event: 'foreignItem.badPayload',
      fields: Object.keys(data as object),
      itemFields: Object.keys(((data as { item?: object }).item) ?? {}),
      problems: result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.code}`)
    }))
  }
  return result.success ? result.data as ForeignItemPayload : undefined
}

function safeJson (text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

export async function recordForeignItem (
  team: TeamConfig,
  senderId: string,
  senderName: string,
  payload: ForeignItemPayload,
  today: string,
  deps: {
    pm: PmClient
    tracker: Tracker
    /** Injected in tests; the store is the real source. */
    summaryHasRun?: (teamId: string, localDate: string) => Promise<boolean>
  }
): Promise<string> {
  const { key } = payload.item
  if (payload.memberId !== senderId || payload.teamId !== team.teamId) {
    return 'That card was sent to someone else, so nothing was recorded.'
  }
  if (payload.choice === 'cancel') return key === '' ? 'Not recorded.' : `${key} not recorded.`
  if (payload.localDate !== today) return 'This card has expired. Please send the update again.'
  if (await (deps.summaryHasRun ?? summaryHasRun)(team.teamId, today)) throw new StandupClosedError(today)

  const story = await deps.pm.lookupStory(key)
  if (story === undefined) return `${key} no longer exists in Jira, so it wasn't recorded.`
  if (story.assigneeAccountId === null) {
    return `${key} is not assigned to anyone now, so it can't be updated. Please reach out to your Scrum Master.`
  }

  const member = team.members.find((m) => m.memberId === senderId)
  const theirs = story.assigneeAccountId === (member?.jiraAccountId ?? '')
  // The row is the sender's (they did the work); the prefix shows whose story it is.
  const prefix = theirs ? '' : `(assigned to ${story.assignee ?? payload.item.owner})`
  const comment = [prefix, payload.item.comment ?? ''].filter((part) => part !== '').join(' ')
  const row: TrackerRow = {
    win: key,
    description: story.title,
    assignedTo: senderName,
    comment: comment === '' ? null : comment,
    status: payload.item.status,
    anyBlocker: payload.item.blocker
  }

  // Merged by work item, so pressing Submit twice updates one row (A11).
  const existing = (await deps.tracker.readToday(team.teamId, today)).find((u) => u.memberName === senderName)?.rows ?? []
  await deps.tracker.write({
    teamId: team.teamId,
    memberId: senderId,
    memberName: senderName,
    localDate: today,
    rows: mergeRows(existing, [row]),
    rawText: '',
    capturedAt: new Date()
  })
  console.log(JSON.stringify({ event: 'foreignItem.recorded', teamId: team.teamId, memberId: senderId, key, theirs }))

  return theirs
    ? `Recorded ${key} in the tracker.`
    : `Recorded ${key} in the tracker. It is assigned to ${story.assignee ?? payload.item.owner}; please ask your Scrum Master to assign it to you in Jira.`
}
