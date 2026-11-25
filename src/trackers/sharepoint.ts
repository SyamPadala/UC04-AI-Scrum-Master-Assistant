import { graphRequest } from '../graph/client.js'
import type { OpenBlocker, StandupUpdate, Tracker } from './types.js'
import { collapseRows, rowKey } from './rows.js'
import { blockersFrom, fieldsFor, latestFor, onlyRoster, reporterOf, todayFrom, FIELD, type ListItem } from './listRows.js'

interface ListItemsResponse { value: ListItem[], '@odata.nextLink'?: string }

/**
 * SharePoint list tracker (SPEC-002, amended 26 Sep 2026).
 *
 * One row per member + work item, updated in place. `Date` is the date the row
 * was last updated, so the list grows only when new work items appear and the
 * current state of every item — including an open blocker — is in its row.
 * Earlier comments stay in SharePoint's own version history. The row rules are
 * shared with the Excel tracker (listRows.ts).
 *
 * Column internal names are fixed at creation and are NOT the display names.
 * On the delivered list they happen to match; if a column is ever renamed in
 * SharePoint, re-verify the internal names before trusting a write.
 */
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
        ...fieldsFor(update, row),
        // Midday, not midnight: SharePoint renders dates in the site's own
        // timezone, and midnight UTC displays as the previous day anywhere
        // west of UTC. Midday is the same calendar date from UTC-11 to UTC+11.
        [FIELD.date]: `${update.localDate}T12:00:00Z`
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
    return todayFrom(await this.allItems(), teamId, localDate)
  }

  async openBlockers (_teamId: string): Promise<OpenBlocker[]> {
    return blockersFrom(await this.allItems())
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
    return onlyRoster(all, this.memberNames)
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
