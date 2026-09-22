import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { StandupUpdate, Tracker } from './types.js'

/**
 * A fully working tracker backed by a local JSON file (SPEC-002 item 6).
 *
 * First-class, not a stub (coding rule 29): the whole daily cycle runs against
 * it with no Microsoft or Jira account, so account setup never blocks
 * development and the demo has somewhere to fall back to.
 */
export class MockTracker implements Tracker {
  constructor (private readonly filePath: string) {}

  private async load (): Promise<StandupUpdate[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as StandupUpdate[]
      return parsed.map((update) => ({ ...update, capturedAt: new Date(update.capturedAt) }))
    } catch {
      return []
    }
  }

  private async save (updates: StandupUpdate[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(updates, null, 2), 'utf8')
  }

  async write (update: StandupUpdate): Promise<void> {
    const updates = await this.load()
    // A11: the member's entry for the day is replaced, not appended to.
    const others = updates.filter(
      (entry) => !(entry.memberName === update.memberName && entry.localDate === update.localDate)
    )
    // rawText is dropped on the way in. The file stands in for the tracker, and
    // the tracker holds rows — keeping the original message here would put
    // update content somewhere the design says it never goes.
    others.push({ ...update, rawText: '' })
    await this.save(others)
  }

  async readToday (teamId: string, localDate: string): Promise<StandupUpdate[]> {
    const updates = await this.load()
    return updates.filter((update) => update.teamId === teamId && update.localDate === localDate)
  }
}
