import type { JobType, RunOutcome, TeamConfig } from '../types.js'
import { activeTeams, claimRun, completeRun, releaseRun } from '../store/firestore.js'
import { isDue } from './schedule.js'
import { localDate } from '../config/time.js'
import { sendFollowUps, sendReminders } from './reminder.js'
import { flagHabitualNonResponders, recordParticipation } from './participation.js'
import { SharePointTracker } from '../trackers/sharepoint.js'
import type { Tracker } from '../trackers/types.js'

export interface TickEntry {
  teamId: string
  jobType: JobType
  outcome: RunOutcome
  detail?: string
}

/** Jobs that exist today. The summary arrives with SPEC-006 and the LLM. */
const JOBS: JobType[] = ['reminder', 'followup', 'participation']

function trackerFor (team: TeamConfig): Tracker {
  switch (team.tracker.kind) {
    case 'sharepoint':
      return new SharePointTracker(team.tracker.siteId, team.tracker.listId)
    case 'mock':
      throw new Error('mock tracker is not wired up yet')
  }
}

/**
 * One scheduler heartbeat.
 *
 * Teams are independent: a failure in one never stops another (FR-10), and a
 * job-level failure never fails the request — Cloud Scheduler would otherwise
 * retry the whole tick and re-run work that already succeeded.
 */
export async function runTick (now: Date = new Date()): Promise<TickEntry[]> {
  const entries: TickEntry[] = []
  const teams = await activeTeams()

  for (const team of teams) {
    const today = localDate(now, team.timezone)

    for (const jobType of JOBS) {
      if (!isDue(team, jobType, now)) continue
      if (!await claimRun(team.teamId, today, jobType)) continue

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
        entries.push({ teamId: team.teamId, jobType, outcome, detail })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        // Log first, then release: the log is a separate document, so releasing
        // afterwards leaves no claim behind and the next tick retries.
        await completeRun(team.teamId, today, jobType, 'failed', startedAt, detail)
        await releaseRun(team.teamId, today, jobType)
        entries.push({ teamId: team.teamId, jobType, outcome: 'failed', detail })
      }
    }
  }

  return entries
}
