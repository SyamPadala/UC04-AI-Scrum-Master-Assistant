import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'

/** SPEC-004 items 21–26: reliable work item resolution. */

process.env.BLOCKER_ALERT_DEDUPE = 'false'
const { normaliseKeysInText, keysInText, canonicalKey } = await import('../dist/agents/keys.js')
const { candidateStories, restrictToKnownKeys } = await import('../dist/agents/updateProcessor.js')
const { parseExtraction } = await import('../dist/agents/schema.js')
const { updateProcessorUser } = await import('../dist/agents/prompts/updateProcessor.js')
const { processUpdate } = await import('../dist/jobs/updateIntake.js')
const { parseStoryPick, parseForeignItemPayload, isForeignItemPress, recordForeignItem } = await import('../dist/jobs/foreignItem.js')
const { storyPickerCard, STORY_PICK_ACTION } = await import('../dist/cards/storyPicker.js')
const { intakeReply } = await import('../dist/bot/replies.js')
const { MockTracker } = await import('../dist/trackers/mock.js')

const story = (key, title, assigneeAccountId, assignee = null) => ({
  key, title, status: 'In Progress', statusCategory: 'In Progress', points: 3, assignee, assigneeAccountId, url: '', updated: new Date()
})
const SPRINT = [
  story('SCRUM-26', 'Implement Synchronous Data Flow and Error Resilience Choreography', 'j3', 'Sailaja'),
  story('SCRUM-27', 'Enforce Transport Security and PII Redaction', 'j1', 'Santhosh'),
  story('SCRUM-24', 'Implement Unified IHub Integration Middleware', 'j2', 'Vardhan'),
  story('SCRUM-28', 'Ensure Scalability and High Availability', null)
]

// ── item 21 ──────────────────────────────────────────────────────────────
test('item 21: every way of typing a key becomes the canonical key', () => {
  for (const typed of ['scrum 25', 'scrum-25', 'Scrum-25', 'SCRUM25', 'scrum_25', 'SCRUM-25']) {
    assert.equal(normaliseKeysInText(`finished ${typed} today`, 'SCRUM'), 'finished SCRUM-25 today', typed)
  }
  assert.equal(normaliseKeysInText('not scrumptious 5', 'SCRUM'), 'not scrumptious 5', 'look-alike words are left alone')
  assert.deepEqual(keysInText('scrum 7 and SCRUM-21, then scrum7 again', 'SCRUM'), ['SCRUM-7', 'SCRUM-21'])
  assert.equal(canonicalKey('scrum 25'), 'SCRUM-25')
})

test('item 21: a key the model returns in any case is canonicalised', () => {
  const out = parseExtraction(JSON.stringify({
    completed: [{ storyRef: 'scrum-25', comment: 'done' }], inProgress: [], blockers: [{ description: 'x', storyRef: 'Scrum 7' }]
  }))
  assert.equal(out.completed[0].storyRef, 'SCRUM-25')
  assert.equal(out.blockers[0].storyRef, 'SCRUM-7')
})

// ── item 22 ──────────────────────────────────────────────────────────────
test("item 22: the whole sprint is offered, the member's own first, each with its owner", () => {
  const offered = candidateStories(SPRINT, 'j1', 'anything', [])
  assert.deepEqual(offered.map((s) => s.key), ['SCRUM-27', 'SCRUM-26', 'SCRUM-24', 'SCRUM-28'])
  const prompt = updateProcessorUser('Santhosh', 'x', offered.map((s) => ({
    key: s.key, title: s.title, status: s.status, owner: s.assignee, mine: s.assigneeAccountId === 'j1'
  })))
  assert.match(prompt, /SCRUM-27 \[In Progress\] \(yours\)/)
  assert.match(prompt, /SCRUM-26 \[In Progress\] \(assigned to Sailaja\)/)
  assert.match(prompt, /SCRUM-28 \[In Progress\] \(unassigned\)/)
})

test('item 22: a very large sprint keeps own, keyed and best-matching stories', () => {
  const big = Array.from({ length: 60 }, (_, i) => story(`SCRUM-${100 + i}`, `Filler story number ${i}`, `other-${i}`, 'Someone'))
  big.push(story('SCRUM-500', 'Payment reconciliation batch job', 'other-x', 'Someone'))
  big.push(story('SCRUM-501', 'Mine', 'j1', 'Santhosh'))
  big.push(story('SCRUM-502', 'Typed by key', 'other-y', 'Someone'))
  const offered = candidateStories(big, 'j1', 'fixed the payment reconciliation job', ['SCRUM-502']).map((s) => s.key)
  assert.ok(offered.length <= 32, `trimmed to ${offered.length}`)
  assert.equal(offered[0], 'SCRUM-501', 'own story first')
  assert.ok(offered.includes('SCRUM-502'), 'a keyed story always stays')
  assert.ok(offered.includes('SCRUM-500'), 'the best title match stays')
})

// ── item 23 ──────────────────────────────────────────────────────────────
test('item 23: a key neither offered nor typed is dropped; alternatives must be offered', () => {
  const output = parseExtraction(JSON.stringify({
    completed: [{ storyRef: 'SCRUM-999', comment: 'invented' }, { storyRef: null, comment: 'the service work', alternatives: ['SCRUM-26', 'SCRUM-777'] }],
    inProgress: [{ storyRef: 'SCRUM-40', comment: 'typed key' }],
    blockers: [{ description: 'x', storyRef: 'SCRUM-888' }]
  }))
  const safe = restrictToKnownKeys(output, new Set(['SCRUM-26', 'SCRUM-27']), new Set(['SCRUM-40']))
  assert.equal(safe.completed[0].storyRef, null)
  assert.deepEqual(safe.completed[1].alternatives, ['SCRUM-26'])
  assert.equal(safe.inProgress[0].storyRef, 'SCRUM-40', 'a typed key is still allowed (checked in Jira later)')
  assert.equal(safe.blockers[0].storyRef, null)
})

// ── items 22–24 through the intake ───────────────────────────────────────
const TEAM = { teamId: 'team-1', name: 'Alpha', timezone: 'Asia/Kolkata', scrumMasterId: '', members: [{ memberId: 'm1', displayName: 'Santhosh', jiraAccountId: 'j1', conversationRef: 'r' }] }

async function intake (modelOutput, text = 'message') {
  const file = path.join(tmpdir(), `uc04-resolution-${Date.now()}-${Math.random()}.json`)
  const tracker = new MockTracker(file)
  const prompts = []
  const llm = { complete: async (request) => { prompts.push(request.user); return { text: JSON.stringify(modelOutput), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, roundTrips: 1 } } }
  const pm = {
    getActiveSprint: async () => ({ id: 1, name: 'S', goal: '', startDate: null, endDate: null }),
    getSprintData: async () => undefined,
    lookupStory: async (key) => SPRINT.find((s) => s.key === key),
    getMemberOpenItems: async (id) => SPRINT.filter((s) => s.assigneeAccountId === id),
    getSprintOpenItems: async () => SPRINT
  }
  try {
    const result = await processUpdate(TEAM, 'm1', 'Santhosh', text, '2026-09-29', { llm, pm, tracker, summaryHasRun: async () => false, alertNoSprint: async () => ({ sent: true }) })
    return { result, prompt: prompts[0], stored: await tracker.readToday('team-1', '2026-09-29'), reply: intakeReply(result, 'Santhosh') }
  } finally { await rm(file, { force: true }) }
}
const update = (parts) => ({ completed: [], inProgress: [], blockers: [], confidence: 'high', kind: 'update', ...parts })

test("item 22: another member's story described in words reaches the confirmation card", async () => {
  const { result, prompt, stored } = await intake(update({ completed: [{ storyRef: 'SCRUM-26', comment: 'completed the synchronous data flow' }] }),
    'completed the implementation of Synchronous Data Flow')
  assert.match(prompt, /SCRUM-26 .*assigned to Sailaja/, 'the model was shown the story')
  assert.deepEqual(stored, [])
  assert.equal(result.pending[0].key, 'SCRUM-26')
  assert.equal(result.pending[0].owner, 'Sailaja')
})

test('item 21 through the intake: the model sees the canonical key', async () => {
  const { prompt } = await intake(update({ completed: [{ storyRef: 'SCRUM-27', comment: 'finished' }] }), 'finished scrum 27')
  assert.match(prompt, /finished SCRUM-27/)
})

test('item 24: unsure words become a "Which story is this?" question, never a guess', async () => {
  const { result, stored, reply } = await intake(update({
    completed: [{ storyRef: null, comment: 'finished the integration work', alternatives: ['SCRUM-24', 'SCRUM-26'] }]
  }))
  assert.deepEqual(stored, [])
  assert.deepEqual(result.refused, [], 'not reported as "no work item"')
  assert.deepEqual(result.ambiguous[0].options.map((o) => o.key), ['SCRUM-24', 'SCRUM-26'])
  assert.match(reply, /^Which story is "finished the integration work"\? Please choose below\./)
})

test('item 24: no alternatives still means "no work item found"', async () => {
  const { result } = await intake(update({ completed: [{ storyRef: null, comment: 'fixed the login page' }] }))
  assert.deepEqual(result.refused, [{ reason: 'noWorkItem', words: 'fixed the login page' }])
  assert.deepEqual(result.ambiguous, [])
})

// ── item 24: the picker card ─────────────────────────────────────────────
const AMBIGUOUS = { words: 'finished the integration work', status: 'Completed', options: [
  { key: 'SCRUM-27', title: 'Enforce Transport Security', owner: 'Santhosh' },
  { key: 'SCRUM-26', title: 'Implement Synchronous Data Flow', owner: 'Sailaja' }
] }

test('item 24: the picker has one button per story plus "None of these"', () => {
  const card = storyPickerCard(AMBIGUOUS, 'team-1', '2026-09-29', 'm1')
  assert.deepEqual(card.actions.map((a) => a.title), ['SCRUM-27', 'SCRUM-26', 'None of these'])
  assert.equal(card.actions[0].data.action, STORY_PICK_ACTION)
  assert.match(JSON.stringify(card.body), /Will be recorded as: Completed/, 'item 29a: the status is shown before anything is written')
})

async function pick (data) {
  const file = path.join(tmpdir(), `uc04-pick-${Date.now()}-${Math.random()}.json`)
  const tracker = new MockTracker(file)
  try {
    const payload = parseStoryPick(data)
    const reply = await recordForeignItem(TEAM, 'm1', 'Santhosh', payload, '2026-09-29', {
      pm: { lookupStory: async (key) => SPRINT.find((s) => s.key === key) }, tracker, summaryHasRun: async () => false
    })
    return { reply, stored: await tracker.readToday('team-1', '2026-09-29') }
  } finally { await rm(file, { force: true }) }
}
const card = storyPickerCard(AMBIGUOUS, 'team-1', '2026-09-29', 'm1')

test('item 24: picking their own story records it plainly', async () => {
  const { reply, stored } = await pick(card.actions[0].data)
  assert.equal(stored[0].rows[0].win, 'SCRUM-27')
  assert.equal(stored[0].rows[0].comment, 'finished the integration work')
  assert.equal(reply, 'Recorded SCRUM-27 in the tracker.')
})

test("item 24: picking someone else's story is the confirmation — recorded with its owner", async () => {
  const { reply, stored } = await pick(card.actions[1].data)
  assert.equal(stored[0].rows[0].comment, '(assigned to Sailaja) finished the integration work')
  assert.match(reply, /assigned to Sailaja; please ask your Scrum Master/)
})

test('item 24: "None of these" and an unassigned story record nothing', async () => {
  const none = await pick(card.actions[2].data)
  assert.equal(none.reply, 'Not recorded.')
  assert.deepEqual(none.stored, [])
  const unassigned = await pick({ ...card.actions[0].data, pick: 'SCRUM-28' })
  assert.match(unassigned.reply, /not assigned to anyone/)
  assert.deepEqual(unassigned.stored, [])
})

// ── item 26 ──────────────────────────────────────────────────────────────
test('item 26: card data with empty fields left out is still read', () => {
  const noNulls = { action: 'scrumAssistant.foreignItem', choice: 'submit', teamId: 't', localDate: '2026-09-29', memberId: 'm1',
    item: { key: 'SCRUM-25', owner: 'P', status: 'Completed', comment: 'done' } }
  const parsed = parseForeignItemPayload(noNulls)
  assert.equal(parsed.item.blocker, null)
  assert.equal(parsed.item.title, null)
  assert.ok(parseForeignItemPayload(JSON.stringify(noNulls)), 'a JSON string is read too')
  const pickNone = { ...card.actions[2].data }
  delete pickNone.pick
  assert.equal(parseStoryPick(pickNone).choice, 'cancel', 'a missing pick is "None of these"')
})

test('item 26: a press on our card that cannot be read is recognised, so it can be answered', () => {
  assert.equal(isForeignItemPress({ action: 'scrumAssistant.foreignItem', garbage: true }), true)
  assert.equal(isForeignItemPress({ action: STORY_PICK_ACTION }), true)
  assert.equal(isForeignItemPress({ action: 'other' }), false)
  assert.equal(isForeignItemPress(undefined), false)
})
