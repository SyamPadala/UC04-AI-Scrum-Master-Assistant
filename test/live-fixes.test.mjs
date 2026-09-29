import test from 'node:test'
import assert from 'node:assert/strict'

/** Fixes from the 29 Sep live test: SPEC-004 items 27 and 29, SPEC-003 item 9. */

const { requireEvidence } = await import('../dist/agents/updateProcessor.js')
const { parseExtraction } = await import('../dist/agents/schema.js')
const { isWorkingDay, DEFAULT_WORKING_DAYS } = await import('../dist/jobs/schedule.js')
const { checkSchedule } = await import('../dist/admin/validate.js')
const { intakeReply } = await import('../dist/bot/replies.js')

const story = (key, title) => ({ key, title, status: 'In Progress', statusCategory: 'In Progress', points: 3, assignee: 'A', assigneeAccountId: 'a', url: '', updated: new Date() })
const STORIES = new Map([
  ['SCRUM-28', story('SCRUM-28', '[Auth Service] Ensure Scalability, High Availability, Low Latency, and Maintainable Partner Onboarding')],
  ['SCRUM-21', story('SCRUM-21', 'Build Risk Scoring Service with configurable weights')],
  ['SCRUM-20', story('SCRUM-20', 'Implement asynchronous screening service with HMAC-validated webhook callbacks')]
])
const extract = (parts) => parseExtraction(JSON.stringify({ completed: [], inProgress: [], blockers: [], ...parts }))

// ── item 27 ──────────────────────────────────────────────────────────────
test('item 27: vague words matched to a story become a question offering it (live test 8)', () => {
  const out = requireEvidence(extract({ completed: [{ storyRef: 'SCRUM-28', comment: 'Finished the service work' }] }), STORIES, new Set())
  assert.equal(out.completed[0].storyRef, null)
  assert.deepEqual(out.completed[0].alternatives, ['SCRUM-28'])
})

test('item 27: words that share a meaningful word with the title are accepted', () => {
  for (const [key, comment] of [
    ['SCRUM-28', 'working on the scalability and high availability work'],
    ['SCRUM-21', 'moving on to the risk scoring rules'],
    ['SCRUM-20', 'wrapped up the webhook validation work'],
    ['SCRUM-20', 'still on the screening service']
  ]) {
    const out = requireEvidence(extract({ inProgress: [{ storyRef: key, comment }] }), STORIES, new Set())
    assert.equal(out.inProgress[0].storyRef, key, comment)
  }
})

test('item 27: a typed key needs no other evidence', () => {
  const out = requireEvidence(extract({ completed: [{ storyRef: 'SCRUM-28', comment: 'done' }] }), STORIES, new Set(['SCRUM-28']))
  assert.equal(out.completed[0].storyRef, 'SCRUM-28')
})

test("item 27: an open blocker's text counts as evidence (\"that issue is resolved\")", () => {
  const out = requireEvidence(
    extract({ inProgress: [{ storyRef: 'SCRUM-21', comment: 'the client finally sent the weights, resolved' }] }),
    STORIES, new Set(), [{ workItem: 'SCRUM-21', description: 'waiting for the client to send the weights' }])
  assert.equal(out.inProgress[0].storyRef, 'SCRUM-21')
})

test('item 27: a blocker is kept on a story the same message supports, and dropped otherwise', () => {
  const kept = requireEvidence(extract({
    inProgress: [{ storyRef: 'SCRUM-21', comment: 'on the risk scoring' }],
    blockers: [{ storyRef: 'SCRUM-21', description: 'waiting on review' }]
  }), STORIES, new Set())
  assert.equal(kept.blockers[0].storyRef, 'SCRUM-21')
  const dropped = requireEvidence(extract({ blockers: [{ storyRef: 'SCRUM-28', description: 'my laptop is broken' }] }), STORIES, new Set())
  assert.equal(dropped.blockers[0].storyRef, null, 'alerted as a blocker with no work item instead')
})

// ── item 29 ──────────────────────────────────────────────────────────────
const result = (over) => ({
  outcome: 'nothingRecorded', understood: true, recorded: [], refused: [], pending: [], ambiguous: [], unlinkedBlockers: [], openItems: [],
  rows: 0, added: 0, blockers: 0, alertSent: false, extractionMs: 0, totalMs: 0, truncated: false, confidence: 'high', ...over
})

test('item 29: a question waiting on a card has no heading and no stray "?"', () => {
  const reply = intakeReply(result({ pending: [{ key: 'SCRUM-26', title: 'T', owner: 'sailaja', status: 'Completed', comment: 'x', blocker: null }] }), 'Madhavi')
  assert.equal(reply, 'SCRUM-26 is assigned to sailaja, not you. Please confirm below if you still want it recorded.')
})

test('item 29: each line is its own paragraph, so Teams keeps them apart', () => {
  const reply = intakeReply(result({
    outcome: 'recorded',
    recorded: [{ win: 'SCRUM-28', title: 'Scalability', status: 'In Progress', blocker: null }],
    refused: [{ reason: 'noWorkItem', words: 'fixed the login page' }]
  }), 'Madhavi')
  assert.match(reply, /Madhavi:\n\n✔ SCRUM-28 Scalability — In Progress\n\n✘ I couldn't find/)
})

// ── SPEC-003 item 9 ──────────────────────────────────────────────────────
const team = (workingDays) => ({ timezone: 'Asia/Kolkata', ...(workingDays === undefined ? {} : { workingDays }) })

test('working days: Monday to Friday by default, in the team\'s own timezone', () => {
  assert.deepEqual(DEFAULT_WORKING_DAYS, [1, 2, 3, 4, 5])
  assert.equal(isWorkingDay(team(), new Date('2026-10-03T05:00:00Z')), false, 'Saturday in Kolkata')
  assert.equal(isWorkingDay(team(), new Date('2026-10-05T05:00:00Z')), true, 'Monday in Kolkata')
  // 20:00 UTC Friday is already 01:30 Saturday in Kolkata.
  assert.equal(isWorkingDay(team(), new Date('2026-10-02T20:00:00Z')), false)
})

test('working days: a team that works Saturdays gets Saturday', () => {
  assert.equal(isWorkingDay(team([1, 2, 3, 4, 5, 6]), new Date('2026-10-03T05:00:00Z')), true)
})

test('working days: the schedule form must keep at least one day', () => {
  const base = { standupTime: '09:30', summaryTime: '18:00', timezone: 'Asia/Kolkata', gracePeriodMinutes: 120, habitualThreshold: 2, active: true }
  assert.deepEqual(checkSchedule({ ...base, workingDays: [5, 1, 3] }, 5).value.workingDays, [1, 3, 5])
  assert.equal(checkSchedule({ ...base, workingDays: [] }, 5).ok, false)
  assert.equal(checkSchedule(base, 5).value.workingDays, undefined, 'absent keeps the team\'s current days')
})
