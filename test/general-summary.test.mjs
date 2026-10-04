import test from 'node:test'
import assert from 'node:assert/strict'
import { gatherFacts } from '../dist/jobs/summary.js'

/**
 * SPEC-004 item 39(c): General rows — new joiners' KT and access status — stay
 * in the tracker and out of the summary, blockers on them included. The member
 * still counts as having responded.
 */

const TEAM = {
  teamId: 'team-1',
  name: 'Alpha',
  timezone: 'Asia/Kolkata',
  members: [
    { memberId: 'm1', displayName: 'Sailaja', jiraAccountId: 'j1' },
    { memberId: 'm2', displayName: 'Sai Krishna', jiraAccountId: 'j2' }
  ],
  scrumMasterId: ''
}

const row = (win, comment, anyBlocker = null) => ({
  win, description: win === null ? null : 'A story', assignedTo: 'x', comment, status: anyBlocker === null ? 'In Progress' : 'Blocked', anyBlocker
})

const tracker = {
  readToday: async () => [
    { teamId: 'team-1', memberId: '', memberName: 'Sailaja', localDate: '2026-10-04', rows: [row('SCRUM-34', 'retry logic')], rawText: '', capturedAt: new Date() },
    { teamId: 'team-1', memberId: '', memberName: 'Sai Krishna', localDate: '2026-10-04', rows: [row(null, 'KT on the gateway', 'no Azure access')], rawText: '', capturedAt: new Date() }
  ],
  openBlockers: async () => [
    { memberId: '', member: 'Sai Krishna', workItem: null, description: 'no Azure access', since: '2026-10-04' },
    { memberId: '', member: 'Sailaja', workItem: 'SCRUM-34', description: 'waiting on Key Vault', since: '2026-10-03' }
  ]
}

const pm = { getSprintData: async () => undefined }

test('item 39(c): General rows and their blockers are left out; the member still responded', async () => {
  const facts = await gatherFacts(TEAM, tracker, pm, '2026-10-04', new Date('2026-10-04T12:00:00Z'))
  assert.deepEqual(facts.updates.map((u) => u.member), ['Sailaja'])
  assert.deepEqual(facts.updates[0].rows.map((r) => r.win), ['SCRUM-34'])
  assert.deepEqual(facts.activeBlockers.map((b) => b.workItem), ['SCRUM-34'])
  assert.equal(facts.participation.responded, 2)
  assert.deepEqual(facts.participation.missing, [])
})
