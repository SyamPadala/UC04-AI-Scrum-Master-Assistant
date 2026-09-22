import { z } from 'zod'
import { httpErrorFrom, withRetry } from '../util/retry.js'
import type { LlmClient, LlmRequest, LlmResponse, ToolExecutor } from './types.js'

/**
 * Anthropic Messages API.
 *
 * Kept working, though Gemini is what ships (A12): the PRD names Claude, and
 * the point of the adapter is that returning to it is a config change rather
 * than a rewrite. No accuracy figure is ever carried across providers — the
 * number reported for FR-03 belongs to whichever one actually ran.
 */

const BASE = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

const responseSchema = z.object({
  content: z.array(z.looseObject({
    type: z.string(),
    text: z.string().nullish(),
    id: z.string().nullish(),
    name: z.string().nullish(),
    input: z.record(z.string(), z.unknown()).nullish()
  })).default([]),
  stop_reason: z.string().nullish(),
  usage: z.object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish()
  }).nullish()
})

interface Message { role: 'user' | 'assistant', content: unknown }

export class AnthropicClient implements LlmClient {
  readonly provider = 'anthropic'

  constructor (
    readonly model: string,
    private readonly apiKey: string
  ) {
    if (apiKey === '') throw new Error('ANTHROPIC_API_KEY is not set')
    if (model === '') throw new Error('LLM_MODEL is not set')
  }

  async complete (request: LlmRequest, executeTool?: ToolExecutor): Promise<LlmResponse> {
    const messages: Message[] = [{ role: 'user', content: request.user }]
    const maxIterations = request.maxToolIterations ?? 0

    let inputTokens = 0
    let outputTokens = 0
    let roundTrips = 0

    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      const body = await this.post(request, messages)
      roundTrips++
      inputTokens += body.usage?.input_tokens ?? 0
      outputTokens += body.usage?.output_tokens ?? 0

      const toolUses = body.content.filter((block) => block.type === 'tool_use')

      if (toolUses.length === 0 || executeTool === undefined) {
        const text = body.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('')
          .trim()
        return {
          text,
          usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
          roundTrips,
          fromCache: false
        }
      }

      messages.push({ role: 'assistant', content: body.content })
      const results = []
      for (const use of toolUses) {
        let result: unknown
        try {
          result = await executeTool(use.name ?? '', use.input ?? {})
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) }
        }
        results.push({
          type: 'tool_result',
          tool_use_id: use.id ?? '',
          content: JSON.stringify(result)
        })
      }
      messages.push({ role: 'user', content: results })
    }

    throw new Error(`Anthropic exceeded ${maxIterations} tool iterations for ${request.label}`)
  }

  private async post (request: LlmRequest, messages: Message[]): Promise<z.infer<typeof responseSchema>> {
    const payload: Record<string, unknown> = {
      model: this.model,
      system: request.system,
      messages,
      max_tokens: request.maxOutputTokens ?? 2048,
      temperature: 0
    }
    if (request.tools !== undefined && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }))
    }

    const raw = await withRetry(async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, request.timeoutMs)
      try {
        const response = await fetch(BASE, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': API_VERSION,
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        })
        if (!response.ok) throw await httpErrorFrom(response)
        return await response.json() as unknown
      } finally {
        clearTimeout(timer)
      }
    }, { label: `anthropic:${request.label}`, attempts: 2 })

    const parsed = responseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Anthropic returned an unexpected response shape for ${request.label}`)
    }
    return parsed.data
  }
}
