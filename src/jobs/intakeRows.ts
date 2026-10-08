import type { Story } from '../pm/types.js'
import type { RowStatus, TrackerRow } from '../trackers/types.js'
import type { ExtractionOutput } from '../agents/schema.js'
import { ChoiceItem, MAX_CHOICES, Refusal } from './intakeTypes.js'

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

  // No General row here (SPEC-004 item 11, 28 Sep 2026): for a member with an
  // open story, an item that names no verified work item is reported back to
  // them, never filed. A member without one gets `generalRow` instead (item 39).
  return rows
}

/**
 * SPEC-004 item 39: a member with no open story of their own — or a team with
 * no sprint — has every part of the message filed as one General row (SPEC-002
 * 2b). Their words go in Comment, blockers in AnyBlocker, so the blocker is not
 * repeated; the Status is Blocked when there is one, otherwise In Progress.
 */
export function generalRow (
  output: Pick<ExtractionOutput, 'completed' | 'inProgress' | 'blockers'>, memberName: string
): TrackerRow {
  const join = (values: string[]): string | null => {
    const kept = [...new Set(values.map((v) => v.trim()).filter((v) => v !== ''))]
    return kept.length === 0 ? null : kept.join('; ')
  }
  const anyBlocker = join(output.blockers.map((b) => b.description))
  return {
    win: null,
    description: null,
    assignedTo: memberName,
    comment: join([...output.completed, ...output.inProgress].map((item) => item.comment)),
    status: anyBlocker === null ? 'In Progress' : 'Blocked',
    anyBlocker
  }
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
): {
  kept: Pick<ExtractionOutput, 'completed' | 'inProgress' | 'blockers'>
  refused: Refusal[]
  choices: ChoiceItem[]
  unlinkedBlockers: string[]
  /** Blockers to alert now: on her own story or on no story. Those on a card wait for it (item 38). */
  alertNow: ExtractionOutput['blockers']
} {
  const refused: Refusal[] = []
  const refuse = (refusal: Refusal): void => {
    const seen = refused.some((r) => refusal.reason === 'unassigned'
      ? r.reason === 'unassigned' && r.key === refusal.key
      : r.reason === 'noWorkItem' && r.words === refusal.words)
    if (!seen) refused.push(refusal)
  }
  const check = (ref: string | null): 'ok' | 'missing' | 'unassigned' | 'otherOwner' => {
    if (ref === null) return 'missing'
    const story = stories.get(ref)
    if (story === undefined) return 'missing'
    if (story.assigneeAccountId === jiraAccountId) return 'ok'
    // Unassigned: the Scrum Master assigns it first (user decision, 29 Sep 2026).
    return story.assigneeAccountId === null ? 'unassigned' : 'otherOwner'
  }

  // Item 38: her own open stories first, then every other (assigned) story the
  // item could fit. Other people's matches always stay; her own fill the rest.
  const own = [...stories.values()]
    .filter((story) => jiraAccountId !== '' && story.assigneeAccountId === jiraAccountId)
    .sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true }))
  const optionsFor = (keys: string[]): ChoiceItem['options'] => {
    const others = [...new Set(keys)]
      .map((key) => stories.get(key))
      .filter((story): story is Story => story !== undefined && story.assigneeAccountId !== null && story.assigneeAccountId !== jiraAccountId)
      .slice(0, MAX_CHOICES)
    const room = MAX_CHOICES - others.length
    return [
      ...own.slice(0, room).map((story) => ({ key: story.key, title: story.title, owner: story.assignee, mine: true })),
      ...others.map((story) => ({ key: story.key, title: story.title, owner: story.assignee, mine: false }))
    ]
  }

  // Someone else's story named by several parts of one message is one card.
  const choices: ChoiceItem[] = []
  const byKey = new Map<string, ChoiceItem>()
  const joined = (x: string | null, y: string): string => x === null || x === y ? y : `${x}; ${y}`
  const choiceFor = (key: string | null, keys: string[], words: string, status: RowStatus): ChoiceItem | undefined => {
    const existing = key === null ? undefined : byKey.get(key)
    if (existing !== undefined) {
      existing.words = joined(existing.words, words)
      existing.options = optionsFor([...existing.options.filter((o) => !o.mine).map((o) => o.key), ...keys])
      return existing
    }
    const options = optionsFor(keys)
    if (options.length === 0) return undefined
    const item: ChoiceItem = { words, status, blocker: null, options }
    choices.push(item)
    if (key !== null) byKey.set(key, item)
    return item
  }

  const keepItems = (items: ExtractionOutput['completed'], status: RowStatus): ExtractionOutput['completed'] => items.filter((item) => {
    const verdict = check(item.storyRef)
    if (verdict === 'ok') return true
    if (verdict === 'unassigned') {
      refuse({ reason: 'unassigned', key: item.storyRef as string })
      return false
    }
    const key = verdict === 'otherOwner' ? item.storyRef : null
    const choice = choiceFor(key, [...(key === null ? [] : [key]), ...(item.alternatives ?? [])], item.comment, status)
    if (choice === undefined) {
      refuse({ reason: 'noWorkItem', words: item.comment })
    } else if (status === 'Completed' || choice.status !== 'Completed') {
      // Completed stands over In Progress, as it does on the member's own rows.
      choice.status = status
    }
    return false
  })
  const completed = keepItems(output.completed, 'Completed')
  const inProgress = keepItems(output.inProgress, 'In Progress')

  const unlinkedBlockers: string[] = []
  const alertNow: ExtractionOutput['blockers'] = []
  const blockers = output.blockers.filter((blocker) => {
    const verdict = check(blocker.storyRef)
    if (verdict === 'ok') {
      alertNow.push(blocker)
      return true
    }
    if (verdict === 'unassigned') {
      refuse({ reason: 'unassigned', key: blocker.storyRef as string })
      alertNow.push(blocker)
      return false
    }
    const key = verdict === 'otherOwner' ? blocker.storyRef : null
    const keys = [...(key === null ? [] : [key]), ...(blocker.alternatives ?? [])]
    // Item 40: a blocker that fits no story at all asks which of her own open
    // stories it blocks; None of these files it as a General row. Only with no
    // open story of her own is it alerted at once, unfiled (item 19).
    const choice = choiceFor(key, keys, blocker.description, 'Blocked')
    if (choice !== undefined && keys.length === 0) choice.noStory = true
    if (choice === undefined) {
      unlinkedBlockers.push(blocker.description)
      alertNow.push({ ...blocker, storyRef: null })
      return false
    }
    choice.blocker = joined(choice.blocker, blocker.description)
    if (choice.status !== 'Completed') choice.status = 'Blocked'
    return false
  })

  return { kept: { completed, inProgress, blockers }, refused, choices, unlinkedBlockers, alertNow }
}
