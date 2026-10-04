import type { ChoiceItem } from '../jobs/updateIntake.js'
import type { RowStatus } from '../trackers/types.js'

/**
 * "These stories could fit…" (SPEC-004 item 38).
 *
 * Sent whenever an update is not clearly the member's own story: her own open
 * stories first, then every other story it could fit, each with its own
 * Submit, and None of these. The card says whose story each one is, so Submit
 * is the confirmation. What she said rides in the buttons, never in Firestore.
 */

export const STORY_CHOICE_ACTION = 'scrumAssistant.storyChoice'

export interface StoryChoicePayload {
  action: typeof STORY_CHOICE_ACTION
  /** The chosen key, or null for "None of these". */
  pick: string | null
  teamId: string
  localDate: string
  memberId: string
  item: { words: string, status: RowStatus, blocker: string | null }
}

export function storyChoiceCard (item: ChoiceItem, teamId: string, localDate: string, memberId: string): unknown {
  const data = (pick: string | null): StoryChoicePayload =>
    ({ action: STORY_CHOICE_ACTION, pick, teamId, localDate, memberId, item: { words: item.words, status: item.status, blocker: item.blocker } })
  const allMine = item.options.every((option) => option.mine)
  const recordedAs = item.blocker === null ? item.status : `Blocked: ${item.blocker}`

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: allMine ? 'Which of your stories is this?' : "Your update didn't match a story assigned to you.",
        weight: 'Bolder',
        wrap: true
      },
      { type: 'TextBlock', text: `These stories could fit "${item.words}":`, spacing: 'Small', wrap: true },
      { type: 'TextBlock', text: `Will be recorded as: ${recordedAs}`, isSubtle: true, size: 'Small', spacing: 'Small', wrap: true },
      ...item.options.map((option) => ({
        type: 'ColumnSet',
        spacing: 'Medium',
        separator: true,
        columns: [
          {
            type: 'Column',
            width: 'stretch',
            verticalContentAlignment: 'Center',
            items: [{
              type: 'TextBlock',
              wrap: true,
              text: `**${option.key}** ${option.title} — ${option.mine ? 'assigned to you' : `not assigned to you (${option.owner ?? 'someone else'})`}`
            }]
          },
          {
            type: 'Column',
            width: 'auto',
            verticalContentAlignment: 'Center',
            items: [{ type: 'ActionSet', actions: [{ type: 'Action.Submit', title: 'Submit', data: data(option.key) }] }]
          }
        ]
      }))
    ],
    actions: [{ type: 'Action.Submit', title: 'None of these', data: data(null) }]
  }
}
