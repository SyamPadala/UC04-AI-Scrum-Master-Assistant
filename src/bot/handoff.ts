import type { ConversationReference } from '@microsoft/agents-activity'
import { config } from '../config/env.js'
import { currentCorrelationId } from '../util/correlation.js'

/**
 * SPEC-004 item 41 (M4): answer Teams at once, then do the work.
 *
 * Teams expects the HTTP answer within ~15 s; reading an update takes 20–25 s,
 * and a late answer can make Teams deliver the message again. So the turn only
 * says "Got it, working on it…" and hands the update to this same service as a
 * new request, which stays open until the work is done — Cloud Run gives CPU
 * only while a request is open, so work after the answer would stall.
 *
 * The member's words travel only inside our own service, over HTTPS, and are
 * never stored (Privacy NFR).
 */

export interface HandedOffUpdate {
  reference: Partial<ConversationReference>
  /** The "Got it, working on it…" message, replaced by the result. */
  ackId: string
  memberId: string
  memberName: string
  text: string
}

export const HANDOFF_PATH = '/internal/process-update'
export const HANDOFF_HEADER = 'x-internal-secret'

/** True when the update was accepted for processing; false means "do it here". */
export async function handOff (update: HandedOffUpdate): Promise<boolean> {
  if (config.admin.publicBaseUrl === '') return false
  // Only the wait for "accepted" is bounded. Once accepted, the connection is
  // left alone: aborting it would end the request that keeps the work running.
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 5_000)
  try {
    // Answered as soon as the work is accepted; the request itself stays open until it is done.
    const response = await fetch(`${config.admin.publicBaseUrl}${HANDOFF_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HANDOFF_HEADER]: config.tick.sharedSecret,
        ...(currentCorrelationId() === undefined ? {} : { 'x-correlation-id': currentCorrelationId() as string })
      },
      body: JSON.stringify(update),
      signal: controller.signal
    })
    clearTimeout(timer)
    if (response.status === 202) return true
    console.error(JSON.stringify({ event: 'handoff.refused', status: response.status }))
  } catch (error) {
    clearTimeout(timer)
    console.error(JSON.stringify({ event: 'handoff.failed', error: String(error) }))
  }
  return false
}
