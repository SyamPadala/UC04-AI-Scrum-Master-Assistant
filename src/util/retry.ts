/**
 * Retry with exponential backoff (coding rule 20).
 *
 * Only 429 and 5xx are retried: those are the responses that mean "try again".
 * A 400 or 401 means the request itself is wrong and retrying it just repeats
 * the mistake more expensively.
 */

export interface RetryOptions {
  /** Attempts in total, not retries after the first. */
  attempts?: number
  baseDelayMs?: number
  /** Identifies the call in log lines. */
  label: string
}

export class HttpError extends Error {
  constructor (
    readonly status: number,
    readonly body: string,
    readonly retryAfterSeconds?: number
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`)
    this.name = 'HttpError'
  }

  /** 429 and 5xx are transient; everything else is the caller's fault. */
  get transient (): boolean {
    return this.status === 429 || this.status >= 500
  }
}

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

export async function withRetry<T> (
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const attempts = options.attempts ?? 3
  const base = options.baseDelayMs ?? 500
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const transient = error instanceof HttpError && error.transient
      if (!transient || attempt === attempts) break

      // Retry-After is the server telling us how long to wait. Guessing a
      // shorter delay is how a rate limit turns into a longer rate limit.
      const retryAfter = (error as HttpError).retryAfterSeconds
      const delay = retryAfter !== undefined
        ? retryAfter * 1000
        : base * 2 ** (attempt - 1)

      console.warn(JSON.stringify({
        event: 'retry', label: options.label, attempt, ofAttempts: attempts,
        status: (error as HttpError).status, delayMs: delay
      }))
      await sleep(delay)
    }
  }
  throw lastError
}

/** Reads a fetch Response into an HttpError, preserving Retry-After. */
export async function httpErrorFrom (response: Response): Promise<HttpError> {
  const header = response.headers.get('retry-after')
  const seconds = header === null ? undefined : Number(header)
  return new HttpError(
    response.status,
    await response.text(),
    seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined
  )
}
