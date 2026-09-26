import { z } from 'zod'

/**
 * Agent 1's output contract (SPEC-004, FR-03).
 *
 * The model's reply is parsed through this before anything is done with it.
 * Output that does not fit **fails the call** — it is never repaired, and never
 * replaced with something the program made up. A result that could have come
 * from either source would not be evidence that the model works.
 */

const itemSchema = z.object({
  /** Work item key such as 'SCRUM-7', or null when the member named none (A8). */
  storyRef: z.string().trim().min(1).nullable().catch(null),
  comment: z.string().trim().min(1)
})

const blockerSchema = z.object({
  description: z.string().trim().min(1),
  storyRef: z.string().trim().min(1).nullable().catch(null)
})

export const extractionSchema = z.object({
  completed: z.array(itemSchema).default([]),
  inProgress: z.array(itemSchema).default([]),
  blockers: z.array(blockerSchema).default([]),
  confidence: z.enum(['high', 'low']).default('high')
})

export type ExtractionOutput = z.infer<typeof extractionSchema>

export interface ExtractionInput {
  text: string
  memberId: string
  memberName: string
  teamId: string
  /** Empty when the member has no Jira link recorded (checklist item 5b). */
  jiraAccountId: string
  /** Blockers this member raised earlier that are still open (SPEC-004 5a). */
  activeBlockers?: Array<{ workItem: string | null, description: string, since: string }>
}

/**
 * Pulls the JSON object out of a model reply.
 *
 * Models sometimes wrap JSON in a fenced code block even when asked not to, or
 * after a tool call prefix it with a stray "json" (seen from Gemini, 26 Sep).
 * Tolerating that is not repairing the output — the content is unchanged, only
 * the wrapper around the outermost object is discarded.
 */
export function jsonObjectIn (raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = (fenced?.[1] ?? raw).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start === -1 || end < start ? text : text.slice(start, end + 1)
}

export function parseExtraction (raw: string): ExtractionOutput {
  const candidate = jsonObjectIn(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    throw new Error('agent returned output that is not valid JSON')
  }

  const result = extractionSchema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ')
    throw new Error(`agent output failed validation: ${detail}`)
  }
  return result.data
}

/**
 * Agent 2's output contract (SPEC-006 item 4, amended 25 Sep 2026).
 *
 * The five sections as data, so code can lay them out in a Teams card and an
 * email. Same rule as Agent 1: output that does not fit fails the call.
 */
const text = z.string().trim().min(1)

export const summarySchema = z.object({
  updates: z.array(z.object({ member: text, lines: z.array(text).min(1) })),
  blockers: z.array(z.object({ member: text, workItem: text.nullable().catch(null), description: text, since: text.nullable().catch(null) })),
  progress: text,
  atRisk: z.array(z.object({ workItem: text, reason: text })),
  velocity: text,
  participation: text
})

export type SummaryOutput = z.infer<typeof summarySchema>

export function parseSummary (raw: string): SummaryOutput {
  const candidate = jsonObjectIn(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    throw new Error('agent returned output that is not valid JSON')
  }

  const result = summarySchema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ')
    throw new Error(`summary output failed validation: ${detail}`)
  }
  return result.data
}
