/** SPEC-006: what the app needs to know about a sprint. Jira only (decided 20 Sep 2026). */

export interface Story {
  key: string
  title: string
  status: string
  /** Jira's own grouping: 'To Do' | 'In Progress' | 'Done'. */
  statusCategory: string
  /** null when the issue carries no estimate — never silently 0 (SPEC-002, A6). */
  points: number | null
  assignee: string | null
  assigneeAccountId: string | null
  url: string
  /** Last time anything on the issue changed; A5 uses it to spot stalled work. */
  updated: Date
  /** User Story and Acceptance Criteria text from the description (SPEC-004 item 32); null when empty. */
  about?: string | null
  /** SPEC-004 item 44: the parent story's key when this is a sub-task; absent or null for a story. */
  parentKey?: string | null
}

/**
 * The work item's title as the tracker shows it (SPEC-004 item 44): a
 * sub-task names its parent, "Build form (sub-task of SCRUM-25)".
 */
export function trackerTitle (story: Pick<Story, 'title' | 'parentKey'>): string {
  return story.parentKey == null ? story.title : `${story.title} (sub-task of ${story.parentKey})`
}

export interface SprintData {
  sprintName: string
  goal: string
  startDate: Date | null
  endDate: Date | null
  committedPoints: number
  completedPoints: number
  /** Issues in the sprint with no estimate, counted rather than treated as zero. */
  unpointedCount: number
  /** Completed points for up to the last three closed sprints, oldest first (A6). */
  previousVelocities: number[]
  items: Story[]
}

/** Read-only view of Jira. Nothing here writes — the agents only ever read. */
export interface PmClient {
  /** The team's Jira project key, for reading "scrum 25" as SCRUM-25 (M10). Absent in older fakes. */
  readonly projectKey?: string
  getActiveSprint: () => Promise<{ id: number, name: string, goal: string, startDate: Date | null, endDate: Date | null } | undefined>
  getSprintData: () => Promise<SprintData | undefined>
  lookupStory: (key: string) => Promise<Story | undefined>
  getMemberOpenItems: (jiraAccountId: string) => Promise<Story[]>
  /** Every unfinished story in the active sprint, anyone's (SPEC-004 item 22). Empty with no active sprint. */
  getSprintOpenItems: () => Promise<Story[]>
}
