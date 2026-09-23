import type {
  NonResponderFlag, ParticipationEntry, ParticipationRecord, TeamConfig
} from '../types.js'
import type { Tracker } from '../trackers/types.js'
import {
  alreadyFlagged, recentParticipation, saveFlag, saveParticipation
} from '../store/firestore.js'
import { sendProactive } from '../bot/adapter.js'

/**
 * FR-09: records who replied today and at what rate.
 *
 * Only metadata is stored — who replied and when, never what they said
 * (Privacy NFR). Who replied is read from the tracker, which is the only place
 * update content lives.
 */
export async function recordParticipation (
  team: TeamConfig, tracker: Tracker, localDate: string,
  options: { persist: boolean } = { persist: true }
): Promise<ParticipationRecord> {
  const updates = await tracker.readToday(team.teamId, localDate)
  const responders = new Set(updates.map((u) => u.memberName))

  const entries: ParticipationEntry[] = team.members.map((member) => (
    responders.has(member.displayName)
      ? { memberId: member.memberId, memberName: member.displayName, status: 'responded', withinGrace: true }
      : { memberId: member.memberId, memberName: member.displayName, status: 'missed' }
  ))

  const responded = entries.filter((e) => e.status === 'responded').length
  const record: ParticipationRecord = {
    teamId: team.teamId,
    localDate,
    entries,
    rate: team.members.length === 0 ? 0 : responded / team.members.length
  }

  // A manual run reports the count without saving it: the saved record is
  // what the scheduled count and the non-responder streaks are built on.
  if (options.persist) await saveParticipation(record)
  return record
}

/**
 * FR-09 / A3: tells the Scrum Master about repeat non-responders.
 *
 * A member is flagged once per streak, not once per day — otherwise the Scrum
 * Master is told the same thing every morning and stops reading it. Replying
 * again ends the streak, and the next miss starts a fresh one.
 *
 * With `persist` off (a manual run) the flags are worked out and returned but
 * neither saved nor sent. Saving one would mark the streak as already flagged
 * and silence the scheduled flag that should follow.
 */
export async function flagHabitualNonResponders (
  team: TeamConfig, localDate: string,
  options: { todayRecord?: ParticipationRecord, persist: boolean } = { persist: true }
): Promise<NonResponderFlag[]> {
  const stored = await recentParticipation(team.teamId, team.habitualWindowDays, team.timezone)
  const history = withToday(stored, options.todayRecord)
  const flags: NonResponderFlag[] = []

  for (const candidate of streaksToFlag(team, history, localDate)) {
    if (await alreadyFlagged(team.teamId, candidate.memberId, candidate.missedDates)) continue

    const flag: NonResponderFlag = { ...candidate, flaggedAt: new Date() }
    if (options.persist) await saveFlag(flag)
    flags.push(flag)
  }

  if (flags.length > 0 && options.persist) await notifyScrumMaster(team, flags)
  return flags
}

/**
 * The stored history with today's count in place of whatever is stored for
 * today. A manual count is never saved, so it has to be put in by hand.
 */
export function withToday (
  history: ParticipationRecord[], today: ParticipationRecord | undefined
): ParticipationRecord[] {
  if (today === undefined) return history
  return [today, ...history.filter((record) => record.localDate !== today.localDate)]
}

/** Members whose missed days reach the threshold and who did not reply today. */
export function streaksToFlag (
  team: TeamConfig, history: ParticipationRecord[], localDate: string
): Array<Omit<NonResponderFlag, 'flaggedAt'>> {
  const candidates: Array<Omit<NonResponderFlag, 'flaggedAt'>> = []

  for (const member of team.members) {
    const missedDates = history
      .filter((record) => record.entries.some(
        (e) => e.memberId === member.memberId && e.status === 'missed'
      ))
      .map((record) => record.localDate)
      .sort()

    if (missedDates.length < team.habitualThreshold) continue

    // Did they reply on the most recent day? If so the streak is over.
    const latest = history.find((r) => r.localDate === localDate)
    const repliedToday = latest?.entries.some(
      (e) => e.memberId === member.memberId && e.status === 'responded'
    ) ?? false
    if (repliedToday) continue

    candidates.push({
      teamId: team.teamId,
      memberId: member.memberId,
      memberName: member.displayName,
      missedDates
    })
  }

  return candidates
}

async function notifyScrumMaster (team: TeamConfig, flags: NonResponderFlag[]): Promise<void> {
  const scrumMaster = team.members.find((m) => m.memberId === team.scrumMasterId)
  if (scrumMaster?.conversationRef === undefined || scrumMaster.conversationRef === '') {
    console.error('cannot flag non-responders: the Scrum Master is not reachable')
    return
  }

  const lines = flags.map(
    (f) => `- ${f.memberName}: no update on ${f.missedDates.join(', ')}`
  )
  await sendProactive(
    scrumMaster.conversationRef,
    `These team members have missed ${team.habitualThreshold} or more stand-ups in the last ${team.habitualWindowDays} days:\n\n${lines.join('\n')}`
  )
}
