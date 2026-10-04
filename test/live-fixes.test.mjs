import test from 'node:test'
import assert from 'node:assert/strict'

/** Fixes from the 29 Sep live test: SPEC-004 items 29 and 33 (replacing 27), SPEC-003 item 9. */

const { requireReason, reasonIsSpecific } = await import('../dist/agents/updateProcessor.js')
const { parseExtraction } = await import('../dist/agents/schema.js')
const { isWorkingDay, DEFAULT_WORKING_DAYS } = await import('../dist/jobs/schedule.js')
const { checkSchedule } = await import('../dist/admin/validate.js')
const { intakeReply } = await import('../dist/bot/replies.js')

const extract = (parts) => parseExtraction(JSON.stringify({ completed: [], inProgress: [], blockers: [], ...parts }))

// ── item 33 (replaces item 27's title-word guard) ───────────────────────
test('item 33: a match with no reason, or a vague one, becomes a question offering it (live test 8)', () => {
  for (const reason of [undefined, null, '', 'matches their story', 'the member said they finished the task']) {
    const out = requireReason(extract({ completed: [{ storyRef: 'SCRUM-28', comment: 'Finished the service work', reason }] }), new Set())
    assert.equal(out.completed[0].storyRef, null, String(reason))
    assert.deepEqual(out.completed[0].alternatives, ['SCRUM-28'])
  }
})

test('item 33: a specific reason is enough, even with no word from the title (live 30 Sep, Sailaja)', () => {
  const out = requireReason(extract({ inProgress: [{
    storyRef: 'SCRUM-32', comment: 'added the circuit breaker and the backoff retries',
    reason: "circuit breaker and exponential backoff are in SCRUM-32's acceptance criteria"
  }] }), new Set())
  assert.equal(out.inProgress[0].storyRef, 'SCRUM-32')
})

test('item 33: a typed key needs no reason', () => {
  const out = requireReason(extract({ completed: [{ storyRef: 'SCRUM-28', comment: 'done' }] }), new Set(['SCRUM-28']))
  assert.equal(out.completed[0].storyRef, 'SCRUM-28')
})

test('item 33: a blocker is kept on a story the same message supports, or with its own reason; dropped otherwise', () => {
  const kept = requireReason(extract({
    inProgress: [{ storyRef: 'SCRUM-21', comment: 'on the risk scoring', reason: 'risk scoring is the title' }],
    blockers: [{ storyRef: 'SCRUM-21', description: 'waiting on review' }]
  }), new Set())
  assert.equal(kept.blockers[0].storyRef, 'SCRUM-21')
  const own = requireReason(extract({ blockers: [{ storyRef: 'SCRUM-33', description: 'blocked on Key Vault access', reason: 'Azure Key Vault secrets are in its acceptance criteria' }] }), new Set())
  assert.equal(own.blockers[0].storyRef, 'SCRUM-33')
  const dropped = requireReason(extract({ blockers: [{ storyRef: 'SCRUM-28', description: 'my laptop is broken' }] }), new Set())
  assert.equal(dropped.blockers[0].storyRef, null, 'alerted as a blocker with no work item instead')
})

test('item 33: what counts as a specific reason', () => {
  assert.equal(reasonIsSpecific('load balancer is part of high availability'), true)
  assert.equal(reasonIsSpecific('IHub middleware in the title'), true)
  assert.equal(reasonIsSpecific('it matches the story'), false)
  assert.equal(reasonIsSpecific('their task relates to this ticket'), false)
  assert.equal(reasonIsSpecific(null), false)
})

// ── item 29 ──────────────────────────────────────────────────────────────
const result = (over) => ({
  outcome: 'nothingRecorded', understood: true, recorded: [], refused: [], choices: [], unlinkedBlockers: [], openItems: [],
  rows: 0, added: 0, blockers: 0, alertSent: false, extractionMs: 0, totalMs: 0, truncated: false, confidence: 'high', ...over
})

test('item 29: a question waiting on a card has no heading and no stray "?"', () => {
  const reply = intakeReply(result({ choices: [{ words: 'x', status: 'Completed', blocker: null, options: [] }] }), 'Madhavi')
  assert.equal(reply, 'Which story is "x"? Please choose below.')
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
