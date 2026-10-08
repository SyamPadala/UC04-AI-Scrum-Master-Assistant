import test from 'node:test'
import assert from 'node:assert/strict'

/** SPEC-008 10m: the onboarding checklist, from plain facts. */

const { assessOnboarding } = await import('../dist/admin/onboarding.js')

const READY = {
  teamsTeamName: 'Scrum Team Alpha',
  licence: true,
  inTeamsTeam: true,
  chat: 'ok',
  linked: true,
  story: true,
  tracker: { via: 'group' }
}
const step = (result, key) => result.steps.find((s) => s.key === key)

test('10m: every step done is Ready, 6 of 6', () => {
  const result = assessOnboarding(READY)
  assert.deepEqual(result.steps.map((s) => s.key), ['licence', 'teamsTeam', 'app', 'jira', 'story', 'tracker'])
  assert.equal(result.done, 6)
  assert.equal(result.total, 6)
  assert.equal(step(result, 'tracker').detail, 'Through Scrum Team Alpha')
})

test('10m: a new member — each step says what to do next', () => {
  const result = assessOnboarding({ ...READY, licence: false, inTeamsTeam: false, chat: 'none', linked: false, story: false })
  assert.equal(result.done, 0)
  assert.match(step(result, 'licence').detail, /Assign a licence/)
  assert.equal(step(result, 'teamsTeam').detail, 'Add them to Scrum Team Alpha in Teams.')
  assert.equal(step(result, 'tracker').detail, 'Add them to Scrum Team Alpha in Teams.', 'group site: tracker access is the same fact')
  assert.match(step(result, 'app').detail, /send 'help'/)
  assert.equal(step(result, 'jira').detail, 'Invite them to Jira, then link them here.')
  assert.equal(step(result, 'story').detail, 'Link their Jira account first.')
})

test('10m: a fact that could not be read is never done', () => {
  const result = assessOnboarding({ ...READY, inTeamsTeam: { error: 'the Graph app is missing the GroupMember.Read.All permission.' } })
  assert.equal(step(result, 'teamsTeam').state, 'unknown')
  assert.equal(step(result, 'tracker').state, 'unknown')
  assert.match(step(result, 'teamsTeam').detail, /^Could not check: .*GroupMember\.Read\.All/)
  assert.equal(result.done, 4)
})

test('10m: no Teams team set — steps 2 and 6 say so', () => {
  const result = assessOnboarding({ ...READY, teamsTeamName: undefined, inTeamsTeam: undefined, tracker: { via: 'hand', tick: null } })
  assert.equal(step(result, 'teamsTeam').state, 'todo')
  assert.match(step(result, 'teamsTeam').detail, /^Teams team not set/)
  assert.equal(step(result, 'tracker').manual, true, 'tracker is not on a known group site, so it is ticked by hand')
})

test('10m: tracker elsewhere is ticked by hand, and shows who ticked it', () => {
  const todo = assessOnboarding({ ...READY, tracker: { via: 'hand', tick: null } })
  assert.equal(step(todo, 'tracker').detail, 'Give them access to the tracker, then tick.')
  const ticked = assessOnboarding({ ...READY, tracker: { via: 'hand', tick: { by: 'Syam', at: '2026-10-05T10:00:00Z' } } })
  assert.equal(step(ticked, 'tracker').state, 'done')
  assert.equal(step(ticked, 'tracker').detail, 'Ticked by Syam')
})

test('10m: no story, or no sprint, points to general updates', () => {
  assert.match(step(assessOnboarding({ ...READY, story: false }), 'story').detail, /Assign them a story in Jira\. Until then their updates are matched to stories for them to confirm, or saved as general updates\./)
  assert.match(step(assessOnboarding({ ...READY, story: 'noSprint' }), 'story').detail, /^No active sprint/)
})

// ── 10n: failures read as one line, naming the cause ─────────────────────
const { reason } = await import('../dist/admin/provision.js')

test('10n: a missing permission, a missing licence and a full Jira are named plainly', () => {
  assert.equal(reason(new Error("Graph POST /teams/g1/members failed: 403 {\"error\":{}}")), 'the Graph app is missing the TeamMember.ReadWrite.All permission.')
  assert.match(reason(new Error('Graph POST /users/u1/teamwork/installedApps failed: 403 x')), /licence is missing or still being set up/)
  assert.equal(reason(new Error('Jira 400: user limit reached for this license')), 'Jira has no free seat.')
  assert.equal(reason(new Error('something else')), 'something else')
})
