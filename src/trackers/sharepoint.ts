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
  anyBlocker: 'AnyBlocker'
} as const

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'

export class SharePointTracker implements Tracker {
  constructor (
    private readonly siteId: string,
    private readonly listId: string
  ) {}

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
        [FIELD.assignedTo]: update.memberName,
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
  }

  async readToday (teamId: string, localDate: string): Promise<StandupUpdate[]> {
    const byMember = new Map<string, TrackerRow[]>()
    for (const item of await this.allItems()) {
      if (dateOf(item) !== localDate) continue
      const name = String(item.fields[FIELD.assignedTo] ?? '')
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
      const key = `${String(item.fields[FIELD.assignedTo] ?? '')}|${String(item.fields[FIELD.win] ?? '')}`
      const seen = latest.get(key)
      if (seen === undefined || dateOf(item) > dateOf(seen)) latest.set(key, item)
    }
    return [...latest.values()]
      .map((item) => ({ item, row: toRow(item.fields) }))
      .filter(({ row }) => row.anyBlocker !== null)
      .map(({ item, row }) => ({
        memberId: '',
        member: row.assignedTo,
        workItem: row.win,
        description: row.anyBlocker as string,
        since: dateOf(item)
      }))
  }

  /** Removes every row of one member. For the smoke check's clean-up only; the daily cycle never deletes. */
  async deleteRowsOf (memberName: string): Promise<number> {
    const mine = (await this.allItems()).filter((item) => String(item.fields[FIELD.assignedTo] ?? '') === memberName)
    for (const item of mine) await graphRequest('DELETE', `${this.base}/items/${item.id}`)
    return mine.length
  }

  /** Every row, following Graph's paging. The list stays small: one row per member per item. */
  private async allItems (): Promise<ListItem[]> {
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
    .filter((item) => String(item.fields[FIELD.assignedTo] ?? '') === memberName &&
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
