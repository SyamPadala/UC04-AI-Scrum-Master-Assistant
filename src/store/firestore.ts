import { Firestore } from '@google-cloud/firestore'
import { config } from '../config/env.js'
import type {
  JobType, NonResponderFlag, ParticipationRecord, RunLog, RunOutcome, TeamConfig
} from '../types.js'

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

export async function saveParticipation (record: ParticipationRecord): Promise<void> {
  await db.collection('participation')
    .doc(`${record.teamId}_${record.localDate}`)
    .set(record)
}

/**
 * The most recent days of participation for a team, newest first.
 *
 * Fetched by document name rather than with a where+orderBy query: that
 * combination needs a composite index, and the document id already encodes
 * team and date, so the ids can simply be computed.
 */
export async function recentParticipation (
  teamId: string, days: number, timeZone: string, endingOn: Date = new Date()
): Promise<ParticipationRecord[]> {
  const dates: string[] = []
  for (let back = 0; back < days; back++) {
    const day = new Date(endingOn.getTime() - back * 86_400_000)
    dates.push(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(day))
  }

  const refs = dates.map((date) => db.collection('participation').doc(`${teamId}_${date}`))
  const docs = await db.getAll(...refs)
  return docs.filter((doc) => doc.exists).map((doc) => doc.data() as ParticipationRecord)
}

function flagId (teamId: string, memberId: string, missedDates: string[]): string {
  // Keyed on the streak's first missed date, so one flag per streak rather
  // than one per day (SPEC-007 behaviour 5).
  return `${teamId}_${memberId}_${missedDates[0]}`
}

export async function alreadyFlagged (
  teamId: string, memberId: string, missedDates: string[]
): Promise<boolean> {
  const doc = await db.collection('flags').doc(flagId(teamId, memberId, missedDates)).get()
  return doc.exists
}

export async function saveFlag (flag: NonResponderFlag): Promise<void> {
  await db.collection('flags')
    .doc(flagId(flag.teamId, flag.memberId, flag.missedDates))
    .set(flag)
}
