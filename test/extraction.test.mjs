import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExtraction } from '../dist/agents/schema.js'
import { toTrackerRows } from '../dist/jobs/updateIntake.js'

/**
 * Agent 1's output boundary (SPEC-004 verification 6) and the mapping into
 * tracker rows. Both are places where a quiet mistake reaches the tracker
 * without anything visibly failing.
 */

test('valid model output parses', () => {
  const output = parseExtraction(JSON.stringify({
    completed: [{ storyRef: 'SCRUM-7', comment: 'finished it' }],
    inProgress: [{ storyRef: null, comment: 'reviewing PRs' }],
    blockers: [{ description: 'no VPN', storyRef: null }],
    confidence: 'high'
  }))
  assert.equal(output.completed[0].storyRef, 'SCRUM-7')
  assert.equal(output.blockers.length, 1)
})

test('a fenced code block is unwrapped, not rejected', () => {
  const output = parseExtraction('```json\n{"completed":[],"inProgress":[],"blockers":[],"confidence":"high"}\n```')
  assert.equal(output.completed.length, 0)
})

test('output that is not JSON fails the call', () => {
  assert.throws(() => parseExtraction('I think they finished SCRUM-7.'), /not valid JSON/)
})

test('output missing a required field fails validation', () => {
  assert.throws(
    () => parseExtraction(JSON.stringify({ completed: [{ storyRef: 'SCRUM-7' }], inProgress: [], blockers: [] })),
    /failed validation/
  )
})

test('an unknown confidence value fails rather than being corrected', () => {
  assert.throws(
    () => parseExtraction(JSON.stringify({ completed: [], inProgress: [], blockers: [], confidence: 'maybe' })),
    /failed validation/
  )
})

const stories = new Map([
  ['SCRUM-6', { key: 'SCRUM-6', title: 'Risk scoring rules', url: 'https://example/SCRUM-6' }]
])

test('completed and in-progress items become their own rows', () => {
  const rows = toTrackerRows({
    completed: [{ storyRef: 'SCRUM-6', comment: 'done' }],
    inProgress: [{ storyRef: null, comment: 'reviewing' }],
    blockers: [],
    confidence: 'high'
  }, 'Madhavi Andoju', 'raw', stories)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].status, 'Completed')
  assert.equal(rows[0].description, 'Risk scoring rules', 'title comes from Jira, not the model')
  assert.equal(rows[1].status, 'In Progress')
  assert.equal(rows[1].description, null, 'no work item means no title (A8)')
})

test('a blocker on a listed item attaches to that row instead of adding one', () => {
  const rows = toTrackerRows({
    completed: [],
    inProgress: [{ storyRef: 'SCRUM-6', comment: 'working on it' }],
    blockers: [{ description: 'sandbox times out', storyRef: 'SCRUM-6' }],
    confidence: 'high'
  }, 'Madhavi Andoju', 'raw', stories)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].anyBlocker, 'sandbox times out')
  assert.equal(rows[0].status, 'In Progress')
})

test('a blocker with no work item gets its own Blocked row, comment empty', () => {
  const rows = toTrackerRows({
    completed: [], inProgress: [],
    blockers: [{ description: 'no VPN access', storyRef: null }],
    confidence: 'high'
  }, 'Madhavi Andoju', 'raw', stories)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'Blocked')
  assert.equal(rows[0].anyBlocker, 'no VPN access')
  assert.equal(rows[0].comment, null, 'the text is not duplicated into Comment')
  assert.equal(rows[0].win, null)
})

test('an empty extraction still records the member as having replied', () => {
  const rows = toTrackerRows(
    { completed: [], inProgress: [], blockers: [], confidence: 'high' },
    'Madhavi Andoju', 'nothing to report today', stories
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].comment, 'nothing to report today')
  assert.equal(rows[0].status, 'In Progress')
})

test('two blockers on the same item are joined onto one row', () => {
  const rows = toTrackerRows({
    completed: [],
    inProgress: [{ storyRef: 'SCRUM-6', comment: 'on it' }],
    blockers: [
      { description: 'waiting on review', storyRef: 'SCRUM-6' },
      { description: 'test data stale', storyRef: 'SCRUM-6' }
    ],
    confidence: 'high'
  }, 'Madhavi Andoju', 'raw', stories)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].anyBlocker, 'waiting on review; test data stale')
})

/**
 * Merging a later message into the day's rows (A11).
 *
 * The case that forced this: report two tickets, remember a third, send it —
 * the first two must still be there.
 */
const row = (win, status, comment, blocker = null) => ({
  win, description: null, assignedTo: 'Madhavi Andoju', comment, status, anyBlocker: blocker
})

test('a later message about a different ticket keeps the earlier rows', async () => {
  const { mergeRows } = await import('../dist/jobs/updateIntake.js')
  const merged = mergeRows(
    [row('SCRUM-6', 'In Progress', 'on it'), row('SCRUM-7', 'Completed', 'done')],
    [row('SCRUM-21', 'In Progress', 'starting this')]
  )
  assert.deepEqual(merged.map((r) => r.win), ['SCRUM-6', 'SCRUM-7', 'SCRUM-21'])
})

test('mentioning the same ticket again updates its row instead of duplicating it', async () => {
  const { mergeRows } = await import('../dist/jobs/updateIntake.js')
  const merged = mergeRows(
    [row('SCRUM-6', 'In Progress', 'on it')],
    [row('SCRUM-6', 'Completed', 'finished it now')]
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'Completed')
  assert.equal(merged[0].comment, 'finished it now')
})

test('a ticket not mentioned again is left untouched', async () => {
  const { mergeRows } = await import('../dist/jobs/updateIntake.js')
  const merged = mergeRows(
    [row('SCRUM-6', 'In Progress', 'on it'), row('SCRUM-7', 'Completed', 'done')],
    [row('SCRUM-6', 'Blocked', null, 'waiting on credentials')]
  )
  assert.equal(merged.length, 2)
  assert.equal(merged.find((r) => r.win === 'SCRUM-7').status, 'Completed')
  assert.equal(merged.find((r) => r.win === 'SCRUM-6').anyBlocker, 'waiting on credentials')
})

test('repeating the same unattached remark does not add a second row', async () => {
  const { mergeRows } = await import('../dist/jobs/updateIntake.js')
  const merged = mergeRows(
    [row(null, 'In Progress', 'reviewing pull requests')],
    [row(null, 'In Progress', 'reviewing pull requests')]
  )
  assert.equal(merged.length, 1)
})

test('a different unattached remark is added alongside the first', async () => {
  const { mergeRows } = await import('../dist/jobs/updateIntake.js')
  const merged = mergeRows(
    [row(null, 'In Progress', 'reviewing pull requests')],
    [row(null, 'In Progress', 'also sat in the architecture review')]
  )
  assert.equal(merged.length, 2)
})
