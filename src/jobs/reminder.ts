import type { TeamConfig } from '../types.js'
import type { Tracker } from '../trackers/types.js'
import { sendProactive } from '../bot/adapter.js'

export interface JobResult {
  sent: number
  skipped: number
  failed: number
  detail: string
}

const REMINDER_TEXT =
  'Good morning. What did you work on yesterday, what are you on today, and is anything blocking you? ' +
  'Reply in your own words — no particular format needed.'

const FOLLOWUP_TEXT =
  'A reminder that your stand-up update has not come in yet. Reply whenever you get a moment.'

/** FR-01: the daily stand-up reminder, sent to every member of the team. */
export async function sendReminders (team: TeamConfig): Promise<JobResult> {
  return await messageMembers(team, team.members.map((m) => m.memberId), REMINDER_TEXT)
}

/**
 * FR-05: chases only those who have not answered.
 *
 * Who has answered is read from the tracker, not from Firestore — the update
 * content lives in the tracker and nowhere else (Privacy NFR).
 */
export async function sendFollowUps (
  team: TeamConfig, tracker: Tracker, localDate: string
): Promise<JobResult> {
  const updates = await tracker.readToday(team.teamId, localDate)
  const responded = new Set(updates.map((u) => u.memberName))
  const pending = team.members.filter((m) => !responded.has(m.displayName))

  if (pending.length === 0) {
    return { sent: 0, skipped: 0, failed: 0, detail: 'everyone had already responded' }
  }
  return await messageMembers(team, pending.map((m) => m.memberId), FOLLOWUP_TEXT)
}

async function messageMembers (
  team: TeamConfig, memberIds: string[], text: string
): Promise<JobResult> {
  let sent = 0
  let failed = 0
  const unreachable: string[] = []

  for (const memberId of memberIds) {
    const member = team.members.find((m) => m.memberId === memberId)
    if (member === undefined) continue

    // A member without a conversation reference has never had the app
    // installed. Report it: silently skipping them is how a demo half-works.
    if (member.conversationRef === undefined || member.conversationRef === '') {
      unreachable.push(member.displayName)
      continue
    }

    try {
      await sendProactive(member.conversationRef, text)
      sent++
    } catch (error) {
      failed++
      console.error(`send failed for ${member.displayName}`, error)
    }
  }

  const parts = [`sent ${sent}`]
  if (failed > 0) parts.push(`failed ${failed}`)
  if (unreachable.length > 0) parts.push(`not installed for: ${unreachable.join(', ')}`)

  return { sent, skipped: unreachable.length, failed, detail: parts.join('; ') }
}
