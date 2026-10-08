import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from '../config/env.js'
import { serviceToken } from '../auth/tokens.js'

/** An application-level Microsoft Graph token (one shared helper, auth/tokens.ts). */
export async function getGraphToken (): Promise<string> {
  return await serviceToken('graph')
}

/**
 * Graph was slow or failing on every attempt (SPEC-002 item 5a). Distinct from
 * an ordinary error so the member can be told the tracker could not be reached.
 */
export class GraphUnavailableError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'GraphUnavailableError'
  }
}

/** Per-call settings; overridable in tests so they do not wait real seconds. */
export const graphRetry = { timeoutMs: 15_000, delaysMs: [2_000, 5_000], maxRetryAfterMs: 10_000 }

/**
 * Who to tell when a call is being retried. Set around one member's message
 * (SPEC-002 item 5a), so any Graph call made for that message can say so once.
 */
const retryNotice = new AsyncLocalStorage<{ notify: () => Promise<void>, told: boolean }>()

export async function withGraphRetryNotice<T> (notify: () => Promise<void>, work: () => Promise<T>): Promise<T> {
  return await retryNotice.run({ notify, told: false }, work)
}

async function tellOnce (): Promise<void> {
  const scope = retryNotice.getStore()
  if (scope === undefined || scope.told) return
  scope.told = true
  await scope.notify().catch(() => {})
}

const sleep = async (ms: number): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, ms)) }

/**
 * Calls a Microsoft Graph endpoint, throwing with Graph's own error text on failure.
 *
 * SPEC-002 item 5a: each attempt has a timeout, and a timeout, 5xx or 429 is
 * tried again twice. A POST is retried only on 429: after a timeout or a 5xx
 * the item may already have been created, and a second POST would duplicate it.
 */
export async function graphRequest<T> (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  let lastProblem = ''
  for (let attempt = 0; ; attempt++) {
    const token = await getGraphToken()
    let response: Response
    try {
      response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(graphRetry.timeoutMs)
      })
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      if (!timedOut) throw error
      lastProblem = `no answer within ${graphRetry.timeoutMs / 1000}s`
      if (method === 'POST' || attempt >= graphRetry.delaysMs.length) break
      await retryAfter(attempt, method, path, lastProblem)
      continue
    }

    if (response.status === 204) return undefined as T

    const text = await response.text()
    const unavailable = response.status === 429 || response.status >= 500
    const retryable = unavailable && (response.status === 429 || method !== 'POST')
    if (retryable && attempt < graphRetry.delaysMs.length) {
      lastProblem = `${response.status}`
      await retryAfter(attempt, method, path, lastProblem, response.headers.get('retry-after'))
      continue
    }
    if (response.ok !== true) {
      const message = `Graph ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`
      throw unavailable ? new GraphUnavailableError(message) : new Error(message)
    }
    // sendMail answers 202 with no body. Parsing that threw after the mail had
    // already gone, and the summary was reported as failed when it had arrived.
    if (text.trim() === '') return undefined as T
    return JSON.parse(text) as T
  }
  throw new GraphUnavailableError(`Graph ${method} ${path} failed: ${lastProblem}`)
}

async function retryAfter (attempt: number, method: string, path: string, problem: string, header?: string | null): Promise<void> {
  const asked = Number(header) * 1000
  const wait = Number.isFinite(asked) && asked > 0 ? Math.min(asked, graphRetry.maxRetryAfterMs) : graphRetry.delaysMs[attempt]
  console.warn(JSON.stringify({ event: 'graph.retry', method, path: path.split('?')[0], attempt: attempt + 1, problem, waitMs: wait }))
  await tellOnce()
  await sleep(wait)
}
