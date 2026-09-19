import { ActivityHandler, MessageFactory, type TurnContext } from '@microsoft/agents-hosting'
import type { StandupUpdate, Tracker } from '../trackers/types.js'

/** 'YYYY-MM-DD' for the given moment. Timezone handling arrives with SPEC-001. */
function localDate (at: Date): string {
  return at.toISOString().slice(0, 10)
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
      const text = (context.activity.text ?? '').trim()
      const memberName = context.activity.from?.name ?? 'Unknown'
      const memberId = context.activity.from?.id ?? ''

      if (text === '') {
        await next()
        return
      }

      const update: StandupUpdate = {
        teamId: context.activity.conversation?.id ?? 'unknown',
        memberId,
        memberName,
        localDate: localDate(new Date()),
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
          await context.sendActivity(MessageFactory.text(
            'Scrum Assistant is installed. Send me your status update and I will record it.'
          ))
        }
      }
      await next()
    })
  }
}
