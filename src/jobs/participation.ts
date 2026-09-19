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
  team: TeamConfig, tracker: Tracker, localDate: string
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

  await saveParticipation(record)
  return record
}

/**
 * FR-09 / A3: tells the Scrum Master about repeat non-responders.
 *
 * A member is flagged once per streak, not once per day — otherwise the Scrum
 * Master is told the same thing every morning and stops reading it. Replying
 * again ends the streak, and the next miss starts a fresh one.
 */
export async function flagHabitualNonResponders (
  team: TeamConfig, localDate: string
): Promise<NonResponderFlag[]> {
  const history = await recentParticipation(team.teamId, team.habitualWindowDays, team.timezone)
  const flags: NonResponderFlag[] = []

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

    if (await alreadyFlagged(team.teamId, member.memberId, missedDates)) continue

    const flag: NonResponderFlag = {
      teamId: team.teamId,
      memberId: member.memberId,
      memberName: member.displayName,
      missedDates,
      flaggedAt: new Date()
    }
    await saveFlag(flag)
    flags.push(flag)
  }

  if (flags.length > 0) await notifyScrumMaster(team, flags)
  return flags
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
