import { Firestore } from '@google-cloud/firestore'
import { config } from '../config/env.js'
import type {
  BotTeam, ConfigChange, JobType, NonResponderFlag, ParticipationRecord, RunLog, RunOutcome, TeamConfig
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

/**
 * Finds the team a person belongs to (FR-10).
 *
 * A one-to-one Teams message carries no team, so the roster is what resolves
 * it. A person in no team, or in two, is a configuration error and is reported
 * as such rather than guessed at.
 */
export async function teamForMember (memberId: string): Promise<TeamConfig | undefined> {
  const snapshot = await db.collection('teams').get()
  const matches = snapshot.docs
    .map((doc) => doc.data() as TeamConfig)
    .filter((team) => team.members.some((m) => m.memberId === memberId))

  if (matches.length > 1) {
    throw new Error(
      `${memberId} is on more than one team (${matches.map((t) => t.name).join(', ')}); rosters must not overlap`
    )
  }
  return matches[0]
}

/**
 * Finds the team whose stakeholder channel this is (FR-08, FR-10).
 *
 * Matched on the configured channel id, so the assistant seeing a message in
 * some other channel cannot make it that team's summary destination.
 */
export async function teamForChannel (channelId: string): Promise<TeamConfig | undefined> {
  const snapshot = await db.collection('teams').get()
  return snapshot.docs
    .map((doc) => doc.data() as TeamConfig)
    .find((team) => (team.stakeholders.channelId ?? '') === channelId)
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
  teamId: string, memberId: string, displayName: string | undefined, reference: string
): Promise<void> {
  const ref = db.collection('teams').doc(teamId)
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref)
    if (!doc.exists) return
    const team = doc.data() as TeamConfig
    const existing = team.members.find((m) => m.memberId === memberId)
    if (existing === undefined) {
      team.members.push({ memberId, displayName: displayName ?? 'Unknown', conversationRef: reference })
    } else {
      existing.conversationRef = reference
      // Some Teams events carry no sender name; keeping the stored one stops
      // the roster, alerts and summary showing "Unknown".
      if (displayName !== undefined && displayName !== '') existing.displayName = displayName
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
 * Records the outcome of a job run by hand with the `run` command.
 *
 * Touches no claim: a manual run must neither use up the scheduled job nor
 * close the stand-up. Marked `trigger: 'manual'` so the status card, which
 * reports the scheduled cycle, can leave it out.
 */
export async function logManualRun (
  teamId: string, localDate: string, jobType: JobType,
  outcome: RunOutcome, startedAt: Date, detail?: string
): Promise<void> {
  const entry: RunLog = {
    teamId, jobType, localDate, outcome, startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    trigger: 'manual',
    ...(detail === undefined ? {} : { detail })
  }
  await db.collection('runLogs').add(entry)
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

/**
 * Whether the day's summary has already run for this team (A14).
 *
 * The claim is written when the summary starts, so this is true whether it
 * built successfully or not. That is deliberate: the day's record has been
 * taken either way, and a closing time that depends on whether a job
 * succeeded cannot be explained to a team.
 */
export async function summaryHasRun (teamId: string, localDate: string): Promise<boolean> {
  const doc = await db.collection('runs').doc(runId(teamId, localDate, 'summary')).get()
  return doc.exists
}

/** Today's job outcomes for the status card. */
export async function runsForDate (
  teamId: string, localDate: string
): Promise<Array<{ jobType: string, outcome: string, detail?: string }>> {
  const jobTypes: JobType[] = ['reminder', 'followup', 'summary', 'participation']
  const refs = jobTypes.map((jobType) => db.collection('runs').doc(runId(teamId, localDate, jobType)))
  const docs = await db.getAll(...refs)
  const claimed = docs.filter((doc) => doc.exists).map((doc) => doc.data() as { jobType: JobType })

  const results: Array<{ jobType: string, outcome: string, detail?: string }> = []
  for (const claim of claimed) {
    const logs = await db.collection('runLogs')
      .where('teamId', '==', teamId)
      .where('localDate', '==', localDate)
      .where('jobType', '==', claim.jobType)
      .get()
    const latest = logs.docs
      .map((doc) => doc.data() as RunLog)
      .filter((log) => log.trigger !== 'manual')
      .sort((a, b) => Number(b.startedAt) - Number(a.startedAt))[0]
    results.push({
      jobType: claim.jobType,
      outcome: latest?.outcome ?? 'running',
      ...(latest?.detail === undefined ? {} : { detail: latest.detail })
    })
  }
  return results
}

export async function recordConfigChange (change: ConfigChange): Promise<void> {
  await db.collection('configChanges').add(change)
}

export async function allTeams (): Promise<TeamConfig[]> {
  const snapshot = await db.collection('teams').get()
  return snapshot.docs.map((doc) => doc.data() as TeamConfig)
}

/**
 * The most recent configuration changes for one team, newest first.
 *
 * Sorted here rather than in the query: ordering on a second field would need
 * a composite index, and the history of one team is small.
 */
export async function configChangesFor (teamId: string, limit = 25): Promise<ConfigChange[]> {
  const snapshot = await db.collection('configChanges').where('teamId', '==', teamId).get()
  return snapshot.docs
    .map((doc) => {
      // Firestore hands dates back as Timestamps, not Date objects.
      const data = doc.data() as Omit<ConfigChange, 'changedAt'> & { changedAt: { toDate: () => Date } }
      return { ...data, changedAt: data.changedAt.toDate() }
    })
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
    .slice(0, limit)
}

/**
 * Claims one LLM call against the day's ceiling.
 *
 * Counted in Firestore rather than in memory because Cloud Run scales to zero
 * and a restarted instance would start counting from nothing. Returns false
 * when the ceiling is reached; the caller must then fail rather than spend.
 *
 * Counts only — no prompt, no completion, no member text. The Privacy NFR
 * applies to this document like any other.
 */
export async function reserveLlmCall (localDate: string, maxPerDay: number): Promise<boolean> {
  const ref = db.collection('llmUsage').doc(localDate)
  try {
    return await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      const calls = doc.exists ? Number((doc.data() as { calls?: number }).calls ?? 0) : 0
      if (calls >= maxPerDay) return false
      tx.set(ref, { localDate, calls: calls + 1 }, { merge: true })
      return true
    })
  } catch (error) {
    // A counter that cannot be read must not become a free pass to spend.
    console.error(JSON.stringify({ event: 'llm.reserve.failed', localDate, error: String(error) }))
    return false
  }
}

/** Records what a completed call actually cost. Token counts only. */
export async function recordLlmUsage (
  localDate: string, label: string,
  usage: { inputTokens: number, outputTokens: number }
): Promise<void> {
  const ref = db.collection('llmUsage').doc(localDate)
  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      const data = (doc.exists ? doc.data() : {}) as Record<string, number | string | undefined>
      const previousIn = Number(data.inputTokens ?? 0)
      const previousOut = Number(data.outputTokens ?? 0)
      const previousLabel = Number(data[`calls_${label}`] ?? 0)
      tx.set(ref, {
        localDate,
        inputTokens: previousIn + usage.inputTokens,
        outputTokens: previousOut + usage.outputTokens,
        [`calls_${label}`]: previousLabel + 1
      }, { merge: true })
    })
  } catch (error) {
    console.error(JSON.stringify({ event: 'llm.usage.failed', localDate, error: String(error) }))
  }
}

/**
 * Daily model usage for a list of dates, for the admin page (SPEC-008).
 * Counts and token totals only — never prompt or response text.
 */
export async function llmUsageForDates (dates: string[]): Promise<Array<{
  localDate: string, calls: number, inputTokens: number, outputTokens: number, byLabel: Record<string, number>
}>> {
  if (dates.length === 0) return []
  const docs = await db.getAll(...dates.map((date) => db.collection('llmUsage').doc(date)))
  return docs.map((doc, index) => {
    const data = (doc.exists ? doc.data() : {}) as Record<string, number | string | undefined>
    const byLabel: Record<string, number> = {}
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('calls_')) byLabel[key.slice(6)] = Number(value ?? 0)
    }
    return {
      localDate: dates[index],
      calls: Number(data.calls ?? 0),
      inputTokens: Number(data.inputTokens ?? 0),
      outputTokens: Number(data.outputTokens ?? 0),
      byLabel
    }
  })
}

/** Today's spend, for the status card and the run report. */
export async function llmUsageFor (localDate: string): Promise<{
  calls: number, inputTokens: number, outputTokens: number
}> {
  const doc = await db.collection('llmUsage').doc(localDate).get()
  const data = (doc.exists ? doc.data() : {}) as Record<string, number | undefined>
  return {
    calls: Number(data.calls ?? 0),
    inputTokens: Number(data.inputTokens ?? 0),
    outputTokens: Number(data.outputTokens ?? 0)
  }
}

/**
 * Remembers that a blocker has already been alerted on (SPEC-005).
 *
 * The key is a hash of the normalised blocker text, never the text itself:
 * a blocker description is update content and must not be stored outside the
 * tracker (Privacy NFR). Returns true when this is the first time today.
 */
export async function claimBlockerAlert (
  teamId: string, memberId: string, localDate: string, blockerHash: string
): Promise<boolean> {
  const ref = db.collection('blockerAlerts').doc(`${teamId}_${memberId}_${localDate}_${blockerHash}`)
  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (doc.exists) throw new Error('already-alerted')
      tx.create(ref, { teamId, memberId, localDate, blockerHash, alertedAt: new Date() })
    })
    return true
  } catch {
    return false
  }
}

/**
 * Remembers the channel the app was installed into, so the summary can be
 * posted there later (FR-08).
 *
 * The bot posts to the channel itself rather than through Graph:
 * `ChannelMessage.Send` is delegated-only, so a background service with no
 * signed-in user can never use it (checklist item 8). A stored conversation
 * reference is the only route a scheduled job has.
 */
export async function saveChannelRef (teamId: string, reference: string): Promise<void> {
  await db.collection('teams').doc(teamId).set({ channelRef: reference }, { merge: true })
}

/** Disconnects the stakeholder channel; the summary then goes by email only. */
export async function clearChannelRef (teamId: string): Promise<void> {
  await db.collection('teams').doc(teamId).set({ channelRef: '' }, { merge: true })
}

/**
 * Remembers a Teams team the app is installed in (SPEC-008 behaviour 6), so
 * its channels can be offered on the admin page. Holds no message content.
 */
export async function saveBotTeam (team: BotTeam): Promise<void> {
  await db.collection('botTeams').doc(encodeURIComponent(team.teamThreadId)).set(team)
}

export async function botTeams (): Promise<BotTeam[]> {
  const snapshot = await db.collection('botTeams').get()
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Omit<BotTeam, 'seenAt'> & { seenAt: { toDate: () => Date } }
    return { ...data, seenAt: data.seenAt.toDate() }
  })
}

export async function getChannelRef (teamId: string): Promise<string | undefined> {
  const doc = await db.collection('teams').doc(teamId).get()
  const value = (doc.data() as { channelRef?: string } | undefined)?.channelRef
  return value === undefined || value === '' ? undefined : value
}
