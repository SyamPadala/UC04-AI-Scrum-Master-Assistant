/** SPEC-001 shared types. */

export type JobType = 'reminder' | 'followup' | 'summary' | 'participation'

export interface Member {
  /** Entra object id — this person's identity in Microsoft 365 and Teams. */
  memberId: string
  displayName: string
  /** Work address, recorded when the member is added from the admin page. */
  email?: string
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
  /**
   * Onboarding steps ticked by hand on the admin page (SPEC-008 10m): who and
   * when. Metadata only. Tracker access is ticked when it can't be checked.
   */
  onboarding?: { trackerAccess?: { by: string, at: string } }
}

/** SPEC-008 10n: a removed member's offboarding checklist, until it is marked finished. */
export interface Leaver {
  memberId: string
  displayName: string
  email?: string
  removedBy: string
  removedAt: string
  items: Array<{ label: string, state: 'auto' | 'manual', detail: string }>
}

/** A team's Scrum Master as the jobs need them: who, and how to reach them. */
export interface ScrumMaster {
  memberId: string
  displayName: string
  email?: string
  conversationRef?: string
}

export type TrackerConfig =
  | { kind: 'sharepoint', siteId: string, listId: string }
  | { kind: 'mock', path: string }
  /** FR-04 destination 3: comments on the Jira work items (SPEC-002). */
  | { kind: 'jira', projectKey: string, standupIssueKey: string }
  /** SPEC-008 10q (M11): a new team has no tracker until an admin picks its own list. */
  | { kind: 'unset' }

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
  /**
   * Days the scheduled jobs run, 0 = Sunday … 6 = Saturday, in the team's
   * timezone (SPEC-003 item 9). Absent means Monday to Friday.
   */
  workingDays?: number[]
  members: Member[]
  /**
   * The Scrum Master is a role, not a roster entry (SPEC-008 10f, 29 Sep 2026).
   * One person may run several teams; their chat lives in `scrumMasters/`.
   */
  scrumMasterId: string
  /** Shown on the page; kept here so a team reads without a Graph call. */
  scrumMasterName?: string
  scrumMasterEmail?: string
  /** A3: missed days inside the rolling window before a member is flagged. */
  habitualThreshold: number
  habitualWindowDays: number
  tracker: TrackerConfig
  stakeholders: { channelId?: string, emails: string[] }
  /**
   * The team's Teams team, a Microsoft 365 group (SPEC-008 10m), set by an
   * admin. Absent: the team's own id, when that is a Teams team (Scrum Team
   * Alpha was created from its Teams team).
   */
  teamsGroupId?: string
  teamsGroupName?: string
  /** SPEC-008 10n: members removed whose offboarding is not yet marked finished. Metadata only. */
  leaving?: Leaver[]
  /**
   * SPEC-008 10p (M10): the team's own Jira project, chosen by an admin. Absent
   * = the team works without Jira: every update is a general update. The Jira
   * site and the assistant's login stay deployment settings.
   */
  jira?: { projectKey: string, boardId?: string, boardName?: string }
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
  /** Absent on scheduled runs, which predate the field. */
  trigger?: 'manual'
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

/**
 * A Teams team the app is installed in (SPEC-008 behaviour 6). Not one of our
 * scrum teams: the source the stakeholder channel is chosen from.
 */
export interface BotTeam {
  /** The Teams team's thread id, which is also its General channel's id. */
  teamThreadId: string
  name: string
  /** A conversation reference into this Teams team, JSON. */
  reference: string
  seenAt: Date
}

export interface ConfigChange {
  teamId: string
  changedBy: string
  changedAt: Date
  fields: Array<{ field: string, from: unknown, to: unknown }>
}
