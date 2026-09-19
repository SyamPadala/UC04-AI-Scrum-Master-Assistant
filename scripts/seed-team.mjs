/**
 * Seeds the team configuration into Firestore. Run by hand.
 *
 *   node scripts/seed-team.mjs                 # 09:00 stand-up
 *   node scripts/seed-team.mjs 14:35           # stand-up at 14:35 local
 *
 * The roster comes from the M365 directory, so display names match exactly.
 * Existing conversation references are preserved — re-seeding must not make
 * members unreachable.
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

const standupTime = process.argv[2] ?? '09:00'
if (!/^\d{2}:\d{2}$/.test(standupTime)) throw new Error('time must be HH:mm')

const token = await (async () => {
  const r = await fetch(`https://login.microsoftonline.com/${env.M365_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials'
    })
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('Graph token failed: ' + JSON.stringify(j))
  return j.access_token
})()

const users = await (await fetch(
  'https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName',
  { headers: { authorization: `Bearer ${token}` } }
)).json()

const db = new Firestore({
  projectId: env.GCP_PROJECT_ID,
  databaseId: env.FIRESTORE_DATABASE,
  keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS
})

const ref = db.collection('teams').doc(env.TEAMS_TEAM_ID)
const existing = (await ref.get()).data()
const keptRefs = new Map((existing?.members ?? []).map((m) => [m.memberId, m.conversationRef]))

const scrumMaster = users.value.find((u) => u.userPrincipalName.startsWith('syam.padala'))
if (scrumMaster === undefined) throw new Error('could not identify the Scrum Master in the directory')

const team = {
  teamId: env.TEAMS_TEAM_ID,
  name: 'Scrum Team Alpha',
  active: true,
  timezone: env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  standupTime,
  gracePeriodMinutes: Number(env.DEFAULT_GRACE_MINUTES || 120),
  summaryTime: '18:00',
  // A3: two missed stand-ups inside a five-day window counts as habitual.
  habitualThreshold: Number(process.env.HABITUAL_THRESHOLD ?? 2),
  habitualWindowDays: Number(process.env.HABITUAL_WINDOW_DAYS ?? 5),
  scrumMasterId: scrumMaster.id,
  members: users.value.map((u) => ({
    memberId: u.id,
    displayName: u.displayName,
    ...(keptRefs.get(u.id) === undefined ? {} : { conversationRef: keptRefs.get(u.id) })
  })),
  tracker: { kind: 'sharepoint', siteId: env.SHAREPOINT_SITE_ID, listId: env.SHAREPOINT_LIST_ID },
  stakeholders: { channelId: env.STAKEHOLDER_CHANNEL_ID, emails: [] }
}

await ref.set(team)

console.log(`team "${team.name}" seeded`)
console.log(`  stand-up ${team.standupTime} ${team.timezone}, follow-up +${team.gracePeriodMinutes}m`)
console.log(`  Scrum Master: ${scrumMaster.displayName}`)
for (const m of team.members) {
  console.log(`  ${m.displayName.padEnd(20)} ${m.conversationRef === undefined ? 'NOT reachable (app not installed)' : 'reachable'}`)
}
