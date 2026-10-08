import type { TeamConfig } from '../types.js'
import type { LlmClient } from '../llm/types.js'
import type { PmClient, Story } from '../pm/types.js'
import type { StandupUpdate, Tracker, TrackerRow } from '../trackers/types.js'
import type { ExtractionOutput } from '../agents/schema.js'
import { extractUpdate } from '../agents/updateProcessor.js'
import { collapseRows } from '../trackers/rows.js'
import { sendBlockerAlert } from './blockerAlert.js'
import { alertNoSprint } from './noSprintAlert.js'
import { summaryHasRun } from '../store/index.js'
import { config } from '../config/env.js'
import { IntakeOutcome, IntakeResult, RecordedItem, StandupClosedError } from './intakeTypes.js'
import { generalRow, mergeRows, toTrackerRows, verifyItems } from './intakeRows.js'

/**
 * One member's message, from arrival to filed (SPEC-004, FR-02/03/04/06).
 *
 * Agent 1 decides what the message says. Everything after that — turning it
 * into rows, writing it, alerting the Scrum Master — is code. The agent is
 * never given the means to do any of it.
 */

/** Reads the real titles for every work item the extraction referred to. */
export async function resolveStories (output: ExtractionOutput, pm: PmClient, known: Story[]): Promise<Map<string, Story>> {
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
    alertNoSprint?: (team: TeamConfig, localDate: string) => Promise<{ sent: boolean, already?: boolean, reason?: string }>
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
    choices: [],
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

  // Item 20 replaced by item 42 (M12, 8 Oct 2026): a member not linked to Jira
  // owns no story, so their work is matched by context and confirmed on a card,
  // and what fits nothing goes into their General row.
  if (jiraAccountId === '') console.log(JSON.stringify({ event: 'update.notLinked', teamId: team.teamId, memberId }))

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

  let stories = new Map<string, Story>()
  let alertable: ExtractionOutput['blockers']
  let result: IntakeResult
  if (extraction.general) {
    // Item 39: no sprint, or no open story of their own. Every part goes into
    // the member's one General row — no matching, no card — and they count as
    // having responded. Later messages today join the same row (A11).
    const incoming = generalRow(output, memberName)
    const existing = today.find((update) => update.memberName === memberName)?.rows ?? []
    const rows = mergeRows(existing, [incoming])
    await deps.tracker.write({
      teamId: team.teamId, memberId, memberName, localDate, rows, rawText: text, capturedAt: receivedAt
    })

    // Items 12 and 39(a): with no sprint at all, the Scrum Master still hears
    // once a day per team, in case the sprint was simply never started.
    let noSprintAlertSent: boolean | undefined
    if (sprint === undefined) {
      noSprintAlertSent = false
      try {
        const alert = await (deps.alertNoSprint ?? alertNoSprint)(team, localDate)
        noSprintAlertSent = alert.sent || alert.already === true
        if (!alert.sent) console.log(JSON.stringify({ event: 'noSprintAlert.notSent', teamId: team.teamId, reason: alert.reason }))
      } catch (error) {
        console.error(JSON.stringify({ event: 'noSprintAlert.failed', teamId: team.teamId, error: String(error) }))
      }
    }
    result = base('general', extraction.durationMs, {
      ...common,
      ...(noSprintAlertSent === undefined ? {} : { noSprintAlertSent }),
      general: { said: incoming.comment, blocker: incoming.anyBlocker },
      rows: collapseRows(rows).length,
      added: 1
    })
    // A blocker in a General row belongs to no story: alerted at once (item 19).
    alertable = output.blockers.map((b) => ({ ...b, storyRef: null, alternatives: [] }))
  } else {
    // Seeded with every story offered to the model, so owners and titles are known.
    stories = await resolveStories(output, deps.pm, extraction.candidates)
    const verified = verifyItems(output, stories, jiraAccountId)

    // Items 11, 13, 14, 18: only verified items are written; the rest go back
    // to the member with their reason in the same reply.
    const incoming = toTrackerRows(verified.kept, memberName, stories)
    // Item 42 (M12): with no story of their own, work that fits no story and
    // blockers on no story are not refused — they are the member's General row.
    let general: TrackerRow | undefined
    if (extraction.noOwnStory) {
      const leftover = verified.refused.flatMap((r) => r.reason === 'noWorkItem' ? [r.words] : [])
      if (leftover.length + verified.unlinkedBlockers.length > 0) {
        general = generalRow({
          completed: [],
          inProgress: leftover.map((comment) => ({ storyRef: null, comment, reason: null, alternatives: [] })),
          blockers: verified.unlinkedBlockers.map((description) => ({ description, storyRef: null, reason: null, alternatives: [] }))
        }, memberName)
        incoming.push(general)
        verified.refused = verified.refused.filter((r) => r.reason !== 'noWorkItem')
        verified.unlinkedBlockers = []
      }
    }
    const existing = today.find((update) => update.memberName === memberName)?.rows ?? []
    const rows = mergeRows(existing, incoming)

    if (incoming.length > 0) {
      const update: StandupUpdate = {
        teamId: team.teamId, memberId, memberName, localDate, rows, rawText: text, capturedAt: receivedAt
      }
      await deps.tracker.write(update)
    }

    const recorded: RecordedItem[] = collapseRows(incoming.filter((row) => row !== general)).map((row) => ({
      win: row.win as string, title: row.description, status: row.status, blocker: row.anyBlocker, said: row.comment
    }))
    result = base(general !== undefined ? 'general' : incoming.length > 0 ? 'recorded' : 'nothingRecorded', extraction.durationMs, {
      ...common,
      ...(general === undefined ? {} : { general: { said: general.comment, blocker: general.anyBlocker } }),
      recorded,
      refused: verified.refused,
      choices: verified.choices,
      unlinkedBlockers: verified.unlinkedBlockers,
      rows: rows.length,
      added: incoming.length
    })
    alertable = verified.alertNow
  }

  // FR-06 is triggered from the validated extraction, after anything that was
  // going to be filed is filed: a failed alert must never cost the member their
  // update. Every blocker is alerted, written or not (item 19), except one on
  // a choice card: that waits for the member's answer (items 14b, 38).
  result.blockers = alertable.length
  try {
    const alert = await sendBlockerAlert(
      team, memberId, memberName, localDate, alertable, stories, receivedAt,
      extraction.openItems.map((item) => ({ key: item.key, title: item.title, url: item.url }))
    )
    result.alertSent = alert.sent
    result.alertCode = alert.code
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
    choices: result.choices.length,
    unlinkedBlockers: result.unlinkedBlockers.length,
    blockers: result.blockers,
    confidence: output.confidence,
    extractionMs: extraction.durationMs,
    totalMs: result.totalMs,
    withinLatencyBudget: result.totalMs <= 30_000
  }))
  return result
}

// Split by responsibility (design review, 8 Oct 2026); callers keep importing from here.
export * from './intakeTypes.js'
export * from './intakeRows.js'
