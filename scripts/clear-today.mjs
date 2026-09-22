/**
 * Clears today's job claims so the scheduler runs them again. For demos and
 * testing only — in normal operation a job runs once per team per day.
 *
 *   node scripts/clear-today.mjs             every job
 *   node scripts/clear-today.mjs reminder    just the stand-up reminder
 *
 * Naming one job matters more than it looks: clearing all four also re-sends
 * the follow-up and rebuilds the summary, and the summary costs a model call.
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

const JOB_TYPES = ['reminder', 'followup', 'summary', 'participation']
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))

const unknown = wanted.filter((job) => !JOB_TYPES.includes(job))
if (unknown.length > 0) {
  console.error(`unknown job type: ${unknown.join(', ')}`)
  console.error(`use one of: ${JOB_TYPES.join(', ')}`)
  process.exit(1)
}

const all = await db.collection('runs').where('localDate', '==', today).get()
const claims = wanted.length === 0
  ? all.docs
  : all.docs.filter((doc) => wanted.includes(doc.data().jobType))

console.log(`${today} — clearing: ${wanted.length === 0 ? 'ALL JOBS' : wanted.join(', ')}`)
for (const doc of claims) {
  console.log('  cleared', doc.id)
  await doc.ref.delete()
}

if (claims.length === 0) console.log('  nothing to clear')
else console.log(`\n${claims.length} claim(s) cleared — the next tick will run those jobs again.`)
