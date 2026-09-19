/**
 * Shows who the service can actually message. Run by hand.
 *
 *   node scripts/check-reach.mjs
 *
 * A member is reachable only once the app has been installed for them AND the
 * app has seen an activity from them, which is when the conversation reference
 * is stored. An unreachable member is skipped at reminder time.
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

const db = new Firestore({
  projectId: env.GCP_PROJECT_ID,
  databaseId: env.FIRESTORE_DATABASE,
  keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS
})

const team = (await db.collection('teams').doc(env.TEAMS_TEAM_ID).get()).data()
if (team === undefined) throw new Error('team config not found — run scripts/seed-team.mjs first')

console.log(`${team.name} — stand-up ${team.standupTime} ${team.timezone}, follow-up +${team.gracePeriodMinutes}m\n`)
let reachable = 0
for (const member of team.members) {
  const ok = typeof member.conversationRef === 'string' && member.conversationRef !== ''
  if (ok) reachable++
  console.log(`  ${ok ? '[reachable]  ' : '[UNREACHABLE]'} ${member.displayName}`)
}
console.log(`\n${reachable} of ${team.members.length} can be messaged.`)
if (reachable < team.members.length) {
  console.log('Unreachable members need the app installed for them, and then to')
  console.log('send it one message so the conversation reference is captured.')
}
