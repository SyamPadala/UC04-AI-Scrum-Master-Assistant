import { CardFactory, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import type { TeamConfig } from '../types.js'
import { adminSetupCard, adminStatusCard } from '../cards/adminCards.js'
import { getTeam, recordConfigChange, runsForDate, saveTeam } from '../store/firestore.js'
import { localDate } from '../config/time.js'
import { config } from '../config/env.js'
import { runJobNow } from '../jobs/tick.js'
import type { JobType } from '../types.js'

export type AdminCommand = 'setup' | 'status' | 'pause' | 'resume' | 'help' | 'run'

const COMMANDS: AdminCommand[] = ['setup', 'status', 'pause', 'resume', 'help']

const JOB_TYPES: JobType[] = ['reminder', 'followup', 'summary', 'participation']

/** Recognises an admin command, or returns undefined if this is an ordinary message. */
export function parseAdminCommand (text: string): AdminCommand | undefined {
  const word = text.trim().toLowerCase()
  const exact = COMMANDS.find((c) => c === word)
  if (exact !== undefined) return exact

  // 'run' takes one word after it. Anything longer is a sentence a member
  // wrote — "run through the backlog with me" is an update, not a command,
  // and treating it as one would silently lose their day's work.
  return /^run(\s+\S+)?$/.test(word) ? 'run' : undefined
}

/** The job named after `run`, or undefined when it is missing or not a job. */
export function parseJobArgument (text: string): JobType | undefined {
  const argument = text.trim().toLowerCase().replace(/^run\s*/, '').trim()
  return JOB_TYPES.find((job) => job === argument)
}

/** Only the team's Scrum Master, or a configured admin, may change settings. */
function mayConfigure (team: TeamConfig, senderId: string): boolean {
  return senderId === team.scrumMasterId || config.admin.userIds.includes(senderId)
}

function senderIdOf (context: TurnContext): string {
  return context.activity.from?.aadObjectId ?? context.activity.from?.id ?? ''
}

export async function handleAdminCommand (command: AdminCommand, context: TurnContext): Promise<void> {
  const team = await getTeam(config.teams.teamId)
  if (team === undefined) {
    await context.sendActivity(MessageFactory.text('No team is configured yet.'))
    return
  }

  if (command === 'help') {
    await context.sendActivity(MessageFactory.text(
      'I record your stand-up update — just tell me what you worked on.\n\n' +
      'The Scrum Master can also use: **setup** to change settings, **status** to see ' +
      'what ran today, **pause** / **resume** to stop and restart the daily messages, ' +
      'and **run reminder** (or followup, summary, participation) to trigger one now — ' +
      'a manual run for testing, which leaves the scheduled day untouched.'
    ))
    return
  }

  if (command === 'status') {
    const today = localDate(new Date(), team.timezone)
    const runs = await runsForDate(team.teamId, today)
    await context.sendActivity(MessageFactory.attachment(
      CardFactory.adaptiveCard(adminStatusCard(team, today, runs))
    ))
    return
  }

  if (!mayConfigure(team, senderIdOf(context))) {
    await context.sendActivity(MessageFactory.text(
      'Only the Scrum Master can change these settings.'
    ))
    return
  }

  // A development aid, not part of the daily cycle: the scheduler runs each job
  // once at its set time, so testing one otherwise means waiting for the clock.
  // Runs the same code the scheduler runs, and works while paused. Isolated
  // from the scheduled cycle: it does not use up today's scheduled job and does
  // not close the stand-up.
  if (command === 'run') {
    const jobType = parseJobArgument(context.activity.text ?? '')
    if (jobType === undefined) {
      await context.sendActivity(MessageFactory.text(
        `Tell me which one to run: ${JOB_TYPES.map((j) => `**run ${j}**`).join(', ')}.`
      ))
      return
    }

    await context.sendActivity(MessageFactory.text(
      `Running the ${jobType} now, as a manual run. Today's scheduled ${jobType} still goes out at its usual time.`
    ))
    try {
      const entry = await runJobNow(team, jobType)
      await context.sendActivity(MessageFactory.text(
        `Manual ${jobType}: ${entry.outcome}${entry.detail === undefined ? '' : ` — ${entry.detail}`}`
      ))
    } catch (error) {
      await context.sendActivity(MessageFactory.text(
        `The ${jobType} could not be run: ${error instanceof Error ? error.message : String(error)}`
      ))
    }
    return
  }

  if (command === 'setup') {
    await context.sendActivity(MessageFactory.attachment(
      CardFactory.adaptiveCard(adminSetupCard(team))
    ))
    return
  }

  // pause / resume
  const active = command === 'resume'
  if (team.active === active) {
    await context.sendActivity(MessageFactory.text(
      active ? 'The assistant is already running.' : 'The assistant is already paused.'
    ))
    return
  }

  await applyConfig(team, { active }, context)
  await context.sendActivity(MessageFactory.text(
    active
      ? 'Resumed. Stand-up reminders will go out again from the next scheduled time.'
      : 'Paused. No reminders, follow-ups or summaries will be sent until you resume.'
  ))
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** Values submitted from the card arrive as strings and are not trusted. */
export async function handleCardSubmit (value: Record<string, unknown>, context: TurnContext): Promise<void> {
  const team = await getTeam(config.teams.teamId)
  if (team === undefined) {
    await context.sendActivity(MessageFactory.text('No team is configured yet.'))
    return
  }

  if (!mayConfigure(team, senderIdOf(context))) {
    await context.sendActivity(MessageFactory.text('Only the Scrum Master can change these settings.'))
    return
  }

  const standupTime = String(value.standupTime ?? '').trim()
  const summaryTime = String(value.summaryTime ?? '').trim()
  const timezone = String(value.timezone ?? '').trim()
  const grace = Number(value.gracePeriodMinutes)
  const active = String(value.active ?? 'true') === 'true'
  const emails = String(value.stakeholderEmails ?? '')
    .split(',').map((e) => e.trim()).filter((e) => e !== '')

  const problems: string[] = []
  if (!TIME_PATTERN.test(standupTime)) problems.push('Stand-up time must look like 09:00.')
  if (!TIME_PATTERN.test(summaryTime)) problems.push('Summary time must look like 18:00.')
  if (!Number.isInteger(grace) || grace < 5 || grace > 1440) {
    problems.push('Follow-up delay must be a whole number of minutes between 5 and 1440.')
  }
  // An unknown timezone would make every schedule comparison throw at tick time,
  // long after the person who typed it has walked away.
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone })
  } catch {
    problems.push(`"${timezone}" is not a timezone I recognise. Try Asia/Kolkata.`)
  }

  if (problems.length > 0) {
    await context.sendActivity(MessageFactory.text(
      `I did not save that:\n\n${problems.map((p) => `- ${p}`).join('\n')}`
    ))
    return
  }

  const changed = await applyConfig(
    team,
    { standupTime, summaryTime, timezone, gracePeriodMinutes: grace, active,
      stakeholders: { ...team.stakeholders, emails } },
    context
  )

  if (changed.length === 0) {
    await context.sendActivity(MessageFactory.text('Nothing changed.'))
    return
  }

  await context.sendActivity(MessageFactory.text(
    `Saved:\n\n${changed.map((c) => `- ${c}`).join('\n')}\n\nThe next check will use these settings.`
  ))
}

/**
 * Writes the change and records who made it.
 *
 * SPEC-008 requires an audit line per change: a misconfigured demo is much
 * easier to explain when you can see what was changed and by whom.
 */
async function applyConfig (
  team: TeamConfig, patch: Partial<TeamConfig>, context: TurnContext
): Promise<string[]> {
  const fields: Array<{ field: string, from: unknown, to: unknown }> = []
  const described: string[] = []

  for (const [key, next] of Object.entries(patch)) {
    const before = (team as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(before) === JSON.stringify(next)) continue
    fields.push({ field: key, from: before, to: next })
    described.push(`${key}: ${JSON.stringify(before)} → ${JSON.stringify(next)}`)
  }

  if (fields.length === 0) return []

  await saveTeam({ ...team, ...patch })
  await recordConfigChange({
    teamId: team.teamId,
    changedBy: context.activity.from?.name ?? 'unknown',
    changedAt: new Date(),
    fields
  })
  return described
}
