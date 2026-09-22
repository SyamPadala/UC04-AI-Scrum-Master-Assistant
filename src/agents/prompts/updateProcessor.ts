/**
 * Agent 1's standing instructions (SPEC-004).
 *
 * Kept in its own module rather than inline in the agent (coding rule 17).
 * SPEC-004 names a `.md` file; a `.ts` module is used instead so the prompt is
 * compiled into `dist/` like everything else — `tsc` does not copy plain files,
 * and a prompt that exists locally but not on Cloud Run is a failure that only
 * shows up after deploying.
 *
 * The wording is deliberately stable. It forms part of the response cache key,
 * so every edit invalidates every recorded answer and the eval has to be paid
 * for again.
 */
export const UPDATE_PROCESSOR_SYSTEM = `You read one short stand-up update written by a software engineer and return what it says as JSON.

Return three lists:
- completed: work the person says is finished
- inProgress: work they say they are doing now or will do next
- blockers: anything stopping them, waiting on someone else, or described as stuck

Rules:
- Return JSON only. No prose, no code fences, no explanation.
- Use the person's own words for "comment" and "description". Do not rewrite, summarise or improve them.
- Split distinct pieces of work into separate entries. One sentence covering two work items is two entries.
- "storyRef" is a work item key such as SCRUM-12. Use it only when the person's words point to a specific item. If they did not, use null. Never invent a key.
- A person may mention a work item key that is not in their open items. Use the lookup_story tool to check it exists before using it. If it does not exist, keep their words and set storyRef to null.
- Something can be both in progress and blocked. Record it in both lists.
- If the message is not a status update at all, return empty lists and set confidence to "low".
- If the message says there is nothing to report, return empty lists and set confidence to "high".
- Set confidence to "low" when you are unsure what the message means.

Respond with exactly this shape:

{
  "completed":  [{ "storyRef": "SCRUM-7" | null, "comment": "their words" }],
  "inProgress": [{ "storyRef": "SCRUM-6" | null, "comment": "their words" }],
  "blockers":   [{ "description": "their words", "storyRef": "SCRUM-6" | null }],
  "confidence": "high" | "low"
}`

/**
 * The user turn.
 *
 * The member's open sprint items are supplied here rather than left to a tool
 * call. Six lines of text cost a fraction of a tool round-trip, and every
 * round-trip resends the entire conversation — so injecting the facts the model
 * almost always needs is the single largest saving available.
 */
export function updateProcessorUser (
  memberName: string,
  text: string,
  openItems: Array<{ key: string, title: string, status: string }>
): string {
  const items = openItems.length === 0
    ? '(no open sprint items are recorded for this person)'
    : openItems.map((item) => `${item.key} [${item.status}] ${item.title}`).join('\n')

  return `Open sprint items assigned to ${memberName}:
${items}

${memberName} wrote:
"""
${text}
"""`
}
