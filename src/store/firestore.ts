import { Firestore } from '@google-cloud/firestore'
import { config } from '../config/env.js'
import type { JobType, RunLog, RunOutcome, TeamConfig } from '../types.js'

/**
 * Firestore holds configuration, conversation references and run metadata only.
 * Update content lives in the team's tracker — never here. This is the Privacy
 * NFR and a violation is a build error, not a preference.
 */
const db = new Firestore({
  projectId: config.gcp.projectId,
  databaseId: config.gcp.firestoreDatabase,
  ...(config.gcp.credentialsPath === '' ? {} : { keyFilename: config.gcp.credentialsPath })
})

export async function firestoreReachable (): Promise<boolean> {
  try {
    await db.collection('teams').limit(1).get()
    return true
  } catch {
    return false
  }
}

export async function activeTeams (): Promise<TeamConfig[]> {
  const snapshot = await db.collection('teams').where('active', '==', true).get()
  return snapshot.docs.map((doc) => doc.data() as TeamConfig)
}

export async function getTeam (teamId: string): Promise<TeamConfig | undefined> {
  const doc = await db.collection('teams').doc(teamId).get()
  return doc.exists ? (doc.data() as TeamConfig) : undefined
}

export async function saveTeam (team: TeamConfig): Promise<void> {
  await db.collection('teams').doc(team.teamId).set(team)
}

/** Stores the reference that lets the app message this person directly. */
export async function saveConversationRef (
  teamId: string, memberId: string, displayName: string, reference: string
): Promise<void> {
  const ref = db.collection('teams').doc(teamId)
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref)
    if (!doc.exists) return
    const team = doc.data() as TeamConfig
    const existing = team.members.find((m) => m.memberId === memberId)
    if (existing === undefined) {
      team.members.push({ memberId, displayName, conversationRef: reference })
    } else {
      existing.conversationRef = reference
      existing.displayName = displayName
    }
    tx.set(ref, team)
  })
}

function runId (teamId: string, localDate: string, jobType: JobType): string {
  return `${teamId}_${localDate}_${jobType}`
}

/**
 * Claims a job for this team, date and job type.
 *
 * Returns false if it is already claimed. /tick fires the same window more than
 * once, so the claim must be atomic — a read followed by a write would let two
 * overlapping ticks both decide the job had not run.
 */
export async function claimRun (teamId: string, localDate: string, jobType: JobType): Promise<boolean> {
  const ref = db.collection('runs').doc(runId(teamId, localDate, jobType))
  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (doc.exists) throw new Error('already-claimed')
      tx.create(ref, {
        teamId, jobType, localDate, outcome: 'claimed', startedAt: new Date()
      })
    })
    return true
  } catch {
    return false
  }
}

/**
 * Records the outcome.
 *
 * The log is a separate document from the claim on purpose. Writing the log
 * back onto the claim would re-create a claim that a failure had just
 * released, and the job would never be retried.
 */
export async function completeRun (
  teamId: string, localDate: string, jobType: JobType,
  outcome: RunOutcome, startedAt: Date, detail?: string
): Promise<void> {
  const entry: RunLog = {
    teamId, jobType, localDate, outcome, startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    ...(detail === undefined ? {} : { detail })
  }
  await db.collection('runLogs').add(entry)

  const claim = db.collection('runs').doc(runId(teamId, localDate, jobType))
  const doc = await claim.get()
  if (doc.exists) await claim.update({ outcome })
}

/**
 * Releases a claim so a later tick retries the job.
 *
 * Used when a job threw before completing: without this the day's reminder
 * would be marked as done and never sent.
 */
export async function releaseRun (teamId: string, localDate: string, jobType: JobType): Promise<void> {
  await db.collection('runs').doc(runId(teamId, localDate, jobType)).delete()
}
