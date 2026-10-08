import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

/**
 * Correlation id (M16, coding rule 25): one id per incoming message, admin
 * request or scheduled job run, carried on every log line it writes, so one
 * message can be followed from arrival to tracker write to alert.
 *
 * The id rides in async context, so the 100+ existing log calls need no
 * change: every JSON log line written inside `withCorrelation` gets it added.
 */

const store = new AsyncLocalStorage<string>()

export function newCorrelationId (prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

export function currentCorrelationId (): string | undefined {
  return store.getStore()
}

export function withCorrelation<T> (id: string, work: () => T): T {
  return store.run(id, work)
}

/** Adds the current id to a JSON log line; any other text passes unchanged. */
export function tagLine (line: unknown): unknown {
  const id = store.getStore()
  if (id === undefined || typeof line !== 'string' || !line.startsWith('{')) return line
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null || 'correlationId' in parsed) return line
    return JSON.stringify({ correlationId: id, ...parsed })
  } catch {
    return line
  }
}

let installed = false

/** Called once at start-up. */
export function installLogCorrelation (): void {
  if (installed) return
  installed = true
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (first?: unknown, ...rest: unknown[]) => { original(tagLine(first), ...rest) }
  }
}
