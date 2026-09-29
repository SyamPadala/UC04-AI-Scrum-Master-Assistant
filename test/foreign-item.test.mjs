import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { parseForeignItemPayload, recordForeignItem } from '../dist/jobs/foreignItem.js'
import { foreignItemCard, FOREIGN_ITEM_ACTION } from '../dist/cards/foreignItem.js'
import { blockerAlertCard } from '../dist/cards/blockerAlert.js'
import { StandupClosedError } from '../dist/jobs/updateIntake.js'
import { MockTracker } from '../dist/trackers/mock.js'

/** SPEC-004 14a: Submit / Cancel on someone else's story. SPEC-005 2a: open items on an unattributed blocker. */

const TEAM = { teamId: 'team-1', members: [{ memberId: 'm1', displayName: 'Santhosh', jiraAccountId: 'j1' }] }
const ITEM = { key: 'SCRUM-25', title: 'Build Core Architecture', owner: 'Pravallika', status: 'Completed', comment: 'finished it', blocker: null }
const story = (assigneeAccountId, assignee) => ({
  key: 'SCRUM-25', title: 'Build Core Architecture', status: 'In Progress', statusCategory: 'In Progress',
  points: 3, assignee, assigneeAccountId, url: '', updated: new Date()
})
const payload = (over = {}) => ({
  action: FOREIGN_ITEM_ACTION, choice: 'submit', teamId: 'team-1', localDate: '2026-09-29', memberId: 'm1', item: ITEM, ...over
})

async function submit (p, options = {}) {
  const { closed = false, times = 1 } = options
  // 'in', not a default: an explicit undefined means "not found in Jira".
  const lookup = 'lookup' in options ? options.lookup : story('j2', 'Pravallika')
  const file = path.join(tmpdir(), `uc04-foreign-${Date.now()}-${Math.random()}.json`)
  const tracker = new MockTracker(file)
  const deps = { pm: { lookupStory: async () => lookup }, tracker, summaryHasRun: async () => closed }
  try {
    let reply
    for (let i = 0; i < times; i++) reply = await recordForeignItem(TEAM, 'm1', 'Santhosh', p, '2026-09-29', deps)
    return { reply, stored: await tracker.readToday('team-1', '2026-09-29') }
  } finally {
    await rm(file, { force: true })
  }
}

test('the card carries the item in its buttons and round-trips through validation', () => {
  const card = foreignItemCard(ITEM, 'team-1', '2026-09-29', 'm1')
  assert.deepEqual(card.actions.map((a) => a.title), ['Submit', 'Cancel'])
  assert.deepEqual(parseForeignItemPayload(card.actions[0].data), payload())
  assert.equal(parseForeignItemPayload({ action: 'something else' }), undefined)
  assert.equal(parseForeignItemPayload(undefined), undefined)
})

test('Submit records under the sender, says whose story it is, and asks for it to be assigned', async () => {
  const { reply, stored } = await submit(payload())
  const row = stored[0].rows[0]
  assert.equal(row.win, 'SCRUM-25')
  assert.equal(row.assignedTo, 'Santhosh')
  assert.equal(row.comment, '(assigned to Pravallika) finished it')
  assert.equal(row.status, 'Completed')
  assert.match(reply, /Recorded SCRUM-25 in the tracker\. Please ask your Scrum Master to assign it to you in Jira\./)
})

test('Submit pressed twice records one row', async () => {
  const { stored } = await submit(payload(), { times: 2 })
  assert.equal(stored[0].rows.length, 1)
})

test('Cancel records nothing', async () => {
  const { reply, stored } = await submit(payload({ choice: 'cancel' }))
  assert.equal(reply, 'SCRUM-25 not recorded.')
  assert.deepEqual(stored, [])
})

test("yesterday's card, or someone else's, records nothing", async () => {
  assert.match((await submit(payload({ localDate: '2026-09-28' }))).reply, /expired/)
  assert.match((await submit(payload({ memberId: 'm9' }))).reply, /someone else/)
})

test('after the scheduled summary, Submit is refused like any late update', async () => {
  await assert.rejects(() => submit(payload(), { closed: true }), StandupClosedError)
})

test('Jira is re-checked: a deleted or now-unassigned story is not recorded', async () => {
  assert.match((await submit(payload(), { lookup: undefined })).reply, /no longer exists/)
  const unassigned = await submit(payload(), { lookup: story(null, null) })
  assert.match(unassigned.reply, /not assigned to anyone now/)
  assert.deepEqual(unassigned.stored, [])
})

test("SPEC-005 2a: an unattributed blocker lists the member's open items, by name", () => {
  const card = blockerAlertCard('pravallika boppana', '2026-09-29',
    [{ description: 'my laptop is broken', storyRef: null }],
    [{ key: 'SCRUM-25', title: 'Build Core Architecture', url: 'https://x/SCRUM-25' }])
  const texts = JSON.stringify(card)
  assert.match(texts, /Affected work item: not specified/)
  assert.match(texts, /pravallika boppana's open items: SCRUM-25 Build Core Architecture/)
  assert.doesNotMatch(texts, /\b(her|his)\b/i, 'never a pronoun')
  assert.ok(card.actions.some((a) => a.title === 'Open SCRUM-25'))
})

test('SPEC-005 2a: a blocker on a named story shows no open-items line', () => {
  const texts = JSON.stringify(blockerAlertCard('A', 'd',
    [{ description: 'x', storyRef: 'SCRUM-25', storyTitle: 'T' }], [{ key: 'SCRUM-27', title: 'Other' }]))
  assert.doesNotMatch(texts, /open items/)
})
