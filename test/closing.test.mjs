import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { processUpdate, StandupClosedError } from '../dist/jobs/updateIntake.js'
import { MockTracker } from '../dist/trackers/mock.js'

/**
 * A14: the stand-up closes when the summary is sent.
 *
 * The point of these tests is not the error itself but what must NOT happen
 * after closing — no model call, and nothing written to the tracker.
 */

const TEAM = {
  teamId: 'team-1',
  name: 'Alpha',
  timezone: 'Asia/Kolkata',
  members: [{ memberId: 'm1', displayName: 'Madhavi Andoju', jiraAccountId: 'j1', conversationRef: 'ref' }],
  scrumMasterId: 'm1'
}

function stubs () {
  const calls = { llm: 0, lookups: 0 }
  const llm = {
    complete: async () => {
      calls.llm += 1
      return {
        text: JSON.stringify({
          completed: [{ storyRef: 'SCRUM-7', comment: 'done' }],
          inProgress: [], blockers: [], confidence: 'high'
        }),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        iterations: 1
      }
    }
  }
  const pm = {
    getActiveSprint: async () => undefined,
    getSprintData: async () => undefined,
    lookupStory: async (key) => {
      calls.lookups += 1
      return { key, title: 'A story', status: 'In Progress', statusCategory: 'In Progress', points: 3, assignee: null, assigneeAccountId: null, url: '', updated: new Date() }
    },
    getMemberOpenItems: async () => []
  }
  return { calls, llm, pm }
}

async function freshTracker (name) {
  const file = path.join(tmpdir(), `uc04-${name}-${Date.now()}.json`)
  await rm(file, { force: true })
  return { tracker: new MockTracker(file), file }
}

test('after the summary has run, the update is refused', async () => {
  const { calls, llm, pm } = stubs()
  const { tracker, file } = await freshTracker('closed')

  await assert.rejects(
    () => processUpdate(TEAM, 'm1', 'Madhavi Andoju', 'Finished SCRUM-7', '2026-09-22', {
      llm, pm, tracker, summaryHasRun: async () => true
    }),
    StandupClosedError
  )

  assert.equal(calls.llm, 0, 'the model must not be called after closing')
  assert.deepEqual(await tracker.readToday('team-1', '2026-09-22'), [], 'nothing may be written after closing')
  await rm(file, { force: true })
})

test('the refusal names the day it applies to', async () => {
  const { llm, pm } = stubs()
  const { tracker, file } = await freshTracker('names-day')
  const error = await processUpdate(TEAM, 'm1', 'Madhavi Andoju', 'late update', '2026-09-22', {
    llm, pm, tracker, summaryHasRun: async () => true
  }).catch((e) => e)

  assert.ok(error instanceof StandupClosedError)
  assert.equal(error.localDate, '2026-09-22')
  await rm(file, { force: true })
})

test('before the summary has run, the update is recorded as normal', async () => {
  const { calls, llm, pm } = stubs()
  const { tracker, file } = await freshTracker('open')

  const result = await processUpdate(TEAM, 'm1', 'Madhavi Andoju', 'Finished SCRUM-7', '2026-09-22', {
    llm, pm, tracker, summaryHasRun: async () => false
  })

  assert.equal(calls.llm, 1)
  assert.equal(result.rows, 1)
  const stored = await tracker.readToday('team-1', '2026-09-22')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].rows[0].win, 'SCRUM-7')
  await rm(file, { force: true })
})
