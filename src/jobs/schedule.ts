import type { JobType, TeamConfig } from '../types.js'

/** The team's local 'HH:mm' at this instant. */
export function localTime (at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(at)
}

function toMinutes (hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

/** The local time each job is scheduled for, in minutes past local midnight. */
export function scheduledMinutes (team: TeamConfig, jobType: JobType): number {
  switch (jobType) {
    case 'reminder': return toMinutes(team.standupTime)
    // A2: the cut-off is the reminder time plus the grace period.
    case 'followup': return toMinutes(team.standupTime) + team.gracePeriodMinutes
    case 'summary': return toMinutes(team.summaryTime)
    // Participation is counted once the day's summary has gone out.
    case 'participation': return toMinutes(team.summaryTime) + 5
  }
}

/**
 * Whether a job is due now.
 *
 * Due means the team's local time has reached the job's configured time on the
 * current local date. It stays due for the rest of the day; the run claim, not
 * this function, is what stops it running twice. That way a tick missed at
 * 09:00 still sends the reminder at 09:05 rather than skipping the day.
 */
export function isDue (team: TeamConfig, jobType: JobType, at: Date): boolean {
  return toMinutes(localTime(at, team.timezone)) >= scheduledMinutes(team, jobType)
}
