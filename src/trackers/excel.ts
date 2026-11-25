import { graphRequest, graphUpload } from '../graph/client.js'
import type { OpenBlocker, StandupUpdate, Tracker } from './types.js'
import { collapseRows, rowKey } from './rows.js'
import { blockersFrom, fieldsFor, latestFor, onlyRoster, todayFrom, COLUMN_ORDER, type ListItem } from './listRows.js'
import { trackerWorkbook } from './xlsx.js'

/**
 * Excel Online tracker (SPEC-002 item 7).
 *
 * A table in a workbook on the team's own site, with the SharePoint list's
 * columns and rules (item 7b): one row per member + work item, changed in
 * place by its position in the table; a new item is added at the end. Nothing
 * is deleted, so a row's position never moves (7d).
 */
export const WORKBOOK_NAME = 'Daily Status Tracker.xlsx'
export const SHEET_NAME = 'Tracker'
export const TABLE_NAME = 'DailyStatusTracker'
const COLUMN_WIDTHS = [12, 12, 40, 22, 60, 12, 40, 22]

interface TableRow { index: number, values: unknown[][] }
interface TableRowsResponse { value: TableRow[], '@odata.nextLink'?: string }

/**
 * Every cell is written with a leading apostrophe: Excel stores the rest as
 * text and drops the apostrophe. A comment starting with "=" then stays words,
 * never a formula, and a date or number stays exactly what was written (7c).
 */
const asText = (value: string): string => value === '' ? '' : `'${value}`

export class ExcelTracker implements Tracker {
  constructor (
    private readonly driveId: string,
    private readonly itemId: string,
    private readonly memberNames?: readonly string[]
  ) {}

  /** One read per message or job, as for the SharePoint list (SPEC-002 5a). */
  private read: Promise<ListItem[]> | undefined

  private get table (): string {
    return `/drives/${this.driveId}/items/${this.itemId}/workbook/tables/${TABLE_NAME}`
  }

  async write (update: StandupUpdate): Promise<void> {
    const items = await this.allItems()
    for (const row of collapseRows(update.rows)) {
      const fields = fieldsFor(update, row)
      const values = [COLUMN_ORDER.map((column) => asText(fields[column] ?? ''))]
      const current = latestFor(items, update.memberName, rowKey(row))
      if (current === undefined) {
        await graphRequest('POST', `${this.table}/rows`, { values })
      } else {
        await graphRequest('PATCH', `${this.table}/rows/itemAt(index=${current.id})`, { values })
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

  private async allItems (): Promise<ListItem[]> {
    this.read ??= this.everyRow()
    try {
      return onlyRoster(await this.read, this.memberNames)
    } catch (error) {
      this.read = undefined
      throw error
    }
  }

  private async everyRow (): Promise<ListItem[]> {
    const items: ListItem[] = []
    let path: string | undefined = `${this.table}/rows`
    while (path !== undefined) {
      const page: TableRowsResponse = await graphRequest<TableRowsResponse>('GET', path)
      for (const row of page.value) {
        const cells = row.values[0] ?? []
        const fields: Record<string, unknown> = {}
        COLUMN_ORDER.forEach((column, i) => { fields[column] = cells[i] === null || cells[i] === undefined ? '' : String(cells[i]) })
        items.push({ id: String(row.index), fields })
      }
      const next = page['@odata.nextLink']
      path = next === undefined ? undefined : next.replace('https://graph.microsoft.com/v1.0', '')
    }
    return items
  }
}

export interface PreparedWorkbook { itemId: string, webUrl: string, created: boolean }

/**
 * Item 7e: the team's tracker workbook, created when its site has none.
 *
 * An existing workbook is used as is when it has the table with every column;
 * otherwise it is refused with the reason, never changed. The one exception is
 * a workbook this function itself left half-made (file uploaded, table not yet
 * added): its sheet holds exactly the header row, and the table is added.
 */
export async function prepareWorkbook (driveId: string): Promise<PreparedWorkbook> {
  const filePath = `/drives/${driveId}/root:/${encodeURIComponent(WORKBOOK_NAME)}`
  let file = await graphRequest<{ id: string, webUrl: string }>('GET', `${filePath}?$select=id,webUrl`).catch((error: unknown) => {
    if (error instanceof Error && / 404 /.test(error.message)) return undefined
    throw error
  })
  let created = false
  if (file === undefined) {
    file = await graphUpload<{ id: string, webUrl: string }>(
      `${filePath}:/content?@microsoft.graph.conflictBehavior=fail`,
      trackerWorkbook(SHEET_NAME, COLUMN_ORDER, COLUMN_WIDTHS),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    created = true
  }

  const workbook = `/drives/${driveId}/items/${file.id}/workbook`
  const header = await graphRequest<{ values: unknown[][] }>('GET', `${workbook}/tables/${TABLE_NAME}/headerRowRange?$select=values`)
    .catch((error: unknown) => {
      if (error instanceof Error && / 404 /.test(error.message)) return undefined
      throw error
    })

  if (header === undefined) {
    const firstRow = await graphRequest<{ values: unknown[][] }>('GET', `${workbook}/worksheets/${SHEET_NAME}/range(address='A1:H2')?$select=values`)
      .catch(() => undefined)
    const top = (firstRow?.values[0] ?? []).map(String)
    const below = (firstRow?.values[1] ?? []).map(String)
    const halfMade = COLUMN_ORDER.every((column, i) => top[i] === column) && below.every((cell) => cell === '')
    if (!halfMade) {
      throw new Error(`${WORKBOOK_NAME} on the team's site has no "${TABLE_NAME}" table. Rename or move that file, then choose Excel again.`)
    }
    const table = await graphRequest<{ name: string }>('POST', `${workbook}/worksheets/${SHEET_NAME}/tables/add`, { address: `${SHEET_NAME}!A1:H1`, hasHeaders: true })
    await graphRequest('PATCH', `${workbook}/tables/${table.name}`, { name: TABLE_NAME })
  } else {
    const names = new Set((header.values[0] ?? []).map(String))
    const missing = COLUMN_ORDER.filter((column) => !names.has(column))
    if (missing.length > 0) throw new Error(`${WORKBOOK_NAME} is missing columns: ${missing.join(', ')}.`)
    const inOrder = COLUMN_ORDER.every((column, i) => String(header.values[0][i]) === column)
    if (!inOrder) throw new Error(`${WORKBOOK_NAME} has the columns in another order. They must be: ${COLUMN_ORDER.join(', ')}.`)
  }
  return { itemId: file.id, webUrl: file.webUrl, created }
}
