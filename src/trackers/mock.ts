import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpenBlocker, StandupUpdate, Tracker, TrackerRow } from './types.js'
import { collapseRows, rowKey } from './rows.js'

/** One stored row: a member's current state for one work item (SPEC-002 2a). */
interface StoredRow {
  teamId: string
  memberId: string
  memberName: string
  /** 'YYYY-MM-DD' the row was last updated. */
  updatedOn: string
  row: TrackerRow
}

/**
 * A fully working tracker backed by a local JSON file (SPEC-002 item 6).
 *
 * First-class, not a stub (coding rule 29): the whole daily cycle runs against
 * it with no Microsoft or Jira account. It behaves like the SharePoint list —
 * one row per member + work item, updated in place — so tests exercise the
 * same rules the live tracker follows.
 */
export class MockTracker implements Tracker {
  constructor (private readonly filePath: string) {}

  private async load (): Promise<StoredRow[]> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as StoredRow[]
    } catch {
      return []
    }
  }

  private async save (rows: StoredRow[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(rows, null, 2), 'utf8')
  }

  async write (update: StandupUpdate): Promise<void> {
    const stored = await this.load()
    // rawText is never kept: the file stands in for the tracker, and the
    // tracker holds rows, not the original message.
    for (const row of collapseRows(update.rows)) {
      const entry: StoredRow = {
        teamId: update.teamId,
        memberId: update.memberId,
        memberName: update.memberName,
        updatedOn: update.localDate,
        row: { ...row, assignedTo: update.memberName }
      }
      const at = stored.findIndex((s) => s.teamId === update.teamId &&
        s.memberName === update.memberName && rowKey(s.row) === rowKey(row))
      if (at === -1) stored.push(entry)
      else stored[at] = entry
    }
    await this.save(stored)
  }

  async readToday (teamId: string, localDate: string): Promise<StandupUpdate[]> {
    const byMember = new Map<string, StandupUpdate>()
    for (const s of await this.load()) {
      if (s.teamId !== teamId || s.updatedOn !== localDate) continue
      const entry = byMember.get(s.memberName) ?? {
        teamId, memberId: s.memberId, memberName: s.memberName, localDate, rows: [], rawText: '', capturedAt: new Date()
      }
      entry.rows.push(s.row)
      byMember.set(s.memberName, entry)
    }
    return [...byMember.values()]
  }

  async openBlockers (teamId: string): Promise<OpenBlocker[]> {
    return (await this.load())
      .filter((s) => s.teamId === teamId && s.row.anyBlocker !== null)
      .map((s) => ({
        memberId: s.memberId,
        member: s.memberName,
        workItem: s.row.win,
        description: s.row.anyBlocker as string,
        since: s.updatedOn
      }))
  }
}
