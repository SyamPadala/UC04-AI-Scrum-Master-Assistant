import type { JobType, RunOutcome, TeamConfig } from '../types.js'
import { activeTeams, claimRun, completeRun, releaseRun } from '../store/firestore.js'
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

/**
 * Runs one job that has already been claimed, and records what happened.
 *
 * Shared by the scheduler and by the `run` command so that triggering a job by
 * hand exercises the same code path the scheduler uses. A test that ran
 * something else would prove nothing.
 */
async function runClaimedJob (
  team: TeamConfig, jobType: JobType, today: string, llm: LlmClient, pm: PmClient
): Promise<TickEntry> {
  const startedAt = new Date()
  try {
    let outcome: RunOutcome
    let detail: string

    if (jobType === 'participation') {
      const record = await recordParticipation(team, trackerFor(team), today)
      const flags = await flagHabitualNonResponders(team, today)
      const percent = Math.round(record.rate * 100)
      const responded = record.entries.filter((e) => e.status === 'responded').length
      detail = `participation ${percent}% (${responded}/${record.entries.length})` +
        (flags.length > 0 ? `; flagged ${flags.map((f) => f.memberName).join(', ')}` : '')
      outcome = 'success'
    } else if (jobType === 'summary') {
      const result = await runSummary(team, today, { llm, pm, tracker: trackerFor(team) })
      // Reaching one of the two stakeholder routes is a real outcome, not a
      // failure — SPEC-006 item 8 keeps the half that worked.
      outcome = result.distribution.channel === 'sent' && result.distribution.email === 'sent'
        ? 'success'
        : result.distribution.channel === 'sent' || result.distribution.email === 'sent'
          ? 'partial'
          : 'failed'
      detail = result.distribution.detail
    } else {
      const result = jobType === 'reminder'
        ? await sendReminders(team)
        : await sendFollowUps(team, trackerFor(team), today)

      outcome = result.failed > 0 ? 'partial'
        : result.sent === 0 && result.skipped > 0 ? 'partial'
          : 'success'
      detail = result.detail
    }

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
 * Runs one job immediately, whether or not it is due and whether or not it has
 * already run today. Triggered by the `run` command.
 *
 * A development aid: the daily cycle is built to happen once at a set time, so
 * testing it otherwise means waiting for the clock. Any existing claim for the
 * day is dropped first, so the job can be run repeatedly.
 */
export async function runJobNow (
  team: TeamConfig, jobType: JobType, now: Date = new Date()
): Promise<TickEntry> {
  const today = localDate(now, team.timezone)
  await releaseRun(team.teamId, today, jobType)
  await claimRun(team.teamId, today, jobType)
  return await runClaimedJob(team, jobType, today, createLlm(), jiraClient())
}
