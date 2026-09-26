import type { LlmClient } from '../llm/types.js'
import { SUMMARY_BUILDER_SYSTEM, summaryBuilderUser, type SummaryFacts } from './prompts/summaryBuilder.js'
import { parseSummary, type SummaryOutput } from './schema.js'

/**
 * Agent 2 — the summary builder (SPEC-006, FR-07).
 *
 * Takes facts, returns the five sections as validated data (SPEC-006 item 4).
 * It knows nothing about Teams, email, Firestore or trackers (coding rule 14),
 * and it is given no tools: every figure it needs is
 * gathered by code first, so the arithmetic in the summary is arithmetic the
 * code did and can be checked.
 *
 * No fallback. If the model fails, this throws and no summary is sent — a
 * program-written summary presented as the model's would make the output
 * impossible to trace (SPEC-006 item 10).
 */

export interface Agent2Options {
  timeoutMs: number
  maxRetries: number
}

export interface Agent2Result {
  sections: SummaryOutput
  durationMs: number
  roundTrips: number
  attempts: number
}

export async function buildSummaryText (
  facts: SummaryFacts, llm: LlmClient, options: Agent2Options
): Promise<Agent2Result> {
  const startedAt = Date.now()
  const request = {
    system: SUMMARY_BUILDER_SYSTEM,
    user: summaryBuilderUser(facts),
    maxOutputTokens: 2500,
    timeoutMs: options.timeoutMs,
    label: 'agent2'
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    try {
      const response = await llm.complete(request)
      // Output that does not fit the schema fails this attempt; it is never
      // repaired or filled in by code.
      const sections = parseSummary(response.text)

      return {
        sections,
        durationMs: Date.now() - startedAt,
        roundTrips: response.fromCache ? 0 : response.roundTrips,
        attempts: attempt
      }
    } catch (error) {
      lastError = error
      console.warn(JSON.stringify({
        event: 'agent2.attemptFailed',
        attempt,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  throw new Error(
    `Agent 2 failed after ${options.maxRetries + 1} attempts: ` +
    (lastError instanceof Error ? lastError.message : String(lastError))
  )
}
