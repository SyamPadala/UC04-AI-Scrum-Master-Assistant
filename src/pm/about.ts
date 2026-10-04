/**
 * What a story is about, for Agent 1 (SPEC-004 item 32).
 *
 * A title rarely names the work a member describes: "added the circuit breaker
 * and the backoff retries" is in SCRUM-32's acceptance criteria, not its title.
 * So the User Story and Acceptance Criteria text of the Jira description goes
 * to the model with the title. Everything from "Design Traceability" on is
 * reference noise and is dropped.
 */

/** Longest description text sent per story. */
export const MAX_ABOUT_CHARS = 800

interface AdfNode { type?: string, text?: string, content?: AdfNode[] }

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow', 'rule'])

/** Plain text of an Atlassian Document Format node; a plain string passes through. */
export function adfText (node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const adf = node as AdfNode
  if (adf.type === 'text') return adf.text ?? ''
  if (adf.type === 'hardBreak') return '\n'
  const inner = (adf.content ?? []).map(adfText).join('')
  return BLOCKS.has(adf.type ?? '') ? `${inner}\n` : inner
}

/** The part of a description worth sending, or null when there is none. */
export function storyAbout (description: unknown): string | null {
  const text = adfText(description)
    .split(/design traceability/i)[0]
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  if (text === '') return null
  return text.length <= MAX_ABOUT_CHARS ? text : `${text.slice(0, MAX_ABOUT_CHARS - 1).trimEnd()}…`
}
