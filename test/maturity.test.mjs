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
