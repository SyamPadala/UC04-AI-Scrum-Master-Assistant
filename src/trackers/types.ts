/** SPEC-002: one tracker row is one work item, or one unattached blocker. */
export type RowStatus = 'Completed' | 'In Progress' | 'Blocked'

export interface TrackerRow {
  /** Work item number, e.g. 'SCRUM-12'; null when the member named none (A8). */
  win: string | null
  /** The work item's title from Jira/ADO — never the member's own words. */
  description: string | null
  /** Member display name, taken from Teams. */
  assignedTo: string
  /** What the member said about this item, in their words; null on a Blocked row. */
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

export interface Tracker {
  /** Upsert on member + date: that member's rows for the day are replaced, not appended (A11). */
  write: (update: StandupUpdate) => Promise<void>
  readToday: (teamId: string, localDate: string) => Promise<StandupUpdate[]>
}
