import test from 'node:test'
import assert from 'node:assert/strict'

/** 30 Sep night round: SPEC-004 items 32–34 and SPEC-002 item 5a. */

const { storyAbout, adfText, MAX_ABOUT_CHARS } = await import('../dist/pm/about.js')
const { StandupClosedError } = await import('../dist/jobs/updateIntake.js')
const { parseExtraction } = await import('../dist/agents/schema.js')
const graph = await import('../dist/graph/client.js')

// ── item 32: what a story is about ───────────────────────────────────────
const adf = (...paragraphs) => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })

test('item 32: the user story and acceptance criteria are kept, design traceability dropped', () => {
  const about = storyAbout(adf(
    'User Story: As a reliability engineer, I want a circuit breaker.',
    'Acceptance Criteria: failures trip the Circuit Breaker to OPEN.',
    'Design Traceability: Originating Design Reference: tmp.md#SEC-04'
  ))
  assert.match(about, /circuit breaker/)
  assert.match(about, /OPEN/)
  assert.doesNotMatch(about, /Traceability|SEC-04/)
})

test('item 32: an empty description is null, a long one is cut, plain text passes through', () => {
  assert.equal(storyAbout(null), null)
  assert.equal(storyAbout(adf('Design Traceability: only this')), null)
  assert.equal(storyAbout('x'.repeat(2000)).length, MAX_ABOUT_CHARS)
  assert.equal(adfText('plain'), 'plain')
})

// ── item 34: several stories, then a confirmation ───────────────────────
test('item 34: the model may offer up to four alternatives, and a reason', () => {
  const out = parseExtraction(JSON.stringify({
    completed: [], blockers: [],
    inProgress: [{ storyRef: null, comment: 'resilience', alternatives: ['SCRUM-1', 'SCRUM-2', 'SCRUM-3', 'SCRUM-4', 'SCRUM-5'], reason: null }]
  }))
  assert.deepEqual(out.inProgress[0].alternatives, ['SCRUM-1', 'SCRUM-2', 'SCRUM-3', 'SCRUM-4'])
})

const TEAM = { teamId: 'team-1', members: [{ memberId: 'm1', displayName: 'sailaja', jiraAccountId: 'j1' }] }
const STORIES = {
  'SCRUM-31': { key: 'SCRUM-31', title: 'Ingress Gateway', assignee: 'Vardhan', assigneeAccountId: 'j2' },
  'SCRUM-34': { key: 'SCRUM-34', title: 'Scalability', assignee: 'sailaja', assigneeAccountId: 'j1' },
  'SCRUM-35': { key: 'SCRUM-35', title: 'Nobody', assignee: null, assigneeAccountId: null }
}
const deps = (closed = false) => ({ pm: { lookupStory: async (key) => STORIES[key] }, summaryHasRun: async () => closed })
const pick = (key, over = {}) => ({
  action: 'scrumAssistant.storyPick', pick: key, teamId: 'team-1', localDate: '2026-09-30', memberId: 'm1',
  item: { words: 'spent some time on the resilience part', status: 'In Progress' }, ...over
})

// ── SPEC-002 item 5a: tracker resilience ─────────────────────────────────
function fakeFetch (answers) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('login.microsoftonline.com')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    }
    calls.push(init?.method ?? 'GET')
    const next = answers.shift()
    if (next === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e }
    return new Response(next.body ?? '{"ok":true}', { status: next.status, headers: next.headers })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}
graph.graphRetry.delaysMs = [1, 1]

test('5a: a timeout and a 504 are retried, and the member is told once', async () => {
  const f = fakeFetch(['timeout', { status: 504 }, { status: 200 }])
  const told = []
  try {
    const out = await graph.withGraphRetryNotice(async () => { told.push('slow') }, () => graph.graphRequest('GET', '/x'))
    assert.deepEqual(out, { ok: true })
    assert.equal(f.calls.length, 3)
    assert.deepEqual(told, ['slow'])
  } finally { f.restore() }
})

test('5a: after every attempt fails, the error says the tracker could not be reached', async () => {
  const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 503 }])
  try {
    await assert.rejects(graph.graphRequest('GET', '/x'), graph.GraphUnavailableError)
    assert.equal(f.calls.length, 3)
  } finally { f.restore() }
})

test('5a: a POST is not retried after a 5xx (it may have been created), but is after a 429', async () => {
  let f = fakeFetch([{ status: 504 }])
  try {
    await assert.rejects(graph.graphRequest('POST', '/items', {}), graph.GraphUnavailableError)
    assert.equal(f.calls.length, 1)
  } finally { f.restore() }
  f = fakeFetch([{ status: 429, headers: { 'retry-after': '0' } }, { status: 201 }])
  try {
    await graph.graphRequest('POST', '/items', {})
    assert.equal(f.calls.length, 2)
  } finally { f.restore() }
})

test('5a: a 404 is not retried and is not reported as the tracker being down', async () => {
  const f = fakeFetch([{ status: 404, body: 'not found' }])
  try {
    await assert.rejects(graph.graphRequest('GET', '/x'), (e) => !(e instanceof graph.GraphUnavailableError) && / 404 /.test(e.message))
    assert.equal(f.calls.length, 1)
  } finally { f.restore() }
})

// ── item 38: one card whenever it is not clearly her own story ───────────
const { storyChoiceCard, STORY_CHOICE_ACTION } = await import('../dist/cards/storyChoice.js')
const { recordChoice, parseStoryChoice } = await import('../dist/jobs/foreignItem.js')
const { MockTracker } = await import('../dist/trackers/mock.js')
const { tmpdir } = await import('node:os')
const path = await import('node:path')
const { rm } = await import('node:fs/promises')

const CHOICE = {
  words: 'added the circuit breaker and the backoff retries', status: 'In Progress', blocker: null,
  options: [
    { key: 'SCRUM-34', title: 'Scalability', owner: 'sailaja', mine: true },
    { key: 'SCRUM-32', title: 'Error Resilience', owner: 'Pravallika', mine: false },
    { key: 'SCRUM-31', title: 'Ingress Gateway', owner: 'Vardhan', mine: false }
  ]
}

test('item 38: the card lists her own story first, each row with Submit, and None of these', () => {
  const card = storyChoiceCard(CHOICE, 'team-1', '2026-09-30', 'm1')
  assert.equal(card.body[0].text, "Your update didn't match a story assigned to you.")
  const rows = card.body.filter((b) => b.type === 'ColumnSet')
  assert.deepEqual(rows.map((r) => r.columns[0].items[0].text), [
    '**SCRUM-34** Scalability — assigned to you',
    '**SCRUM-32** Error Resilience — not assigned to you (Pravallika)',
    '**SCRUM-31** Ingress Gateway — not assigned to you (Vardhan)'
  ])
  assert.deepEqual(rows.map((r) => r.columns[1].items[0].actions[0].data.pick), ['SCRUM-34', 'SCRUM-32', 'SCRUM-31'])
  assert.deepEqual(card.actions.map((a) => a.title), ['None of these'])
  assert.equal(card.actions[0].data.action, STORY_CHOICE_ACTION)
})

test('item 38: only her own stories (vague words) asks "Which of your stories is this?"; a blocker shows as Blocked', () => {
  const card = storyChoiceCard({ ...CHOICE, status: 'Blocked', blocker: 'waiting on Key Vault', options: [CHOICE.options[0]] }, 't', '2026-09-30', 'm1')
  assert.equal(card.body[0].text, 'Which of your stories is this?')
  assert.equal(card.body[2].text, 'Will be recorded as: Blocked: waiting on Key Vault')
})

const CHOICE_STORIES = {
  'SCRUM-32': { key: 'SCRUM-32', title: 'Error Resilience', assignee: 'Pravallika', assigneeAccountId: 'j3', url: '' },
  'SCRUM-34': { key: 'SCRUM-34', title: 'Scalability', assignee: 'sailaja', assigneeAccountId: 'j1', url: '' }
}
async function press (data, item = {}) {
  const file = path.join(tmpdir(), `uc04-choice-${Date.now()}-${Math.random()}.json`)
  const tracker = new MockTracker(file)
  const alerts = []
  try {
    const card = storyChoiceCard({ ...CHOICE, ...item }, 'team-1', '2026-09-30', 'm1')
    const payload = parseStoryChoice(data(card))
    const reply = await recordChoice(TEAM, 'm1', 'sailaja', payload, '2026-09-30', {
      pm: { lookupStory: async (key) => CHOICE_STORIES[key], getMemberOpenItems: async () => [CHOICE_STORIES['SCRUM-34']] },
      tracker, summaryHasRun: async () => false,
      sendBlockerAlert: async (...args) => { alerts.push(args); return { sent: true, suppressed: 0 } }
    })
    return { reply, stored: await tracker.readToday('team-1', '2026-09-30'), alerts }
  } finally { await rm(file, { force: true }) }
}
const rowPick = (i) => (card) => card.body.filter((b) => b.type === 'ColumnSet')[i].columns[1].items[0].actions[0].data
const nonePick = (card) => { const d = { ...card.actions[0].data }; delete d.pick; return d } // Teams drops null fields

test("item 38: Submit on someone else's story records it at once, with its owner", async () => {
  const { reply, stored, alerts } = await press(rowPick(1))
  assert.equal(stored[0].rows[0].win, 'SCRUM-32')
  assert.equal(stored[0].rows[0].assignedTo, 'Pravallika')
  assert.equal(stored[0].rows[0].comment, 'added the circuit breaker and the backoff retries', 'the comment never names the sender — Updated By does')
  assert.match(reply, /Recorded SCRUM-32 in the tracker under Pravallika/)
  assert.equal(alerts.length, 0, 'no blocker, no alert')
})

test('item 38: Submit on her own story records it plainly', async () => {
  const { reply, stored } = await press(rowPick(0))
  assert.equal(stored[0].rows[0].comment, 'added the circuit breaker and the backoff retries')
  assert.equal(reply, 'Recorded SCRUM-34 in the tracker.')
})

test('item 38: a blocker — Submit writes the Blocked row then alerts with the story; None alerts with no story', async () => {
  const blocked = { words: 'waiting on Key Vault', status: 'Blocked', blocker: 'waiting on Key Vault' }
  const submitted = await press(rowPick(1), blocked)
  assert.equal(submitted.stored[0].rows[0].status, 'Blocked')
  assert.equal(submitted.stored[0].rows[0].comment, null, 'the blocker is not repeated as the comment')
  assert.deepEqual(submitted.alerts[0][4], [{ description: 'waiting on Key Vault', storyRef: 'SCRUM-32' }])

  const none = await press(nonePick, blocked)
  assert.deepEqual(none.stored, [])
  assert.deepEqual(none.alerts[0][4], [{ description: 'waiting on Key Vault', storyRef: null }])
  assert.deepEqual(none.alerts[0][7].map((i) => i.key), ['SCRUM-34'], 'her open items are listed (SPEC-005 2a)')
  assert.match(none.reply, /Scrum Master has been told about the blocker/)
})

test('item 40: a blocker that named no story — the card asks which story it is blocking', () => {
  const card = storyChoiceCard({ ...CHOICE, words: 'DB access not working', status: 'Blocked', blocker: 'DB access not working', noStory: true, options: [CHOICE.options[0]] }, 't', '2026-09-30', 'm1')
  assert.equal(card.body[0].text, 'Which story is "DB access not working" blocking?')
  assert.equal(card.body[1].text, 'Will be recorded as: Blocked: DB access not working')
  assert.equal(card.actions[0].data.item.noStory, true)
})

test('item 40: Submit puts the blocker on that story and alerts with it', async () => {
  const blocked = { words: 'DB access not working', status: 'Blocked', blocker: 'DB access not working', noStory: true, options: [CHOICE.options[0]] }
  const { reply, stored, alerts } = await press(rowPick(0), blocked)
  assert.equal(stored[0].rows[0].win, 'SCRUM-34')
  assert.equal(stored[0].rows[0].status, 'Blocked')
  assert.equal(stored[0].rows[0].anyBlocker, 'DB access not working')
  assert.deepEqual(alerts[0][4], [{ description: 'DB access not working', storyRef: 'SCRUM-34' }])
  assert.equal(reply, 'Recorded SCRUM-34 in the tracker.')
})

test('item 40: None of these files it as a General row (Blocked), then alerts with no story', async () => {
  const blocked = { words: 'DB access not working', status: 'Blocked', blocker: 'DB access not working', noStory: true, options: [CHOICE.options[0]] }
  const { reply, stored, alerts } = await press(nonePick, blocked)
  assert.equal(stored[0].rows.length, 1)
  assert.deepEqual(stored[0].rows[0], { win: null, description: null, assignedTo: 'sailaja', comment: null, status: 'Blocked', anyBlocker: 'DB access not working' })
  assert.deepEqual(alerts[0][4], [{ description: 'DB access not working', storyRef: null }])
  assert.equal(reply, 'Saved as a general update. ⚠ Blocker: "DB access not working". Your Scrum Master has been told.')
})

test('item 38: None of these on work records nothing and alerts nobody', async () => {
  const { reply, stored, alerts } = await press(nonePick)
  assert.equal(reply, 'Not recorded.')
  assert.deepEqual(stored, [])
  assert.equal(alerts.length, 0)
})

// ── SPEC-002 2f: Assigned To is the Jira owner; Updated By is who sent it ─
const { SharePointTracker } = await import('../dist/trackers/sharepoint.js')

test('2f: SharePoint writes the owner in AssignedTo and the sender in UpdatedBy, and reads rows back by sender', async () => {
  const list = [
    // An old row from before the column: AssignedTo was the sender.
    { id: '1', fields: { Date: '2026-10-01T12:00:00Z', WIN: 'SCRUM-34', AssignedTo: 'sailaja', Status: 'In Progress' } },
    // Vardhan's own row on the same story must not be touched.
    { id: '2', fields: { Date: '2026-10-01T12:00:00Z', WIN: 'SCRUM-31', AssignedTo: 'Vardhan', UpdatedBy: 'Vardhan', Status: 'In Progress' } }
  ]
  const sent = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
    const method = init?.method ?? 'GET'
    if (method === 'GET') return new Response(JSON.stringify({ value: list }))
    sent.push({ method, url: String(url), body: JSON.parse(init.body) })
    if (method === 'POST') list.push({ id: '3', fields: { ...JSON.parse(init.body).fields } })
    return new Response('{}', { status: 201 })
  }
  try {
    const tracker = new SharePointTracker('site', 'list', ['sailaja', 'Vardhan'])
    await tracker.write({
      teamId: 't', memberId: 'm1', memberName: 'sailaja', localDate: '2026-10-01', rawText: '', capturedAt: new Date(),
      rows: [{ win: 'SCRUM-31', description: 'Ingress', assignedTo: 'Vardhan', comment: 'Polly retries', status: 'In Progress', anyBlocker: null }]
    })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].method, 'POST', "a new row for sailaja — Vardhan's own SCRUM-31 row is not overwritten")
    assert.equal(sent[0].body.fields.AssignedTo, 'Vardhan')
    assert.equal(sent[0].body.fields.UpdatedBy, 'sailaja')

    const today = await new SharePointTracker('site', 'list', ['sailaja', 'Vardhan']).readToday('t', '2026-10-01')
    const byName = Object.fromEntries(today.map((u) => [u.memberName, u.rows.map((r) => `${r.win}/${r.assignedTo}`)]))
    assert.deepEqual(byName.sailaja.sort(), ['SCRUM-31/Vardhan', 'SCRUM-34/sailaja'], 'old rows still count for their sender')
    assert.deepEqual(byName.Vardhan, ['SCRUM-31/Vardhan'])
  } finally { globalThis.fetch = original }
})

// ── each recorded line shows her own words for it ───────────────────────
const { intakeReply } = await import('../dist/bot/replies.js')

test('the reply shows her words under each recorded item, whatever their order in the message', () => {
  const reply = intakeReply({
    outcome: 'recorded', understood: true, refused: [], unlinkedBlockers: [], openItems: [], rows: 1, added: 1, blockers: 0,
    alertSent: false, extractionMs: 0, totalMs: 0, truncated: false, confidence: 'high',
    recorded: [{ win: 'SCRUM-34', title: 'Scalability', status: 'In Progress', blocker: null, said: 'implement load testing for 10k requests per minute' }],
    choices: [{ words: 'Still waiting for the security team to open up access to the secrets store', status: 'Blocked', blocker: 'x', options: [] }]
  }, 'sailaja kagita')
  assert.equal(reply, [
    'Recorded your update, sailaja kagita:',
    '✔ SCRUM-34 Scalability — In Progress',
    '_"implement load testing for 10k requests per minute"_',
    'Which story is "Still waiting for the security team to open up access to the secrets store"? Please choose below.'
  ].join('\n\n'))
})
