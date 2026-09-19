/** SPEC-001 shared types. */

export type JobType = 'reminder' | 'followup' | 'summary' | 'participation'

export interface Member {
  /** Entra object id — this person's identity in Microsoft 365 and Teams. */
  memberId: string
  displayName: string
  /**
   * This person's Jira account id (SPEC-002, item 5b).
   *
   * Stored explicitly rather than matched on display name or email: Jira names
   * are owned by the person's own Atlassian profile and cannot be set by the
   * site admin, and Jira hides other users' email addresses by default. Any
   * matching scheme therefore breaks silently the moment someone is renamed.
   * Undefined means the link has not been made; the code must treat that as
   * "unknown", never as "no match".
   */
  jiraAccountId?: string
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
  /** A3: missed days inside the rolling window before a member is flagged. */
  habitualThreshold: number
  habitualWindowDays: number
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

export interface ParticipationEntry {
  memberId: string
  memberName: string
  status: 'responded' | 'missed'
  respondedAt?: Date
  withinGrace?: boolean
}

export interface ParticipationRecord {
  teamId: string
  localDate: string
  entries: ParticipationEntry[]
  /** 0..1, measured at the cut-off. */
  rate: number
}

export interface NonResponderFlag {
  teamId: string
  memberId: string
  memberName: string
  missedDates: string[]
  flaggedAt: Date
}

export interface ConfigChange {
  teamId: string
  changedBy: string
  changedAt: Date
  fields: Array<{ field: string, from: unknown, to: unknown }>
}
