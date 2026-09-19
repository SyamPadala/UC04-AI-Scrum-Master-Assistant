/**
 * Local check that the tracker write path works end to end, without Teams.
 * Writes a row, reads it back, overwrites it (A11), then deletes it.
 */
import { config } from './config/env.js'
import { SharePointTracker } from './trackers/sharepoint.js'
import type { StandupUpdate } from './trackers/types.js'

const tracker = new SharePointTracker(config.sharepoint.siteId, config.sharepoint.listId)
const localDate = new Date().toISOString().slice(0, 10)

function update (comment: string): StandupUpdate {
  return {
    teamId: 'smoke',
    memberId: 'smoke-id',
    memberName: 'Smoke Test',
    localDate,
    rows: [{
      win: null,
      description: null,
      assignedTo: 'Smoke Test',
      comment,
      status: 'In Progress',
      anyBlocker: null
    }],
    rawText: comment,
    capturedAt: new Date()
  }
}

await tracker.write(update('first message of the day'))
console.log('write: OK')

const after = await tracker.readToday('smoke', localDate)
const mine = after.find((u) => u.memberName === 'Smoke Test')
console.log('read back:', mine?.rows[0]?.comment)

await tracker.write(update('second message, should replace the first'))
const replaced = (await tracker.readToday('smoke', localDate)).find((u) => u.memberName === 'Smoke Test')
console.log(`A11 replace: ${replaced?.rows.length === 1 ? 'OK — still 1 row' : `FAIL — ${replaced?.rows.length ?? 0} rows`}`)
console.log('row now reads:', replaced?.rows[0]?.comment)

await tracker.write({ ...update(''), rows: [] })
const cleaned = (await tracker.readToday('smoke', localDate)).find((u) => u.memberName === 'Smoke Test')
console.log(`cleanup: ${cleaned === undefined ? 'OK — rows removed' : 'FAIL — rows remain'}`)
