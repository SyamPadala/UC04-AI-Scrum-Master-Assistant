import test from 'node:test'
import assert from 'node:assert/strict'
import { assessReadiness } from '../dist/admin/readiness.js'
import { isConversationGone } from '../dist/bot/adapter.js'
import { messageMembers } from '../dist/jobs/reminder.js'

/** SPEC-008 10d–10e: readiness checks, and a chat Teams has deleted. */

const item = (key, over = {}) => ({
  key, title: key, status: 'In Progress', statusCategory: 'In Progress', points: 3,
  assignee: 'A', assigneeAccountId: 'j1', url: '', updated: new Date(), ...over
})
const ready = {
  sprint: { name: 'Sprint 1', items: [item('SCRUM-1')] },
  pointsFieldConfigured: true,
  members: [{ name: 'Santhosh', linked: true, chat: 'ok' }],
  scrumMaster: { name: 'Syam', chat: 'ok' },
  tracker: { ok: true },
  summaryRanToday: false,
  standupTime: '09:30',
  summaryTime: '18:00'
}
const red = (facts) => assessReadiness(facts).filter((r) => !r.ok).map((r) => r.check)

test('a ready team is green on every check', () => {
  assert.deepEqual(red(ready), [])
})

test('no active sprint is red and says to start it', () => {
  const rows = assessReadiness({ ...ready, sprint: undefined })
  const sprint = rows.find((r) => r.check === 'Active sprint')
  assert.equal(sprint.ok, false)
  assert.match(sprint.detail, /Start the sprint in Jira/)
})

test('unassigned and unpointed stories are each named', () => {
  const rows = assessReadiness({ ...ready, sprint: { name: 'S', items: [item('SCRUM-28', { assigneeAccountId: null, points: null })] } })
  assert.match(rows.find((r) => r.check === 'Assignees').detail, /SCRUM-28/)
  assert.match(rows.find((r) => r.check === 'Story points').detail, /SCRUM-28/)
})

test('unlinked members and dead or missing chats are named', () => {
  const rows = assessReadiness({
    ...ready,
    members: [
      { name: 'Vardhan', linked: false, chat: 'gone' },
      { name: 'Sailaja', linked: true, chat: 'none' }
    ]
  })
  assert.match(rows.find((r) => r.check === 'Jira links').detail, /Vardhan/)
  const chats = rows.find((r) => r.check === 'Teams chats').detail
  assert.match(chats, /Chat deleted in Teams: Vardhan/)
  assert.match(chats, /App not installed: Sailaja/)
})

test('an unreachable tracker, a closed stand-up and a bad schedule are red', () => {
  assert.deepEqual(red({ ...ready, tracker: { ok: false, error: '404' }, summaryRanToday: true }), ['Tracker', 'Schedule'])
  assert.deepEqual(red({ ...ready, standupTime: '18:00', summaryTime: '09:00' }), ['Schedule'])
})

test("the Scrum Master's chat is checked, because blocker alerts depend on it (10k)", () => {
  assert.deepEqual(red({ ...ready, scrumMaster: { name: 'Syam', chat: 'gone' } }), ['Scrum Master chat'])
  const { scrumMaster: _unset, ...noSm } = ready
  assert.match(assessReadiness(noSm).find((r) => r.check === 'Scrum Master chat').detail, /No Scrum Master is set/)
})

test('a Jira failure is shown, not hidden as "no sprint"', () => {
  const rows = assessReadiness({ ...ready, sprint: undefined, jiraError: '401 Unauthorized' })
  assert.match(rows.find((r) => r.check === 'Active sprint').detail, /Jira could not be read: 401/)
})

test('ConversationNotFound is recognised as a deleted chat; other errors are not', () => {
  const gone = Object.assign(new Error('Request failed with status 404: {"error":{"code":"ConversationNotFound"}}'), { status: 404 })
  assert.equal(isConversationGone(gone), true)
  assert.equal(isConversationGone(Object.assign(new Error('Request failed with status 401'), { status: 401 })), false)
})

test('10e: a deleted chat is forgotten and reported as not installed, not as a failure', async () => {
  const team = {
    teamId: 't1',
    members: [
      { memberId: 'm1', displayName: 'Santhosh', conversationRef: 'ok' },
      { memberId: 'm2', displayName: 'Vardhan', conversationRef: 'dead' }
    ]
  }
  const forgotten = []
  const result = await messageMembers(team, ['m1', 'm2'], 'hello', {
    send: async (ref) => {
      if (ref === 'dead') throw Object.assign(new Error('Request failed with status 404: ConversationNotFound'), { status: 404 })
    },
    forget: async (teamId, memberId) => { forgotten.push(`${teamId}/${memberId}`) }
  })
  assert.deepEqual(forgotten, ['t1/m2'])
  assert.equal(result.sent, 1)
  assert.equal(result.failed, 0)
  assert.match(result.detail, /not installed for: Vardhan/)
})
