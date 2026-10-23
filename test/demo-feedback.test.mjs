import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'

/** Demo feedback, 22 Oct 2026: SPEC-004 items 43–44, SPEC-006 items 11–12. */

process.env.DRY_RUN = 'true'
const { participationFigure, headline } = await import('../dist/cards/summary.js')
const { summaryBuilderUser } = await import('../dist/agents/prompts/summaryBuilder.js')
const { trackerTitle } = await import('../dist/pm/types.js')
const { toTrackerRows } = await import('../dist/jobs/intakeRows.js')
const { JiraClient } = await import('../dist/pm/jira.js')
const { gatherFacts } = await import('../dist/jobs/summary.js')
const { scheduledMinutes } = await import('../dist/jobs/schedule.js')
const { useStore, waitingApprovals } = await import('../dist/store/index.js')
const { memoryStore } = await import('../dist/store/memory.js')
const { askScrumMaster, decideRequest, expireApprovals, parseApproval, remindApprovals } = await import('../dist/jobs/approval.js')
const { approvalCard, APPROVAL_ACTION } = await import('../dist/cards/approval.js')
const { MockTracker } = await import('../dist/trackers/mock.js')

// ── SPEC-006 item 12: participation percentage ──────────────────────────
test('item 12: participation shows the percentage, worked out by code', () => {
  assert.equal(participationFigure({ responded: 3, rosterSize: 5 }), '3 of 5 (60%)')
  assert.equal(participationFigure({ responded: 0, rosterSize: 0 }), 'no roster')
  const facts = { teamName: 'T', localDate: 'd', updates: [], activeBlockers: [], atRisk: [], staleProgressDays: 2, participation: { responded: 3, rosterSize: 5, missing: ['A', 'B'] } }
  assert.equal(headline(facts)[0].value, '3 of 5 (60%)')
  assert.match(summaryBuilderUser(facts), /Participation: 3 of 5 \(60%\) reported/)
})

// ── SPEC-004 item 44 / SPEC-006 item 11: sub-tasks ──────────────────────
const sub = { key: 'SCRUM-41', title: 'Build form', parentKey: 'SCRUM-25', status: 'Done', statusCategory: 'Done', points: 2, assignee: 'Ravi', assigneeAccountId: 'j1', url: '', updated: new Date(0) }
const parent = { key: 'SCRUM-25', title: 'Login page', parentKey: null, status: 'In Progress', statusCategory: 'In Progress', points: 5, assignee: 'Priya', assigneeAccountId: 'j2', url: '', updated: new Date(0) }

test('item 44: a sub-task row names its parent; a story row is unchanged', () => {
  assert.equal(trackerTitle(sub), 'Build form (sub-task of SCRUM-25)')
  assert.equal(trackerTitle(parent), 'Login page')
  const rows = toTrackerRows({ completed: [{ storyRef: 'SCRUM-41', comment: 'done' }], inProgress: [], blockers: [] }, 'Ravi', new Map([['SCRUM-41', sub]]))
  assert.equal(rows[0].win, 'SCRUM-41', 'recorded on the sub-task itself')
  assert.equal(rows[0].description, 'Build form (sub-task of SCRUM-25)')
})

test('item 11: sprint figures count stories only; a sub-task is known by its parent', async (t) => {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  const issue = (key, subtask, parentKey, points, done) => ({
    key,
    fields: {
      summary: key, updated: '2026-10-22', status: { name: done ? 'Done' : 'In Progress', statusCategory: { name: done ? 'Done' : 'In Progress' } },
      issuetype: { subtask }, ...(parentKey === null ? {} : { parent: { key: parentKey } }), points
    }
  })
  globalThis.fetch = async (url) => {
    const u = String(url)
    const body = u.includes('state=active')
      ? { values: [{ id: 5, name: 'Sprint 1', state: 'active' }] }
      : u.includes('state=closed')
        ? { values: [] }
        : { issues: [issue('SCRUM-25', false, 'SCRUM-1', 5, false), issue('SCRUM-41', true, 'SCRUM-25', 2, true), issue('SCRUM-26', false, null, 3, true)] }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  const jira = new JiraClient({ baseUrl: 'https://x', email: 'e', apiToken: 't', projectKey: 'SCRUM', storyPointsField: 'points', boardId: '1' })
  const data = await jira.getSprintData()
  assert.equal(data.committedPoints, 8, 'SCRUM-25 + SCRUM-26; the sub-task is not counted')
  assert.equal(data.completedPoints, 3)
  assert.equal(data.items.find((i) => i.key === 'SCRUM-41').parentKey, 'SCRUM-25')
  assert.equal(data.items.find((i) => i.key === 'SCRUM-25').parentKey, null, "a story's epic parent does not make it a sub-task")
})

test('item 11: the summary shows a sub-task under its story and leaves it out of the sprint list and at-risk', async () => {
  const tracker = {
    readToday: async () => [{ memberName: 'Ravi', rows: [{ win: 'SCRUM-41', status: 'Completed', comment: 'form done', anyBlocker: null }] }],
    openBlockers: async () => []
  }
  const pm = { getSprintData: async () => ({ sprintName: 'S', goal: '', committedPoints: 5, completedPoints: 0, unpointedCount: 0, previousVelocities: [], items: [parent, { ...sub, statusCategory: 'In Progress' }] }) }
  const facts = await gatherFacts({ teamId: 't', name: 'T', members: [{ memberId: 'm1', displayName: 'Ravi' }] }, tracker, pm, '2026-10-22', new Date('2026-10-22'))
  assert.equal(facts.updates[0].rows[0].win, 'SCRUM-25 › SCRUM-41')
  assert.deepEqual(facts.sprint.items.map((i) => i.key), ['SCRUM-25'])
  assert.deepEqual(facts.atRisk.map((i) => i.key), ['SCRUM-25'])
})

// ── SPEC-004 item 43: Scrum Master approval ─────────────────────────────
test('item 43: the reminder runs 30 minutes before the summary', () => {
  assert.equal(scheduledMinutes({ summaryTime: '17:00' }, 'approvals'), 990)
})

const TODAY = '2026-10-22'
const TEAM = {
  teamId: 'team-1', name: 'Alpha', summaryTime: '17:00', scrumMasterId: 'sm',
  members: [{ memberId: 'm1', displayName: 'Ravi', jiraAccountId: 'j1', conversationRef: 'ravi-chat' }]
}
const PRIYA_STORY = { ...parent }

async function fresh () {
  const store = memoryStore()
  useStore(store)
  await store.saveScrumMasterRef('sm', 'Sam', 'sm-chat')
  const file = path.join(tmpdir(), `uc04-approval-${Date.now()}-${Math.random()}.json`)
  return { tracker: new MockTracker(file), cleanup: async () => await rm(file, { force: true }) }
}

/** Builds the Scrum Master's card the way askScrumMaster does and reads back its button data. */
async function ask (item = { status: 'Completed', comment: 'finished the form', blocker: null }) {
  const reply = await askScrumMaster(TEAM, { memberId: 'm1', memberName: 'Ravi' }, PRIYA_STORY, item, TODAY)
  const [waiting] = await waitingApprovals('team-1', TODAY)
  const card = approvalCard({ memberName: 'Ravi', owner: 'Priya', storyTitle: 'Login page', summaryTime: '17:00', payload: { action: APPROVAL_ACTION, requestId: waiting.requestId, teamId: 'team-1', localDate: TODAY, memberId: 'm1', item: { key: 'SCRUM-25', ...item } } })
  const press = (title) => parseApproval(card.actions.find((a) => a.title === title).data)
  return { reply, waiting, card, press }
}

test('item 43: Submit asks the Scrum Master; only who and which story are stored', async () => {
  const { cleanup } = await fresh()
  try {
    const { reply, waiting } = await ask()
    assert.match(reply, /waiting for your Scrum Master's approval/)
    assert.deepEqual(Object.keys(waiting).sort(), ['key', 'localDate', 'memberId', 'memberName', 'owner', 'requestId', 'requestedAt', 'state', 'teamId'])
    assert.doesNotMatch(JSON.stringify(waiting), /finished the form/, 'Privacy NFR: no update text in the store')
    const again = await askScrumMaster(TEAM, { memberId: 'm1', memberName: 'Ravi' }, PRIYA_STORY, { status: 'Completed', comment: 'x', blocker: null }, TODAY)
    assert.match(again, /already waiting/)
  } finally { await cleanup() }
})

test('item 43: the card carries the blocker, so the Scrum Master learns of it at once', async () => {
  const { cleanup } = await fresh()
  try {
    const { reply, card } = await ask({ status: 'Blocked', comment: null, blocker: 'waiting on Key Vault' })
    assert.match(reply, /told about the blocker/)
    assert.match(JSON.stringify(card), /Blocker: waiting on Key Vault/)
  } finally { await cleanup() }
})

test('item 43: no reachable Scrum Master → nothing waits and the member is told', async () => {
  useStore(memoryStore())
  const reply = await askScrumMaster(TEAM, { memberId: 'm1', memberName: 'Ravi' }, PRIYA_STORY, { status: 'Completed', comment: 'x', blocker: null }, TODAY)
  assert.match(reply, /couldn't reach your Scrum Master/)
  assert.deepEqual(await waitingApprovals('team-1', TODAY), [])
})

test('item 43: Approve writes under the owner on the sender\'s row; a second press acts once; the member is told', async () => {
  const { tracker, cleanup } = await fresh()
  try {
    const { press } = await ask()
    const told = []
    const deps = { pm: { lookupStory: async () => PRIYA_STORY }, tracker, summaryHasRun: async () => false, tell: async (ref, text) => { told.push([ref, text]); return true } }
    const reply = await decideRequest(TEAM, 'sm', press('Approve'), TODAY, deps)
    assert.match(reply, /Approved: Ravi's update on SCRUM-25 is recorded/)
    const [update] = await tracker.readToday('team-1', TODAY)
    assert.equal(update.memberName, 'Ravi')
    assert.equal(update.rows[0].assignedTo, 'Priya')
    assert.equal(update.rows[0].comment, 'finished the form')
    assert.deepEqual(told, [['ravi-chat', 'Your Scrum Master approved your update on SCRUM-25. It is recorded in the tracker under Priya, as updated by you.']])
    assert.match(await decideRequest(TEAM, 'sm', press('Reject'), TODAY, deps), /already approved/)
  } finally { await cleanup() }
})

test('item 43: Reject writes nothing; only the Scrum Master may decide; a past card has expired', async () => {
  const { tracker, cleanup } = await fresh()
  try {
    const { press } = await ask()
    const told = []
    const deps = { pm: { lookupStory: async () => PRIYA_STORY }, tracker, summaryHasRun: async () => false, tell: async (ref, text) => { told.push(text); return true } }
    assert.match(await decideRequest(TEAM, 'm1', press('Approve'), TODAY, deps), /Only the Scrum Master/)
    assert.match(await decideRequest(TEAM, 'sm', press('Approve'), '2026-10-23', deps), /expired/)
    assert.match(await decideRequest(TEAM, 'sm', press('Reject'), TODAY, deps), /Rejected/)
    assert.deepEqual(await tracker.readToday('team-1', TODAY), [])
    assert.deepEqual(told, ['Your Scrum Master did not approve your update on SCRUM-25, so it was not recorded.'])
  } finally { await cleanup() }
})

test('item 43: the reminder goes to the Scrum Master and to each waiting member', async () => {
  const { cleanup } = await fresh()
  try {
    await ask()
    const told = []
    const result = await remindApprovals(TEAM, TODAY, { tell: async (ref, text) => { told.push([ref, text]); return true } })
    assert.equal(result.sent, 2)
    assert.deepEqual(told, [
      ['sm-chat', "1 update is waiting for your approval: Ravi → SCRUM-25. It won't be in today's summary unless approved by 17:00."],
      ['ravi-chat', "Your update on SCRUM-25 is still waiting for your Scrum Master's approval. Please contact them. If it isn't approved by 17:00, it won't be in today's summary."]
    ])
  } finally { await cleanup() }
})

test('item 43: at summary time what is still waiting expires and the member is told; nothing waiting, no reminder', async () => {
  const { tracker, cleanup } = await fresh()
  try {
    const { press } = await ask()
    const told = []
    assert.equal(await expireApprovals(TEAM, TODAY, { tell: async (ref, text) => { told.push(text); return true } }), 1)
    assert.deepEqual(told, ["Your update on SCRUM-25 wasn't approved before today's summary, so it wasn't recorded."])
    assert.equal((await remindApprovals(TEAM, TODAY, { tell: async () => true })).sent, 0)
    const late = await decideRequest(TEAM, 'sm', press('Approve'), TODAY, { pm: { lookupStory: async () => PRIYA_STORY }, tracker, summaryHasRun: async () => false, tell: async () => true })
    assert.match(late, /expired/)
  } finally { await cleanup() }
})

// ── SPEC-006 item 13: a rejected AI key ─────────────────────────────────
const { LlmAuthError } = await import('../dist/llm/types.js')
const { GeminiClient } = await import('../dist/llm/gemini.js')
const { buildSummaryText } = await import('../dist/agents/summaryBuilder.js')

test('item 13: a 401 from Gemini is a rejected key, and Agent 2 does not retry it', async (t) => {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('{"error":{"message":"API key not valid"}}', { status: 401 }) }
  const gemini = new GeminiClient('m', 'k')
  await assert.rejects(() => gemini.complete({ system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 1000, label: 't' }), LlmAuthError)
  assert.equal(calls, 1, 'not retried')

  let attempts = 0
  const llm = { model: 'm', complete: async () => { attempts++; throw new LlmAuthError(401) } }
  const facts = { teamName: 'T', localDate: 'd', updates: [], activeBlockers: [], atRisk: [], staleProgressDays: 2, participation: { responded: 0, rosterSize: 1, missing: ['A'] } }
  await assert.rejects(() => buildSummaryText(facts, llm, { maxRetries: 2, timeoutMs: 1000, maxToolIterations: 1 }), /AI key was rejected .* an admin must replace it/)
  assert.equal(attempts, 1)
})
