import { z } from 'zod'
import type { TeamConfig } from '../types.js'
import type { PmClient } from '../pm/types.js'
import type { Tracker, TrackerRow } from '../trackers/types.js'
import { FOREIGN_ITEM_ACTION, type ForeignItemPayload } from '../cards/foreignItem.js'
import { STORY_PICK_ACTION, type StoryPickPayload } from '../cards/storyPicker.js'
import { STORY_CHOICE_ACTION, type StoryChoicePayload } from '../cards/storyChoice.js'
import { generalRow, mergeRows, StandupClosedError } from './updateIntake.js'
import { summaryHasRun } from '../store/firestore.js'
import { scrumMasterKnows, sendBlockerAlert } from './blockerAlert.js'

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

const choiceSchema = z.object({
  action: z.literal(STORY_CHOICE_ACTION),
  // Teams leaves a null field out, so a missing pick is "None of these".
  pick: z.string().min(1).nullish().transform((v) => v ?? null),
  teamId: z.string().min(1),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memberId: z.string().min(1),
  item: z.object({
    words: z.string(),
    status: z.enum(['Completed', 'In Progress', 'Blocked']),
    blocker: z.string().nullish().transform((v) => v ?? null),
    noStory: z.boolean().nullish().transform((v) => v === true)
  })
})

/** True when the activity carries one of our cards' data at all, valid or not (item 26). */
export function isForeignItemPress (value: unknown): boolean {
  const data = typeof value === 'string' ? safeJson(value) : value
  const action = typeof data === 'object' && data !== null ? (data as { action?: unknown }).action : undefined
  return action === FOREIGN_ITEM_ACTION || action === STORY_PICK_ACTION || action === STORY_CHOICE_ACTION
}

/** A press on "These stories could fit…" (item 38), or undefined. */
export function parseStoryChoice (value: unknown): StoryChoicePayload | undefined {
  const data = typeof value === 'string' ? safeJson(value) : value
  const result = choiceSchema.safeParse(data)
  if (!result.success) {
    if ((data as { action?: unknown } | undefined)?.action === STORY_CHOICE_ACTION) {
      console.error(JSON.stringify({
        event: 'storyChoice.badPayload',
        fields: Object.keys(data as object),
        problems: result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.code}`)
      }))
    }
    return undefined
  }
  return result.data as StoryChoicePayload
}

/**
 * SPEC-004 item 38: the member pressed Submit on one story, or None of these.
 * Submit records at once — the card said whose story it is — through the same
 * path as 14a (Jira re-read, "(assigned to …)", merged rows, alert on a
 * blocker). None records nothing, but a blocker still reaches the Scrum
 * Master, as one with no story. Item 40: None on a blocker that named no story
 * files it as her General row first.
 */
export async function recordChoice (
  team: TeamConfig,
  senderId: string,
  senderName: string,
  choice: StoryChoicePayload,
  today: string,
  deps: {
    pm: PmClient
    tracker: Tracker
    summaryHasRun?: (teamId: string, localDate: string) => Promise<boolean>
    sendBlockerAlert?: typeof sendBlockerAlert
  }
): Promise<string> {
  if (choice.memberId !== senderId || choice.teamId !== team.teamId) {
    return 'That card was sent to someone else, so nothing was recorded.'
  }
  const { words, status, blocker } = choice.item
  if (choice.pick !== null) {
    return await recordForeignItem(team, senderId, senderName, {
      action: FOREIGN_ITEM_ACTION,
      choice: 'submit',
      teamId: choice.teamId,
      localDate: choice.localDate,
      memberId: choice.memberId,
      // A blocker-only item's words are the blocker; it is not repeated as the comment.
      item: { key: choice.pick, title: null, owner: '', status, comment: words === blocker ? null : words, blocker }
    }, today, deps)
  }

  if (blocker === null) return 'Not recorded.'
  if (choice.localDate !== today) return 'This card has expired. Please send the update again.'

  // Item 40: a blocker that named no story, and she says it is none of hers —
  // it goes into her General row (item 39), then the usual no-story alert.
  let filed = false
  if (choice.item.noStory === true) {
    if (await (deps.summaryHasRun ?? summaryHasRun)(team.teamId, today)) throw new StandupClosedError(today)
    const row = generalRow({ completed: [], inProgress: [], blockers: [{ description: blocker, storyRef: null, reason: null, alternatives: [] }] }, senderName)
    const existing = (await deps.tracker.readToday(team.teamId, today)).find((u) => u.memberName === senderName)?.rows ?? []
    await deps.tracker.write({
      teamId: team.teamId, memberId: senderId, memberName: senderName, localDate: today,
      rows: mergeRows(existing, [row]), rawText: '', capturedAt: new Date()
    })
    console.log(JSON.stringify({ event: 'storyChoice.general', teamId: team.teamId, memberId: senderId }))
    filed = true
  }

  const member = team.members.find((m) => m.memberId === senderId)
  const openItems = member?.jiraAccountId === undefined || member.jiraAccountId === ''
    ? []
    : await deps.pm.getMemberOpenItems(member.jiraAccountId).catch(() => [])
  try {
    const alert = await (deps.sendBlockerAlert ?? sendBlockerAlert)(
      team, senderId, senderName, today, [{ description: blocker, storyRef: null }], new Map(), new Date(),
      openItems.map((item) => ({ key: item.key, title: item.title, url: item.url }))
    )
    if (scrumMasterKnows(alert)) {
      return filed
        ? `Saved as a general update. ⚠ Blocker: "${blocker}". Your Scrum Master has been told.`
        : 'Not recorded in the tracker. Your Scrum Master has been told about the blocker.'
    }
    console.log(JSON.stringify({ event: 'storyChoice.alertNotSent', teamId: team.teamId, reason: alert.reason }))
  } catch (error) {
    console.error(JSON.stringify({ event: 'blockerAlert.failed', teamId: team.teamId, memberId: senderId, error: String(error) }))
  }
  return filed
    ? `Saved as a general update. ⚠ Blocker: "${blocker}". It is in the tracker, but I couldn't reach your Scrum Master about it.`
    : "Not recorded, and I couldn't reach your Scrum Master about the blocker. Please tell them directly."
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

/** A press on "Which story is this?", as sent (item 34c), or undefined. */
export function parseStoryPickPayload (value: unknown): StoryPickPayload | undefined {
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
  return result.data as StoryPickPayload
}

/**
 * SPEC-004 item 34c: the member picked a story on "Which story is this?".
 * Nothing is written yet. The answer is the confirmation card to show (the
 * 14a card for someone else's story, "Record against … (yours)?" for their
 * own), or a reply when there is nothing to confirm.
 */
export async function confirmPick (
  team: TeamConfig,
  senderId: string,
  senderName: string,
  pick: StoryPickPayload,
  today: string,
  deps: { pm: PmClient, summaryHasRun?: (teamId: string, localDate: string) => Promise<boolean> }
): Promise<{ confirm: ForeignItemPayload['item'], mine: boolean } | { reply: string }> {
  if (pick.memberId !== senderId || pick.teamId !== team.teamId) {
    return { reply: 'That card was sent to someone else, so nothing was recorded.' }
  }
  if (pick.pick === null) return { reply: 'Not recorded.' }
  if (pick.localDate !== today) return { reply: 'This card has expired. Please send the update again.' }
  if (await (deps.summaryHasRun ?? summaryHasRun)(team.teamId, today)) throw new StandupClosedError(today)

  const story = await deps.pm.lookupStory(pick.pick)
  if (story === undefined) return { reply: `${pick.pick} no longer exists in Jira, so it wasn't recorded.` }
  if (story.assigneeAccountId === null) {
    return { reply: `${pick.pick} is not assigned to anyone, so it can't be updated. Please reach out to your Scrum Master.` }
  }
  const member = team.members.find((m) => m.memberId === senderId)
  const mine = story.assigneeAccountId === (member?.jiraAccountId ?? '')
  return {
    mine,
    confirm: {
      key: story.key,
      title: story.title,
      owner: mine ? senderName : (story.assignee ?? 'someone else'),
      status: pick.item.status,
      comment: pick.item.words,
      blocker: null
    }
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
    sendBlockerAlert?: typeof sendBlockerAlert
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
  // SPEC-002 2f: Assigned To is the story's owner, as in Jira; Updated By is the
  // sender, so the comment holds only their words. The row is still the sender's,
  // so their participation counts and nobody's row is overwritten.
  const owner = story.assignee ?? payload.item.owner
  const said = payload.item.comment ?? ''
  const row: TrackerRow = {
    win: key,
    description: story.title,
    assignedTo: theirs ? senderName : owner,
    comment: said === '' ? null : said,
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

  // Item 14b: the blocker was held at intake; it is news only once submitted.
  // A failed alert never undoes the row that was just written.
  if (payload.item.blocker !== null) {
    try {
      const alert = await (deps.sendBlockerAlert ?? sendBlockerAlert)(
        team, senderId, senderName, today, [{ description: payload.item.blocker, storyRef: key }],
        new Map([[key, story]]), new Date()
      )
      if (!alert.sent) console.log(JSON.stringify({ event: 'foreignItem.alertNotSent', teamId: team.teamId, key, reason: alert.reason }))
    } catch (error) {
      console.error(JSON.stringify({ event: 'blockerAlert.failed', teamId: team.teamId, memberId: senderId, error: error instanceof Error ? error.message : String(error) }))
    }
  }

  return theirs
    ? `Recorded ${key} in the tracker.`
    : `Recorded ${key} in the tracker under ${owner}, as updated by you.`
}
