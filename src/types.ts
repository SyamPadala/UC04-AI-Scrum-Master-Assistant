/** SPEC-001 shared types. */

export type JobType = 'reminder' | 'followup' | 'summary' | 'participation'

export interface Member {
  /** Entra object id. */
  memberId: string
  displayName: string
  /** Set when the app is installed for this person; without it they cannot be messaged. */
  conversationRef?: string
}

export type TrackerConfig =
  | { kind: 'sharepoint', siteId: string, listId: string }
  | { kind: 'mock', path: string }

export interface TeamConfig {
  teamId: string
  name: string
  active: boolean
  /** IANA zone, e.g. 'Asia/Kolkata'. */
  timezone: string
  /** 'HH:mm' local. */
  standupTime: string
  /** A2: the follow-up runs this many minutes after standupTime. */
  gracePeriodMinutes: number
  /** 'HH:mm' local (A4). */
  summaryTime: string
  members: Member[]
  scrumMasterId: string
  tracker: TrackerConfig
  stakeholders: { channelId?: string, emails: string[] }
}

export type RunOutcome = 'success' | 'partial' | 'failed' | 'skipped'

export interface RunLog {
  teamId: string
  jobType: JobType
  localDate: string
  outcome: RunOutcome
  startedAt: Date
  durationMs: number
  detail?: string
}
