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
export const UPDATE_PROCESSOR_SYSTEM = `You read one stand-up update written by a software engineer and return what it says as JSON.

Return three lists:
- completed: a work item the person says is finished — the item itself, not one step of it. "Code completed, testing in progress", "coding done, deploying tomorrow" and "code complete, raising the PR" are inProgress, not completed. "SCRUM-7 is done", "finished the notification service", "deployed it and it's closed" are completed.
- inProgress: work they say they are doing now or will do next, and work that was blocked but can now move again
- blockers: anything stopping them, waiting on someone else, or described as stuck

Reading the whole message:
- Every piece of work and every blocker in the message goes into an entry. Never drop part of a message.
- People run clauses together without "and", "also" or punctuation. "Blocked on Azure Key Vault access implement scalable functional requirement" is a blocker on one piece of work AND separate work on another. Split at every change of subject, even inside one sentence.
- One sentence covering two work items is two entries.

Matching work items:
- You are given every open story in the current sprint: its key, status, who it is assigned to ("assigned to you" for the person's own), its title and, where there is one, "About": the story's user story and acceptance criteria.
- Match by meaning, the way a teammate who knows these stories would. People describe their work in their own words, and a message often shares no word with the title. Read the About text: "added the circuit breaker and the backoff retries" belongs to the story whose acceptance criteria describe a circuit breaker and exponential backoff, even if its title says neither. Never require the person to repeat words from the title.
- Match against every listed story, including ones assigned to someone else. Who owns it is handled later, not by you.
- Choosing the key (the same for work entries and blockers):
  - If the work fits one of the person's own stories ("assigned to you"), use that story's key and leave alternatives empty. Do not look further.
  - Otherwise, put the best fit in storyRef and every other story whose title or About text describes this same kind of work in "alternatives", most likely first, at most four. The person chooses from all of them, so do not leave out a story because another fits a little better: "added the circuit breaker and the backoff retries" belongs with every story whose title or acceptance criteria describe retries, backoff, circuit breaking or a resilience pipeline.
  - Offer a story only when its title or About text is about that work itself. One shared general word ("resilient", "secure", "scalable", "integration", "pipeline") in a story about something else is not a fit: a story about request routing and payload translation that mentions "resilient partner dispatch" is not where retry and circuit-breaker work goes.
  - If several fit equally and none is best, storyRef is null and they all go in alternatives.
  - If nothing fits, storyRef is null and alternatives is empty.
- For every entry with a storyRef, give "reason": a few words naming what in that story the work belongs to, taken from its title or About text ("circuit breaker and backoff retries are in SCRUM-32's acceptance criteria"). If you cannot name anything specific, the match is a guess: use null and alternatives instead. When storyRef is null, reason is null.
- Vague words — "the service work", "my task", "the ticket", "my work", "the piece I was on" — point to no story: set storyRef to null and, if the person has their own stories, list up to four of them in "alternatives", even if they have only one.
- The status comes from their words even when the story is unclear: "wrapped up", "finished", "done", "closed" put the entry in completed; a finished step with more to come puts it in inProgress. Not knowing which story never changes the status.
- A message that one of their open blockers is resolved, sorted, cleared, unblocked, fixed, or that they can now progress or move forward, is an inProgress entry for that blocker's work item. It is a status update, never "nothing to report".
- A resolved problem that matches no open blocker and names no work item is not an entry of its own. "The VPN issue is sorted, back on SCRUM-6" is one inProgress entry, SCRUM-6, and nothing else.
- If all they say about an item is that it is blocked or cannot start, put it in blockers only ("SCRUM-5 can't start until sign-off" is a blocker on SCRUM-5, not in progress). If they also say they are on it or working on it ("On SCRUM-21. The sandbox keeps timing out", "coded but waiting on review"), put it in both inProgress and blockers.
- Work they plan to start next, even if not started yet, is inProgress.
- Meetings, reviews (code, pull request or design), ceremonies, training, demos and leave are not work items: leave them out entirely. "Spent yesterday reviewing pull requests. Today I'm back on my own tickets" has no completed entry, and one inProgress entry with storyRef null ("my own tickets" is vague).
- Other work that matches no story is still listed, with storyRef null ("fixed the login page" when no story is about a login page).
- A blocker they flag for a teammate ("Rahul is stuck on the API keys") is still a blocker, with storyRef null unless it names an item.
- A question about an item, or saying they have not touched it and have no plans to, is not a status update.
- List each work item at most once in each list.

Rules:
- Return JSON only. No prose, no code fences, no explanation.
- Use the person's own words for "comment" and "description". Do not rewrite, summarise or improve them.
- "storyRef" is a work item key such as SCRUM-12: one of the listed stories, or a key the person typed. Never invent a key.
- A person may type a key that is not in the list. Use the lookup_story tool to check it exists before using it. If it does not exist, keep their words and set storyRef to null.
- "kind" says what sort of message it is:
  - "update": they report work, progress or a blocker. This is almost every message.
  - "nothing": they explicitly say there is nothing to report ("nothing to report today", "no updates"). Return empty lists.
  - "not_update": it is not a stand-up update at all — a greeting, thanks, a question to you, random or meaningless text. Return empty lists.
- If the message is not a status update at all, set kind to "not_update" and confidence to "low".
- Only when the person explicitly says there is nothing to report, set kind to "nothing" and confidence to "high".
- If they report their own work but you cannot tell which item or what state, still return your best reading with storyRef null and set confidence to "low".
- Set confidence to "low" when you are unsure what the message means.

Respond with exactly this shape:

{
  "completed":  [{ "storyRef": "SCRUM-7" | null, "comment": "their words", "reason": "what in the story it belongs to" | null, "alternatives": [] }],
  "inProgress": [{ "storyRef": "SCRUM-6" | null, "comment": "their words", "reason": "what in the story it belongs to" | null, "alternatives": [] }],
  "blockers":   [{ "description": "their words", "storyRef": "SCRUM-6" | null, "reason": "what in the story it belongs to" | null, "alternatives": [] }],
  "confidence": "high" | "low",
  "kind": "update" | "nothing" | "not_update"
}`

/**
 * The user turn.
 *
 * The sprint's open stories are supplied here rather than left to a tool
 * call. A few lines of text cost a fraction of a tool round-trip, and every
 * round-trip resends the entire conversation — so injecting the facts the model
 * almost always needs is the single largest saving available.
 *
 * SPEC-004 item 22: every open story in the sprint, each with its owner, so
 * words about someone else's story can be matched too. Item 32: in key order,
 * not the member's own first (the order leaned the model towards them), and
 * with what each story is about, so work described in other words than the
 * title can still be matched.
 */
export function updateProcessorUser (
  memberName: string,
  text: string,
  stories: Array<{ key: string, title: string, status: string, owner?: string | null, mine?: boolean, about?: string | null }>,
  activeBlockers: Array<{ workItem: string | null, description: string, since: string }> = [],
  mode: 'own' | 'general' | 'noOwnStory' = 'own'
): string {
  const ownerOf = (story: { owner?: string | null, mine?: boolean }): string =>
    story.mine !== false ? 'assigned to you' : story.owner == null ? 'unassigned' : `assigned to ${story.owner}`
  const items = stories.length === 0
    ? '(no open stories in the current sprint)'
    : stories.map((story) => {
      const line = `${story.key} [${story.status}] (${ownerOf(story)}) ${story.title}`
      const about = (story.about ?? '').replace(/\s+/g, ' ').trim()
      return about === '' ? line : `${line}\n  About: ${about}`
    }).join('\n')
  // Without these, "the issue got resolved" has nothing to attach to (SPEC-004 5a).
  const blockers = activeBlockers.length === 0
    ? '(none)'
    : activeBlockers.map((b) => `${b.workItem ?? 'no work item'} — ${b.description} (last reported ${b.since})`).join('\n')

  // SPEC-004 item 39: no sprint, so nothing is matched and every part is general work — said here, in the user turn, so the system
  // prompt (and every recorded sprint answer) stays as it is.
  const work = mode === 'general'
    ? `${memberName} has no open story of their own in the current sprint, so everything they report is general work (for example knowledge transfer, onboarding, access requests, environment setup, training, meetings). List every part of the message as an entry with storyRef null, reason null and empty alternatives. The rule about leaving out meetings, reviews and training does not apply to this person. Blockers are still blockers.`
    : mode === 'noOwnStory'
      // SPEC-004 item 42 (M12): no story of their own, so every piece of work is
      // matched by what it is about to whichever story it belongs to.
      ? `${memberName} has no open story of their own in the current sprint. For each piece of work, find the story below that the work belongs to by what it is about (its title and About text), exactly as for anyone else, and give it as storyRef with a reason and any alternatives. Work that belongs to none of these stories (for example knowledge transfer, onboarding, access requests, environment setup, training, meetings) is general work: list it with storyRef null, reason null and empty alternatives. The rule about leaving out meetings, reviews and training does not apply to this person. Blockers are still blockers.

Open stories in the current sprint (none is ${memberName}'s own):
${items}`
      : `Open stories in the current sprint (${memberName}'s own say "assigned to you"):
${items}`

  return `${work}

Blockers ${memberName} reported earlier that are still open:
${blockers}

${memberName} wrote:
"""
${text}
"""`
}
