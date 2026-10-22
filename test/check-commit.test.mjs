import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCommit, isCode, specStatus } from '../scripts/check-commit.mjs'

const statuses = { 'SPEC-004': 'Approved — item 41 approved 8 Oct 2026', 'SPEC-001': 'Draft' }
const statusOf = (id) => statuses[id]

test('documentation-only commits are not checked', () => {
  assert.deepEqual(checkCommit('Docs: session log', ['docs/sessions/x.md', 'README.md'], statusOf), [])
})

test('a code commit with no spec id is stopped', () => {
  const problems = checkCommit('M16: correlation id', ['src/index.ts'], statusOf)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /names no spec/)
})

test('a code commit naming an Approved spec goes ahead', () => {
  assert.deepEqual(checkCommit('SPEC-004 item 41: answer at once', ['src/bot/handler.ts'], statusOf), [])
})

test('a code commit naming a Draft or unknown spec is stopped', () => {
  assert.match(checkCommit('SPEC-001: tick', ['src/jobs/tick.ts'], statusOf)[0], /not Approved/)
  assert.match(checkCommit('SPEC-099: x', ['src/a.ts'], statusOf)[0], /does not exist/)
})

test('merge commits are not checked; build files count as code', () => {
  assert.deepEqual(checkCommit('Merge branch x', ['src/a.ts'], statusOf), [])
  assert.equal(isCode('package.json'), true)
  assert.equal(isCode('test/a.test.mjs'), true)
  assert.equal(isCode('docs/specs/SPEC-001-foundation.md'), false)
})

test('reads the Status cell from the real spec files', () => {
  assert.match(specStatus('SPEC-008'), /^Approved/)
  assert.equal(specStatus('SPEC-999'), undefined)
})
