/**
 * The one interface every provider implements (A12).
 *
 * No call site knows which provider is active, so switching between Gemini and
 * Anthropic is a config change with no code impact (coding rule 8).
 */

export interface LlmTool {
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>
}

/** Read-only by construction: a tool that writes or sends is a build error (rule 15). */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>

export interface LlmRequest {
  /** Standing instructions; kept identical across calls so it caches well. */
  system: string
  user: string
  tools?: LlmTool[]
  /** Cap on tool round-trips. Each one resends the whole conversation. */
  maxToolIterations?: number
  maxOutputTokens?: number
  timeoutMs: number
  /** Names the caller in usage records, e.g. 'agent1'. Never content. */
  label: string
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface LlmResponse {
  text: string
  usage: LlmUsage
  /** Model round-trips this request cost, including tool follow-ups. */
  roundTrips: number
  /** True when this came from the recorded-response cache and cost nothing. */
  fromCache: boolean
}

export interface LlmClient {
  readonly provider: string
  readonly model: string
  complete: (request: LlmRequest, executeTool?: ToolExecutor) => Promise<LlmResponse>
}

/** Thrown when the day's call ceiling is reached. Not a model failure. */
export class LlmBudgetError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'LlmBudgetError'
  }
}

/** Thrown when live calling is switched off and nothing is recorded for this request. */
export class LlmOfflineError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'LlmOfflineError'
  }
}
