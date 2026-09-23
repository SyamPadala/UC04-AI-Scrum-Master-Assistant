import type { JobType, RunOutcome, TeamConfig } from '../types.js'
import { activeTeams, claimRun, completeRun, logManualRun, releaseRun } from '../store/firestore.js'
import { isDue } from './schedule.js'
import { localDate } from '../config/time.js'
import { sendFollowUps, sendReminders } from './reminder.js'
import { flagHabitualNonResponders, recordParticipation } from './participation.js'
import { trackerFor } from '../trackers/factory.js'
import { runSummary } from './summary.js'
import { createLlm } from '../llm/index.js'
import { JiraClient } from '../pm/jira.js'
import { config } from '../config/env.js'
import { LlmBudgetError, LlmOfflineError, type LlmClient } from '../llm/types.js'
import type { PmClient } from '../pm/types.js'

export interface TickEntry {
  teamId: string
  jobType: JobType
  outcome: RunOutcome
  detail?: string
}

// Order matters: the summary is built before participation is counted, so the
// figures the summary quotes are the ones that were true when it ran.
const JOBS: JobType[] = ['reminder', 'followup', 'summary', 'participation']

/**
 * One scheduler heartbeat.
 *
 * Teams are independent: a failure in one never stops another (FR-10), and a
 * job-level failure never fails the request — Cloud Scheduler would otherwise
 * retry the whole tick and re-run work that already succeeded.
 */
function jiraClient (): PmClient {
  return new JiraClient({
    baseUrl: config.jira.baseUrl,
    email: config.jira.email,
    apiToken: config.jira.apiToken,
    projectKey: config.jira.projectKey,
    storyPointsField: config.jira.storyPointsField,
    boardId: config.jira.boardId
  })
}

export async function runTick (
  now: Date = new Date(),
  deps: { llm?: LlmClient, pm?: PmClient } = {}
): Promise<TickEntry[]> {
  const entries: TickEntry[] = []
  const teams = await activeTeams()

  // Built once per tick rather than per team: both are stateless, and the
  // summary job is the only caller that needs them.
  const llm = deps.llm ?? createLlm()
  const pm = deps.pm ?? jiraClient()

  for (const team of teams) {
    const today = localDate(now, team.timezone)

    for (const jobType of JOBS) {
      if (!isDue(team, jobType, now)) continue
      if (!await claimRun(team.teamId, today, jobType)) continue
      entries.push(await runClaimedJob(team, jobType, today, llm, pm))
    }
  }

  return entries
}

/** Which of the two flows started a job. */
export type Trigger = 'scheduled' | 'manual'

/**
 * Runs one job that the scheduler has claimed, and records what happened
 * against that claim.
 */
async function runClaimedJob (
  team: TeamConfig, jobType: JobType, today: string, llm: LlmClient, pm: PmClient
): Promise<TickEntry> {
  const startedAt = new Date()
  try {
    const { outcome, detail } = await executeJob(team, jobType, today, llm, pm, 'scheduled')
    await completeRun(team.teamId, today, jobType, outcome, startedAt, detail)
    return { teamId: team.teamId, jobType, outcome, detail }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // Log first, then release: the log is a separate document, so releasing
    // afterwards leaves no claim behind and the next tick retries.
    await completeRun(team.teamId, today, jobType, 'failed', startedAt, detail)

    // A spent budget or a switched-off model will fail identically on the
    // next tick. Releasing the claim would retry it every five minutes
    // until midnight — 288 attempts at a problem only a person can fix.
    const willRecur = error instanceof LlmBudgetError || error instanceof LlmOfflineError
    if (!willRecur) await releaseRun(team.teamId, today, jobType)

    return {
      teamId: team.teamId,
      jobType,
      outcome: 'failed',
      detail: willRecur ? `${detail} (not retried today)` : detail
    }
  }
}

/**
 * The job itself, shared by both flows so that a manual run exercises the
 * same code the scheduler runs. A test that ran something else would prove
 * nothing.
 *
 * The trigger decides only what the job leaves behind for the scheduler to
 * read. A manual participation count is reported but not saved, because the
 * saved record and the flags are what the scheduled count builds on.
 */
async function executeJob (
  team: TeamConfig, jobType: JobType, today: string,
  llm: LlmClient, pm: PmClient, trigger: Trigger
): Promise<{ outcome: RunOutcome, detail: string }> {
  const persist = trigger === 'scheduled'

  if (jobType === 'participation') {
    const record = await recordParticipation(team, trackerFor(team), today, { persist })
    const flags = await flagHabitualNonResponders(team, today, { todayRecord: record, persist })
    const percent = Math.round(record.rate * 100)
    const responded = record.entries.filter((e) => e.status === 'responded').length
    const flagWord = persist ? 'flagged' : 'would flag'
    return {
      outcome: 'success',
      detail: `participation ${percent}% (${responded}/${record.entries.length})` +
        (flags.length > 0 ? `; ${flagWord} ${flags.map((f) => f.memberName).join(', ')}` : '')
    }
  }

  if (jobType === 'summary') {
    const result = await runSummary(team, today, { llm, pm, tracker: trackerFor(team) })
    // Reaching one of the two stakeholder routes is a real outcome, not a
    // failure — SPEC-006 item 8 keeps the half that worked.
    const outcome: RunOutcome =
      result.distribution.channel === 'sent' && result.distribution.email === 'sent'
        ? 'success'
        : result.distribution.channel === 'sent' || result.distribution.email === 'sent'
          ? 'partial'
          : 'failed'
    return { outcome, detail: result.distribution.detail }
  }

  const result = jobType === 'reminder'
    ? await sendReminders(team)
    : await sendFollowUps(team, trackerFor(team), today)

  const outcome: RunOutcome = result.failed > 0 ? 'partial'
    : result.sent === 0 && result.skipped > 0 ? 'partial'
      : 'success'
  return { outcome, detail: result.detail }
}

/**
 * Runs one job immediately, for testing and demos. Triggered by the `run`
 * command.
 *
 * Isolated from the scheduler: it never reads, takes or releases the day's run
 * claim. So a manual run neither uses up the scheduled job nor closes the
 * stand-up (A14), and the scheduled cycle carries on exactly as if the manual
 * run had not happened. It is logged, marked as manual, for the record.
 */
export async function runJobNow (
  team: TeamConfig, jobType: JobType, now: Date = new Date()
): Promise<TickEntry> {
  const today = localDate(now, team.timezone)
  const startedAt = new Date()
  try {
    const { outcome, detail } = await executeJob(team, jobType, today, createLlm(), jiraClient(), 'manual')
    await logManualRun(team.teamId, today, jobType, outcome, startedAt, detail)
    return { teamId: team.teamId, jobType, outcome, detail }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await logManualRun(team.teamId, today, jobType, 'failed', startedAt, detail)
    return { teamId: team.teamId, jobType, outcome: 'failed', detail }
  }
}
