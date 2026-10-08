import type { OpenBlocker, StandupUpdate, Tracker } from './types.js'

/**
 * SPEC-008 10q (M11): a team whose own tracker list has not been chosen yet.
 * Writing refuses with a clear reason instead of falling back to another
 * team's list — teams must never see each other's updates.
 */
export class TrackerNotSetError extends Error {
  constructor () {
    super('no tracker is set for this team yet')
    this.name = 'TrackerNotSetError'
  }
}

export class UnsetTracker implements Tracker {
  async write (_update: StandupUpdate): Promise<void> {
    throw new TrackerNotSetError()
  }

  async readToday (_teamId: string, _localDate: string): Promise<StandupUpdate[]> {
    return []
  }

  async openBlockers (_teamId: string): Promise<OpenBlocker[]> {
    return []
  }
}
