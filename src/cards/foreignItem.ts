import type { PendingItem } from '../jobs/updateIntake.js'

/**
 * "This story is someone else's — submit anyway?" (SPEC-004 item 14a).
 *
 * The item rides in the buttons' data, so nothing about it is stored anywhere
 * but the member's own chat (Privacy NFR). Code re-checks it on Submit.
 */

export const FOREIGN_ITEM_ACTION = 'scrumAssistant.foreignItem'

export interface ForeignItemPayload {
  action: typeof FOREIGN_ITEM_ACTION
  choice: 'submit' | 'cancel'
  teamId: string
  localDate: string
  memberId: string
  item: PendingItem
}

export function foreignItemCard (item: PendingItem, teamId: string, localDate: string, memberId: string): unknown {
  const data = (choice: 'submit' | 'cancel'): ForeignItemPayload =>
    ({ action: FOREIGN_ITEM_ACTION, choice, teamId, localDate, memberId, item })
  const said = [item.comment, item.blocker === null ? null : `Blocked: ${item.blocker}`].filter((part) => part !== null).join(' · ')

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: `${item.key} is assigned to ${item.owner}, not you`, weight: 'Bolder', wrap: true },
      ...(item.title === null ? [] : [{ type: 'TextBlock', text: item.title, isSubtle: true, spacing: 'None', wrap: true }]),
      ...(said === '' ? [] : [{ type: 'TextBlock', text: `Your update: ${said}`, spacing: 'Small', wrap: true }]),
      { type: 'TextBlock', text: 'Submit your update anyway?', spacing: 'Medium', wrap: true }
    ],
    actions: [
      { type: 'Action.Submit', title: 'Submit', style: 'positive', data: data('submit') },
      { type: 'Action.Submit', title: 'Cancel', data: data('cancel') }
    ]
  }
}
