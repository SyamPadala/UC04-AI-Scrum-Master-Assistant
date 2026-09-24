import type { TeamConfig } from '../types.js'

/**
 * Input checks for the admin page (SPEC-008).
 *
 * Everything that arrives from the browser is untrusted and checked here, on
 * the server. Kept free of I/O so the rules can be unit tested.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
// Deliberately loose: the real check is that Graph or the mail server accepts
// it. This only catches typing mistakes before they are saved.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ScheduleInput {
  standupTime: string
  summaryTime: string
  timezone: string
  gracePeriodMinutes: number
  habitualThreshold: number
  active: boolean
}

export type Checked<T> = { ok: true, value: T } | { ok: false, problems: string[] }

function minutesOf (time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function isValidTimezone (timezone: string): boolean {
  if (timezone === '') return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function checkSchedule (raw: Record<string, unknown>, habitualWindowDays: number): Checked<ScheduleInput> {
  const standupTime = String(raw.standupTime ?? '').trim()
  const summaryTime = String(raw.summaryTime ?? '').trim()
  const timezone = String(raw.timezone ?? '').trim()
  const grace = Number(raw.gracePeriodMinutes)
  const threshold = Number(raw.habitualThreshold)
  const active = raw.active === true || raw.active === 'true'

  const problems: string[] = []
  if (!TIME_PATTERN.test(standupTime)) problems.push('Stand-up time must look like 09:00.')
  if (!TIME_PATTERN.test(summaryTime)) problems.push('Summary time must look like 18:00.')
  if (!Number.isInteger(grace) || grace < 5 || grace > 1440) {
    problems.push('Follow-up delay must be a whole number of minutes between 5 and 1440.')
  }
  // An unknown timezone would make every schedule comparison throw at tick
  // time, long after the person who typed it has gone.
  if (!isValidTimezone(timezone)) problems.push(`"${timezone}" is not a timezone I recognise. Try Asia/Kolkata.`)
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > habitualWindowDays) {
    problems.push(`Non-responder threshold must be a whole number from 1 to ${habitualWindowDays}.`)
  }

  // The follow-up chases people before the day closes; one scheduled after the
  // summary would chase them for a stand-up that is already shut (A14).
  if (problems.length === 0 && minutesOf(standupTime) + grace >= minutesOf(summaryTime)) {
    problems.push('The follow-up would go out after the summary. Move the summary later or shorten the follow-up delay.')
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    value: { standupTime, summaryTime, timezone, gracePeriodMinutes: grace, habitualThreshold: threshold, active }
  }
}

export function normaliseEmail (raw: unknown): string | undefined {
  const email = String(raw ?? '').trim().toLowerCase()
  return EMAIL_PATTERN.test(email) ? email : undefined
}

/** Only the team's Scrum Master, or a configured admin, may manage a team. */
export function mayManage (team: TeamConfig, userId: string, adminIds: readonly string[]): boolean {
  return userId !== '' && (userId === team.scrumMasterId || adminIds.includes(userId))
}
