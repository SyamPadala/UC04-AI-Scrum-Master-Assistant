import { ActivityHandler, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import type { StandupUpdate, Tracker } from '../trackers/types.js'
import { localDate } from '../config/time.js'
import { config } from '../config/env.js'
import { saveConversationRef } from '../store/firestore.js'
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
 * First working slice: a member's message is captured and written to the tracker.
 *
 * The message text is stored verbatim in `comment` as a single In Progress row.
 * Extraction into completed / in-progress / blocker rows is Agent 1 (SPEC-004)
 * and is not wired up yet, so nothing here interprets what the member wrote.
 */
export class ScrumAssistant extends ActivityHandler {
  constructor (private readonly tracker: Tracker) {
    super()

    this.onMessage(async (context: TurnContext, next) => {
      await rememberSender(context)

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

      // Admin words are commands, not stand-up updates. Checked before the
      // tracker write so 'setup' never ends up recorded as someone's status.
      const command = parseAdminCommand(text)
      if (command !== undefined) {
        await handleAdminCommand(command, context)
        await next()
        return
      }

      const update: StandupUpdate = {
        teamId: config.teams.teamId,
        memberId,
        memberName,
        localDate: localDate(new Date(), config.defaultTimezone),
        rows: [{
          win: null,
          description: null,
          assignedTo: memberName,
          comment: text,
          status: 'In Progress',
          anyBlocker: null
        }],
        rawText: text,
        capturedAt: new Date()
      }

      try {
        await this.tracker.write(update)
        await context.sendActivity(MessageFactory.text(
          `Recorded your update, ${memberName}. It is in the Daily Status Tracker for ${update.localDate}.`
        ))
      } catch (error) {
        // The member is told plainly; the detail goes to the log, not to Teams.
        console.error('tracker write failed', error)
        await context.sendActivity(MessageFactory.text(
          'I could not save that to the tracker. The error has been logged.'
        ))
      }

      await next()
    })

    this.onMembersAdded(async (context: TurnContext, next) => {
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
}
