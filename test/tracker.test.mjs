import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MockTracker } from '../dist/trackers/mock.js'

/**
 * The tracker contract (SPEC-002 verification 1 and 2), exercised against the
 * mock so it runs with no Microsoft account.
 */

const update = (memberName, localDate, comment) => ({
  teamId: 'team-1',
  memberId: 'm1',
  memberName,
  localDate,
  rows: [{ win: null, description: null, assignedTo: memberName, comment, status: 'In Progress', anyBlocker: null }],
  rawText: comment,
  capturedAt: new Date()
})

test('a written update reads back', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const tracker = new MockTracker(path.join(dir, 'tracker.json'))

  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'first message'))
  const today = await tracker.readToday('team-1', '2026-09-21')

  assert.equal(today.length, 1)
  assert.equal(today[0].rows[0].comment, 'first message')
})

test('a second message the same day replaces the first (A11)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const tracker = new MockTracker(path.join(dir, 'tracker.json'))

  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'first message'))
  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'second message'))
  const today = await tracker.readToday('team-1', '2026-09-21')

  assert.equal(today.length, 1, 'one entry, not two')
  assert.equal(today[0].rows[0].comment, 'second message')
})

test('the next day updates the same row in place, not a new one (SPEC-002 2a)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const file = path.join(dir, 'tracker.json')
  const tracker = new MockTracker(file)

  await tracker.write(update('Madhavi Andoju', '2026-09-20', 'yesterday'))
  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'today'))

  assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1, 'one row per member + item')
  assert.deepEqual(await tracker.readToday('team-1', '2026-09-20'), [], 'the row now carries its last-updated date')
  assert.equal((await tracker.readToday('team-1', '2026-09-21'))[0].rows[0].comment, 'today')
})

test('one member\'s write does not disturb another\'s', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const tracker = new MockTracker(path.join(dir, 'tracker.json'))

  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'hers'))
  await tracker.write(update('Tiwari Satyam', '2026-09-21', 'his'))

  const today = await tracker.readToday('team-1', '2026-09-21')
  assert.equal(today.length, 2)
})

test('the original message is not kept alongside the rows', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const file = path.join(dir, 'tracker.json')
  const tracker = new MockTracker(file)

  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'the rows carry this'))
  const stored = JSON.parse(await readFile(file, 'utf8'))

  assert.equal(stored[0].rawText, undefined, 'rawText is dropped; only rows are stored')
})

test('another team\'s rows are not returned', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const tracker = new MockTracker(path.join(dir, 'tracker.json'))

  await tracker.write(update('Madhavi Andoju', '2026-09-21', 'team one'))
  await tracker.write({ ...update('Someone Else', '2026-09-21', 'team two'), teamId: 'team-2' })

  const today = await tracker.readToday('team-1', '2026-09-21')
  assert.equal(today.length, 1, 'FR-10: teams do not see each other\'s updates')
})
