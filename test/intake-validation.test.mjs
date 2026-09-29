import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'

/**
 * SPEC-004 items 11–20 (28 Sep 2026): nothing about an update is silent.
 * Only a work item that exists in Jira and is assigned to the sender is
 * written; everything else goes back to the member with its reason.
 */

// Keeps the blocker alert away from real Firestore: with no dedupe claim and
// no Scrum Master on the roster, it returns before any I/O.
process.env.BLOCKER_ALERT_DEDUPE = 'false'
const { processUpdate } = await import('../dist/jobs/updateIntake.js')
const { MockTracker } = await import('../dist/trackers/mock.js')
const { intakeReply } = await import('../dist/bot/replies.js')

const TEAM = {
  teamId: 'team-1',
  name: 'Alpha',
  timezone: 'Asia/Kolkata',
  members: [
    { memberId: 'm1', displayName: 'Santhosh', jiraAccountId: 'j1', conversationRef: 'ref' },
    { memberId: 'm2', displayName: 'Vardhan', conversationRef: 'ref' }
  ],
  scrumMasterId: ''
}

const story = (key, title, assigneeAccountId, assignee = null) => ({
  key, title, status: 'In Progress', statusCategory: 'In Progress', points: 3,
  assignee, assigneeAccountId, url: '', updated: new Date()
})
const STORIES = {
  'SCRUM-27': story('SCRUM-27', 'Enforce Transport Security', 'j1', 'Santhosh'),
  'SCRUM-25': story('SCRUM-25', 'Build Core Architecture', 'j2', 'Pravallika'),
  'SCRUM-28': story('SCRUM-28', 'Ensure Scalability', null)
}

function stubs (output, { sprint = true } = {}) {
  const calls = { llm: 0, noSprintAlerts: 0 }
  const llm = {
    complete: async () => {
      calls.llm += 1
      return { text: JSON.stringify(output), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, roundTrips: 1 }
    }
  }
  const pm = {
    getActiveSprint: async () => sprint ? { id: 1, name: 'Sprint 1', goal: '', startDate: null, endDate: null } : undefined,
    getSprintData: async () => undefined,
    lookupStory: async (key) => STORIES[key],
    getMemberOpenItems: async (id) => sprint ? Object.values(STORIES).filter((s) => s.assigneeAccountId === id) : [],
    getSprintOpenItems: async () => sprint ? Object.values(STORIES) : []
  }
  const alertNoSprint = async () => { calls.noSprintAlerts += 1; return { sent: true } }
  return { calls, llm, pm, alertNoSprint }
}

async function run (output, { memberId = 'm1', sprint = true } = {}) {
  const file = path.join(tmpdir(), `uc04-validation-${Date.now()}-${Math.random()}.json`)
  await rm(file, { force: true })
  const tracker = new MockTracker(file)
  const s = stubs(output, { sprint })
  const name = TEAM.members.find((m) => m.memberId === memberId).displayName
  // The member's message names the keys the stubbed model returns, as a real
  // one would: a key nobody typed and nothing in the words supports is refused
  // by the evidence guard (SPEC-004 item 27), which resolution.test.mjs covers.
  const keys = [...output.completed ?? [], ...output.inProgress ?? [], ...output.blockers ?? []]
    .map((entry) => entry.storyRef).filter((key) => key != null)
  const text = keys.length === 0 ? 'message' : `update on ${keys.join(' and ')}`
  const result = await processUpdate(TEAM, memberId, name, text, '2026-09-28', {
    llm: s.llm, pm: s.pm, tracker, summaryHasRun: async () => false, alertNoSprint: s.alertNoSprint
  })
  const stored = await tracker.readToday('team-1', '2026-09-28')
  await rm(file, { force: true })
  return { result, stored, calls: s.calls, reply: intakeReply(result, name) }
}

const update = (parts) => ({ completed: [], inProgress: [], blockers: [], confidence: 'high', kind: 'update', ...parts })

test('item 20: a member with no Jira link is refused before the model is called', async () => {
  const { result, stored, calls, reply } = await run(update({ inProgress: [{ storyRef: 'SCRUM-27', comment: 'on it' }] }), { memberId: 'm2' })
  assert.equal(result.outcome, 'notLinked')
  assert.equal(calls.llm, 0, 'no model call is spent')
  assert.deepEqual(stored, [])
  assert.match(reply, /isn't linked to Jira/)
})

test('item 12: no active sprint writes nothing, tells the member and alerts the Scrum Master', async () => {
  const { result, stored, calls, reply } = await run(update({ inProgress: [{ storyRef: 'SCRUM-27', comment: 'on it' }] }), { sprint: false })
  assert.equal(result.outcome, 'noSprint')
  assert.deepEqual(stored, [])
  assert.equal(calls.noSprintAlerts, 1)
  assert.match(reply, /no active sprint/)
  assert.match(reply, /Scrum Master has been told/)
  assert.doesNotMatch(reply, /^Recorded/)
})

test('item 13: an item with no work item is not written and the member is shown their open items', async () => {
  const { result, stored, reply } = await run(update({ inProgress: [{ storyRef: null, comment: 'started analysing the story' }] }))
  assert.equal(result.outcome, 'nothingRecorded')
  assert.deepEqual(stored, [])
  assert.match(reply, /couldn't find a work item for: "started analysing the story"/)
  assert.match(reply, /SCRUM-27 Enforce Transport Security/)
})

test('item 13: a key that does not exist in Jira is treated as no work item', async () => {
  const { result } = await run(update({ completed: [{ storyRef: 'SCRUM-999', comment: 'done' }] }))
  assert.deepEqual(result.refused, [{ reason: 'noWorkItem', words: 'done' }])
})

test("item 14: an unassigned work item is refused; 14a: someone else's is held for confirmation", async () => {
  const { result, stored, reply } = await run(update({
    completed: [{ storyRef: 'SCRUM-25', comment: 'finished' }],
    inProgress: [{ storyRef: 'SCRUM-28', comment: 'picked it up' }]
  }))
  assert.deepEqual(stored, [], 'neither is written yet')
  assert.deepEqual(result.refused, [{ reason: 'unassigned', key: 'SCRUM-28' }])
  assert.deepEqual(result.pending, [{
    key: 'SCRUM-25', title: 'Build Core Architecture', owner: 'Pravallika', status: 'Completed', comment: 'finished', blocker: null
  }])
  assert.match(reply, /SCRUM-28 is not assigned to you, so it can't be updated\. Please reach out to your Scrum Master\./)
  assert.match(reply, /SCRUM-25 is assigned to Pravallika, not you\. Please confirm below/)
  assert.doesNotMatch(reply, /\? SCRUM-25/, 'no stray question mark (item 29)')
})

test('item 18: a mixed message records the verified item and refuses the rest', async () => {
  const { result, stored, reply } = await run(update({
    completed: [{ storyRef: 'SCRUM-27', comment: 'done' }],
    inProgress: [{ storyRef: 'SCRUM-25', comment: 'helping' }]
  }))
  assert.equal(result.outcome, 'recorded')
  assert.deepEqual(stored[0].rows.map((r) => r.win), ['SCRUM-27'])
  assert.match(reply, /✔ SCRUM-27 Enforce Transport Security — Completed/)
  assert.match(reply, /SCRUM-25 is assigned to Pravallika, not you/)
  assert.equal(result.pending.length, 1, 'the other person\'s item waits for the card')
})

test('item 17: the confirmation lists WIN, title and status for each recorded item', async () => {
  const { reply } = await run(update({
    inProgress: [{ storyRef: 'SCRUM-27', comment: 'on it' }],
    blockers: [{ storyRef: 'SCRUM-27', description: 'waiting for credentials' }]
  }))
  assert.match(reply, /^Recorded your update, Santhosh:/)
  assert.match(reply, /⚠ SCRUM-27 Enforce Transport Security — Blocked: waiting for credentials/)
})

test('item 15: garbage is not written and is not counted as a response', async () => {
  const { result, stored, reply } = await run({ completed: [], inProgress: [], blockers: [], confidence: 'low', kind: 'not_update' })
  assert.equal(result.outcome, 'notUpdate')
  assert.deepEqual(stored, [], 'no row, so the member stays a non-responder')
  assert.equal(reply, "This doesn't look like a stand-up update, so it isn't counted as a response.")
})

test('item 16: "nothing to report" is not written and says so', async () => {
  const { result, stored, reply } = await run({ completed: [], inProgress: [], blockers: [], confidence: 'high', kind: 'nothing' })
  assert.equal(result.outcome, 'nothing')
  assert.deepEqual(stored, [])
  assert.match(reply, /^Nothing recorded\./)
})

test('item 19: a blocker with no work item is not written but is still passed to the alert', async () => {
  const { result, stored, reply } = await run(update({ blockers: [{ storyRef: null, description: 'my laptop is broken' }] }))
  assert.deepEqual(stored, [])
  assert.deepEqual(result.unlinkedBlockers, ['my laptop is broken'])
  assert.equal(result.blockers, 1, 'the alert was asked to send it')
  // No Scrum Master on this roster, so the reply must not claim they heard.
  assert.match(reply, /"my laptop is broken" isn't linked to a work item.*couldn't reach your Scrum Master/)
})

test('a missing kind is read as an update, which with nothing in it asks which item', async () => {
  const { result } = await run({ completed: [], inProgress: [], blockers: [], confidence: 'low' })
  assert.equal(result.outcome, 'notUnderstood')
  assert.equal(result.understood, false)
})
