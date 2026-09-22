import { config } from '../config/env.js'
import { localDate } from '../config/time.js'
import { recordLlmUsage, reserveLlmCall } from '../store/firestore.js'
import { AnthropicClient } from './anthropic.js'
import { GeminiClient } from './gemini.js'
import { ResponseCache, cacheKey } from './cache.js'
import {
  LlmBudgetError, LlmOfflineError,
  type LlmClient, type LlmRequest, type LlmResponse, type ToolExecutor
} from './types.js'

export * from './types.js'

/**
 * Everything that costs money passes through here.
 *
 * Three guards sit in front of the provider, in this order:
 *
 *   1. cache    a recorded answer to this exact request is replayed, free
 *   2. live     with LLM_LIVE off, a miss fails loudly instead of spending
 *   3. ceiling  a per-day call limit, counted in Firestore so a restart
 *               cannot reset it
 *
 * The ceiling matters because Cloud Scheduler pokes this service 288 times a
 * day, unattended. Billing alerts arrive 24-48 hours later, which is far too
 * late to stop a loop that started overnight. This is the control that acts in
 * time.
 */
class GuardedLlm implements LlmClient {
  private readonly cache: ResponseCache

  constructor (private readonly inner: LlmClient) {
    this.cache = new ResponseCache(config.llm.cachePath)
  }

  get provider (): string { return this.inner.provider }
  get model (): string { return this.inner.model }

  async complete (request: LlmRequest, executeTool?: ToolExecutor): Promise<LlmResponse> {
    const key = cacheKey(this.inner.provider, this.inner.model, request)

    if (config.llm.cache) {
      const recorded = await this.cache.read(key)
      if (recorded !== undefined) {
        log('llm.replay', { label: request.label, key, tokens: recorded.usage.totalTokens })
        return recorded
      }
    }

    if (!config.llm.live) {
      throw new LlmOfflineError(
        `LLM_LIVE is off and no recorded response exists for ${request.label}. ` +
        'Set LLM_LIVE=true to allow this call to reach the model and be billed.'
      )
    }

    const today = localDate(new Date(), config.defaultTimezone)
    if (!await reserveLlmCall(today, config.llm.maxCallsPerDay)) {
      throw new LlmBudgetError(
        `the daily ceiling of ${config.llm.maxCallsPerDay} model calls has been reached ` +
        `for ${today}; raise LLM_MAX_CALLS_PER_DAY or wait for the next day`
      )
    }

    const startedAt = Date.now()
    const response = await this.inner.complete(request, executeTool)
    const durationMs = Date.now() - startedAt

    // Counts and timings only — never the prompt or the completion (rule 23).
    log('llm.call', {
      label: request.label,
      provider: this.inner.provider,
      model: this.inner.model,
      roundTrips: response.roundTrips,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      durationMs
    })
    await recordLlmUsage(today, request.label, response.usage)

    if (config.llm.cache) {
      await this.cache.write(key, this.inner.provider, this.inner.model, request.label, response)
    }
    return response
  }
}

function log (event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }))
}

function providerClient (): LlmClient {
  switch (config.llm.provider) {
    case 'gemini':
      return new GeminiClient(config.llm.model, config.llm.geminiApiKey)
    case 'anthropic':
      return new AnthropicClient(config.llm.model, config.llm.anthropicApiKey)
    case 'vertex':
      // Rejected 17 Sep 2026: Claude on Vertex is a Marketplace purchase and
      // the GCP trial credit does not cover Marketplace. Named here so the
      // failure is the recorded reason rather than a confusing 404.
      throw new Error(
        'LLM_PROVIDER=vertex is not implemented: Claude on Vertex could not be ' +
        'funded with the GCP trial credit (POC-Plan decision log). Use gemini or anthropic.'
      )
    default:
      throw new Error(`unknown LLM_PROVIDER: ${String(config.llm.provider)}`)
  }
}

/**
 * Builds the client. Constructed by the caller and passed in, never held as a
 * module-level singleton, so tests can substitute a stub (coding rule 9).
 */
export function createLlm (): LlmClient {
  return new GuardedLlm(providerClient())
}
