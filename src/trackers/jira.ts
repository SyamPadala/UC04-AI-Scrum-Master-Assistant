import { z } from 'zod'
import { httpErrorFrom, withRetry } from '../util/retry.js'
import type { OpenBlocker, StandupUpdate, Tracker, TrackerRow } from './types.js'

/**
 * Jira comment tracker (SPEC-002, FR-04 destination 3).
 *
 * Each member's update becomes a comment on the work item it is about. Rows
 * with no work item go to one configured "daily stand-up" issue. A later
 * message from the same member the same day replaces their comments (A11),
 * the same upsert the SharePoint list does.
 *
 * The comment is written twice over: once as readable text for people, and
 * once as a comment property holding the rows as data. The property is what
 * `readToday` reads back, so the summary never has to parse prose.
 */

export interface JiraTrackerOptions {
  baseUrl: string
  email: string
  apiToken: string
  projectKey: string
  /** Receives rows that name no work item, e.g. 'SCRUM-30'. */
  standupIssueKey: string
}

/** The comment property key. Namespaced so it cannot collide with another app's. */
export const PROPERTY_KEY = 'uc04.scrumAssistant.standup'

interface StandupProperty {
  teamId: string
  memberId: string
  memberName: string
  localDate: string
  rows: TrackerRow[]
}

const rowSchema = z.object({
  win: z.string().nullable(),
  description: z.string().nullable(),
  assignedTo: z.string(),
  comment: z.string().nullable(),
  status: z.enum(['Completed', 'In Progress', 'Blocked']),
  anyBlocker: z.string().nullable()
})

const propertySchema = z.object({
  teamId: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  localDate: z.string(),
  rows: z.array(rowSchema)
})

const commentPageSchema = z.object({
  comments: z.array(z.object({
    id: z.string(),
    properties: z.array(z.object({ key: z.string(), value: z.unknown() })).default([])
  })).default([]),
  total: z.number().default(0)
})

const searchSchema = z.object({
  issues: z.array(z.object({ key: z.string() })).default([])
})

/** Which issue each row's comment belongs on. Rows for one issue share a comment. */
export function groupByIssue (rows: TrackerRow[], standupIssueKey: string): Map<string, TrackerRow[]> {
  const groups = new Map<string, TrackerRow[]>()
  for (const row of rows) {
    const key = row.win ?? standupIssueKey
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return groups
}

type AdfNode = Record<string, unknown>

const text = (value: string, bold = false): AdfNode =>
  bold ? { type: 'text', text: value, marks: [{ type: 'strong' }] } : { type: 'text', text: value }

const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })

function rowLines (row: TrackerRow): AdfNode[] {
  const lines: AdfNode[] = [paragraph(text('Status: ', true), text(row.status))]
  if (row.comment !== null) lines.push(paragraph(text('Update: ', true), text(row.comment)))
  if (row.anyBlocker !== null) lines.push(paragraph(text('Blocker: ', true), text(row.anyBlocker)))
  return lines
}

/** The comment people read, in Atlassian Document Format (REST v3 requires it). */
export function renderComment (memberName: string, localDate: string, rows: TrackerRow[]): AdfNode {
  const content: AdfNode[] = [paragraph(text(`Stand-up ${localDate} — ${memberName}`, true))]
  if (rows.length === 1) {
    content.push(...rowLines(rows[0]))
  } else {
    content.push({
      type: 'bulletList',
      content: rows.map((row) => ({ type: 'listItem', content: rowLines(row) }))
    })
  }
  content.push(paragraph({ type: 'text', text: 'Recorded by Scrum Assistant', marks: [{ type: 'em' }] }))
  return { type: 'doc', version: 1, content }
}

export class JiraCommentTracker implements Tracker {
  constructor (private readonly options: JiraTrackerOptions) {}

  private get authHeader (): string {
    return `Basic ${Buffer.from(`${this.options.email}:${this.options.apiToken}`).toString('base64')}`
  }

  private async request (method: string, path: string, body?: unknown): Promise<unknown> {
    return await withRetry(async () => {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authHeader,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      if (!response.ok) throw await httpErrorFrom(response)
      return response.status === 204 ? undefined : await response.json() as unknown
    }, { label: `jira tracker ${method}` })
  }

  async write (update: StandupUpdate): Promise<void> {
    // Replace, not append (A11): the rows passed in are already the member's
    // whole day, merged by the caller.
    for (const existing of await this.commentsFor(update.teamId, update.localDate)) {
      if (existing.property.memberId === update.memberId) {
        await this.request('DELETE', `/rest/api/3/issue/${encodeURIComponent(existing.issueKey)}/comment/${existing.commentId}`)
      }
    }

    for (const [issueKey, rows] of groupByIssue(update.rows, this.options.standupIssueKey)) {
      const property: StandupProperty = {
        teamId: update.teamId,
        memberId: update.memberId,
        memberName: update.memberName,
        localDate: update.localDate,
        rows
      }
      await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
        body: renderComment(update.memberName, update.localDate, rows),
        properties: [{ key: PROPERTY_KEY, value: property }]
      })
    }
  }

  async readToday (teamId: string, localDate: string): Promise<StandupUpdate[]> {
    const byMember = new Map<string, StandupUpdate>()
    for (const { property } of await this.commentsFor(teamId, localDate)) {
      const entry = byMember.get(property.memberId) ?? {
        teamId,
        memberId: property.memberId,
        memberName: property.memberName,
        localDate,
        rows: [],
        rawText: '',
        capturedAt: new Date()
      }
      entry.rows.push(...property.rows)
      byMember.set(property.memberId, entry)
    }
    return [...byMember.values()]
  }

  /**
   * SPEC-002 4b: the latest assistant comment per member on each open story
   * says whether that member is still blocked on it. Stories already done are
   * not read, and no earlier day is looked up by date.
   */
  async openBlockers (teamId: string): Promise<OpenBlocker[]> {
    const search = searchSchema.parse(await this.request('POST', '/rest/api/3/search/jql', {
      jql: `project = "${this.options.projectKey}" AND statusCategory != Done`, fields: ['summary'], maxResults: 100
    }))
    const keys = new Set([...search.issues.map((issue) => issue.key), this.options.standupIssueKey])

    const blockers: OpenBlocker[] = []
    for (const issueKey of keys) {
      const page = commentPageSchema.parse(await this.request(
        'GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?expand=properties&orderBy=-created&maxResults=100`
      ))
      const seen = new Set<string>()
      for (const comment of page.comments) {
        const parsed = propertySchema.safeParse(comment.properties.find((p) => p.key === PROPERTY_KEY)?.value)
        if (!parsed.success || parsed.data.teamId !== teamId || seen.has(parsed.data.memberId)) continue
        seen.add(parsed.data.memberId)
        for (const row of parsed.data.rows) {
          if (row.anyBlocker === null) continue
          blockers.push({
            memberId: parsed.data.memberId,
            member: parsed.data.memberName,
            workItem: row.win,
            description: row.anyBlocker,
            since: parsed.data.localDate
          })
        }
      }
    }
    return blockers
  }

  /**
   * Our comments for this team and date, wherever they are.
   *
   * Adding a comment updates the issue, so the issues updated since the day
   * before are the only ones that can hold today's comments. The stand-up
   * issue is always included in case the project key differs.
   */
  private async commentsFor (teamId: string, localDate: string): Promise<Array<{
    issueKey: string, commentId: string, property: StandupProperty
  }>> {
    const since = new Date(`${localDate}T00:00:00Z`)
    since.setUTCDate(since.getUTCDate() - 1)
    const jql = `project = "${this.options.projectKey}" AND updated >= "${since.toISOString().slice(0, 10)}"`
    const search = searchSchema.parse(await this.request('POST', '/rest/api/3/search/jql', {
      jql, fields: ['summary'], maxResults: 100
    }))
    const keys = new Set([...search.issues.map((issue) => issue.key), this.options.standupIssueKey])

    const found: Array<{ issueKey: string, commentId: string, property: StandupProperty }> = []
    for (const issueKey of keys) {
      const page = commentPageSchema.parse(await this.request(
        'GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?expand=properties&orderBy=-created&maxResults=100`
      ))
      for (const comment of page.comments) {
        const raw = comment.properties.find((p) => p.key === PROPERTY_KEY)?.value
        const parsed = propertySchema.safeParse(raw)
        if (parsed.success && parsed.data.teamId === teamId && parsed.data.localDate === localDate) {
          found.push({ issueKey, commentId: comment.id, property: parsed.data })
        }
      }
    }
    return found
  }
}
