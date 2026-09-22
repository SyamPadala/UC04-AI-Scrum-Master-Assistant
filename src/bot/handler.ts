import { ActivityHandler, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import type { TeamConfig } from '../types.js'
import type { LlmClient } from '../llm/types.js'
import type { PmClient } from '../pm/types.js'
import { LlmBudgetError, LlmOfflineError } from '../llm/types.js'
import { localDate } from '../config/time.js'
import { config } from '../config/env.js'
import { saveChannelRef, saveConversationRef, teamForMember } from '../store/firestore.js'
import { trackerFor } from '../trackers/factory.js'
import { processUpdate } from '../jobs/updateIntake.js'
import { handleAdminCommand, handleCardSubmit, parseAdminCommand } from './admin.js'

/**
 * Stores what the app needs to message this person later.
 *
 * The reference is captured on every activity, not only on install: a member
 * who was added to the team before the app existed still becomes reachable the
 * first time they say anything.
 */
async function rememberSender (context: TurnContext): Promise<void> {
  const from = context.activity.from
  if (from?.id === undefined) return
  const reference = context.activity.getConversationReference()
  await saveConversationRef(
    config.teams.teamId,
    from.aadObjectId ?? from.id,
    from.name ?? 'Unknown',
    JSON.stringify(reference)
  )
}

/**
 * Captures the channel this activity came from, if it came from one.
 *
 * The end-of-day summary is posted by the bot itself, which needs a stored
 * channel reference — Graph cannot do it, because ChannelMessage.Send works
 * only with a signed-in user behind it. Without this the summary has nowhere
 * to go but email.
 */
async function rememberChannel (context: TurnContext): Promise<void> {
  if (context.activity.conversation?.conversationType !== 'channel') return
  await saveChannelRef(config.teams.teamId, JSON.stringify(context.activity.getConversationReference()))
}

/**
 * A member's message, understood and filed (SPEC-004, FR-02/03/04/06).
 *
 * The team is resolved from the sender's roster membership, not from `.env`:
 * a one-to-one Teams message carries no team, and reading the destination from
 * the environment sent every team's updates to the first team's tracker.
 */
export class ScrumAssistant extends ActivityHandler {
  constructor (
    private readonly llm: LlmClient,
    private readonly pm: PmClient
  ) {
    super()

    this.onMessage(async (context: TurnContext, next) => {
      await rememberSender(context)
      await rememberChannel(context)

      // A card Save arrives as a message with no text and a value payload.
      const submitted = context.activity.value
      if (submitted !== undefined && submitted !== null && typeof submitted === 'object') {
        const payload = submitted as Record<string, unknown>
        if (payload.command === 'saveConfig') {
          await handleCardSubmit(payload, context)
          await next()
          return
        }
      }

      const text = (context.activity.text ?? '').trim()
      const memberName = context.activity.from?.name ?? 'Unknown'
      const memberId = context.activity.from?.aadObjectId ?? context.activity.from?.id ?? ''

      if (text === '') {
        await next()
        return
      }

      // Admin words are commands, not stand-up updates. Checked before any
      // extraction so 'setup' is never recorded as someone's status — and
      // never sent to the model, which would cost a call to learn nothing.
      const command = parseAdminCommand(text)
      if (command !== undefined) {
        await handleAdminCommand(command, context)
        await next()
        return
      }

      await this.recordUpdate(context, memberId, memberName, text)
      await next()
    })

    this.onMembersAdded(async (context: TurnContext, next) => {
      for (const member of context.activity.membersAdded ?? []) {
        if (member.id !== context.activity.recipient?.id) {
          await rememberSender(context)
          await rememberChannel(context)
          await context.sendActivity(MessageFactory.text(
            'Scrum Assistant is installed. Send me your status update and I will record it. ' +
            'Type **help** to see what else I can do.'
          ))
        }
      }
      await next()
    })
  }

  private async recordUpdate (
    context: TurnContext, memberId: string, memberName: string, text: string
  ): Promise<void> {
    let team: TeamConfig | undefined
    try {
      team = await teamForMember(memberId)
    } catch (error) {
      // Overlapping rosters are a configuration error, and guessing which team
      // the person meant would file their update in the wrong tracker.
      console.error(JSON.stringify({ event: 'team.resolveFailed', memberId, error: String(error) }))
      await context.sendActivity(MessageFactory.text(
        'I could not work out which team you are on. Ask your Scrum Master to check the roster.'
      ))
      return
    }

    if (team === undefined) {
      console.log(JSON.stringify({ event: 'update.notOnRoster', memberId }))
      await context.sendActivity(MessageFactory.text(
        'You are not on a team roster I know about, so I have not recorded that. ' +
        'Ask your Scrum Master to add you.'
      ))
      return
    }

    const today = localDate(new Date(), team.timezone)

    try {
      const result = await processUpdate(team, memberId, memberName, text, today, {
        llm: this.llm,
        pm: this.pm,
        tracker: trackerFor(team)
      })

      const parts = [`Recorded your update, ${memberName}.`]
      // Says what this message added *and* what the day now holds, so a member
      // adding a forgotten ticket can see their earlier rows are still there.
      parts.push(result.added === result.rows
        ? `${result.rows} ${result.rows === 1 ? 'item' : 'items'} in the tracker for ${today}.`
        : `Added ${result.added}; you now have ${result.rows} items in the tracker for ${today}.`)
      if (result.blockers > 0) {
        parts.push(result.alertSent
          ? 'Your Scrum Master has been told about the blocker.'
          : 'I could not reach your Scrum Master about the blocker; it is recorded in the tracker.')
      }
      if (result.truncated) {
        parts.push('Your message was long, so only the first part was read.')
      }
      await context.sendActivity(MessageFactory.text(parts.join(' ')))
    } catch (error) {
      await this.reportFailure(context, memberId, error)
    }
  }

  /**
   * Tells the member plainly and records why.
   *
   * There is no fallback extraction: when the model fails, nothing is written
   * and the member is asked to resend (SPEC-004 item 9). Writing a guess here
   * would put unverified content in the tracker and make the failure invisible.
   */
  private async reportFailure (context: TurnContext, memberId: string, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'update.failed', memberId, error: detail }))

    if (error instanceof LlmOfflineError) {
      await context.sendActivity(MessageFactory.text(
        'I cannot read updates at the moment — the assistant is running with its ' +
        'language model switched off. Your Scrum Master has been notified in the logs.'
      ))
      return
    }
    if (error instanceof LlmBudgetError) {
      await context.sendActivity(MessageFactory.text(
        'I have reached my daily limit for reading updates, so I have not recorded that. ' +
        'Please tell your Scrum Master.'
      ))
      return
    }
    await context.sendActivity(MessageFactory.text(
      'I could not process that update, so nothing was recorded. Please send it again in a moment.'
    ))
  }
}
