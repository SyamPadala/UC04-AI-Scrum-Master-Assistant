import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { processUpdate } from '../dist/jobs/updateIntake.js'
import { MockTracker } from '../dist/trackers/mock.js'
import { updateProcessorUser } from '../dist/agents/prompts/updateProcessor.js'

/** SPEC-004 5a/5b: open blockers reach the model; nothing understood means nothing written. */

const TEAM = {
  teamId: 'team-1',
  name: 'Alpha',
  timezone: 'Asia/Kolkata',
  members: [{ memberId: 'm1', displayName: 'Syam Padala', jiraAccountId: 'j1', conversationRef: 'ref' }],
  scrumMasterId: 'other'
}

function stubs (outputs) {
  const prompts = []
  const llm = {
    complete: async (request) => {
      prompts.push(request.user)
      return { text: JSON.stringify(outputs.shift()), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, roundTrips: 1 }
    }
  }
  const pm = {
    getSprintData: async () => undefined,
    lookupStory: async (key) => ({ key, title: 'Risk Scoring Service', status: 'In Progress', statusCategory: 'In Progress', points: 3, assignee: null, assigneeAccountId: null, url: '', updated: new Date() }),
    getMemberOpenItems: async () => []
  }
  return { llm, pm, prompts }
}

const empty = (confidence) => ({ completed: [], inProgress: [], blockers: [], confidence })
const deps = (s, tracker) => ({ llm: s.llm, pm: s.pm, tracker, summaryHasRun: async () => false })

async function freshTracker (name) {
  const file = path.join(tmpdir(), `uc04-${name}-${Date.now()}.json`)
  await rm(file, { force: true })
  return new MockTracker(file)
}

test('an unsure empty reading writes nothing and is reported as not understood', async () => {
  const tracker = await freshTracker('unsure')
  const s = stubs([empty('low')])
  const result = await processUpdate(TEAM, 'm1', 'Syam Padala', 'sorted it', '2026-09-25', deps(s, tracker))
  assert.equal(result.understood, false)
  assert.deepEqual(await tracker.readToday('team-1', '2026-09-25'), [])
})

test('an empty reading after an earlier update keeps the earlier rows and asks', async () => {
  const tracker = await freshTracker('after')
  const s = stubs([{ completed: [{ storyRef: 'SCRUM-6', comment: 'done' }], inProgress: [], blockers: [], confidence: 'high' }, empty('high')])
  await processUpdate(TEAM, 'm1', 'Syam Padala', 'SCRUM-6 done', '2026-09-25', deps(s, tracker))
  const second = await processUpdate(TEAM, 'm1', 'Syam Padala', 'Risk score issue got resolved', '2026-09-25', deps(s, tracker))
  assert.equal(second.understood, false)
  const rows = (await tracker.readToday('team-1', '2026-09-25'))[0].rows
  assert.deepEqual(rows.map((r) => r.win), ['SCRUM-6'])
})

test("the member's open blockers from earlier days are in the prompt", async () => {
  const tracker = await freshTracker('blockers')
  const s = stubs([
    { completed: [], inProgress: [], blockers: [{ storyRef: 'SCRUM-21', description: 'client has not given the rules' }], confidence: 'high' },
    { completed: [], inProgress: [{ storyRef: 'SCRUM-21', comment: 'resolved' }], blockers: [], confidence: 'high' }
  ])
  await processUpdate(TEAM, 'm1', 'Syam Padala', 'blocked on SCRUM-21', '2026-09-24', deps(s, tracker))
  await processUpdate(TEAM, 'm1', 'Syam Padala', 'Risk score issue got resolved', '2026-09-25', deps(s, tracker))
  assert.match(s.prompts[1], /SCRUM-21 — client has not given the rules \(last reported 2026-09-24\)/)
})

test('with no open blockers the prompt says so', () => {
  assert.match(updateProcessorUser('A', 'text', [], []), /still open:\n\(none\)/)
})
