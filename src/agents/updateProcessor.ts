import type { LlmClient } from '../llm/types.js'
import type { PmClient, Story } from '../pm/types.js'
import { UPDATE_PROCESSOR_SYSTEM, updateProcessorUser } from './prompts/updateProcessor.js'
import { createStoryToolExecutor, storyTools } from './tools/stories.js'
import { parseExtraction, type ExtractionInput, type ExtractionOutput } from './schema.js'
import { keysInText, normaliseKeysInText } from './keys.js'
import { config } from '../config/env.js'

/** Above this many open stories, the list sent to the model is trimmed (SPEC-004 item 22). */
const MAX_CANDIDATES = 40
const OTHERS_WHEN_TRIMMED = 30

/** Lower-case words of three letters or more, for ranking titles against a message. */
function words (text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3))
}

/**
 * The stories the model may choose from (SPEC-004 item 22): every open story in
 * the sprint, the member's own first. Trimmed only for an unusually large
 * sprint: own stories and keyed ones always stay, then the titles sharing the
 * most words with the message.
 */
export function candidateStories (all: Story[], jiraAccountId: string, text: string, keyed: string[]): Story[] {
  const own = all.filter((s) => jiraAccountId !== '' && s.assigneeAccountId === jiraAccountId)
  const others = all.filter((s) => !own.includes(s))
  if (all.length <= MAX_CANDIDATES) return [...own, ...others]

  const said = words(text)
  const score = (story: Story): number => [...words(story.title)].filter((w) => said.has(w)).length
  const mustKeep = others.filter((s) => keyed.includes(s.key))
  const ranked = others
    .filter((s) => !mustKeep.includes(s))
    .sort((a, b) => score(b) - score(a))
    .slice(0, OTHERS_WHEN_TRIMMED)
  return [...own, ...mustKeep, ...ranked]
}

/**
 * SPEC-004 item 23: a key is accepted only if it was offered or typed. Anything
 * else becomes "no work item", and alternatives are kept only when offered.
 */
export function restrictToKnownKeys (output: ExtractionOutput, offered: Set<string>, typed: Set<string>): ExtractionOutput {
  const known = (key: string | null): string | null => key !== null && (offered.has(key) || typed.has(key)) ? key : null
  const item = (entry: ExtractionOutput['completed'][number]): ExtractionOutput['completed'][number] => {
    const storyRef = known(entry.storyRef)
    return {
      ...entry,
      storyRef,
      alternatives: storyRef !== null ? [] : [...new Set(entry.alternatives.filter((key) => offered.has(key)))].slice(0, 3)
    }
  }
  return {
    ...output,
    completed: output.completed.map(item),
    inProgress: output.inProgress.map(item),
    blockers: output.blockers.map((b) => ({ ...b, storyRef: known(b.storyRef) }))
  }
}

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
  /** The member's own open items at the time of the call. */
  openItems: Story[]
  /** Every story offered to the model, so code can read titles and owners afterwards. */
  candidates: Story[]
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
  // Item 21: "scrum 25" and "SCRUM-25" are the same key; code says so, not the model.
  const text = normaliseKeysInText(truncated ? input.text.slice(0, options.maxInputChars) : input.text, config.jira.projectKey)
  const typed = new Set(keysInText(text, config.jira.projectKey))

  // Fetched once and passed to the model in the prompt. A tool round-trip for
  // the same facts would resend the whole conversation, which costs far more
  // than the lines this produces.
  const candidates = candidateStories(await pm.getSprintOpenItems(), input.jiraAccountId, text, [...typed])
  const openItems = candidates.filter((s) => input.jiraAccountId !== '' && s.assigneeAccountId === input.jiraAccountId)

  const request = {
    system: UPDATE_PROCESSOR_SYSTEM,
    user: updateProcessorUser(
      input.memberName, text,
      candidates.map((story) => ({
        key: story.key,
        title: story.title,
        status: story.status,
        owner: story.assignee,
        mine: openItems.includes(story)
      })),
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
        output: restrictToKnownKeys(parseExtraction(response.text), new Set(candidates.map((s) => s.key)), typed),
        openItems,
        candidates,
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
