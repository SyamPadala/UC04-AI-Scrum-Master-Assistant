/**
 * Installs the Scrum Assistant for every roster member and Scrum Master of
 * every team. Run by hand.
 *
 *   node scripts/install-app.mjs
 *
 * The app must already be published to the organisation's catalogue — a
 * side-loaded copy exists only for the person who uploaded it and cannot be
 * installed for anyone else.
 *
 * Installing is what creates the conversation reference the app needs to
 * message someone. Without it that member is silently skipped at reminder time,
 * which is the most common reason a demo half-works.
 *
 * Two app registrations, two jobs (found 29 Sep 2026: installing with the Graph
 * app always failed with 403, because a "self" install permission only lets an
 * app install itself):
 *   - Graph app (GRAPH_CLIENT_ID): reads the catalogue — AppCatalog.Read.All.
 *   - Bot app (BOT_APP_ID): installs — TeamsAppInstallation.ReadWriteForUser.All
 *     (or …SelfForUser.All), admin-consented on the bot's own registration.
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

async function graphToken (clientId, secret, label) {
  const response = await (await fetch(`https://login.microsoftonline.com/${env.M365_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  })).json()
  if (response.access_token === undefined) throw new Error(`${label} token failed: ${response.error_description ?? response.error}`)
  return { authorization: `Bearer ${response.access_token}`, 'content-type': 'application/json' }
}
const graphHeaders = await graphToken(env.GRAPH_CLIENT_ID, env.GRAPH_CLIENT_SECRET, 'Graph app')
const botHeaders = await graphToken(env.BOT_APP_ID, env.BOT_APP_PASSWORD, 'Bot app')

// 1. find the app in the organisation's catalogue, matched on the bot's app id
const catalogue = await (await fetch(
  `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=externalId eq '${env.BOT_APP_ID}'`,
  { headers: graphHeaders }
)).json()
const app = (catalogue.value ?? [])[0]
if (app === undefined) {
  throw new Error('Scrum Assistant is not in the organisation catalogue. Upload appPackage/ScrumAssistant.zip in the Teams admin centre under Teams apps > Manage apps.')
}
console.log(`catalogue app: ${app.displayName} (${app.distributionMethod})\n`)

// 2. everyone the service messages: every team's roster and its Scrum Master
const db = new Firestore({
  projectId: env.GCP_PROJECT_ID,
  databaseId: env.FIRESTORE_DATABASE,
  keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS
})
const people = new Map()
for (const doc of (await db.collection('teams').get()).docs) {
  const team = doc.data()
  for (const member of team.members) people.set(member.memberId, `${member.displayName} (${team.name})`)
  if (team.scrumMasterId) people.set(team.scrumMasterId, people.get(team.scrumMasterId) ?? `${team.scrumMasterName ?? 'Scrum Master'} (Scrum Master, ${team.name})`)
}

for (const [userId, label] of people) {
  const installs = await (await fetch(
    `https://graph.microsoft.com/v1.0/users/${userId}/teamwork/installedApps?$expand=teamsApp&$filter=teamsApp/externalId eq '${env.BOT_APP_ID}'`,
    { headers: botHeaders }
  )).json()

  if ((installs.value ?? []).length > 0) {
    console.log(`${label.padEnd(40)} already installed`)
    continue
  }

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${userId}/teamwork/installedApps`, {
    method: 'POST',
    headers: botHeaders,
    body: JSON.stringify({ 'teamsApp@odata.bind': `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${app.id}` })
  })

  if (response.status === 201) {
    console.log(`${label.padEnd(40)} installed`)
  } else {
    const error = await response.json()
    console.log(`${label.padEnd(40)} FAILED ${response.status} ${(error.error?.message ?? '').slice(0, 120)}`)
  }
}

console.log('\nThe app saves each chat when it receives the install event. Check the')
console.log('admin page (Dev team, or Readiness) in a minute to see who can be messaged.')
