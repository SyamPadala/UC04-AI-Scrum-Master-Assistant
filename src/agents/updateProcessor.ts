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

/** Key order: SCRUM-2 before SCRUM-10. */
function byKey (a: Story, b: Story): number {
  return a.key.localeCompare(b.key, undefined, { numeric: true })
}

/**
 * The stories the model may choose from (SPEC-004 items 22, 32): every open
 * story in the sprint, in key order — listing the member's own first leaned the
 * model towards them. Trimmed only for an unusually large sprint: own stories
 * and keyed ones always stay, then the stories whose title and description
 * share the most words with the message.
 */
export function candidateStories (all: Story[], jiraAccountId: string, text: string, keyed: string[]): Story[] {
  const own = all.filter((s) => jiraAccountId !== '' && s.assigneeAccountId === jiraAccountId)
  const others = all.filter((s) => !own.includes(s))
  if (all.length <= MAX_CANDIDATES) return [...all].sort(byKey)

  const said = words(text)
  const score = (story: Story): number => [...words(`${story.title} ${story.about ?? ''}`)].filter((w) => said.has(w)).length
  const mustKeep = others.filter((s) => keyed.includes(s.key))
  const ranked = others
    .filter((s) => !mustKeep.includes(s))
    .sort((a, b) => score(b) - score(a))
    .slice(0, OTHERS_WHEN_TRIMMED)
  return [...own, ...mustKeep, ...ranked].sort(byKey)
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
      // Item 38: kept alongside a pick too, so a card can offer every story it could fit.
      alternatives: [...new Set(entry.alternatives.filter((key) => offered.has(key) && key !== storyRef))].slice(0, 4)
    }
  }
  return {
    ...output,
    completed: output.completed.map(item),
    inProgress: output.inProgress.map(item),
    blockers: output.blockers.map((b) => {
      const storyRef = known(b.storyRef)
      return { ...b, storyRef, alternatives: [...new Set(b.alternatives.filter((key) => offered.has(key) && key !== storyRef))].slice(0, 4) }
    })
  }
}

/**
 * Words that say nothing about which story is meant (SPEC-004 item 27): "the
 * service work", "my task", "implemented the piece". They appear in almost any
 * update or title, so they are never evidence of a match.
 */
const VAGUE = new Set([
  'work', 'task', 'tasks', 'story', 'stories', 'ticket', 'tickets', 'item', 'items', 'piece', 'part', 'stuff', 'thing', 'things',
  'done', 'finish', 'finished', 'complete', 'completed', 'working', 'worked', 'start', 'started', 'starting', 'continue', 'continuing',
  'today', 'yesterday', 'tomorrow', 'currently', 'will', 'have', 'been', 'with', 'from', 'that', 'this', 'then', 'also', 'just', 'some',
  'more', 'still', 'again', 'implement', 'implemented', 'implementing', 'implementation', 'build', 'built', 'building',
  'service', 'services', 'application', 'system', 'feature', 'module', 'component', 'code', 'coding', 'test', 'testing', 'tests',
  'deploy', 'deployed', 'deployment', 'auth'
])

/**
 * Words that fill a reason without saying anything about the work: "matches
 * their story", "related to the ticket". A reason made only of these (and
 * VAGUE words) names nothing specific.
 */
const FILLER = new Set([
  'story', 'stories', 'acceptance', 'criteria', 'title', 'titles', 'description', 'about', 'user', 'member', 'person', 'their', 'they',
  'them', 'this', 'that', 'these', 'those', 'match', 'matches', 'matched', 'matching', 'related', 'relates', 'relating', 'belongs',
  'belong', 'mentions', 'mentioned', 'mention', 'refers', 'refer', 'says', 'said', 'fits', 'fit', 'which', 'because', 'words',
  'message', 'update', 'assigned', 'owner', 'yours', 'your', 'only', 'clearly', 'likely', 'probably', 'most', 'same', 'where',
  'what', 'there', 'here', 'into', 'onto', 'part', 'parts', 'scrum', 'sprint', 'open', 'current'
])

/** True when a reason names something specific — at least one word that is neither vague nor filler. */
export function reasonIsSpecific (reason: string | null | undefined): boolean {
  if (reason === null || reason === undefined) return false
  return reason.toLowerCase().split(/[^a-z]+/)
    .some((w) => w.length >= 4 && !VAGUE.has(w) && !FILLER.has(w))
}

/**
 * SPEC-004 item 33: a key the member did not type is kept only when Agent 1
 * says what in that story the work belongs to. A missing or vague reason
 * means the model guessed: the entry becomes a question (item 34c) offering
 * that story, and a blocker becomes one with no work item (item 19).
 *
 * Replaces item 27's title-word guard, which rejected any match that did not
 * repeat a word from the title — the right story included.
 */
export function requireReason (output: ExtractionOutput, typed: Set<string>): ExtractionOutput {
  const item = (entry: ExtractionOutput['completed'][number]): ExtractionOutput['completed'][number] => {
    if (entry.storyRef === null || typed.has(entry.storyRef) || reasonIsSpecific(entry.reason)) return entry
    console.log(JSON.stringify({ event: 'agent1.unsupportedMatch', key: entry.storyRef }))
    return { ...entry, storyRef: null, alternatives: [entry.storyRef, ...entry.alternatives.filter((k) => k !== entry.storyRef)].slice(0, 4) }
  }
  const completed = output.completed.map(item)
  const inProgress = output.inProgress.map(item)
  // A blocker on a story the same message already names (with a reason) is supported by it.
  const supported = new Set([...completed, ...inProgress].map((e) => e.storyRef).filter((k): k is string => k !== null))
  const blockers = output.blockers.map((b) => {
    if (b.storyRef === null || typed.has(b.storyRef) || supported.has(b.storyRef) || reasonIsSpecific(b.reason)) return b
    console.log(JSON.stringify({ event: 'agent1.unsupportedMatch', key: b.storyRef, blocker: true }))
    return { ...b, storyRef: null, alternatives: [b.storyRef, ...b.alternatives.filter((k) => k !== b.storyRef)].slice(0, 4) }
  })
  return { ...output, completed, inProgress, blockers }
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
  /** SPEC-004 item 36: Agent 1's own model; empty or absent means LLM_MODEL. */
  model?: string
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
  /** SPEC-004 item 39: no sprint (or nothing open in it): every part is general work. */
  general: boolean
  /**
   * SPEC-004 item 42 (M12): the member has no open story of their own, or is
   * not linked to Jira, but the sprint has stories. Work is matched by context
   * to anyone's story and confirmed on a card; what fits nothing is general.
   */
  noOwnStory: boolean
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
  // M10: the team's own project; older fakes without one fall back to the setting.
  const projectKey = pm.projectKey ?? config.jira.projectKey
  const text = normaliseKeysInText(truncated ? input.text.slice(0, options.maxInputChars) : input.text, projectKey)
  const typed = new Set(keysInText(text, projectKey))

  // Fetched once and passed to the model in the prompt. A tool round-trip for
  // the same facts would resend the whole conversation, which costs far more
  // than the lines this produces.
  const sprintStories = candidateStories(await pm.getSprintOpenItems(), input.jiraAccountId, text, [...typed])
  const openItems = sprintStories.filter((s) => input.jiraAccountId !== '' && s.assigneeAccountId === input.jiraAccountId)
  // SPEC-004 item 39: no sprint, or nothing open in it → a general update;
  // the model is offered no stories, so it cannot match one. Item 42 (M12): no
  // story of their own but a sprint with stories → offered every story, so work
  // is matched by context and confirmed on a card.
  const general = sprintStories.length === 0
  const noOwnStory = !general && openItems.length === 0
  const candidates = general ? [] : sprintStories

  const request = {
    system: UPDATE_PROCESSOR_SYSTEM,
    user: updateProcessorUser(
      input.memberName, text,
      candidates.map((story) => ({
        key: story.key,
        title: story.title,
        status: story.status,
        owner: story.assignee,
        mine: openItems.includes(story),
        about: story.about ?? null
      })),
      input.activeBlockers ?? [],
      general ? 'general' : noOwnStory ? 'noOwnStory' : 'own'
    ),
    tools: storyTools,
    maxToolIterations: options.maxToolIterations,
    // Room for a thinking model's reasoning as well as the JSON: at 1024,
    // gemini-3.5-flash ran out mid-answer on 20 of 69 eval cases (1 Oct 2026).
    maxOutputTokens: 8192,
    timeoutMs: options.timeoutMs,
    label: 'agent1',
    // Item 36: a stronger model than the summary's; empty means LLM_MODEL.
    ...(options.model === undefined || options.model === '' ? {} : { model: options.model })
  }
  const executeTool = createStoryToolExecutor(pm, input.jiraAccountId)

  let lastError: unknown
  // A retry is the same model asked again; that is not a fallback. Switching to
  // a different source of the answer would be (SPEC-004 item 10).
  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    try {
      const response = await llm.complete(request, executeTool)
      return {
        // Items 23 and 33: only offered or typed keys, and only with a specific reason.
        output: requireReason(
          restrictToKnownKeys(parseExtraction(response.text), new Set(candidates.map((s) => s.key)), typed),
          typed
        ),
        openItems,
        candidates,
        general,
        noOwnStory,
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
