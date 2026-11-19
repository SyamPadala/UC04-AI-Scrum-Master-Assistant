import type { ChoiceItem } from '../jobs/updateIntake.js'
import type { RowStatus } from '../trackers/types.js'

/**
 * "These stories could fit…" (SPEC-004 item 38).
 *
 * Sent whenever an update is not clearly the member's own story: her own open
 * stories first, then every other story it could fit, each with its own
 * Submit, then Save as general update and None of these (item 45). The card
 * says whose story each one is, so Submit is the confirmation. What she said
 * rides in the buttons, never in Firestore.
 */

export const STORY_CHOICE_ACTION = 'scrumAssistant.storyChoice'

export interface StoryChoicePayload {
  action: typeof STORY_CHOICE_ACTION
  /** The chosen key, or null for "Save as general update" / "None of these". */
  pick: string | null
  /** Item 45: "Save as general update" — her General row instead of a story. */
  general?: true
  teamId: string
  localDate: string
  memberId: string
  item: { words: string, status: RowStatus, blocker: string | null, noStory?: boolean }
}

export function storyChoiceCard (item: ChoiceItem, teamId: string, localDate: string, memberId: string): unknown {
  const data = (pick: string | null, general = false): StoryChoicePayload =>
    ({ action: STORY_CHOICE_ACTION, pick, ...(general ? { general: true as const } : {}), teamId, localDate, memberId, item: { words: item.words, status: item.status, blocker: item.blocker, ...(item.noStory === true ? { noStory: true } : {}) } })
  const allMine = item.options.every((option) => option.mine)
  const noStory = item.noStory === true
  // Item 46: a vague update ("working on my tasks") offers only her own stories.
  const vague = item.vague === true
  const recordedAs = item.blocker === null ? item.status : `Blocked: ${item.blocker}`

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        // Item 40: a blocker that named no story asks which of hers it blocks.
        text: noStory
          ? `Which story is "${item.words}" blocking?`
          : vague ? `Which of your stories is "${item.words}" about?` : allMine ? 'Which of your stories is this?' : "Your update didn't match a story assigned to you.",
        weight: 'Bolder',
        wrap: true
      },
      ...(noStory || vague ? [] : [{ type: 'TextBlock', text: `These stories could fit "${item.words}":`, spacing: 'Small', wrap: true }]),
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
    actions: [
      { type: 'Action.Submit', title: 'Save as general update', data: data(null, true) },
      { type: 'Action.Submit', title: 'None of these', data: data(null) }
    ]
  }
}
