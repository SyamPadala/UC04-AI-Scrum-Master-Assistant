/**
 * Builds today's sprint summary and prints it. Nothing is sent.
 *
 *   node scripts/preview-summary.mjs
 *
 * For checking what stakeholders would receive before letting the scheduled
 * job send it for real. Costs one model call the first time; after that the
 * recorded response is replayed for the same facts, free.
 *
 * Requires LLM_LIVE=true for that first call.
 */
import { config } from '../dist/config/env.js'
import { createLlm } from '../dist/llm/index.js'
import { JiraClient } from '../dist/pm/jira.js'
import { MockTracker } from '../dist/trackers/mock.js'
import { trackerFor } from '../dist/trackers/factory.js'
import { gatherFacts } from '../dist/jobs/summary.js'
import { buildSummaryText } from '../dist/agents/summaryBuilder.js'
import fs from 'node:fs'
import { summaryCard, summaryEmailHtml, summaryPlainText } from '../dist/cards/summary.js'
import { getTeam } from '../dist/store/firestore.js'
import { localDate } from '../dist/config/time.js'

// Flags are skipped so `--mock` alone is not mistaken for a team id.
const teamId = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? config.teams.teamId
const team = await getTeam(teamId)
if (team === undefined) throw new Error(`no team ${teamId} in Firestore`)

const today = process.env.PREVIEW_DATE ?? localDate(new Date(), team.timezone)

// --mock reads the sample tracker instead of SharePoint, so the summary can be
// previewed with no Microsoft account and no live updates.
const tracker = process.argv.includes('--mock')
  ? new MockTracker(process.env.MOCK_TRACKER_PATH ?? './.data/tracker.json')
  : trackerFor(team)

const pm = new JiraClient({
  baseUrl: config.jira.baseUrl,
  email: config.jira.email,
  apiToken: config.jira.apiToken,
  projectKey: config.jira.projectKey,
  storyPointsField: config.jira.storyPointsField,
  boardId: config.jira.boardId
})

const facts = await gatherFacts(team, tracker, pm, today)
console.log(`team          : ${team.name}`)
console.log(`date          : ${today}`)
console.log(`updates read  : ${facts.updates.length}`)
console.log(`participation : ${facts.participation.responded}/${facts.participation.rosterSize}`)
console.log(`sprint        : ${facts.sprint?.name ?? 'none active'}`)
console.log(`at risk       : ${facts.atRisk.length}`)
console.log('')

const built = await buildSummaryText(facts, createLlm(), config.agent2)
console.log('─'.repeat(70))
console.log(summaryPlainText(facts, built.sections))
console.log('─'.repeat(70))
// --out <dir> writes the email and the Teams card, to look at before sending.
const outAt = process.argv.indexOf('--out')
if (outAt !== -1) {
  const dir = process.argv[outAt + 1]
  fs.writeFileSync(`${dir}/summary-email.html`, summaryEmailHtml(facts, built.sections))
  fs.writeFileSync(`${dir}/summary-card.json`, JSON.stringify(summaryCard(facts, built.sections), null, 2))
  console.log(`wrote ${dir}/summary-email.html and summary-card.json`)
}
console.log(`built in ${built.durationMs}ms, ${built.attempts} attempt(s). Not sent.`)
