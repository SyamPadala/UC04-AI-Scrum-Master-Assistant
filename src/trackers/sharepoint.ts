import { graphRequest } from '../graph/client.js'
import type { OpenBlocker, StandupUpdate, Tracker, TrackerRow, RowStatus } from './types.js'
import { collapseRows, rowKey } from './rows.js'

interface ListItem { id: string, fields: Record<string, unknown> }
interface ListItemsResponse { value: ListItem[], '@odata.nextLink'?: string }

/**
 * SharePoint list tracker (SPEC-002, amended 26 Sep 2026).
 *
 * One row per member + work item, updated in place. `Date` is the date the row
 * was last updated, so the list grows only when new work items appear and the
 * current state of every item — including an open blocker — is in its row.
 * Earlier comments stay in SharePoint's own version history.
 *
 * Column internal names are fixed at creation and are NOT the display names.
 * On the delivered list they happen to match; if a column is ever renamed in
 * SharePoint, re-verify the internal names before trusting a write.
 */
const FIELD = {
  date: 'Date',
  win: 'WIN',
  description: 'Description',
  assignedTo: 'AssignedTo',
  comment: 'Comment',
  status: 'Status',
  anyBlocker: 'AnyBlocker',
  /** Who sent the update (SPEC-002 2f). Empty on rows written before 1 Oct 2026. */
  updatedBy: 'UpdatedBy'
} as const

/**
 * The member a row belongs to — who sent the update. Rows written before the
 * Updated By column existed only have AssignedTo, which then was the sender.
 */
function reporterOf (item: ListItem): string {
  const by = String(item.fields[FIELD.updatedBy] ?? '')
  return by !== '' ? by : String(item.fields[FIELD.assignedTo] ?? '')
}

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'

export class SharePointTracker implements Tracker {
  /**
   * `memberNames`: the team's roster. The list has no team column, so a team
   * reads only its own members' rows — two teams can share one list (SPEC-002
   * 4c). Omitted, every row is read (the smoke check).
   */
  constructor (
    private readonly siteId: string,
    private readonly listId: string,
    private readonly memberNames?: readonly string[]
  ) {}

  /**
   * The list as read for this instance. An instance serves one message or one
   * job, so today's rows, open blockers and the write all come from one read
   * (SPEC-002 item 5a) instead of three. A write clears it.
   */
  private read: Promise<ListItem[]> | undefined

  private get base (): string {
    return `/sites/${this.siteId}/lists/${this.listId}`
  }

  async write (update: StandupUpdate): Promise<void> {
    const items = await this.allItems()

    for (const row of collapseRows(update.rows)) {
      const fields = {
        // Midday, not midnight: SharePoint renders dates in the site's own
        // timezone, and midnight UTC displays as the previous day anywhere
        // west of UTC. Midday is the same calendar date from UTC-11 to UTC+11.
        [FIELD.date]: `${update.localDate}T12:00:00Z`,
        [FIELD.win]: row.win ?? '',
        [FIELD.description]: row.description ?? (row.win === null ? 'General' : ''),
        // SPEC-002 2f: AssignedTo is the story's owner as in Jira; Updated By is who sent it.
        [FIELD.assignedTo]: row.assignedTo !== '' ? row.assignedTo : update.memberName,
        [FIELD.updatedBy]: update.memberName,
        [FIELD.comment]: row.comment ?? '',
        [FIELD.status]: row.status,
        // Written every time: a report without a blocker clears it (SPEC-002 2d).
        [FIELD.anyBlocker]: row.anyBlocker ?? ''
      }
      const current = latestFor(items, update.memberName, rowKey(row))
      if (current === undefined) {
        await graphRequest('POST', `${this.base}/items`, { fields })
      } else {
        await graphRequest('PATCH', `${this.base}/items/${current.id}/fields`, fields)
      }
    }
    this.read = undefined
  }

  async readToday (teamId: string, localDate: string): Promise<StandupUpdate[]> {
    const byMember = new Map<string, TrackerRow[]>()
    for (const item of await this.allItems()) {
      if (dateOf(item) !== localDate) continue
      const name = reporterOf(item)
      byMember.set(name, [...(byMember.get(name) ?? []), toRow(item.fields)])
    }
    return [...byMember.entries()].map(([memberName, rows]) => ({
      teamId, memberId: '', memberName, localDate, rows, rawText: '', capturedAt: new Date()
    }))
  }

  async openBlockers (_teamId: string): Promise<OpenBlocker[]> {
    const items = await this.allItems()
    // Rows written before 26 Sep are one per day, so the same member and item
    // can appear several times; only the latest says whether it is still blocked.
    const latest = new Map<string, ListItem>()
    for (const item of items) {
      const key = `${reporterOf(item)}|${String(item.fields[FIELD.win] ?? '')}`
      const seen = latest.get(key)
      if (seen === undefined || dateOf(item) > dateOf(seen)) latest.set(key, item)
    }
    return [...latest.values()]
      .map((item) => ({ item, row: toRow(item.fields) }))
      .filter(({ row }) => row.anyBlocker !== null)
      .map(({ item, row }) => ({
        memberId: '',
        member: reporterOf(item),
        workItem: row.win,
        description: row.anyBlocker as string,
        since: dateOf(item)
      }))
  }

  /** Removes every row of one member. For the smoke check's clean-up only; the daily cycle never deletes. */
  async deleteRowsOf (memberName: string): Promise<number> {
    const mine = (await this.allItems()).filter((item) => reporterOf(item) === memberName)
    for (const item of mine) await graphRequest('DELETE', `${this.base}/items/${item.id}`)
    this.read = undefined
    return mine.length
  }

  /** This team's rows, following Graph's paging. The list stays small: one row per member per item. */
  private async allItems (): Promise<ListItem[]> {
    this.read ??= this.everyItem()
    let all: ListItem[]
    try {
      all = await this.read
    } catch (error) {
      this.read = undefined
      throw error
    }
    if (this.memberNames === undefined) return all
    const mine = new Set(this.memberNames)
    return all.filter((item) => mine.has(reporterOf(item)))
  }

  private async everyItem (): Promise<ListItem[]> {
    const items: ListItem[] = []
    let path: string | undefined = `${this.base}/items?expand=fields&$top=999`
    while (path !== undefined) {
      const page: ListItemsResponse = await graphRequest<ListItemsResponse>('GET', path)
      items.push(...page.value)
      const next = page['@odata.nextLink']
      path = next === undefined ? undefined : next.replace(GRAPH_ROOT, '')
    }
    return items
  }
}

function dateOf (item: ListItem): string {
  const raw = item.fields[FIELD.date]
  return typeof raw === 'string' ? raw.slice(0, 10) : ''
}

function latestFor (items: ListItem[], memberName: string, key: string): ListItem | undefined {
  return items
    .filter((item) => reporterOf(item) === memberName &&
      String(item.fields[FIELD.win] ?? '') === key)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0]
}

function toRow (fields: Record<string, unknown>): TrackerRow {
  const text = (key: string): string | null => {
    const value = fields[key]
    return value === undefined || value === null || value === '' ? null : String(value)
  }
  const win = text(FIELD.win)
  const description = text(FIELD.description)
  return {
    win,
    description: win === null && description === 'General' ? null : description,
    assignedTo: String(fields[FIELD.assignedTo] ?? ''),
    comment: text(FIELD.comment),
    status: (text(FIELD.status) ?? 'In Progress') as RowStatus,
    anyBlocker: text(FIELD.anyBlocker)
  }
}
