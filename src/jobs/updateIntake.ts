import type { TeamConfig } from '../types.js'
import type { LlmClient } from '../llm/types.js'
import type { PmClient, Story } from '../pm/types.js'
import type { StandupUpdate, Tracker, TrackerRow } from '../trackers/types.js'
import type { ExtractionOutput } from '../agents/schema.js'
import { extractUpdate } from '../agents/updateProcessor.js'
import { sendBlockerAlert } from './blockerAlert.js'
import { summaryHasRun } from '../store/firestore.js'
import { config } from '../config/env.js'

/**
 * One member's message, from arrival to filed (SPEC-004, FR-02/03/04/06).
 *
 * Agent 1 decides what the message says. Everything after that — turning it
 * into rows, writing it, alerting the Scrum Master — is code. The agent is
 * never given the means to do any of it.
 */

export interface IntakeResult {
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
  output: ExtractionOutput, memberName: string, rawText: string, stories: Map<string, Story>
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

  // "Nothing to report" is participation, not absence. One row keeps the
  // member visible in the tracker and in the follow-up check (SPEC-002).
  if (rows.length === 0) {
    rows.push({
      win: null,
      description: null,
      assignedTo: memberName,
      comment: rawText,
      status: 'In Progress',
      anyBlocker: null
    })
  }
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
  }
): Promise<IntakeResult> {
  const receivedAt = new Date()
  const member = team.members.find((entry) => entry.memberId === memberId)

  const closed = await (deps.summaryHasRun ?? summaryHasRun)(team.teamId, localDate)
  if (closed) throw new StandupClosedError(localDate)

  const extraction = await extractUpdate(
    {
      text,
      memberId,
      memberName,
      teamId: team.teamId,
      jiraAccountId: member?.jiraAccountId ?? ''
    },
    deps.llm,
    deps.pm,
    config.agent1
  )

  const stories = await resolveStories(extraction.output, deps.pm, extraction.openItems)

  // What this message adds, merged into what the member already said today.
  // Read back from the tracker rather than from Firestore, because the tracker
  // is the only place update content lives (Privacy NFR).
  const existing = (await deps.tracker.readToday(team.teamId, localDate))
    .find((update) => update.memberName === memberName)?.rows ?? []

  const output = extraction.output
  const saidSomething =
    output.completed.length + output.inProgress.length + output.blockers.length > 0

  // "Nothing to report" from someone who has already reported adds nothing —
  // it must not overwrite the morning's rows with an empty placeholder.
  const incoming = saidSomething || existing.length === 0
    ? toTrackerRows(output, memberName, text, stories)
    : []

  const rows = mergeRows(existing, incoming)

  const update: StandupUpdate = {
    teamId: team.teamId,
    memberId,
    memberName,
    localDate,
    rows,
    rawText: text,
    capturedAt: receivedAt
  }
  await deps.tracker.write(update)

  // FR-06 is triggered from the validated extraction, after the update is
  // safely filed: a failed alert must never cost the member their update.
  let alertSent = false
  let alertReason: string | undefined
  try {
    const alert = await sendBlockerAlert(
      team, memberId, memberName, localDate, extraction.output.blockers, stories, receivedAt
    )
    alertSent = alert.sent
    alertReason = alert.reason
  } catch (error) {
    alertReason = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'blockerAlert.failed', teamId: team.teamId, memberId, error: alertReason }))
  }

  const totalMs = Date.now() - receivedAt.getTime()
  // The Latency NFR is measured from this number, so it is the real elapsed
  // time from message received to tracker written and alert sent.
  console.log(JSON.stringify({
    event: 'update.processed',
    teamId: team.teamId,
    memberId,
    rows: rows.length,
    added: incoming.length,
    blockers: extraction.output.blockers.length,
    confidence: extraction.output.confidence,
    extractionMs: extraction.durationMs,
    totalMs,
    withinLatencyBudget: totalMs <= 30_000
  }))

  return {
    rows: rows.length,
    added: incoming.length,
    blockers: extraction.output.blockers.length,
    alertSent,
    ...(alertReason === undefined ? {} : { alertReason }),
    extractionMs: extraction.durationMs,
    totalMs,
    truncated: extraction.truncated,
    confidence: extraction.output.confidence
  }
}
