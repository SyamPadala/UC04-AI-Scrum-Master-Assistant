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
}

/**
 * Pulls the JSON object out of a model reply.
 *
 * Models sometimes wrap JSON in a fenced code block even when asked not to.
 * Tolerating that is not repairing the output — the content is unchanged, only
 * the wrapper is discarded.
 */
export function parseExtraction (raw: string): ExtractionOutput {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? raw).trim()

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
