import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSummary } from '../dist/agents/schema.js'
import { headline, splitKey, summaryCard, summaryEmailHtml } from '../dist/cards/summary.js'

/** The summary's sections and layout (SPEC-006 item 4, amended 25 Sep 2026). */

const sections = {
  updates: [{ member: 'Tiwari Satyam', lines: ['SCRUM-7 in progress: login page wired to the API', 'Reviewed pull requests'] }],
  blockers: [{ member: 'Tiwari Satyam', workItem: 'SCRUM-9', description: 'Waiting for <test> credentials', since: '2026-09-24' }],
  progress: '12 of 30 points done (40%); behind the sprint goal.',
  atRisk: [{ workItem: 'SCRUM-9', reason: 'has an active blocker' }],
  velocity: 'This sprint 12; previous 20, 22, 18.',
  participation: '3 of 4 reported; Madhavi Andoju did not report.'
}

const facts = {
  teamName: 'Scrum Team Alpha',
  localDate: '2026-09-25',
  sprint: { name: 'SCRUM Sprint 3', goal: 'Login', committedPoints: 30, completedPoints: 12, unpointedCount: 0, previousVelocities: [20, 22, 18], items: [] },
  updates: [{ member: 'Tiwari Satyam', rows: [{ win: 'SCRUM-9', status: 'In progress', comment: 'x', blocker: 'y' }, { win: null, status: 'Done', comment: 'z', blocker: null }] }],
  participation: { responded: 3, rosterSize: 4, missing: ['Madhavi Andoju'] },
  activeBlockers: [{ member: 'Tiwari Satyam', workItem: 'SCRUM-9', description: 'y', since: '2026-09-24' }],
  atRisk: [{ key: 'SCRUM-9', title: 'API', reason: 'has an active blocker' }],
  staleProgressDays: 2
}

test('valid summary JSON parses, including inside a code fence', () => {
  assert.deepEqual(parseSummary('```json\n' + JSON.stringify(sections) + '\n```'), sections)
})

test('a summary missing a section fails the call', () => {
  const { velocity: _v, ...missing } = sections
  assert.throws(() => parseSummary(JSON.stringify(missing)), /velocity/)
})

test('prose instead of JSON fails the call', () => {
  assert.throws(() => parseSummary("Today's updates: all good."), /not valid JSON/)
})

test('headline figures come from the facts, not the model', () => {
  assert.deepEqual(headline(facts).map((h) => h.value), ['3 of 4', '12/30 (40%)', '1', '1'])
})

test('no sprint means the points figure is shown as not available', () => {
  const { sprint: _s, ...noSprint } = facts
  assert.equal(headline(noSprint)[1].value, 'n/a')
})

test('a leading work item key is split into its own column', () => {
  assert.deepEqual(splitKey('SCRUM-7 in progress: login'), { key: 'SCRUM-7', rest: 'in progress: login' })
  assert.deepEqual(splitKey('Reviewed pull requests'), { key: null, rest: 'Reviewed pull requests' })
})

test('the email escapes model and tracker text', () => {
  const html = summaryEmailHtml(facts, sections)
  assert.ok(html.includes('Waiting for &lt;test&gt; credentials'))
  assert.ok(!html.includes('<test>'))
})

test('the card has all five sections in order', () => {
  const texts = summaryCard(facts, sections).body.filter((b) => b.color === 'Accent').map((b) => b.text)
  assert.deepEqual(texts, ["Today's updates", 'Active blockers', 'Sprint progress', 'At risk', 'Velocity'])
})
