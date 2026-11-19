import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { processUpdate, generalOnly } from '../dist/jobs/updateIntake.js'
import { MockTracker } from '../dist/trackers/mock.js'
import { storyChoiceCard } from '../dist/cards/storyChoice.js'
import { recordChoice, parseStoryChoice } from '../dist/jobs/foreignItem.js'
import { intakeReply } from '../dist/bot/replies.js'

/** SPEC-004 items 45–47 (19 Nov 2026): general updates for everyone. */

const TEAM = {
  teamId: 'team-1',
  name: 'Alpha',
  timezone: 'Asia/Kolkata',
  members: [{ memberId: 'm1', displayName: 'Gowtham', jiraAccountId: 'j1', conversationRef: 'ref' }],
  scrumMasterId: ''
}
const DAY = '2026-11-19'
const story = (key, title, owner, accountId) => ({ key, title, status: 'In Progress', statusCategory: 'In Progress', points: 3, assignee: owner, assigneeAccountId: accountId, url: '', updated: new Date() })
const MINE = [story('REQ-12', 'Login page', 'Gowtham', 'j1'), story('REQ-15', 'Reports', 'Gowtham', 'j1')]

async function freshTracker () {
  const file = path.join(tmpdir(), `uc04-general-${Date.now()}-${Math.random()}.json`)
  await rm(file, { force: true })
  return { tracker: new MockTracker(file), done: () => rm(file, { force: true }) }
}

function deps (tracker, output, sprintStories) {
  return {
    llm: { complete: async () => ({ text: JSON.stringify(output), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, roundTrips: 1 }) },
    pm: {
      getActiveSprint: async () => sprintStories === undefined ? undefined : ({ id: 1, name: 'REQ Sprint 2', goal: '', startDate: null, endDate: null }),
      getSprintData: async () => undefined,
      lookupStory: async (key) => (sprintStories ?? []).find((s) => s.key === key),
      getMemberOpenItems: async () => (sprintStories ?? []).filter((s) => s.assigneeAccountId === 'j1'),
      getSprintOpenItems: async () => sprintStories ?? []
    },
    tracker,
    summaryHasRun: async () => false,
    alertNoSprint: async () => ({ sent: true })
  }
}
const vague = { completed: [], inProgress: [], blockers: [], confidence: 'low', kind: 'update' }

// ── item 46: a vague update ──────────────────────────────────────────────
test('item 46: a vague update from a member with open stories gets the card of his own stories, nothing written', async () => {
  const { tracker, done } = await freshTracker()
  try {
    const result = await processUpdate(TEAM, 'm1', 'Gowtham', 'Working on my tasks', DAY, deps(tracker, vague, MINE))
    assert.deepEqual(await tracker.readToday('team-1', DAY), [])
    assert.equal(result.choices.length, 1)
    assert.equal(result.choices[0].vague, true)
    assert.equal(result.choices[0].words, 'Working on my tasks')
    assert.equal(result.choices[0].status, 'In Progress')
    assert.deepEqual(result.choices[0].options.map((o) => o.key), ['REQ-12', 'REQ-15'])
    assert.equal(intakeReply(result, 'Gowtham'), 'Which of your stories is "Working on my tasks" about? Please choose below.')
    const card = storyChoiceCard(result.choices[0], 'team-1', DAY, 'm1')
    assert.equal(card.body[0].text, 'Which of your stories is "Working on my tasks" about?')
  } finally { await done() }
})

test('item 46: a vague update from a member with no open story goes straight into his General row', async () => {
  const { tracker, done } = await freshTracker()
  try {
    const others = [story('REQ-20', 'Payments', 'Sailaja', 'j9')]
    const result = await processUpdate(TEAM, 'm1', 'Gowtham', 'Working on my tasks', DAY, deps(tracker, vague, others))
    assert.equal(result.outcome, 'general')
    assert.deepEqual(result.choices, [])
    const rows = (await tracker.readToday('team-1', DAY))[0].rows
    assert.deepEqual(rows, [{ win: null, description: null, assignedTo: 'Gowtham', comment: 'Working on my tasks', status: 'In Progress', anyBlocker: null }])
  } finally { await done() }
})

test('item 46: with no active sprint a vague update is a General row', async () => {
  const { tracker, done } = await freshTracker()
  try {
    const result = await processUpdate(TEAM, 'm1', 'Gowtham', 'Same as yesterday', DAY, deps(tracker, vague, undefined))
    assert.equal(result.outcome, 'general')
    assert.equal((await tracker.readToday('team-1', DAY))[0].rows[0].comment, 'Same as yesterday')
  } finally { await done() }
})

test('item 46: "not an update" and "nothing to report" still save nothing and get no card', async () => {
  for (const kind of ['not_update', 'nothing']) {
    const { tracker, done } = await freshTracker()
    try {
      const result = await processUpdate(TEAM, 'm1', 'Gowtham', 'hello', DAY, deps(tracker, { ...vague, kind }, MINE))
      assert.deepEqual(result.choices, [])
      assert.deepEqual(await tracker.readToday('team-1', DAY), [])
    } finally { await done() }
  }
})

// ── item 45: Save as general update / None of these ──────────────────────
const CHOICE = {
  words: 'helped Sailaja with the deployment', status: 'In Progress', blocker: null,
  options: [{ key: 'REQ-12', title: 'Login page', owner: 'Gowtham', mine: true }]
}
const generalPick = (card) => card.actions[0].data
const nonePick = (card) => { const d = { ...card.actions[1].data }; delete d.pick; return d } // Teams drops null fields

async function press (pick, item = {}, today = DAY) {
  const { tracker, done } = await freshTracker()
  const alerts = []
  try {
    const card = storyChoiceCard({ ...CHOICE, ...item }, 'team-1', DAY, 'm1')
    const payload = parseStoryChoice(pick(card))
    const reply = await recordChoice(TEAM, 'm1', 'Gowtham', payload, today, {
      pm: { lookupStory: async () => undefined, getMemberOpenItems: async () => MINE },
      tracker, summaryHasRun: async () => false,
      sendBlockerAlert: async (...args) => { alerts.push(args); return { sent: true, suppressed: 0, code: 'sent' } }
    })
    return { card, reply, stored: await tracker.readToday('team-1', DAY), alerts }
  } finally { await done() }
}

test('item 45: the card has Save as general update, then None of these', () => {
  const card = storyChoiceCard(CHOICE, 'team-1', DAY, 'm1')
  assert.deepEqual(card.actions.map((a) => a.title), ['Save as general update', 'None of these'])
  assert.equal(card.actions[0].data.general, true)
  assert.equal(card.actions[0].data.pick, null)
  assert.equal(card.actions[1].data.general, undefined)
})

test('item 45: Save as general update writes his General row and says so', async () => {
  const { reply, stored, alerts } = await press(generalPick)
  assert.deepEqual(stored[0].rows, [{ win: null, description: null, assignedTo: 'Gowtham', comment: 'helped Sailaja with the deployment', status: 'In Progress', anyBlocker: null }])
  assert.equal(reply, 'Saved as a general update: "helped Sailaja with the deployment"')
  assert.equal(alerts.length, 0)
})

test('item 45: pressing Save as general update twice saves one row', async () => {
  const { tracker, done } = await freshTracker()
  try {
    const card = storyChoiceCard(CHOICE, 'team-1', DAY, 'm1')
    const d = { pm: { getMemberOpenItems: async () => [] }, tracker, summaryHasRun: async () => false, sendBlockerAlert: async () => ({ sent: true }) }
    await recordChoice(TEAM, 'm1', 'Gowtham', parseStoryChoice(generalPick(card)), DAY, d)
    await recordChoice(TEAM, 'm1', 'Gowtham', parseStoryChoice(generalPick(card)), DAY, d)
    assert.equal((await tracker.readToday('team-1', DAY))[0].rows.length, 1)
  } finally { await done() }
})

test('item 45: a blocker saved as general is Blocked and alerts the Scrum Master with no story', async () => {
  const blocked = { words: 'DB access not working', status: 'Blocked', blocker: 'DB access not working', noStory: true }
  const { reply, stored, alerts } = await press(generalPick, blocked)
  assert.deepEqual(stored[0].rows, [{ win: null, description: null, assignedTo: 'Gowtham', comment: null, status: 'Blocked', anyBlocker: 'DB access not working' }])
  assert.deepEqual(alerts[0][4], [{ description: 'DB access not working', storyRef: null }])
  assert.deepEqual(alerts[0][7].map((i) => i.key), ['REQ-12', 'REQ-15'], 'his open items are listed (SPEC-005 2a)')
  assert.equal(reply, 'Saved as a general update.\n\n⚠ Blocker: "DB access not working". Your Scrum Master has been told.')
})

test('item 45: None of these saves nothing and alerts nobody — work or blocker', async () => {
  for (const item of [{}, { words: 'DB access not working', status: 'Blocked', blocker: 'DB access not working', noStory: true }]) {
    const { reply, stored, alerts } = await press(nonePick, item)
    assert.equal(reply, 'Not recorded.')
    assert.deepEqual(stored, [])
    assert.equal(alerts.length, 0)
  }
})

test('item 45: an expired card saves nothing', async () => {
  const { reply, stored } = await press(generalPick, {}, '2026-11-20')
  assert.equal(reply, 'This card has expired. Please send the update again.')
  assert.deepEqual(stored, [])
})

// ── item 47: who gave only a general update ──────────────────────────────
test('item 47: lists members whose only rows today are General', () => {
  const row = (win) => ({ win, description: null, assignedTo: 'x', comment: 'c', status: 'In Progress', anyBlocker: null })
  const updates = [
    { memberName: 'Gowtham', rows: [row(null)] },
    { memberName: 'Ajinkya', rows: [row('REQ-3')] },
    { memberName: 'Sai Krishna', rows: [row(null), row(null)] },
    { memberName: 'Vardhan', rows: [row(null), row('REQ-7')] },
    { memberName: 'Ganesh', rows: [] }
  ]
  assert.deepEqual(generalOnly(updates), ['Gowtham', 'Sai Krishna'])
})
