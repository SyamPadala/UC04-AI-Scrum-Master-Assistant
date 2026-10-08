import type { PendingItem } from '../jobs/updateIntake.js'

/**
 * The item a Submit on the story card records (SPEC-004 items 14a, 38).
 *
 * The 14a confirmation card itself is gone (design review, 8 Oct 2026): item
 * 38's card replaced it on 1 Oct. Its payload shape stays as the internal
 * hand-over from a Submit to `recordForeignItem`, which re-checks Jira.
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
