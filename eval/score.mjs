/**
 * FR-03 is verified by this number, not by reading the code.
 *
 *   node eval/score.mjs            score every case
 *   node eval/score.mjs --smoke    the first 8 only, for prompt iteration
 *
 * Every response is recorded in .llm-cache, so a second run of the same prompt
 * costs nothing. Editing the prompt changes the cache key and the run is paid
 * for again — which is the point: the number always belongs to the wording
 * that produced it.
 *
 * Requires LLM_LIVE=true for the first run of any new prompt.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../dist/config/env.js'
import { createLlm } from '../dist/llm/index.js'
import { JiraClient } from '../dist/pm/jira.js'
import { extractUpdate } from '../dist/agents/updateProcessor.js'

const root = path.resolve(import.meta.dirname, '..')
const cases = JSON.parse(fs.readFileSync(path.join(root, 'eval/dataset.json'), 'utf8'))
const smoke = process.argv.includes('--smoke')
const selected = smoke ? cases.slice(0, 8) : cases

const llm = createLlm()
const pm = new JiraClient({
  baseUrl: config.jira.baseUrl,
  email: config.jira.email,
  apiToken: config.jira.apiToken,
  projectKey: config.jira.projectKey,
  storyPointsField: config.jira.storyPointsField,
  boardId: config.jira.boardId
})

/** Story keys in a bucket, order-insensitive, nulls kept — null is a real answer. */
const keysOf = (items, field = 'storyRef') =>
  items.map((item) => item[field] ?? null).sort((a, b) => String(a).localeCompare(String(b)))

const sameKeys = (actual, expected) => {
  const a = [...actual].sort((x, y) => String(x).localeCompare(String(y)))
  const b = [...expected].sort((x, y) => String(x).localeCompare(String(y)))
  return a.length === b.length && a.every((value, index) => value === b[index])
}

const results = []
let totalMs = 0
let slowest = 0

for (const testCase of selected) {
  const started = Date.now()
  let row

  try {
    const extraction = await extractUpdate(
      {
        text: testCase.text,
        memberId: 'eval-member',
        memberName: 'Eval Member',
        teamId: 'eval',
        // The linked Jira account, so open items reach the prompt exactly as
        // they would in production. Scoring a different prompt than the one
        // that runs would make the number meaningless.
        jiraAccountId: process.env.EVAL_JIRA_ACCOUNT_ID ?? '',
        // Blockers the member raised earlier, as production passes them (SPEC-004 5a).
        activeBlockers: testCase.activeBlockers ?? []
      },
      llm, pm, config.agent1
    )

    const output = extraction.output
    const completed = sameKeys(keysOf(output.completed), testCase.expect.completed)
    const inProgress = sameKeys(keysOf(output.inProgress), testCase.expect.inProgress)
    const blockers = sameKeys(keysOf(output.blockers), testCase.expect.blockers)
    const confidence = output.confidence === testCase.expect.confidence

    row = {
      id: testCase.id,
      completed,
      inProgress,
      blockers,
      confidence,
      // The case passes on structure. Confidence is reported separately: it is
      // a useful signal but not what FR-03 asks for.
      pass: completed && inProgress && blockers,
      ms: extraction.durationMs,
      cached: extraction.roundTrips === 0,
      note: testCase.note
    }
  } catch (error) {
    row = {
      id: testCase.id, completed: false, inProgress: false, blockers: false,
      confidence: false, pass: false, ms: Date.now() - started, cached: false,
      note: testCase.note, error: error.message
    }
  }

  totalMs += row.ms
  slowest = Math.max(slowest, row.ms)
  results.push(row)

  const mark = row.pass ? 'pass' : 'FAIL'
  const fields = [
    row.completed ? '' : 'completed',
    row.inProgress ? '' : 'inProgress',
    row.blockers ? '' : 'blockers'
  ].filter((field) => field !== '')
  console.log(
    `${row.id}  ${mark}  ${String(row.ms).padStart(6)}ms  ${row.cached ? 'cached' : 'live  '}  ` +
    `${fields.length === 0 ? '' : 'wrong: ' + fields.join(', ')}${row.error === undefined ? '' : ' ERROR: ' + row.error}`
  )
}

const passed = results.filter((row) => row.pass).length
const accuracy = (passed / results.length) * 100
const fieldScore = (field) => (results.filter((row) => row[field]).length / results.length) * 100
const liveCalls = results.filter((row) => !row.cached).length

console.log('')
console.log(`cases          : ${results.length}${smoke ? ' (smoke subset)' : ''}`)
console.log(`accuracy       : ${accuracy.toFixed(1)}%  (target >= 90%, FR-03)`)
console.log(`  completed    : ${fieldScore('completed').toFixed(1)}%`)
console.log(`  inProgress   : ${fieldScore('inProgress').toFixed(1)}%`)
console.log(`  blockers     : ${fieldScore('blockers').toFixed(1)}%`)
console.log(`  confidence   : ${fieldScore('confidence').toFixed(1)}%  (reported, not scored)`)
console.log(`latency mean   : ${Math.round(totalMs / results.length)}ms`)
console.log(`latency worst  : ${slowest}ms  (budget 30000ms, Latency NFR)`)
console.log(`calls billed   : ${liveCalls} of ${results.length}`)
console.log(`provider/model : ${llm.provider} / ${llm.model}`)

const report = {
  runAt: new Date().toISOString(),
  provider: llm.provider,
  model: llm.model,
  subset: smoke ? 'smoke' : 'full',
  cases: results.length,
  accuracy,
  byField: {
    completed: fieldScore('completed'),
    inProgress: fieldScore('inProgress'),
    blockers: fieldScore('blockers'),
    confidence: fieldScore('confidence')
  },
  latencyMeanMs: Math.round(totalMs / results.length),
  latencyWorstMs: slowest,
  billedCalls: liveCalls,
  results
}
fs.writeFileSync(path.join(root, 'eval/last-run.json'), JSON.stringify(report, null, 2))
console.log('\nwritten: eval/last-run.json')

process.exit(accuracy >= 90 ? 0 : 1)
