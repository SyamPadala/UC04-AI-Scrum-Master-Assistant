import { createHash } from 'node:crypto'
import type { TeamConfig } from '../types.js'
import type { Story } from '../pm/types.js'
import { blockerAlertCard, type BlockerLine, type OpenItemLine } from '../cards/blockerAlert.js'
import { isConversationGone, sendProactiveCard } from '../bot/adapter.js'
import { claimBlockerAlert, forgetScrumMasterChat, releaseBlockerAlert, scrumMasterOf } from '../store/firestore.js'
import { config } from '../config/env.js'

/**
 * FR-06: the Scrum Master is told about a blocker the moment it is reported.
 *
 * Code sends this, not the agent. Agents hold no send tool at all (coding rule
 * 15); Agent 1 only concludes that a blocker exists, and this decides what
 * happens next.
 *
 * Sent inside update processing so it lands within the same 30-second budget
 * (A1), comfortably inside the PRD's five-minute metric.
 */

/**
 * Why an alert was or was not sent, as a fixed code (design review, 8 Oct
 * 2026): callers decide on the code, never on the wording of `reason`, which
 * is for logs and people only.
 */
export type AlertCode = 'sent' | 'noBlockers' | 'alreadyAlerted' | 'noScrumMaster' | 'appNotInstalled'

export interface BlockerAlertResult {
  sent: boolean
  code: AlertCode
  suppressed: number
  reason?: string
  latencyMs?: number
}

/** True when the Scrum Master has heard about these blockers, now or earlier today. */
export function scrumMasterKnows (result: Pick<BlockerAlertResult, 'sent' | 'code'>): boolean {
  return result.sent || result.code === 'alreadyAlerted'
}

/**
 * Identifies a blocker without storing its text.
 *
 * The description is update content, so it may not be written to Firestore
 * (Privacy NFR). A hash of the normalised text is enough to recognise the same
 * blocker restated later the same day.
 */
function blockerHash (description: string): string {
  const normalised = description.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16)
}

export async function sendBlockerAlert (
  team: TeamConfig,
  memberId: string,
  memberName: string,
  localDate: string,
  blockers: Array<{ description: string, storyRef: string | null }>,
  stories: Map<string, Story>,
  detectedAt: Date,
  /** The member's open sprint items, listed when a blocker names none (SPEC-005 2a). */
  openItems: OpenItemLine[] = []
): Promise<BlockerAlertResult> {
  if (blockers.length === 0) return { sent: false, code: 'noBlockers', suppressed: 0, reason: 'no blockers' }

  // The same blocker restated in a second message today is not news. A new day
  // is: the Scrum Master needs to know it is still live (SPEC-005 edge cases).
  const fresh: Array<{ description: string, storyRef: string | null }> = []
  const claimed: string[] = []
  let suppressed = 0
  for (const blocker of blockers) {
    const hash = blockerHash(blocker.description)
    const outcome = config.blocker.dedupe ? await claimBlockerAlert(team.teamId, memberId, localDate, hash) : 'error'
    if (outcome === 'already') {
      suppressed++
      continue
    }
    // SPEC-005 2b: a store error is not "already alerted" — send anyway.
    fresh.push(blocker)
    if (outcome === 'claimed') claimed.push(hash)
  }
  if (fresh.length === 0) {
    return { sent: false, code: 'alreadyAlerted', suppressed, reason: 'all blockers already alerted today' }
  }

  // SPEC-005 2b (M1): whatever stops the send, the claims taken above are
  // released, so the next mention of the blocker tries again.
  const notSent = async (code: AlertCode, reason: string): Promise<BlockerAlertResult> => {
    await Promise.all(claimed.map(async (hash) => await releaseBlockerAlert(team.teamId, memberId, localDate, hash)))
      .catch((error: unknown) => console.error(JSON.stringify({ event: 'blockerAlert.releaseFailed', teamId: team.teamId, memberId, error: String(error) })))
    return { sent: false, code, suppressed, reason }
  }

  // A role, not a roster entry (SPEC-008 10f): read from where their chat is kept.
  const scrumMaster = await scrumMasterOf(team)
  if (scrumMaster === undefined) {
    return await notSent('noScrumMaster', 'no Scrum Master is configured for this team')
  }
  if ((scrumMaster.conversationRef ?? '') === '') {
    // Surfaced rather than swallowed: this is a setup gap, and a silent one is
    // discovered on demo day.
    return await notSent('appNotInstalled', `the app is not installed for ${scrumMaster.displayName}`)
  }

  const lines: BlockerLine[] = fresh.map((blocker) => {
    const story = blocker.storyRef === null ? undefined : stories.get(blocker.storyRef)
    return {
      description: blocker.description,
      storyRef: blocker.storyRef,
      storyTitle: story?.title ?? null,
      storyUrl: story?.url ?? null
    }
  })

  const fallback = `${memberName} reported ${fresh.length === 1 ? 'a blocker' : `${fresh.length} blockers`}`

  if (config.dryRun) {
    console.log(JSON.stringify({
      event: 'blockerAlert.dryRun', teamId: team.teamId, memberId, count: fresh.length
    }))
    return { sent: true, code: 'sent', suppressed, latencyMs: Date.now() - detectedAt.getTime() }
  }

  try {
    await sendProactiveCard(scrumMaster.conversationRef as string, blockerAlertCard(memberName, localDate, lines, openItems), fallback)
  } catch (error) {
    // SPEC-008 10e: the Scrum Master's chat is gone. Forget it so the page
    // shows it, and say so rather than reporting a generic failure.
    if (!isConversationGone(error)) {
      await notSent('appNotInstalled', 'send failed')
      throw error
    }
    await forgetScrumMasterChat(team).catch(() => {})
    return await notSent('appNotInstalled', `the app is not installed for ${scrumMaster.displayName}`)
  }

  const latencyMs = Date.now() - detectedAt.getTime()
  // The evidence for the "notified within 5 minutes" metric. It has to be a
  // real measurement, so it is taken here rather than asserted anywhere.
  console.log(JSON.stringify({
    event: 'blockerAlert.sent',
    teamId: team.teamId,
    memberId,
    blockers: fresh.length,
    suppressed,
    latencyMs
  }))
  return { sent: true, code: 'sent', suppressed, latencyMs }
}
