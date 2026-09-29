import type { AmbiguousItem } from '../jobs/updateIntake.js'
import type { RowStatus } from '../trackers/types.js'

/**
 * "Which story is this?" (SPEC-004 item 24).
 *
 * Sent when a member's words fit more than one story. One button per story and
 * "None of these". What they said rides in the buttons, never in Firestore.
 */

export const STORY_PICK_ACTION = 'scrumAssistant.storyPick'

export interface StoryPickPayload {
  action: typeof STORY_PICK_ACTION
  /** The chosen key, or null for "None of these". */
  pick: string | null
  teamId: string
  localDate: string
  memberId: string
  item: { words: string, status: RowStatus }
}

export function storyPickerCard (item: AmbiguousItem, teamId: string, localDate: string, memberId: string): unknown {
  const data = (pick: string | null): StoryPickPayload =>
    ({ action: STORY_PICK_ACTION, pick, teamId, localDate, memberId, item: { words: item.words, status: item.status } })
  const owner = (name: string | null): string => name === null ? 'unassigned' : name

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: 'Which story is this?', weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: `"${item.words}"`, spacing: 'Small', wrap: true },
      // SPEC-004 item 24: the status is shown before anything is written, so a
      // wrong reading is caught by the member, not found later in the tracker.
      { type: 'TextBlock', text: `Will be recorded as: ${item.status}`, isSubtle: true, size: 'Small', spacing: 'Small', wrap: true },
      ...item.options.map((option) => ({
        type: 'TextBlock',
        text: `**${option.key}** ${option.title} (${owner(option.owner)})`,
        size: 'Small',
        spacing: 'Small',
        wrap: true
      }))
    ],
    actions: [
      ...item.options.map((option) => ({ type: 'Action.Submit', title: option.key, data: data(option.key) })),
      { type: 'Action.Submit', title: 'None of these', data: data(null) }
    ]
  }
}
