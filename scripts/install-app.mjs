/**
 * Installs the Scrum Assistant for every member of the team. Run by hand.
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
 * Needs Graph application permissions AppCatalog.Read.All and
 * TeamsAppInstallation.ReadWriteSelfForUser.All, both admin-consented.
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

const tokenResponse = await (await fetch(`https://login.microsoftonline.com/${env.M365_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials'
  })
})).json()
if (tokenResponse.access_token === undefined) throw new Error('Graph token failed')
const headers = { authorization: `Bearer ${tokenResponse.access_token}`, 'content-type': 'application/json' }

// 1. find the app in the organisation's catalogue, matched on the bot's app id
const catalogue = await (await fetch(
  `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=externalId eq '${env.BOT_APP_ID}'`,
  { headers }
)).json()
const app = (catalogue.value ?? [])[0]
if (app === undefined) {
  throw new Error('Scrum Assistant is not in the organisation catalogue. Upload appPackage/ScrumAssistant.zip in the Teams admin centre under Teams apps > Manage apps.')
}
console.log(`catalogue app: ${app.displayName} (${app.distributionMethod})\n`)

// 2. the roster is whatever the service will actually message
const db = new Firestore({
  projectId: env.GCP_PROJECT_ID,
  databaseId: env.FIRESTORE_DATABASE,
  keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS
})
const team = (await db.collection('teams').doc(env.TEAMS_TEAM_ID).get()).data()
if (team === undefined) throw new Error('team config not found — run scripts/seed-team.mjs first')

for (const member of team.members) {
  const installs = await (await fetch(
    `https://graph.microsoft.com/v1.0/users/${member.memberId}/teamwork/installedApps?$expand=teamsApp&$filter=teamsApp/externalId eq '${env.BOT_APP_ID}'`,
    { headers }
  )).json()

  if ((installs.value ?? []).length > 0) {
    console.log(`${member.displayName.padEnd(20)} already installed`)
    continue
  }

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${member.memberId}/teamwork/installedApps`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ 'teamsApp@odata.bind': `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${app.id}` })
  })

  if (response.status === 201) {
    console.log(`${member.displayName.padEnd(20)} installed`)
  } else {
    const error = await response.json()
    console.log(`${member.displayName.padEnd(20)} FAILED ${response.status} ${(error.error?.message ?? '').slice(0, 120)}`)
  }
}

console.log('\nInstalling does not by itself create the conversation reference — the app')
console.log('captures that when it receives the install event. Re-run scripts/check-reach.mjs')
console.log('in a minute to see who became reachable.')
