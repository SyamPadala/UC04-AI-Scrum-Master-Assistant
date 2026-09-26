import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MockTracker } from '../dist/trackers/mock.js'

/** SPEC-002 2a–2e and 4a: one row per member + item, open blockers from current state. */

const row = (win, comment, blocker = null, status = blocker === null ? 'In Progress' : 'Blocked') =>
  ({ win, description: null, assignedTo: 'x', comment, status, anyBlocker: blocker })
const update = (memberName, localDate, rows, memberId = memberName) =>
  ({ teamId: 't', memberId, memberName, localDate, rows, rawText: '', capturedAt: new Date() })

async function fresh (t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'blockers-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const file = path.join(dir, 'tracker.json')
  return { tracker: new MockTracker(file), file }
}

test("yesterday's blocker is still open when today's update names other items", async (t) => {
  const { tracker } = await fresh(t)
  await tracker.write(update('Satyam', '2026-09-24', [row('SCRUM-20', 'stuck', 'waiting for access')]))
  await tracker.write(update('Satyam', '2026-09-25', [row('SCRUM-5', 'started')]))
  assert.deepEqual(await tracker.openBlockers('t'), [
    { memberId: 'Satyam', member: 'Satyam', workItem: 'SCRUM-20', description: 'waiting for access', since: '2026-09-24' }
  ])
})

test('the blocker clears when the item is reported again without one', async (t) => {
  const { tracker } = await fresh(t)
  await tracker.write(update('Satyam', '2026-09-24', [row('SCRUM-20', 'stuck', 'waiting for access')]))
  await tracker.write(update('Satyam', '2026-09-25', [row('SCRUM-20', 'unblocked, back on it')]))
  assert.deepEqual(await tracker.openBlockers('t'), [])
})

test("another member's update does not clear someone's blocker (2e)", async (t) => {
  const { tracker, file } = await fresh(t)
  await tracker.write(update('Satyam', '2026-09-24', [row('SCRUM-20', 'stuck', 'waiting')]))
  await tracker.write(update('Sai', '2026-09-25', [row('SCRUM-20', 'helping')]))
  assert.equal((await tracker.openBlockers('t')).length, 1)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 2, 'one row each on the same story')
})

test('rows with no work item share one General row per member (2b)', async (t) => {
  const { tracker, file } = await fresh(t)
  await tracker.write(update('Satyam', '2026-09-25', [row(null, 'on leave'), row(null, null, 'laptop broken')]))
  const stored = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].row.comment, 'on leave')
  assert.equal(stored[0].row.anyBlocker, 'laptop broken')
})

test('items a message does not mention are left as they are (2c)', async (t) => {
  const { tracker } = await fresh(t)
  await tracker.write(update('Satyam', '2026-09-24', [row('SCRUM-6', 'done', null, 'Completed'), row('SCRUM-7', 'working')]))
  await tracker.write(update('Satyam', '2026-09-25', [row('SCRUM-7', 'still working')]))
  assert.deepEqual((await tracker.readToday('t', '2026-09-24'))[0].rows.map((r) => r.win), ['SCRUM-6'])
  assert.deepEqual((await tracker.readToday('t', '2026-09-25'))[0].rows.map((r) => r.win), ['SCRUM-7'])
})

test('two entries for the same item in one message are joined, not overwritten', async (t) => {
  const { tracker, file } = await fresh(t)
  await tracker.write(update('Sai', '2026-09-25', [row('SCRUM-7', 'drafted the application', null, 'Completed'), row('SCRUM-7', 'verified the endpoint', null, 'Completed')]))
  const stored = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].row.comment, 'drafted the application; verified the endpoint')
})
