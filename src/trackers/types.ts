/** SPEC-002: one tracker row is one work item, or one unattached blocker. */
export type RowStatus = 'Completed' | 'In Progress' | 'Blocked'

export interface TrackerRow {
  /** Work item number, e.g. 'SCRUM-12'; null when the member named none (A8). */
  win: string | null
  /** The work item's title from Jira/ADO — never the member's own words. */
  description: string | null
  /** Member display name, taken from Teams. */
  assignedTo: string
  /** What the member said about this item, in their words; null on a blocker-only row. */
  comment: string | null
  status: RowStatus
  anyBlocker: string | null
}

export interface StandupUpdate {
  teamId: string
  memberId: string
  memberName: string
  /** 'YYYY-MM-DD' in the team's timezone. */
  localDate: string
  rows: TrackerRow[]
  /** Never written to the tracker; held only for the life of the request. */
  rawText: string
  capturedAt: Date
}

/** A blocker not yet cleared, whatever day it was raised (SPEC-002 4a). */
export interface OpenBlocker {
  /** Empty where the tracker only knows the member by name (SharePoint). */
  memberId: string
  member: string
  workItem: string | null
  description: string
  /** 'YYYY-MM-DD' the blocker was last reported. */
  since: string
}

export interface Tracker {
  /**
   * Records the member's rows for the day (A11: `rows` is the whole day,
   * already merged by the caller). SharePoint updates one row per member +
   * work item in place; Jira replaces that member's comments for the day.
   */
  write: (update: StandupUpdate) => Promise<void>
  /** Rows reported on this date. */
  readToday: (teamId: string, localDate: string) => Promise<StandupUpdate[]>
  /** The team's current impediments, read from current state — never from earlier days. */
  openBlockers: (teamId: string) => Promise<OpenBlocker[]>
}
