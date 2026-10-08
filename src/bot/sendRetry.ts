/**
 * True when Teams says the stored chat no longer exists (SPEC-008 10e).
 *
 * Happens when the person removes or blocks the app: every later send to that
 * reference fails with 404 ConversationNotFound. The SDK's HttpError carries
 * the status, and the connector's error code in its message.
 */
export function isConversationGone (error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const status = (error as Error & { status?: unknown }).status
  return /ConversationNotFound/i.test(error.message) || (status === 404 && /conversation/i.test(error.message))
}

/**
 * SPEC-003 item 10 (M9, L13): a proactive send that fails because Teams is
 * busy (429), has a temporary error (5xx) or does not answer is tried again
 * after 2 s and 5 s, waiting longer when Teams says so (Retry-After, at most
 * 10 s). A chat that is gone (404) or a request Teams refuses (400/401/403) is
 * never retried: waiting cannot fix it. Accepted (user, 4 and 7 Oct 2026): a
 * 5xx after Teams had in fact delivered can send the message twice.
 */
export const teamsRetry = { delaysMs: [2_000, 5_000], maxRetryAfterMs: 10_000 }

export function retryableSend (error: unknown): boolean {
  if (isConversationGone(error)) return false
  const status = (error as { status?: unknown, statusCode?: unknown } | undefined)?.status ??
    (error as { statusCode?: unknown } | undefined)?.statusCode
  if (typeof status === 'number') return status === 429 || status >= 500
  // No status at all: a timeout or a dropped connection, so Teams never answered.
  return error instanceof Error && /timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(`${error.name} ${error.message}`)
}

function retryAfterMs (error: unknown): number | undefined {
  const headers = (error as { headers?: Record<string, unknown> | { get?: (name: string) => unknown } } | undefined)?.headers
  const raw = typeof (headers as { get?: unknown } | undefined)?.get === 'function'
    ? (headers as { get: (name: string) => unknown }).get('retry-after')
    : (headers as Record<string, unknown> | undefined)?.['retry-after']
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, teamsRetry.maxRetryAfterMs) : undefined
}

export async function withSendRetry (label: string, send: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await send()
      if (attempt > 0) console.log(JSON.stringify({ event: 'teams.sendRecovered', label, attempts: attempt + 1 }))
      return
    } catch (error) {
      const delay = teamsRetry.delaysMs.at(attempt)
      if (delay === undefined || !retryableSend(error)) throw error
      const wait = retryAfterMs(error) ?? delay
      console.warn(JSON.stringify({ event: 'teams.sendRetry', label, attempt: attempt + 1, waitMs: wait, error: String(error).slice(0, 160) }))
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}
