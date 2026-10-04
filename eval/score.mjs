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

// The eval's calls are counted apart from the service's daily limit (user
// decision, 29 Sep 2026). Set before the config module reads the environment.
process.env.LLM_USAGE_SCOPE ??= 'eval'
const { config } = await import('../dist/config/env.js')
const { createLlm } = await import('../dist/llm/index.js')
const { extractUpdate } = await import('../dist/agents/updateProcessor.js')

const root = path.resolve(import.meta.dirname, '..')
const cases = JSON.parse(fs.readFileSync(path.join(root, 'eval/dataset.json'), 'utf8'))
const smoke = process.argv.includes('--smoke')
const selected = smoke ? cases.slice(0, 8) : cases

const llm = createLlm()

// The stories the cases were labelled against, fixed in eval/stories.json.
// Reading them from live Jira made the number depend on Jira's state: on 28 Sep
// the sprint was cleared and a run scored 29.8% because every key was gone.
// They reach the prompt exactly as open items do in production; lookup_story
// answers from the same list, so an unknown key (SCRUM-9999) is still "not found".
// SPEC-004 item 22: the eval member's own stories plus other members' and an
// unassigned one, as the whole sprint is offered in production.
const openStories = JSON.parse(fs.readFileSync(path.join(root, 'eval/stories.json'), 'utf8')).map((story) => ({
  ...story,
  statusCategory: 'In Progress',
  points: null,
  assigneeAccountId: story.assignee === 'Eval Member' ? 'eval' : story.assignee === null ? null : `acct-${story.assignee}`,
  url: '',
  updated: new Date(0)
}))
const pm = {
  getActiveSprint: async () => ({ id: 0, name: 'Eval sprint', goal: '', startDate: null, endDate: null }),
  getSprintData: async () => undefined,
  lookupStory: async (key) => openStories.find((story) => story.key === key),
  getMemberOpenItems: async () => openStories.filter((story) => story.assigneeAccountId === 'eval'),
  getSprintOpenItems: async () => openStories
}
console.log(`open stories given to the model: ${openStories.map((s) => s.key).join(', ') || 'none'}
`)

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
        jiraAccountId: 'eval',
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
    // SPEC-004 items 15–16: the label decides the member's reply for an empty
    // message ("not an update" vs "nothing to report"), so it is scored.
    const kind = output.kind === (testCase.expect.kind ?? 'update')
    // SPEC-004 item 24: where a case expects alternatives, the offered keys must match.
    const altsOf = (bucket) => output[bucket].flatMap((entry) => entry.alternatives ?? []).sort()
    const alternatives = ['completed', 'inProgress'].every((bucket) =>
      testCase.expect.alternatives?.[bucket] === undefined ||
      sameKeys(altsOf(bucket), testCase.expect.alternatives[bucket]))
    // Verification 20: a key the member did not mean, written as if they had.
    const wrongKeys = ['completed', 'inProgress', 'blockers'].flatMap((bucket) =>
      keysOf(output[bucket]).filter((key) => key !== null && !testCase.expect[bucket].includes(key)).map((key) => `${bucket}:${key}`))

    row = {
      id: testCase.id,
      completed,
      inProgress,
      blockers,
      confidence,
      kind,
      alternatives,
      wrongKeys,
      // The case passes on structure and kind. Confidence is reported
      // separately: it is a useful signal but not what FR-03 asks for.
      pass: completed && inProgress && blockers && kind && alternatives,
      ms: extraction.durationMs,
      cached: extraction.roundTrips === 0,
      note: testCase.note,
      tag: testCase.tag,
      // Keys only, so a miss can be diagnosed from the output alone.
      got: { kind: output.kind, alternatives: [...altsOf('completed'), ...altsOf('inProgress')], completed: keysOf(output.completed), inProgress: keysOf(output.inProgress), blockers: keysOf(output.blockers.map((b) => ({ storyRef: b.storyRef }))) }
    }
  } catch (error) {
    row = {
      id: testCase.id, completed: false, inProgress: false, blockers: false,
      confidence: false, kind: false, pass: false, ms: Date.now() - started, cached: false,
      note: testCase.note, tag: testCase.tag, error: error.message
    }
  }

  totalMs += row.ms
  slowest = Math.max(slowest, row.ms)
  results.push(row)

  const mark = row.pass ? 'pass' : 'FAIL'
  const fields = [
    row.completed ? '' : 'completed',
    row.inProgress ? '' : 'inProgress',
    row.blockers ? '' : 'blockers',
    row.kind ? '' : 'kind',
    row.alternatives === false ? 'alternatives' : ''
  ].filter((field) => field !== '')
  console.log(
    `${row.id}  ${mark}  ${String(row.ms).padStart(6)}ms  ${row.cached ? 'cached' : 'live  '}  ` +
    `${fields.length === 0 ? '' : 'wrong: ' + fields.join(', ')}${row.error === undefined ? '' : ' ERROR: ' + row.error}` +
    (row.pass || row.got === undefined ? '' : `
      got ${JSON.stringify(row.got)}`)
  )
}

const passed = results.filter((row) => row.pass).length
const accuracy = (passed / results.length) * 100
const fieldScore = (field) => (results.filter((row) => row[field]).length / results.length) * 100
// A case refused because live calls are off reached no model and cost nothing.
const liveCalls = results.filter((row) => !row.cached && !/LLM_LIVE is off/.test(row.error ?? '')).length

console.log('')
console.log(`cases          : ${results.length}${smoke ? ' (smoke subset)' : ''}`)
console.log(`accuracy       : ${accuracy.toFixed(1)}%  (target >= 90%, FR-03)`)
console.log(`  completed    : ${fieldScore('completed').toFixed(1)}%`)
console.log(`  inProgress   : ${fieldScore('inProgress').toFixed(1)}%`)
console.log(`  blockers     : ${fieldScore('blockers').toFixed(1)}%`)
console.log(`  kind         : ${fieldScore('kind').toFixed(1)}%`)
const wrong = results.filter((row) => (row.wrongKeys ?? []).length > 0)
console.log(`wrong keys     : ${wrong.length} case(s)${wrong.length === 0 ? '' : ' — ' + wrong.map((row) => `${row.id} ${row.wrongKeys.join(',')}`).join('; ')}  (target 0, SPEC-004 verification 20)`)
console.log(`  confidence   : ${fieldScore('confidence').toFixed(1)}%  (reported, not scored)`)
console.log(`latency mean   : ${Math.round(totalMs / results.length)}ms`)
console.log(`latency worst  : ${slowest}ms  (budget 30000ms, Latency NFR)`)
console.log(`calls billed   : ${liveCalls} of ${results.length}`)
const agentModel = config.agent1.model === '' ? llm.model : config.agent1.model
console.log(`provider/model : ${llm.provider} / ${agentModel}`)
// SPEC-004 item 37: every intent, run-on and own-first case must pass, whatever the overall figure.
const mustPass = results.filter((row) => row.tag !== undefined)
const mustFail = mustPass.filter((row) => !row.pass)
console.log(`must-pass cases: ${mustPass.length - mustFail.length} of ${mustPass.length}${mustFail.length === 0 ? '' : ' — failed: ' + mustFail.map((row) => `${row.id} (${row.tag})`).join(', ')}  (target all, SPEC-004 item 37)`)

const report = {
  runAt: new Date().toISOString(),
  provider: llm.provider,
  model: config.agent1.model === '' ? llm.model : config.agent1.model,
  subset: smoke ? 'smoke' : 'full',
  cases: results.length,
  accuracy,
  byField: {
    completed: fieldScore('completed'),
    inProgress: fieldScore('inProgress'),
    blockers: fieldScore('blockers'),
    kind: fieldScore('kind'),
    wrongKeyCases: results.filter((row) => (row.wrongKeys ?? []).length > 0).length,
    confidence: fieldScore('confidence')
  },
  latencyMeanMs: Math.round(totalMs / results.length),
  latencyWorstMs: slowest,
  billedCalls: liveCalls,
  results
}
// A run where the model was never reached measures nothing, and must not
// replace the last real report (it did once, 29 Sep 2026).
const offline = results.filter((row) => /LLM_LIVE is off/.test(row.error ?? '')).length
if (offline > 0) {
  console.log(`\nNOT written: ${offline} case(s) never reached the model (live calls off, nothing recorded); eval/last-run.json kept`)
} else {
  fs.writeFileSync(path.join(root, 'eval/last-run.json'), JSON.stringify(report, null, 2))
  console.log('\nwritten: eval/last-run.json')
}

process.exit(accuracy >= 90 ? 0 : 1)
