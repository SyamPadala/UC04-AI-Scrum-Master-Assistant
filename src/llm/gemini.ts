import { z } from 'zod'
import { httpErrorFrom, withRetry } from '../util/retry.js'
import type { LlmClient, LlmRequest, LlmResponse, ToolExecutor } from './types.js'

/**
 * Gemini, via the Generative Language API (A12 — the approved substitute for
 * Claude and the provider that ships).
 *
 * The tool loop lives here rather than in the agents, so an agent never knows
 * which provider is answering it.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.looseObject({
        text: z.string().nullish(),
        functionCall: z.object({
          name: z.string(),
          args: z.record(z.string(), z.unknown()).nullish()
        }).nullish()
      })).default([]),
      role: z.string().nullish()
    }).nullish(),
    finishReason: z.string().nullish()
  })).default([]),
  usageMetadata: z.object({
    promptTokenCount: z.number().nullish(),
    candidatesTokenCount: z.number().nullish(),
    totalTokenCount: z.number().nullish()
  }).nullish()
})

/**
 * Parts are carried back verbatim, not rebuilt.
 *
 * Gemini 3 attaches a `thoughtSignature` to each functionCall and rejects the
 * follow-up request with a 400 if it is not echoed back. Reconstructing the
 * part from just `name` and `args` drops it, so anything that used a tool
 * failed. The index signature is what keeps fields we do not model.
 */
interface Part {
  text?: string
  functionCall?: { name: string, args?: Record<string, unknown> }
  functionResponse?: unknown
  [key: string]: unknown
}
interface Content { role: 'user' | 'model', parts: Part[] }

export class GeminiClient implements LlmClient {
  readonly provider = 'gemini'

  constructor (
    readonly model: string,
    private readonly apiKey: string
  ) {
    if (apiKey === '') throw new Error('GEMINI_API_KEY is not set')
    if (model === '') throw new Error('LLM_MODEL is not set')
  }

  async complete (request: LlmRequest, executeTool?: ToolExecutor): Promise<LlmResponse> {
    const contents: Content[] = [{ role: 'user', parts: [{ text: request.user }] }]
    const maxIterations = request.maxToolIterations ?? 0

    let inputTokens = 0
    let outputTokens = 0
    let roundTrips = 0

    // One pass per tool round-trip, plus the final answer. Each pass resends
    // the whole conversation, which is why the cap is a cost control and not
    // just a safety net.
    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      const body = await this.post(request, contents)
      roundTrips++
      inputTokens += body.usageMetadata?.promptTokenCount ?? 0
      outputTokens += body.usageMetadata?.candidatesTokenCount ?? 0

      const parts = body.candidates[0]?.content?.parts ?? []
      const calls = parts.filter((part) => part.functionCall != null)

      if (calls.length === 0 || executeTool === undefined) {
        const text = parts.map((part) => part.text ?? '').join('').trim()
        return {
          text,
          usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
          roundTrips,
          fromCache: false
        }
      }

      // The model asked for facts. Run the tools and hand back the results.
      // The model turn is replayed exactly as it arrived, thought signatures
      // and all — see the note on Part.
      contents.push({ role: 'model', parts: parts as Part[] })
      const results: Part[] = []
      for (const part of calls) {
        const call = part.functionCall as { name: string, args?: Record<string, unknown> }
        let result: unknown
        try {
          result = await executeTool(call.name, call.args ?? {})
        } catch (error) {
          // A failing tool is reported to the model as a result, not thrown:
          // the model can say "not found" far better than a stack trace can.
          result = { error: error instanceof Error ? error.message : String(error) }
        }
        results.push({ functionResponse: { name: call.name, response: { result } } })
      }
      contents.push({ role: 'user', parts: results })
    }

    throw new Error(`Gemini exceeded ${maxIterations} tool iterations for ${request.label}`)
  }

  private async post (request: LlmRequest, contents: Content[]): Promise<z.infer<typeof responseSchema>> {
    const payload: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: request.system }] },
      generationConfig: {
        ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
        temperature: 0
      }
    }
    if (request.tools !== undefined && request.tools.length > 0) {
      payload.tools = [{
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }]
    }

    const raw = await withRetry(async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, request.timeoutMs)
      try {
        const response = await fetch(`${BASE}/models/${this.model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        })
        if (!response.ok) throw await httpErrorFrom(response)
        return await response.json() as unknown
      } finally {
        clearTimeout(timer)
      }
    }, { label: `gemini:${request.label}`, attempts: 2 })

    const parsed = responseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Gemini returned an unexpected response shape for ${request.label}`)
    }
    return parsed.data
  }
}
