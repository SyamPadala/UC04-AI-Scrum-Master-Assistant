import type { TeamConfig } from '../types.js'
import type { LlmClient } from '../llm/types.js'
import type { PmClient, SprintData } from '../pm/types.js'
import type { Tracker } from '../trackers/types.js'
import type { SummaryFacts } from '../agents/prompts/summaryBuilder.js'
import { buildSummaryText } from '../agents/summaryBuilder.js'
import { sendProactive } from '../bot/adapter.js'
import { sendMail } from '../graph/mail.js'
import { getChannelRef } from '../store/firestore.js'
import { config } from '../config/env.js'

/**
 * The end-of-day sprint summary (SPEC-006, FR-07 and FR-08).
 *
 * Code gathers every fact and does every calculation; Agent 2 turns them into
 * English; code then distributes the result. The model is given no tools and
 * no numbers to work out, so the figures in the summary are figures that can
 * be checked against Jira and the tracker.
 */

export interface DistributionResult {
  channel: 'sent' | 'skipped' | 'failed'
  email: 'sent' | 'skipped' | 'failed'
  detail: string
}

export interface SummaryResult {
  text: string
  distribution: DistributionResult
  buildMs: number
}

/**
 * A5: an item is at risk when it is not done and either carries a blocker
 * raised today or has not changed for the configured number of days.
 *
 * Both halves are computed here rather than asked of the model, because "has
 * not changed in two days" is a date comparison and a model asked to do one
 * can only guess.
 */
function atRiskItems (
  sprint: SprintData | undefined,
  blockedKeys: Set<string>,
  staleDays: number,
  now: Date
): Array<{ key: string, title: string, reason: string }> {
  if (sprint === undefined) return []
  const staleBefore = now.getTime() - staleDays * 86_400_000

  return sprint.items
    .filter((item) => item.statusCategory !== 'Done')
    .map((item) => {
      const reasons: string[] = []
      if (blockedKeys.has(item.key)) reasons.push('has an active blocker')
      if (item.updated.getTime() < staleBefore) {
        reasons.push(`no change for ${staleDays} or more days`)
      }
      return { key: item.key, title: item.title, reason: reasons.join('; ') }
    })
    .filter((item) => item.reason !== '')
}

/** Everything Agent 2 is told, assembled from the tracker and Jira. */
export async function gatherFacts (
  team: TeamConfig, tracker: Tracker, pm: PmClient, localDate: string, now: Date = new Date()
): Promise<SummaryFacts> {
  const updates = await tracker.readToday(team.teamId, localDate)

  // Sprint data is optional on purpose: SPEC-006 requires the summary to state
  // the gap rather than omit the section or invent figures.
  let sprint: SprintData | undefined
  try {
    sprint = await pm.getSprintData()
  } catch (error) {
    console.warn(JSON.stringify({ event: 'summary.sprintUnavailable', teamId: team.teamId, error: String(error) }))
  }

  const blockedKeys = new Set<string>()
  for (const update of updates) {
    for (const row of update.rows) {
      if (row.anyBlocker !== null && row.win !== null) blockedKeys.add(row.win)
    }
  }

  const responders = new Set(updates.map((update) => update.memberName))
  const missing = team.members
    .filter((member) => !responders.has(member.displayName))
    .map((member) => member.displayName)

  return {
    teamName: team.name,
    localDate,
    ...(sprint === undefined
      ? {}
      : {
          sprint: {
            name: sprint.sprintName,
            goal: sprint.goal,
            committedPoints: sprint.committedPoints,
            completedPoints: sprint.completedPoints,
            unpointedCount: sprint.unpointedCount,
            previousVelocities: sprint.previousVelocities,
            items: sprint.items.map((item) => ({
              key: item.key,
              title: item.title,
              status: item.status,
              points: item.points,
              assignee: item.assignee
            }))
          }
        }),
    updates: updates.map((update) => ({
      member: update.memberName,
      rows: update.rows.map((row) => ({
        win: row.win,
        status: row.status,
        comment: row.comment,
        blocker: row.anyBlocker
      }))
    })),
    participation: {
      responded: responders.size,
      rosterSize: team.members.length,
      missing
    },
    atRisk: atRiskItems(sprint, blockedKeys, config.agent2.staleProgressDays, now),
    staleProgressDays: config.agent2.staleProgressDays
  }
}

/**
 * FR-08. Partial-tolerant: a channel post that works still counts when the
 * email fails, and the outcome says which half happened.
 */
export async function distributeSummary (
  team: TeamConfig, localDate: string, text: string
): Promise<DistributionResult> {
  const notes: string[] = []
  let channel: DistributionResult['channel'] = 'skipped'
  let email: DistributionResult['email'] = 'skipped'

  const header = `Daily sprint summary — ${team.name} — ${localDate}`

  if (config.dryRun) {
    console.log(JSON.stringify({ event: 'summary.dryRun', teamId: team.teamId, localDate }))
    return { channel: 'skipped', email: 'skipped', detail: 'DRY_RUN: nothing was sent' }
  }

  const channelRef = await getChannelRef(team.teamId)
  if (channelRef === undefined) {
    notes.push('no stakeholder channel connected — choose one on the admin page')
  } else {
    try {
      await sendProactive(channelRef, `**${header}**\n\n${text}`)
      channel = 'sent'
    } catch (error) {
      channel = 'failed'
      notes.push(`channel post failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const recipients = team.stakeholders.emails
  if (recipients.length === 0) {
    notes.push('no stakeholder email addresses configured')
  } else if (config.summary.senderUserId === '') {
    notes.push('SUMMARY_SENDER_USER_ID is not set, so email was not attempted')
  } else {
    try {
      await sendMail(config.summary.senderUserId, recipients, header, text)
      email = 'sent'
    } catch (error) {
      email = 'failed'
      notes.push(`email failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // A team with neither route configured is a setup error, and saying so is
  // more use than reporting a summary that reached nobody as a success.
  if (channel === 'skipped' && email === 'skipped') {
    notes.push('the summary reached nobody')
  }

  return { channel, email, detail: notes.length === 0 ? `channel ${channel}, email ${email}` : notes.join('; ') }
}

/**
 * Tells the Scrum Master the summary did not get written (SPEC-006 item 10).
 *
 * A missing summary must never be mistaken for a quiet day, so somebody is
 * told that tonight's needs sending by hand.
 */
async function reportSummaryFailure (team: TeamConfig, localDate: string, reason: string): Promise<void> {
  const scrumMaster = team.members.find((member) => member.memberId === team.scrumMasterId)
  if (scrumMaster === undefined || (scrumMaster.conversationRef ?? '') === '' || config.dryRun) return
  try {
    await sendProactive(
      scrumMaster.conversationRef as string,
      `I could not build the sprint summary for ${localDate}, so nothing was sent to stakeholders. ` +
      `You will need to send it by hand today.\n\nReason: ${reason}`
    )
  } catch (error) {
    console.error(JSON.stringify({ event: 'summary.failureNoticeFailed', teamId: team.teamId, error: String(error) }))
  }
}

export async function runSummary (
  team: TeamConfig, localDate: string,
  deps: { llm: LlmClient, pm: PmClient, tracker: Tracker },
  now: Date = new Date()
): Promise<SummaryResult> {
  const facts = await gatherFacts(team, deps.tracker, deps.pm, localDate, now)

  let built
  try {
    built = await buildSummaryText(facts, deps.llm, config.agent2)
  } catch (error) {
    // No fallback summary: nothing is sent, and the failure is visible.
    await reportSummaryFailure(team, localDate, error instanceof Error ? error.message : String(error))
    throw error
  }
  const distribution = await distributeSummary(team, localDate, built.text)

  console.log(JSON.stringify({
    event: 'summary.built',
    teamId: team.teamId,
    localDate,
    buildMs: built.durationMs,
    attempts: built.attempts,
    responded: facts.participation.responded,
    rosterSize: facts.participation.rosterSize,
    atRisk: facts.atRisk.length,
    channel: distribution.channel,
    email: distribution.email
  }))

  return { text: built.text, distribution, buildMs: built.durationMs }
}
