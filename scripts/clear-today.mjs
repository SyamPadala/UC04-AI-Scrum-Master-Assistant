/**
 * Clears today's job claims so the scheduler runs them again. For demos and
 * testing only — in normal operation a job runs once per team per day.
 *
 *   node scripts/clear-today.mjs
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
const today = new Intl.DateTimeFormat('en-CA', { timeZone: team.timezone }).format(new Date())

const claims = await db.collection('runs').where('localDate', '==', today).get()
for (const doc of claims.docs) {
  console.log('cleared', doc.id)
  await doc.ref.delete()
}
if (claims.empty) console.log(`no claims for ${today}`)
else console.log(`\n${claims.size} claim(s) cleared — the next tick will run those jobs again.`)
