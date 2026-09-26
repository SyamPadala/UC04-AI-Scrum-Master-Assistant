import type { TrackerRow } from './types.js'

/** A row's identity within one member's rows: its work item, or '' for the General row (SPEC-002 2a/2b). */
export function rowKey (row: TrackerRow): string {
  return row.win ?? ''
}

/**
 * Folds rows with the same identity into one (SPEC-002 2a/2b).
 *
 * The tracker holds one row per member + work item, and one General row for
 * everything that names no item. Two entries for the same item in one day
 * ("drafted the application", "verified the endpoint" — both SCRUM-7) are
 * joined, not overwritten, so neither comment is lost.
 */
export function collapseRows (rows: TrackerRow[]): TrackerRow[] {
  const groups = new Map<string, TrackerRow[]>()
  for (const row of rows) groups.set(rowKey(row), [...(groups.get(rowKey(row)) ?? []), row])

  const join = (values: Array<string | null>): string | null => {
    const kept = [...new Set(values.filter((v): v is string => v !== null && v !== ''))]
    return kept.length === 0 ? null : kept.join('; ')
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    const last = group[group.length - 1]
    const anyBlocker = join(group.map((row) => row.anyBlocker))
    return {
      win: last.win,
      description: group.find((row) => row.description !== null)?.description ?? null,
      assignedTo: last.assignedTo,
      comment: join(group.map((row) => row.comment)),
      // Blocked wins; otherwise the last thing said about the item stands.
      status: anyBlocker !== null ? 'Blocked' : last.status,
      anyBlocker
    }
  })
}
