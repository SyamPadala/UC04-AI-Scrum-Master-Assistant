import { CardFactory, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import type { TeamConfig } from '../types.js'
import { adminStatusCard } from '../cards/adminCards.js'
import { runsForDate, teamForMember } from '../store/firestore.js'
import { applyChange } from '../admin/service.js'
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

/**
 * The team this sender belongs to (FR-10).
 *
 * Settings and status are always for the sender's own team. Reading a fixed
 * team id from the server settings let any team's Scrum Master open, and
 * change, the first team's configuration.
 */
async function teamOfSender (context: TurnContext): Promise<TeamConfig | undefined> {
  try {
    const team = await teamForMember(senderIdOf(context))
    if (team === undefined) {
      await context.sendActivity(MessageFactory.text(
        'You are not on a team roster I know about. Ask your Scrum Master to add you.'
      ))
    }
    return team
  } catch {
    await context.sendActivity(MessageFactory.text(
      'I could not work out which team you are on. Ask your Scrum Master to check the roster.'
    ))
    return undefined
  }
}

export async function handleAdminCommand (command: AdminCommand, context: TurnContext): Promise<void> {
  const team = await teamOfSender(context)
  if (team === undefined) return

  if (command === 'help') {
    await context.sendActivity(MessageFactory.text(
      'I record your stand-up update — just tell me what you worked on.\n\n' +
      'The Scrum Master can also use: **setup** for the admin page link, **status** to see ' +
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

  // Configuration lives on the admin page now (SPEC-008 behaviour 13).
  if (command === 'setup') {
    await context.sendActivity(MessageFactory.text(
      config.admin.publicBaseUrl === ''
        ? 'Settings are managed on the admin page, which is not configured on this server yet.'
        : `Team members, stakeholders and the schedule are managed on the admin page: ${config.admin.publicBaseUrl}/admin`
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

/** Pause and resume are recorded like any other change (SPEC-008 behaviour 12). */
async function applyConfig (
  team: TeamConfig, patch: Partial<TeamConfig>, context: TurnContext
): Promise<string[]> {
  return await applyChange(team, patch, context.activity.from?.name ?? 'unknown')
}
