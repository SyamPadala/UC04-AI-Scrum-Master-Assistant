import { z } from 'zod'
import { HttpError, httpErrorFrom, withRetry } from '../util/retry.js'
import type { PmClient, SprintData, Story } from './types.js'

/**
 * Jira Cloud, read only (SPEC-006).
 *
 * Two APIs, not one: issues and fields live under /rest/api/3, while boards and
 * sprints live under /rest/agile/1.0 and do not exist in the REST v3 surface at
 * all. That split is Atlassian's, not ours.
 *
 * Nothing here writes to Jira. The agents reach it only through the read-only
 * tools in `agents/tools/`.
 */

export interface JiraOptions {
  baseUrl: string
  email: string
  apiToken: string
  projectKey: string
  /** Per-site custom field id; unset means points are unknown, not zero. */
  storyPointsField: string
  boardId?: string
}

// Jira returns far more than we use. Each schema keeps the fields we rely on
// and tolerates the rest, so an unrelated Jira change cannot break a parse.
const issueSchema = z.object({
  key: z.string(),
  fields: z.looseObject({
    summary: z.string().nullish(),
    updated: z.string().nullish(),
    status: z.object({
      name: z.string(),
      statusCategory: z.object({ name: z.string() }).nullish()
    }).nullish(),
    assignee: z.object({
      displayName: z.string().nullish(),
      accountId: z.string().nullish()
    }).nullish()
  })
})

const searchSchema = z.object({ issues: z.array(issueSchema).default([]) })

const sprintSchema = z.object({
  id: z.number(),
  name: z.string(),
  state: z.string(),
  goal: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  completeDate: z.string().nullish()
})

const sprintListSchema = z.object({ values: z.array(sprintSchema).default([]) })
const boardListSchema = z.object({
  values: z.array(z.object({ id: z.number(), name: z.string() })).default([])
})

type RawIssue = z.infer<typeof issueSchema>

function parseDate (value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export class JiraClient implements PmClient {
  private boardIdCache?: number

  constructor (private readonly options: JiraOptions) {}

  private get authHeader (): string {
    // Jira Cloud uses HTTP Basic with the API token as the password.
    const encoded = Buffer.from(`${this.options.email}:${this.options.apiToken}`).toString('base64')
    return `Basic ${encoded}`
  }

  /** One GET, retried on 429 and 5xx, parsed through the given schema. */
  private async get<T> (path: string, schema: z.ZodType<T>, label: string): Promise<T> {
    const body = await withRetry(async () => {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        headers: { authorization: this.authHeader, accept: 'application/json' }
      })
      if (!response.ok) throw await httpErrorFrom(response)
      return await response.json() as unknown
    }, { label })

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')
      throw new Error(`Jira ${label}: unexpected response shape — ${detail}`)
    }
    return parsed.data
  }

  /** The board carrying this project. Resolved once, then remembered. */
  private async boardId (): Promise<number> {
    if (this.boardIdCache !== undefined) return this.boardIdCache

    if (this.options.boardId !== undefined && this.options.boardId !== '') {
      this.boardIdCache = Number(this.options.boardId)
      return this.boardIdCache
    }

    const boards = await this.get(
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(this.options.projectKey)}`,
      boardListSchema, 'board lookup'
    )
    const first = boards.values[0]
    if (first === undefined) {
      throw new Error(`no Jira board found for project ${this.options.projectKey}`)
    }
    this.boardIdCache = first.id
    return first.id
  }

  private toStory (raw: RawIssue): Story {
    const fields = raw.fields as Record<string, unknown>
    const pointsRaw = this.options.storyPointsField === ''
      ? undefined
      : fields[this.options.storyPointsField]
    const points = typeof pointsRaw === 'number' ? pointsRaw : null

    return {
      key: raw.key,
      title: raw.fields.summary ?? '(no summary)',
      status: raw.fields.status?.name ?? 'Unknown',
      statusCategory: raw.fields.status?.statusCategory?.name ?? 'Unknown',
      points,
      assignee: raw.fields.assignee?.displayName ?? null,
      assigneeAccountId: raw.fields.assignee?.accountId ?? null,
      url: `${this.options.baseUrl}/browse/${raw.key}`,
      updated: parseDate(raw.fields.updated) ?? new Date(0)
    }
  }

  private get issueFields (): string {
    const base = ['summary', 'status', 'assignee', 'updated']
    if (this.options.storyPointsField !== '') base.push(this.options.storyPointsField)
    return base.join(',')
  }

  async getActiveSprint (): Promise<{
    id: number, name: string, goal: string, startDate: Date | null, endDate: Date | null
  } | undefined> {
    const board = await this.boardId()
    const sprints = await this.get(
      `/rest/agile/1.0/board/${board}/sprint?state=active`, sprintListSchema, 'active sprint'
    )
    const sprint = sprints.values[0]
    if (sprint === undefined) return undefined

    return {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal ?? '',
      startDate: parseDate(sprint.startDate),
      endDate: parseDate(sprint.endDate)
    }
  }

  private async sprintIssues (sprintId: number): Promise<Story[]> {
    const issues = await this.get(
      `/rest/agile/1.0/sprint/${sprintId}/issue?fields=${this.issueFields}&maxResults=100`,
      searchSchema, `sprint ${sprintId} issues`
    )
    return issues.issues.map((raw) => this.toStory(raw))
  }

  /**
   * Completed points for up to the last three closed sprints, oldest first (A6).
   *
   * Fewer than three is reported as what exists rather than padded with
   * zeroes — a padded zero reads as a sprint that delivered nothing.
   */
  private async previousVelocities (): Promise<number[]> {
    const board = await this.boardId()
    const closed = await this.get(
      `/rest/agile/1.0/board/${board}/sprint?state=closed`, sprintListSchema, 'closed sprints'
    )
    const recent = closed.values
      .sort((a, b) => (parseDate(b.completeDate)?.getTime() ?? 0) - (parseDate(a.completeDate)?.getTime() ?? 0))
      .slice(0, 3)
      .reverse()

    const velocities: number[] = []
    for (const sprint of recent) {
      const issues = await this.sprintIssues(sprint.id)
      velocities.push(issues
        .filter((issue) => issue.statusCategory === 'Done')
        .reduce((total, issue) => total + (issue.points ?? 0), 0))
    }
    return velocities
  }

  /**
   * Everything the summary needs about the current sprint.
   *
   * Undefined when no sprint is active — SPEC-006 requires the summary to say
   * so plainly rather than invent figures.
   */
  async getSprintData (): Promise<SprintData | undefined> {
    const sprint = await this.getActiveSprint()
    if (sprint === undefined) return undefined

    const items = await this.sprintIssues(sprint.id)
    // Unpointed issues are excluded from the arithmetic and counted separately.
    // Treating an absent estimate as zero silently understates completion (A6).
    const pointed = items.filter((issue) => issue.points !== null)

    return {
      sprintName: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      committedPoints: pointed.reduce((total, issue) => total + (issue.points ?? 0), 0),
      completedPoints: pointed
        .filter((issue) => issue.statusCategory === 'Done')
        .reduce((total, issue) => total + (issue.points ?? 0), 0),
      unpointedCount: items.length - pointed.length,
      previousVelocities: await this.previousVelocities(),
      items
    }
  }

  /** A single issue by key. Undefined when the key does not exist (SPEC-004). */
  async lookupStory (key: string): Promise<Story | undefined> {
    try {
      const issue = await this.get(
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${this.issueFields}`,
        issueSchema, `issue ${key}`
      )
      return this.toStory(issue)
    } catch (error) {
      // A key the member invented is a normal outcome, not a failure.
      if (error instanceof HttpError && error.status === 404) return undefined
      throw error
    }
  }

  /**
   * The member's unfinished work in the active sprint.
   *
   * Keyed on the stored Jira account id, never on a display name or email
   * (SPEC-002, checklist item 5b). An unlinked member yields nothing, which the
   * caller must read as "not linked", never as "nothing assigned".
   */
  async getMemberOpenItems (jiraAccountId: string): Promise<Story[]> {
    if (jiraAccountId === '') return []

    const sprint = await this.getActiveSprint()
    if (sprint === undefined) return []

    const items = await this.sprintIssues(sprint.id)
    return items.filter(
      (issue) => issue.assigneeAccountId === jiraAccountId && issue.statusCategory !== 'Done'
    )
  }
}
