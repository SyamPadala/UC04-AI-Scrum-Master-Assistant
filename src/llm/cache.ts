import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LlmRequest, LlmResponse } from './types.js'

/**
 * Recorded model responses, replayed instead of re-asking.
 *
 * The first time a request is made it is answered by the model and written
 * here; every later run with the same request reads the file. Testing the same
 * behaviour fifty times therefore costs what testing it once costs, which is
 * what makes a limited credit balance survive development.
 *
 * This is not a fallback. A replayed response is the model's own output,
 * recorded verbatim — the program never manufactures one (SPEC-004 item 9).
 * A change to the prompt changes the key, so a stale answer can never be
 * served for a new question.
 *
 * **Development only.** A recorded response contains extracted update content,
 * and the Privacy NFR allows that to live in the team's tracker and nowhere
 * else. The cache is therefore for local runs and the eval set — which use
 * sample data — and is switched off on the deployed service (`LLM_CACHE=false`).
 * The directory is git-ignored.
 */

export interface CacheEntry {
  provider: string
  model: string
  label: string
  recordedAt: string
  response: LlmResponse
}

/**
 * Everything that could change the answer goes into the key.
 *
 * Tool definitions are included because adding a tool changes what the model
 * can do; the tool *results* are not, since the tools are read-only and a
 * replay skips the round-trips entirely.
 */
export function cacheKey (provider: string, model: string, request: LlmRequest): string {
  const material = JSON.stringify({
    provider,
    model,
    system: request.system,
    user: request.user,
    tools: (request.tools ?? []).map((tool) => ({ name: tool.name, parameters: tool.parameters })),
    maxOutputTokens: request.maxOutputTokens ?? null
  })
  return createHash('sha256').update(material).digest('hex').slice(0, 32)
}

export class ResponseCache {
  constructor (private readonly directory: string) {}

  private file (key: string): string {
    return path.join(this.directory, `${key}.json`)
  }

  async read (key: string): Promise<LlmResponse | undefined> {
    try {
      const raw = await readFile(this.file(key), 'utf8')
      const entry = JSON.parse(raw) as CacheEntry
      return { ...entry.response, fromCache: true }
    } catch {
      // A missing or unreadable entry is a miss, never an error: the worst
      // outcome is that the model is asked again.
      return undefined
    }
  }

  async write (
    key: string, provider: string, model: string, label: string, response: LlmResponse
  ): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true })
      const entry: CacheEntry = {
        provider, model, label, recordedAt: new Date().toISOString(), response
      }
      await writeFile(this.file(key), JSON.stringify(entry, null, 2), 'utf8')
    } catch (error) {
      // Cloud Run's filesystem is ephemeral and may be read-only. Failing to
      // record is not a reason to fail a call that already succeeded.
      console.warn(JSON.stringify({ event: 'llm.cache.writeFailed', label, error: String(error) }))
    }
  }
}
