import type { LlmClient } from '../llm/types.js'
import type { PmClient, Story } from '../pm/types.js'
import { UPDATE_PROCESSOR_SYSTEM, updateProcessorUser } from './prompts/updateProcessor.js'
import { createStoryToolExecutor, storyTools } from './tools/stories.js'
import { parseExtraction, type ExtractionInput, type ExtractionOutput } from './schema.js'

/**
 * Agent 1 — the update processor (SPEC-004, FR-03 and FR-06 detection).
 *
 * Takes typed input, returns typed output, and knows nothing about Teams,
 * Firestore or trackers (coding rule 14). Whatever it concludes, code decides
 * what to do about it.
 *
 * There is no fallback path. If the model times out, exceeds its tool cap or
 * returns output that fails validation, this throws. Nothing is written, and
 * the member is told their update could not be processed (SPEC-004 item 9).
 */

export interface Agent1Options {
  maxToolIterations: number
  timeoutMs: number
  maxRetries: number
  maxInputChars: number
}

export interface Agent1Result {
  output: ExtractionOutput
  /** Open items at the time of the call, so code can fill in titles afterwards. */
  openItems: Story[]
  durationMs: number
  /** Round-trips the model needed; 0 when a recorded response was replayed. */
  roundTrips: number
  truncated: boolean
  attempts: number
}

export async function extractUpdate (
  input: ExtractionInput,
  llm: LlmClient,
  pm: PmClient,
  options: Agent1Options
): Promise<Agent1Result> {
  const startedAt = Date.now()

  const truncated = input.text.length > options.maxInputChars
  const text = truncated ? input.text.slice(0, options.maxInputChars) : input.text

  // Fetched once and passed to the model in the prompt. A tool round-trip for
  // the same facts would resend the whole conversation, which costs far more
  // than the six lines this produces.
  const openItems = input.jiraAccountId === ''
    ? []
    : await pm.getMemberOpenItems(input.jiraAccountId)

  const request = {
    system: UPDATE_PROCESSOR_SYSTEM,
    user: updateProcessorUser(
      input.memberName, text,
      openItems.map((item) => ({ key: item.key, title: item.title, status: item.status })),
      input.activeBlockers ?? []
    ),
    tools: storyTools,
    maxToolIterations: options.maxToolIterations,
    maxOutputTokens: 1024,
    timeoutMs: options.timeoutMs,
    label: 'agent1'
  }
  const executeTool = createStoryToolExecutor(pm, input.jiraAccountId)

  let lastError: unknown
  // A retry is the same model asked again; that is not a fallback. Switching to
  // a different source of the answer would be (SPEC-004 item 10).
  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    try {
      const response = await llm.complete(request, executeTool)
      return {
        output: parseExtraction(response.text),
        openItems,
        durationMs: Date.now() - startedAt,
        roundTrips: response.fromCache ? 0 : response.roundTrips,
        truncated,
        attempts: attempt
      }
    } catch (error) {
      lastError = error
      console.warn(JSON.stringify({
        event: 'agent1.attemptFailed',
        teamId: input.teamId,
        memberId: input.memberId,
        attempt,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  throw new Error(
    `Agent 1 failed after ${options.maxRetries + 1} attempts: ` +
    (lastError instanceof Error ? lastError.message : String(lastError))
  )
}
