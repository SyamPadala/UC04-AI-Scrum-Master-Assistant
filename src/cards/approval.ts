import type { RowStatus } from '../trackers/types.js'

/**
 * The Scrum Master's Approve / Reject card (SPEC-004 item 43).
 *
 * Sent when a member submits an update on a story assigned to someone else.
 * What the member said travels in the buttons' data, never in Firestore
 * (Privacy NFR), exactly as on the member's own story card. A blocker in the
 * update is on the card, so this card is also the blocker alert (FR-06).
 */

export const APPROVAL_ACTION = 'scrumAssistant.approval'

export interface ApprovalPayload {
  action: typeof APPROVAL_ACTION
  decision: 'approve' | 'reject'
  requestId: string
  teamId: string
  localDate: string
  memberId: string
  item: { key: string, status: RowStatus, comment: string | null, blocker: string | null }
}

export interface ApprovalCardInput {
  memberName: string
  owner: string
  storyTitle: string
  storyUrl?: string
  summaryTime: string
  payload: Omit<ApprovalPayload, 'decision'>
}

export function approvalCard (input: ApprovalCardInput): unknown {
  const { item } = input.payload
  const data = (decision: ApprovalPayload['decision']): ApprovalPayload => ({ ...input.payload, decision })
  const said = item.comment ?? item.blocker ?? ''
  const body: unknown[] = [
    { type: 'TextBlock', text: 'Update waiting for your approval', weight: 'Bolder', size: 'Medium', wrap: true },
    {
      type: 'TextBlock',
      text: `${input.memberName} sent an update on **${item.key}** ${input.storyTitle} (${input.owner}'s story):`,
      wrap: true
    },
    { type: 'TextBlock', text: `"${said}"`, wrap: true, spacing: 'Small' },
    { type: 'TextBlock', text: `Will be recorded as: ${item.status}`, isSubtle: true, size: 'Small', spacing: 'Small', wrap: true }
  ]
  if (item.blocker !== null) {
    body.push({
      type: 'Container',
      style: 'attention',
      spacing: 'Medium',
      items: [{ type: 'TextBlock', text: `⚠ Blocker: ${item.blocker}`, wrap: true }]
    })
  }
  body.push({
    type: 'TextBlock',
    text: `Not in today's summary unless approved by ${input.summaryTime}.`,
    isSubtle: true,
    size: 'Small',
    spacing: 'Medium',
    wrap: true
  })

  const actions: unknown[] = [
    { type: 'Action.Submit', title: 'Approve', style: 'positive', data: data('approve') },
    { type: 'Action.Submit', title: 'Reject', style: 'destructive', data: data('reject') }
  ]
  if (input.storyUrl !== undefined && input.storyUrl !== '') {
    actions.push({ type: 'Action.OpenUrl', title: `Open ${item.key}`, url: input.storyUrl })
  }
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    actions
  }
}
