import type { OpenBlocker, StandupUpdate, TrackerRow, RowStatus } from './types.js'

/**
 * The row rules shared by the trackers that keep one row per member + work
 * item: the SharePoint list and the Excel workbook (SPEC-002 2a–2f, 4a, item 7b).
 * Each tracker turns its own storage into `ListItem`s and back; the rules live
 * here once, so the two cannot drift apart.
 */
export interface ListItem { id: string, fields: Record<string, unknown> }

/** Column names, in the order the Excel table holds them (SPEC-002 item 7a). */
export const FIELD = {
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

export const COLUMN_ORDER = [FIELD.date, FIELD.win, FIELD.description, FIELD.assignedTo, FIELD.comment, FIELD.status, FIELD.anyBlocker, FIELD.updatedBy]

/**
 * The member a row belongs to — who sent the update. Rows written before the
 * Updated By column existed only have AssignedTo, which then was the sender.
 */
export function reporterOf (item: ListItem): string {
  const by = String(item.fields[FIELD.updatedBy] ?? '')
  return by !== '' ? by : String(item.fields[FIELD.assignedTo] ?? '')
}

/** 'YYYY-MM-DD' of the row's last update. */
export function dateOf (item: ListItem): string {
  const raw = item.fields[FIELD.date]
  return typeof raw === 'string' ? raw.slice(0, 10) : ''
}

/** The column values for one row, the date as `YYYY-MM-DD` (each tracker adds its own date form). */
export function fieldsFor (update: StandupUpdate, row: TrackerRow): Record<string, string> {
  return {
    [FIELD.date]: update.localDate,
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
}

/** The member's current row for one work item ('' = the General row), if any. */
export function latestFor (items: ListItem[], memberName: string, key: string): ListItem | undefined {
  return items
    .filter((item) => reporterOf(item) === memberName &&
      String(item.fields[FIELD.win] ?? '') === key)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0]
}

export function toRow (fields: Record<string, unknown>): TrackerRow {
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

/** SPEC-002 4a: the rows last updated on this date, grouped by who sent them. */
export function todayFrom (items: ListItem[], teamId: string, localDate: string): StandupUpdate[] {
  const byMember = new Map<string, TrackerRow[]>()
  for (const item of items) {
    if (dateOf(item) !== localDate) continue
    const name = reporterOf(item)
    byMember.set(name, [...(byMember.get(name) ?? []), toRow(item.fields)])
  }
  return [...byMember.entries()].map(([memberName, rows]) => ({
    teamId, memberId: '', memberName, localDate, rows, rawText: '', capturedAt: new Date()
  }))
}

/** SPEC-002 4a: every row whose blocker is still set, whatever day it was raised. */
export function blockersFrom (items: ListItem[]): OpenBlocker[] {
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

/** A team reads only its own members' rows (SPEC-002 4c, kept as a second guard). */
export function onlyRoster (items: ListItem[], memberNames?: readonly string[]): ListItem[] {
  if (memberNames === undefined) return items
  const mine = new Set(memberNames)
  return items.filter((item) => mine.has(reporterOf(item)))
}
