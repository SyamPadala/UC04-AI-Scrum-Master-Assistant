/**
 * Local check that the tracker write path works end to end, without Teams.
 * Writes a row, reads it back, updates it in place (SPEC-002 2a), sets and
 * clears a blocker (2d), then deletes it.
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

await tracker.write(update('second message, should update the same row'))
const replaced = (await tracker.readToday('smoke', localDate)).find((u) => u.memberName === 'Smoke Test')
console.log(`update in place: ${replaced?.rows.length === 1 ? 'OK — still 1 row' : `FAIL — ${replaced?.rows.length ?? 0} rows`}`)
console.log('row now reads:', replaced?.rows[0]?.comment)

const blocked = update('blocked on test data')
blocked.rows[0].anyBlocker = 'test data missing'
blocked.rows[0].status = 'Blocked'
await tracker.write(blocked)
const open = (await tracker.openBlockers('smoke')).filter((b) => b.member === 'Smoke Test')
console.log(`blocker open: ${open.length === 1 ? 'OK' : `FAIL — ${open.length}`}`)
await tracker.write(update('unblocked'))
const cleared = (await tracker.openBlockers('smoke')).filter((b) => b.member === 'Smoke Test')
console.log(`blocker cleared: ${cleared.length === 0 ? 'OK' : 'FAIL — still open'}`)

const removed = await tracker.deleteRowsOf('Smoke Test')
const cleaned = (await tracker.readToday('smoke', localDate)).find((u) => u.memberName === 'Smoke Test')
console.log(`cleanup: ${cleaned === undefined ? `OK — ${removed} row(s) removed` : 'FAIL — rows remain'}`)
