import test from 'node:test'
import assert from 'node:assert/strict'

/** Maturity plan (docs/MATURITY-PLAN.md), 8 Oct 2026. */

const { intakeReply } = await import('../dist/bot/replies.js')
const { scrumMasterKnows } = await import('../dist/jobs/blockerAlert.js')

const base = {
  outcome: 'nothingRecorded', understood: true, recorded: [], refused: [], choices: [], openItems: [],
  rows: 0, added: 0, blockers: 1, extractionMs: 0, totalMs: 0, truncated: false, confidence: 'high',
  unlinkedBlockers: ['my laptop is broken']
}

test('M1: the member is told the Scrum Master knows only when the alert went, now or earlier today', () => {
  assert.match(intakeReply({ ...base, alertSent: true, alertCode: 'sent' }, 'm'), /Your Scrum Master has been told/)
  assert.match(intakeReply({ ...base, alertSent: false, alertCode: 'alreadyAlerted' }, 'm'), /Your Scrum Master has been told/)
  // The claim was released, so this is a plain failure — never "has been told".
  assert.match(intakeReply({ ...base, alertSent: false, alertCode: 'appNotInstalled' }, 'm'), /couldn't reach your Scrum Master/)
  assert.match(intakeReply({ ...base, alertSent: false, alertCode: 'noScrumMaster' }, 'm'), /couldn't reach your Scrum Master/)
})

test('M1: a decision never depends on the wording of the reason', () => {
  assert.equal(scrumMasterKnows({ sent: false, code: 'alreadyAlerted' }), true)
  assert.equal(scrumMasterKnows({ sent: false, code: 'appNotInstalled' }), false)
  assert.equal(scrumMasterKnows({ sent: true, code: 'sent' }), true)
})

// ── M9: Teams sends are retried on busy / temporary errors only ─────────
const { withSendRetry, retryableSend, teamsRetry } = await import('../dist/bot/sendRetry.js')
teamsRetry.delaysMs = [1, 1]
const failing = (errors) => { let n = 0; return { calls: () => n, send: async () => { n++; const e = errors.shift(); if (e) throw e } } }
const httpError = (status, message = 'x') => Object.assign(new Error(message), { status })

test('M9: a 429 and a 503 are retried, then the send goes through', async () => {
  const s = failing([httpError(429), httpError(503)])
  await withSendRetry('t', s.send)
  assert.equal(s.calls(), 3)
})

test('M9: three failures in a row give up with the error', async () => {
  const s = failing([httpError(500), httpError(500), httpError(500)])
  await assert.rejects(withSendRetry('t', s.send))
  assert.equal(s.calls(), 3)
})

test('M9: a chat that is gone, or a refused request, is never retried', async () => {
  const gone = failing([httpError(404, 'ConversationNotFound')])
  await assert.rejects(withSendRetry('t', gone.send))
  assert.equal(gone.calls(), 1)
  const refused = failing([httpError(403, 'Forbidden')])
  await assert.rejects(withSendRetry('t', refused.send))
  assert.equal(refused.calls(), 1)
})

test('M9: no answer at all (timeout, dropped connection) counts as temporary', () => {
  assert.equal(retryableSend(new Error('socket hang up')), true)
  assert.equal(retryableSend(Object.assign(new Error('x'), { name: 'TimeoutError' })), true)
  assert.equal(retryableSend(new Error('something else')), false)
})

// ── M7: membership changes only in a linked Teams team ──────────────────
const { assertLinkedTeamsTeam } = await import('../dist/admin/provision.js')
test('M7: a Teams team not linked to a scrum team is refused', () => {
  assert.doesNotThrow(() => assertLinkedTeamsTeam('g-alpha', ['g-alpha', 'g-beta']))
  assert.throws(() => assertLinkedTeamsTeam('g-company-wide', ['g-alpha']), /not linked to any scrum team/)
})

// ── M16: one correlation id on every JSON log line of a message or job ──
const { withCorrelation, tagLine } = await import('../dist/util/correlation.js')
test('M16: JSON log lines inside a run carry its id; other text and lines outside are unchanged', async () => {
  const inside = await withCorrelation('msg-1234', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1)) // survives an await
    return tagLine(JSON.stringify({ event: 'update.processed' }))
  })
  assert.deepEqual(JSON.parse(inside), { correlationId: 'msg-1234', event: 'update.processed' })
  assert.equal(tagLine('{"event":"x"}'), '{"event":"x"}', 'outside a run: unchanged')
  assert.equal(withCorrelation('m', () => tagLine('plain text')), 'plain text')
})

// ── M10: Jira project per team; a team without one works on general updates ──
const { pmFor, NO_JIRA } = await import('../dist/pm/factory.js')
const { assessReadiness } = await import('../dist/admin/readiness.js')
const { assessOnboarding: onboard } = await import('../dist/admin/onboarding.js')

test('M10: a team without a Jira project gets the no-Jira client: no sprint, no stories', async () => {
  const pm = pmFor({})
  assert.equal(pm, NO_JIRA)
  assert.equal(await pm.getActiveSprint(), undefined)
  assert.deepEqual(await pm.getSprintOpenItems(), [])
})

test('M10: readiness and onboarding treat "no Jira project" as a choice, not a fault', () => {
  const rows = assessReadiness({
    sprint: undefined, noJiraProject: true, pointsFieldConfigured: true,
    members: [{ name: 'A', linked: false, chat: 'ok' }], tracker: { ok: true }, summaryRanToday: false,
    standupTime: '09:30', summaryTime: '18:00'
  })
  assert.deepEqual(rows.find((r) => r.check === 'Jira project'), { check: 'Jira project', ok: true, detail: 'Not used by this team: every update is saved as a general update.' })
  assert.equal(rows.some((r) => r.check === 'Jira links' || r.check === 'Active sprint'), false)
  const steps = onboard({ teamsTeamName: 'T', licence: true, inTeamsTeam: true, chat: 'ok', linked: false, story: 'noSprint', tracker: { via: 'group' }, noJiraProject: true })
  assert.equal(steps.done, 6, 'Jira link and story are not needed')
})

// ── M11: a new team never borrows another team's tracker ────────────────
const { trackerFor } = await import('../dist/trackers/factory.js')
const { TrackerNotSetError } = await import('../dist/trackers/unset.js')
test('M11: an unset tracker refuses to write instead of using another list', async () => {
  const tracker = trackerFor({ tracker: { kind: 'unset' }, members: [] })
  await assert.rejects(tracker.write({ teamId: 't', memberId: 'm', memberName: 'M', localDate: '2026-10-08', rows: [], rawText: '', capturedAt: new Date() }), TrackerNotSetError)
  assert.deepEqual(await tracker.readToday('t', '2026-10-08'), [])
})
