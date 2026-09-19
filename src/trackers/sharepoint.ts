import { graphRequest } from '../graph/client.js'
import type { StandupUpdate, Tracker, TrackerRow, RowStatus } from './types.js'

interface ListItem { id: string, fields: Record<string, unknown> }
interface ListItemsResponse { value: ListItem[] }

/**
 * SharePoint list tracker (SPEC-002).
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

export class SharePointTracker implements Tracker {
  constructor (
    private readonly siteId: string,
    private readonly listId: string
  ) {}

  private get base (): string {
    return `/sites/${this.siteId}/lists/${this.listId}`
  }

  async write (update: StandupUpdate): Promise<void> {
    // A11: a second message from the same member on the same day replaces that
    // member's rows rather than appending to them.
    await this.deleteRowsFor(update.memberName, update.localDate)

    for (const row of update.rows) {
      await graphRequest('POST', `${this.base}/items`, {
        fields: {
          [FIELD.date]: `${update.localDate}T00:00:00Z`,
          [FIELD.win]: row.win ?? '',
          [FIELD.description]: row.description ?? '',
          [FIELD.assignedTo]: row.assignedTo,
          [FIELD.comment]: row.comment ?? '',
          [FIELD.status]: row.status,
          [FIELD.anyBlocker]: row.anyBlocker ?? ''
        }
      })
    }
  }

  async readToday (_teamId: string, localDate: string): Promise<StandupUpdate[]> {
    const items = await this.itemsFor(localDate)
    const byMember = new Map<string, TrackerRow[]>()

    for (const item of items) {
      const name = String(item.fields[FIELD.assignedTo] ?? '')
      const rows = byMember.get(name) ?? []
      rows.push(this.toRow(item.fields))
      byMember.set(name, rows)
    }

    return [...byMember.entries()].map(([memberName, rows]) => ({
      teamId: _teamId,
      memberId: '',
      memberName,
      localDate,
      rows,
      rawText: '',
      capturedAt: new Date()
    }))
  }

  private toRow (fields: Record<string, unknown>): TrackerRow {
    const text = (key: string): string | null => {
      const value = fields[key]
      return value === undefined || value === null || value === '' ? null : String(value)
    }
    return {
      win: text(FIELD.win),
      description: text(FIELD.description),
      assignedTo: String(fields[FIELD.assignedTo] ?? ''),
      comment: text(FIELD.comment),
      status: (text(FIELD.status) ?? 'In Progress') as RowStatus,
      anyBlocker: text(FIELD.anyBlocker)
    }
  }

  /** Graph cannot filter this list server-side on these columns, so filter in code. */
  private async itemsFor (localDate: string): Promise<ListItem[]> {
    const response = await graphRequest<ListItemsResponse>(
      'GET', `${this.base}/items?expand=fields&$top=200`
    )
    return response.value.filter((item) => {
      const raw = item.fields[FIELD.date]
      return typeof raw === 'string' && raw.startsWith(localDate)
    })
  }

  private async deleteRowsFor (memberName: string, localDate: string): Promise<void> {
    const items = await this.itemsFor(localDate)
    for (const item of items) {
      if (String(item.fields[FIELD.assignedTo] ?? '') === memberName) {
        await graphRequest('DELETE', `${this.base}/items/${item.id}`)
      }
    }
  }
}
