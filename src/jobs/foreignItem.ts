import { z } from 'zod'
import type { TeamConfig } from '../types.js'
import type { PmClient } from '../pm/types.js'
import type { Tracker, TrackerRow } from '../trackers/types.js'
import { FOREIGN_ITEM_ACTION, type ForeignItemPayload } from '../cards/foreignItem.js'
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
  item: z.object({
    key: z.string().min(1),
    title: z.string().nullable(),
    owner: z.string(),
    status: z.enum(['Completed', 'In Progress', 'Blocked']),
    comment: z.string().nullable(),
    blocker: z.string().nullable()
  })
})

/** The card's button data, or undefined when this activity is not a press on that card. */
export function parseForeignItemPayload (value: unknown): ForeignItemPayload | undefined {
  const result = payloadSchema.safeParse(value)
  return result.success ? result.data as ForeignItemPayload : undefined
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
  if (payload.choice === 'cancel') return `${key} not recorded.`
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
    ? `Recorded ${key} in the tracker. It is assigned to you now.`
    : `Recorded ${key} in the tracker. Please ask your Scrum Master to assign it to you in Jira.`
}
