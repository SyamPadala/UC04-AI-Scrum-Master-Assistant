import type { TeamConfig } from '../types.js'
import type { Tracker } from '../trackers/types.js'
import { isConversationGone, sendProactive } from '../bot/adapter.js'
import { clearConversationRef } from '../store/firestore.js'

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

/** The two side effects of a send, injectable so a test can fake Teams (coding rule 9). */
export interface SendDeps {
  send: (reference: string, text: string) => Promise<void>
  forget: (teamId: string, memberId: string) => Promise<void>
}

const realSend: SendDeps = { send: sendProactive, forget: clearConversationRef }

export async function messageMembers (
  team: TeamConfig, memberIds: string[], text: string, deps: SendDeps = realSend
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
      await deps.send(member.conversationRef, text)
      sent++
    } catch (error) {
      // SPEC-008 10e: a chat Teams has deleted is not a passing failure. It is
      // forgotten, so the page shows App not installed and the run names them.
      if (isConversationGone(error)) {
        await deps.forget(team.teamId, member.memberId).catch((clearError: unknown) =>
          console.error(JSON.stringify({ event: 'conversationRef.clearFailed', memberId, error: String(clearError) })))
        console.log(JSON.stringify({ event: 'conversation.gone', teamId: team.teamId, memberId }))
        unreachable.push(member.displayName)
        continue
      }
      failed++
      console.error(`send failed for ${member.displayName}`, error)
    }
  }

  const parts = [`sent ${sent}`]
  if (failed > 0) parts.push(`failed ${failed}`)
  if (unreachable.length > 0) parts.push(`not installed for: ${unreachable.join(', ')}`)

  return { sent, skipped: unreachable.length, failed, detail: parts.join('; ') }
}
