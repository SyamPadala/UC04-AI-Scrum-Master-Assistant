/**
 * Links each roster member to their Jira account. Run by hand.
 *
 *   node scripts/link-jira.mjs              # show the current links and the choices
 *   node scripts/link-jira.mjs <name>=<n>   # link, using the number shown in the list
 *
 * Example:
 *   node scripts/link-jira.mjs "Madhavi Andoju"=2 "Syam Padala"=1
 *
 * Why this exists: nothing reliably connects a person in Microsoft Teams to the
 * same person in Jira. Display names are owned by each person's own Atlassian
 * profile and cannot be set by the site admin; Jira hides other users' email
 * addresses by default. So the link is recorded once, explicitly, and after
 * that neither system's renames can break it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Firestore } from '@google-cloud/firestore'

const root = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] })
)

const auth = 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')

const response = await fetch(`${env.JIRA_BASE_URL}/rest/api/3/users/search?maxResults=100`, {
  headers: { authorization: auth, accept: 'application/json' }
})
if (!response.ok) throw new Error(`Jira user list failed: ${response.status}`)

const jiraUsers = (await response.json())
  .filter((u) => u.accountType === 'atlassian' && u.active)

const db = new Firestore({
  projectId: env.GCP_PROJECT_ID,
  databaseId: env.FIRESTORE_DATABASE,
  keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS
})
const ref = db.collection('teams').doc(env.TEAMS_TEAM_ID)
const team = (await ref.get()).data()
if (team === undefined) throw new Error('no team record in Firestore — run scripts/seed-team.mjs first')

const assignments = process.argv.slice(2)

if (assignments.length === 0) {
  console.log('Jira accounts available:\n')
  jiraUsers.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.displayName}`)
  })

  console.log('\nRoster in Firestore:\n')
  for (const member of team.members) {
    const linked = jiraUsers.find((u) => u.accountId === member.jiraAccountId)
    console.log(`  ${member.displayName.padEnd(20)} ${linked === undefined ? 'not linked' : `linked to ${linked.displayName}`}`)
  }

  console.log('\nTo link, re-run with name=number, for example:')
  console.log(`  node scripts/link-jira.mjs "${team.members[0].displayName}"=1`)
  process.exit(0)
}

const updated = team.members.map((m) => ({ ...m }))
const done = []

for (const assignment of assignments) {
  const separator = assignment.lastIndexOf('=')
  if (separator === -1) throw new Error(`expected name=number, got "${assignment}"`)

  const name = assignment.slice(0, separator)
  const choice = Number(assignment.slice(separator + 1))
  const jiraUser = jiraUsers[choice - 1]
  if (jiraUser === undefined) throw new Error(`no Jira account numbered ${choice}`)

  const member = updated.find((m) => m.displayName === name)
  if (member === undefined) {
    throw new Error(`"${name}" is not on the roster. Names are: ${updated.map((m) => m.displayName).join(', ')}`)
  }

  // Two people pointing at one Jira account would attribute one person's work
  // to the other, silently.
  const clash = updated.find((m) => m.jiraAccountId === jiraUser.accountId && m.displayName !== name)
  if (clash !== undefined) {
    throw new Error(`${jiraUser.displayName} is already linked to ${clash.displayName}`)
  }

  member.jiraAccountId = jiraUser.accountId
  done.push(`${name} -> ${jiraUser.displayName}`)
}

await ref.update({ members: updated })

console.log('linked:')
for (const line of done) console.log(`  ${line}`)
console.log('\nRoster now:')
for (const member of updated) {
  console.log(`  ${member.displayName.padEnd(20)} ${member.jiraAccountId === undefined ? 'not linked' : member.jiraAccountId}`)
}
