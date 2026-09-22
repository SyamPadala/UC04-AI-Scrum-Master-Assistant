import { createHash } from 'node:crypto'
import type { TeamConfig } from '../types.js'
import type { Story } from '../pm/types.js'
import { blockerAlertCard, type BlockerLine } from '../cards/blockerAlert.js'
import { sendProactiveCard } from '../bot/adapter.js'
import { claimBlockerAlert } from '../store/firestore.js'
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

export interface BlockerAlertResult {
  sent: boolean
  suppressed: number
  reason?: string
  latencyMs?: number
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
  detectedAt: Date
): Promise<BlockerAlertResult> {
  if (blockers.length === 0) return { sent: false, suppressed: 0, reason: 'no blockers' }

  // The same blocker restated in a second message today is not news. A new day
  // is: the Scrum Master needs to know it is still live (SPEC-005 edge cases).
  const fresh: Array<{ description: string, storyRef: string | null }> = []
  let suppressed = 0
  for (const blocker of blockers) {
    const first = config.blocker.dedupe
      ? await claimBlockerAlert(team.teamId, memberId, localDate, blockerHash(blocker.description))
      : true
    if (first) fresh.push(blocker)
    else suppressed++
  }
  if (fresh.length === 0) {
    return { sent: false, suppressed, reason: 'all blockers already alerted today' }
  }

  const scrumMaster = team.members.find((member) => member.memberId === team.scrumMasterId)
  if (scrumMaster === undefined) {
    return { sent: false, suppressed, reason: 'no Scrum Master is configured for this team' }
  }
  if ((scrumMaster.conversationRef ?? '') === '') {
    // Surfaced rather than swallowed: this is a setup gap, and a silent one is
    // discovered on demo day.
    return { sent: false, suppressed, reason: `the app is not installed for ${scrumMaster.displayName}` }
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
    return { sent: true, suppressed, latencyMs: Date.now() - detectedAt.getTime() }
  }

  await sendProactiveCard(scrumMaster.conversationRef as string, blockerAlertCard(memberName, localDate, lines), fallback)

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
  return { sent: true, suppressed, latencyMs }
}
