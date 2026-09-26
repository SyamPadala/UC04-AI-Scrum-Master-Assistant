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
- inProgress: work they say they are doing now or will do next, and work that was blocked but can now move again
- blockers: anything stopping them, waiting on someone else, or described as stuck

Matching work items:
- You are given the person's open sprint items and any blockers they reported earlier that are still open.
- People rarely type keys. Match what they describe to an item by meaning, not exact words: "risk score issue" or "the scoring rules" is the Risk Scoring item; "the endpoint" is the item whose title is about an endpoint. Use the key only when one item clearly fits.
- A message that one of their open blockers is resolved, sorted, cleared, unblocked, fixed, or that they can now progress or move forward, is an inProgress entry for that blocker's work item. It is a status update, never "nothing to report".
- A resolved problem that matches no open blocker and names no work item is not an entry of its own. "The VPN issue is sorted, back on SCRUM-6" is one inProgress entry, SCRUM-6, and nothing else.
- If all they say about an item is that it is blocked, put it in blockers only. If they also describe work done or under way on it ("coded but waiting on review"), put it in both inProgress and blockers.
- Work they plan to start next, even if not started yet, is inProgress.
- A question about an item, or saying they have not touched it and have no plans to, is not a status update.

Rules:
- Return JSON only. No prose, no code fences, no explanation.
- Use the person's own words for "comment" and "description". Do not rewrite, summarise or improve them.
- Split distinct pieces of work into separate entries. One sentence covering two work items is two entries.
- "storyRef" is a work item key such as SCRUM-12. Use it only when the person's words point to a specific item. If they did not, use null. Never invent a key.
- A person may mention a work item key that is not in their open items. Use the lookup_story tool to check it exists before using it. If it does not exist, keep their words and set storyRef to null.
- If the message is not a status update at all (a greeting, thanks, a question to you), return empty lists and set confidence to "low".
- Only when the person explicitly says there is nothing to report, return empty lists and set confidence to "high".
- If they report their own work but you cannot tell which item or what state, still return your best reading with storyRef null and set confidence to "low".
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
  openItems: Array<{ key: string, title: string, status: string }>,
  activeBlockers: Array<{ workItem: string | null, description: string, since: string }> = []
): string {
  const items = openItems.length === 0
    ? '(no open sprint items are recorded for this person)'
    : openItems.map((item) => `${item.key} [${item.status}] ${item.title}`).join('\n')
  // Without these, "the issue got resolved" has nothing to attach to (SPEC-004 5a).
  const blockers = activeBlockers.length === 0
    ? '(none)'
    : activeBlockers.map((b) => `${b.workItem ?? 'no work item'} — ${b.description} (last reported ${b.since})`).join('\n')

  return `Open sprint items assigned to ${memberName}:
${items}

Blockers ${memberName} reported earlier that are still open:
${blockers}

${memberName} wrote:
"""
${text}
"""`
}
