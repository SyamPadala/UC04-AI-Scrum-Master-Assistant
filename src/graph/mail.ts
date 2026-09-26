import { graphRequest } from './client.js'

/**
 * Stakeholder summary by email (FR-08, SPEC-006).
 *
 * Sent with the Mail.Send application permission, which is why a sender
 * mailbox has to be named: there is no signed-in user for Graph to infer one
 * from. That permission is already consented (checklist item 8).
 */
export async function sendMail (
  senderUserId: string, recipients: string[], subject: string, body: string,
  contentType: 'Text' | 'HTML' = 'Text'
): Promise<void> {
  if (recipients.length === 0) return

  await graphRequest('POST', `/users/${encodeURIComponent(senderUserId)}/sendMail`, {
    message: {
      subject,
      // HTML only when the caller built HTML: plain text declared as HTML
      // collapses every line break into one paragraph.
      body: { contentType, content: body },
      toRecipients: recipients.map((address) => ({ emailAddress: { address } }))
    },
    saveToSentItems: true
  })
}
