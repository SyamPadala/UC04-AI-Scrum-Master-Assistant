import { ActivityHandler, CardFactory, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import { Activity } from '@microsoft/agents-activity'
import type { TeamConfig } from '../types.js'
import type { LlmClient } from '../llm/types.js'
import type { PmClient } from '../pm/types.js'
import { pmFor } from '../pm/factory.js'
import { TrackerNotSetError } from '../trackers/unset.js'
import { LlmBudgetError, LlmOfflineError } from '../llm/types.js'
import { localDate } from '../config/time.js'
import {
  saveBotTeam, saveChannelRef, saveConversationRef, saveScrumMasterRef, teamForChannel, teamForMember, teamsRunBy
} from '../store/index.js'
import { channelReference, teamOfActivity } from './channels.js'
import { trackerFor } from '../trackers/factory.js'
import { processUpdate, StandupClosedError } from '../jobs/updateIntake.js'
import { handleAdminCommand, parseAdminCommand } from './admin.js'
import { intakeReply } from './replies.js'
import { isForeignItemPress, parseStoryChoice, recordChoice } from '../jobs/foreignItem.js'
import { storyChoiceCard } from '../cards/storyChoice.js'
import { GraphUnavailableError, withGraphRetryNotice } from '../graph/client.js'
import { handOff, type HandedOffUpdate } from './handoff.js'

/** SPEC-004 item 41 (M4): the instant answer, replaced by the result. */
const WORKING_NOTICE = 'Got it, working on it…'

/** SPEC-002 item 5a: said once when a tracker call is being retried. */
const SLOW_TRACKER_NOTICE = "The tracker is responding slowly, retrying… your update isn't lost yet."

/** Runs work for one member's message, telling them once if the tracker has to be retried. */
async function telling<T> (context: TurnContext, work: () => Promise<T>): Promise<T> {
  return await withGraphRetryNotice(async () => { await context.sendActivity(MessageFactory.text(SLOW_TRACKER_NOTICE)) }, work)
}

/**
 * What a member is told once the day has closed (A14).
 *
 * Names the Scrum Master as the way through, so the message is an instruction
 * rather than a refusal. Kept here as one string: the wording is the Scrum
 * Master's to change, and there is only one place to change it.
 */
const CLOSED_NOTICE =
  "Today's stand-up is closed — the daily summary has already gone out, so I have not recorded that. " +
  'Please speak to your Scrum Master about anything you still need to report.'

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
  const memberId = from.aadObjectId ?? from.id
  const reference = context.activity.getConversationReference()

  // A Scrum Master is not on any roster (SPEC-008 10f). Their chat is kept once
  // per person, so alerts from every team they run can reach them (10g).
  try {
    if ((await teamsRunBy(memberId)).length > 0) {
      await saveScrumMasterRef(memberId, from.name, JSON.stringify(reference))
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'scrumMaster.saveRefFailed', memberId, error: String(error) }))
  }

  // Stored against the sender's own team (FR-10). Someone on no roster is not
  // added to one: joining a team is the Scrum Master's decision, not a side
  // effect of installing the app. Overlapping rosters are reported by
  // recordUpdate, so they are only logged here.
  let team: TeamConfig | undefined
  try {
    team = await teamForMember(memberId)
  } catch (error) {
    console.error(JSON.stringify({ event: 'team.resolveFailed', memberId, error: String(error) }))
    return
  }
  if (team === undefined) {
    console.log(JSON.stringify({ event: 'sender.notOnRoster', memberId }))
    return
  }

  await saveConversationRef(team.teamId, memberId, from.name, JSON.stringify(reference))
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
  const conversation = context.activity.conversation
  if (conversation?.conversationType !== 'channel') return

  // Any activity in a Teams team — the install itself included — makes that
  // team's channels choosable on the admin page (SPEC-008 behaviour 6).
  const teamsTeam = teamOfActivity(context.activity.channelData)
  if (teamsTeam !== undefined) {
    await saveBotTeam({
      teamThreadId: teamsTeam.id,
      name: teamsTeam.name ?? 'Unnamed team',
      reference: JSON.stringify(context.activity.getConversationReference()),
      seenAt: new Date()
    })
    console.log(JSON.stringify({ event: 'channel.teamSeen', teamThreadId: teamsTeam.id }))
  }

  // A reply in a thread carries ';messageid=...' after the channel id.
  const channelId = conversation.id.split(';')[0]
  const team = await teamForChannel(channelId)
  if (team === undefined) {
    // Not any team's stakeholder channel. Storing it would redirect that
    // team's summary into a channel its stakeholders may not be in.
    console.log(JSON.stringify({ event: 'channel.notConfigured', channelId }))
    return
  }
  await saveChannelRef(team.teamId, channelReference(context.activity.getConversationReference(), channelId))
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
    /** Each team's own Jira project (M10); injected so tests can substitute it. */
    private readonly pmOf: (team: TeamConfig) => PmClient = pmFor
  ) {
    super()

    this.onMessage(async (context: TurnContext, next) => {
      // A channel is a discussion forum, not a stand-up. Nothing said there is
      // a status update, so the only thing taken from it is the channel itself,
      // which is where the summary is posted. Taking the sender from here too
      // would replace their personal chat with the channel and send their next
      // reminder to the whole team.
      if (context.activity.conversation?.conversationType === 'channel') {
        await rememberChannel(context)
        await next()
        return
      }

      await rememberSender(context)

      const text = (context.activity.text ?? '').trim()
      const memberName = context.activity.from?.name ?? 'Unknown'
      const memberId = context.activity.from?.aadObjectId ?? context.activity.from?.id ?? ''

      // SPEC-004 14a: Submit or Cancel on the "someone else's story" card
      // arrives as a message with the button's data and no text.
      // SPEC-004 item 38: Submit or None of these on "These stories could fit…".
      const choice = parseStoryChoice(context.activity.value)
      if (choice !== undefined) {
        await this.answerPress(context, memberId, (team, today) =>
          recordChoice(team, memberId, memberName, choice, today, { pm: this.pmOf(team), tracker: trackerFor(team) }))
        await next()
        return
      }
      if (isForeignItemPress(context.activity.value)) {
        await context.sendActivity(MessageFactory.text(
          "Sorry, I couldn't read that button press, so nothing was recorded. Please send the update again."
        ))
        await next()
        return
      }

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

      await this.acceptUpdate(context, memberId, memberName, text)
      await next()
    })

    this.onMembersAdded(async (context: TurnContext, next) => {
      // In a Teams team the sender is whoever installed the app or added
      // someone. Storing their reference from here replaced that person's
      // personal chat with the channel, so their next reminder went to the
      // whole team. A team install only tells us where the channels are.
      if (context.activity.conversation?.conversationType === 'channel') {
        await rememberChannel(context)
        await next()
        return
      }

      for (const member of context.activity.membersAdded ?? []) {
        if (member.id !== context.activity.recipient?.id) {
          await rememberSender(context)
          await context.sendActivity(MessageFactory.text(
            'Scrum Assistant is installed. Send me your status update and I will record it. ' +
            'Type **help** to see what else I can do.'
          ))
        }
      }
      await next()
    })
  }

  /**
   * SPEC-004 item 41 (M4): answer at once, then hand the work over. If the
   * hand-over is not possible, the update is processed here as before, and the
   * result still replaces the "working on it" line.
   */
  private async acceptUpdate (context: TurnContext, memberId: string, memberName: string, text: string): Promise<void> {
    const ack = await context.sendActivity(MessageFactory.text(WORKING_NOTICE))
    const ackId = ack?.id
    if (ackId !== undefined && ackId !== '' &&
      await handOff({ reference: context.activity.getConversationReference(), ackId, memberId, memberName, text })) return
    await this.recordUpdate(context, memberId, memberName, text, ackId)
  }

  /** The handed-over update, now in a context of its own (M4). */
  async processHandedOff (context: TurnContext, update: HandedOffUpdate): Promise<void> {
    await this.recordUpdate(context, update.memberId, update.memberName, update.text, update.ackId)
  }

  private async recordUpdate (
    context: TurnContext, memberId: string, memberName: string, text: string, ackId?: string
  ): Promise<void> {
    // M4: the first reply replaces "Got it, working on it…", so the member ends
    // with one message; anything after it (cards, notices) follows below.
    let pending = ackId
    const say = async (reply: string): Promise<void> => {
      const id = pending
      pending = undefined
      if (id !== undefined && id !== '') {
        const replaced = await context.updateActivity(Activity.fromObject({ type: 'message', id, text: reply })).then(() => true, () => false)
        if (replaced) return
      }
      await context.sendActivity(MessageFactory.text(reply))
    }
    let team: TeamConfig | undefined
    try {
      team = await teamForMember(memberId)
    } catch (error) {
      // Overlapping rosters are a configuration error, and guessing which team
      // the person meant would file their update in the wrong tracker.
      console.error(JSON.stringify({ event: 'team.resolveFailed', memberId, error: String(error) }))
      await say('I could not work out which team you are on. Ask your Scrum Master to check the roster.')
      return
    }

    if (team === undefined) {
      // SPEC-008 10k: a Scrum Master runs the stand-up; they don't report in it.
      const run = await teamsRunBy(memberId).catch(() => [])
      if (run.length > 0) {
        await say(
          `You're the Scrum Master of ${run.map((t) => t.name).join(', ')}. Scrum Masters don't send stand-up updates, so I haven't recorded that. ` +
          'Type **help** to see what you can do here.'
        )
        return
      }
      console.log(JSON.stringify({ event: 'update.notOnRoster', memberId }))
      await say(
        'You are not on a team roster I know about, so I have not recorded that. ' +
        'Ask your Scrum Master to add you.'
      )
      return
    }

    const today = localDate(new Date(), team.timezone)

    try {
      const result = await telling(context, async () => await processUpdate(team, memberId, memberName, text, today, {
        llm: this.llm,
        pm: this.pmOf(team),
        tracker: trackerFor(team)
      }))

      // SPEC-004 items 12–20: one reply saying what was written, item by item,
      // and why anything else was not.
      await say(intakeReply(result, memberName))
      // Item 38: one card per item that is not clearly her own story.
      for (const item of result.choices) {
        const card = MessageFactory.attachment(CardFactory.adaptiveCard(storyChoiceCard(item, team.teamId, today, memberId)))
        card.summary = 'Which story is this?'
        await context.sendActivity(card)
      }
    } catch (error) {
      // A14: closing time is not a failure. The member is told plainly where
      // to go instead, and nothing is recorded for the day.
      if (error instanceof StandupClosedError) {
        console.log(JSON.stringify({
          event: 'update.standupClosed', teamId: team.teamId, memberId, localDate: today
        }))
        await say(CLOSED_NOTICE)
        return
      }
      await this.reportFailure(context, memberId, error, say)
    }
  }

  /**
   * Answers one card press: records through `record`, then replaces the card
   * with the outcome so its buttons can't be pressed again (item 28).
   */
  private async answerPress (
    context: TurnContext, memberId: string, record: (team: TeamConfig, today: string) => Promise<string>
  ): Promise<void> {
    let team: TeamConfig | undefined
    try {
      team = await teamForMember(memberId)
    } catch {
      team = undefined
    }
    if (team === undefined) {
      await context.sendActivity(MessageFactory.text('You are not on a team roster I know about, so nothing was recorded.'))
      return
    }
    const today = localDate(new Date(), team.timezone)
    let reply: string
    try {
      reply = await telling(context, async () => await record(team as TeamConfig, today))
    } catch (error) {
      if (error instanceof StandupClosedError) {
        await context.sendActivity(MessageFactory.text(CLOSED_NOTICE))
        return
      }
      await this.reportFailure(context, memberId, error)
      return
    }
    // Replace the card with the outcome, so its buttons can't be pressed again.
    // SPEC-004 item 28: one reply per press — a separate message only when Teams
    // refuses the replacement (sending both showed every outcome twice).
    const cardId = context.activity.replyToId
    let replaced = false
    if (cardId !== undefined && cardId !== '') {
      replaced = await context.updateActivity(Activity.fromObject({ type: 'message', id: cardId, text: reply }))
        .then(() => true, () => false)
    }
    if (!replaced) await context.sendActivity(MessageFactory.text(reply))
  }

  /**
   * Tells the member plainly and records why.
   *
   * There is no fallback extraction: when the model fails, nothing is written
   * and the member is asked to resend (SPEC-004 item 9). Writing a guess here
   * would put unverified content in the tracker and make the failure invisible.
   */
  private async reportFailure (
    context: TurnContext, memberId: string, error: unknown,
    say: (reply: string) => Promise<void> = async (reply) => { await context.sendActivity(MessageFactory.text(reply)) }
  ): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'update.failed', memberId, error: detail }))

    if (error instanceof LlmOfflineError) {
      await say(
        'I cannot read updates at the moment — the assistant is running with its ' +
        'language model switched off. Your Scrum Master has been notified in the logs.'
      )
      return
    }
    if (error instanceof GraphUnavailableError) {
      await say(
        "I couldn't reach the tracker, so your update wasn't recorded. Please send it again in a few minutes."
      )
      return
    }
    if (error instanceof TrackerNotSetError) {
      await say(
        "Your team's tracker hasn't been set up yet, so I couldn't record that. Please tell your Scrum Master."
      )
      return
    }
    if (error instanceof LlmBudgetError) {
      await say(
        'I have reached my daily limit for reading updates, so I have not recorded that. ' +
        'Please tell your Scrum Master.'
      )
      return
    }
    await say(
      'I could not process that update, so nothing was recorded. Please send it again in a moment.'
    )
  }
}
