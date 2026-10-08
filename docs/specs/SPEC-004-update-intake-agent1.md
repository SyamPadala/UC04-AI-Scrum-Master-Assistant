# SPEC-004: Update intake and Agent 1 extraction

| | |
|---|---|
| **Status** | Approved — amendment of 28 Sep 2026 (items 11–20) approved 28 Sep 2026; amendment of 29 Sep 2026 (items 14, 14a) approved 29 Sep 2026; amendment of 29 Sep 2026 (items 21–26) approved 29 Sep 2026; items 27–30 approved 29 Sep 2026; item 14b approved 30 Sep 2026; amendment of 30 Sep 2026 night (items 31–37) approved 30 Sep 2026; item 38 approved 1 Oct 2026; item 39 approved 4 Oct 2026; item 40 approved 5 Oct 2026; item 41, 42 approved 8 Oct 2026 |
| **Delivers** | FR-02, FR-03, NFR Latency |
| **Assumptions** | A8 (story resolution), A11 (messages combined per member per day) |
| **Depends on** | SPEC-001, SPEC-002 |
| **Owner** | Claude |

## Intent

**In plain words:** a team member replies to the assistant in whatever words
they like — no form, no template. The assistant reads it and works out three
things: what they finished, what they're working on, and what's blocking them.
It can look up a story number to check it is real. Then it files the result in
the team's tracker.

This is the riskiest part of the build, so it is built and measured first.

## Behaviour

1. Any personal message from a roster member arriving at `/api/messages` is
   treated as a stand-up update. No command, keyword or format is required
   (FR-02).
2. The member is acknowledged in Teams promptly, without waiting for the full
   extraction to finish.
3. Agent 1 extracts three fields from the text: `completed`, `inProgress`,
   `blockers` (FR-03). Output is structured JSON validated against a schema.
4. Agent 1 may call **read-only** tools to establish facts:
   `lookup_story(id)` and `get_member_open_items(memberId)`.
5. A blocker's affected story is resolved from an explicit id or from a
   description matched against the member's open items; when neither succeeds,
   `storyRef` is `null` and it is reported as "not specified" (A8).
5a. *Added 25 Sep 2026 (user decision, after "Risk score issue got resolved…"
   was silently dropped):* Agent 1 is also given the member's **active
   blockers** (SPEC-006 4a). A message saying a blocker is resolved, cleared,
   or that they can progress again is an **in-progress** update on that item,
   which clears the blocker. Informal names ("risk score issue") are matched to
   open items and active blockers by meaning.
5b. When a message yields nothing and the model is unsure (`confidence: low`),
   or it yields nothing for a member who has already reported today, **nothing
   is written** and the member is asked which work item they mean. The
   assistant never replies "Recorded" when it recorded nothing.
6. Code — never the agent — then writes the result to the team's tracker
   (SPEC-002) and, if blockers exist, triggers escalation (SPEC-005).
7. Further messages from the same member on the same day are re-extracted
   together with the earlier text and the record is updated, not duplicated
   (A11).
8. The whole path — message received to tracker written — is timed and must
   complete within 30 seconds (Latency NFR).
9. **No fallback extraction.** If the agent exceeds its cap or timeout, or
   returns invalid JSON, the extraction **fails explicitly**: nothing is written
   to the tracker, the failure is recorded, and the member is told their update
   could not be processed. The program never substitutes its own extraction for
   the model's, because a result that might have come from either is not
   evidence that the model works.
10. A failed call may be **retried** against the same model (a retry is the same
    source; a fallback is a different one). Retries are capped and recorded.

### Amendment 28 Sep 2026 — no silent outcomes (user decisions)

*Why:* in the 28 Sep demo the sprint had not been started, so every update was
filed with no work item and nobody was told. Each case below was silent before.
Code decides and acts in every case; Agent 1 only reads the message.

11. **Only items with a verified work item are recorded.** A tracker row is
    written for an item only when its `storyRef` exists in Jira **and** is
    assigned to the sender (checked by code against the member's linked
    `jiraAccountId`). Everything else is reported back to the member (12–16)
    and not written. This replaces the General row (SPEC-002 2b) for new
    writes.
12. **No active sprint.** Nothing is recorded. The member is told: *"There is no
    active sprint, so I couldn't link your update to a work item and haven't
    recorded it. Your Scrum Master has been told."* The Scrum Master gets one
    alert per team per day: *"No active sprint in <project>. Stand-up updates
    can't be matched to work items."* The alert is idempotent on
    `teamId + date + 'noSprint'`.
13. **Sprint active, no work item found for an item.** That item is not
    recorded. The member is told: *"I couldn't find a work item for: '<their
    words>'. Your open items: SCRUM-27 <title>, …. Which one is it?"*
14. **Unassigned work item.** Not recorded. The member is told: *"SCRUM-28 is
    not assigned to you, so it can't be updated. Please reach out to your
    Scrum Master."*
14a. *Amended 29 Sep 2026 (user decision; replaces the 28 Sep "no card").*
    **Work item assigned to someone else.** Not recorded yet; the member gets
    a card: *"SCRUM-25 is assigned to Pravallika, not you. Submit your update
    anyway?"* **[Submit] [Cancel]**.
    - **Submit:** code records the item under the **sender's** name, with the
      comment prefixed *"(assigned to <owner>)"*, and replies *"Recorded
      SCRUM-25 in the tracker. Please ask your Scrum Master to assign it to
      you in Jira."* Jira is not changed.
    - **Cancel:** *"SCRUM-25 not recorded."*
    - The pending item travels in the card's button data (key, status,
      comment, blocker, date), so nothing is stored in Firestore (Privacy
      NFR). On Submit, code re-checks the story in Jira: it must still exist
      and still not be unassigned.
    - Submitting twice records once (the row is updated in place, keyed on
      member + work item). A card from another day, or after the day's
      scheduled summary, records nothing: *"This card has expired"* / the
      stand-up-closed notice.
    - The member's own items in the same message are recorded at once; only
      the other person's item waits for the button.
14b. *Amended 30 Sep 2026 (demo-day test; user decision).* A blocker on
    someone else's story is **not alerted at intake**. It is alerted on
    **Submit**, with the story; **Cancel** sends nothing. Blockers on the
    member's own story, or on no story, are still alerted at once (item 19).
    When the blocker text equals the comment, the card shows it once.
    Two members' rows on one story are kept as they are (option A): each row
    shows who reported it.
15. **Not a stand-up update** (e.g. *"asdf lol"*, *"thanks!"*). Agent 1 labels
    the message `kind: 'not_update'`. Nothing is recorded; the member is told:
    *"This doesn't look like a stand-up update, so it isn't counted as a
    response."* They remain a non-responder (follow-up and flag apply).
16. **"Nothing to report today."** Agent 1 labels it `kind: 'nothing'`. No row
    is written and, for now, the member counts as a **non-responder**. The
    member is told: *"Nothing recorded. A stand-up update needs at least one
    work item, so this isn't counted as a response."* *Parked: the user will
    revisit whether this should count as a response.*
17. **Confirmation lists what was recorded.** Plain text, no card, one line per
    recorded item — WIN, Jira title, status — plus the blocker line when the
    Scrum Master was alerted. Items not recorded (12–14) follow in the same
    reply with their reason. The reply never says "Recorded" when nothing was.
18. **Mixed messages** are handled item by item: verified items are recorded
    and listed; the others get their reason in the same reply.

19. **Blocker with no work item** (*"my laptop is broken"*). Not written to the
    tracker, but the Scrum Master **is still alerted** (FR-06), and the member
    is told: *"Your Scrum Master has been told about: '<blocker>'. It isn't
    linked to a work item, so it hasn't gone into the tracker."* *User
    decision, 28 Sep 2026.*

20. **Member not linked to Jira.** Ownership (item 14) can't be checked, so
    nothing is recorded. The member is told: *"Your account isn't linked to
    Jira yet. Please ask your Scrum Master."* The readiness panel (SPEC-008
    10d) shows the missing link before the day starts. Checked before the
    model is called, so no LLM call is spent. *User decision, 28 Sep 2026.*

### Amendment 29 Sep 2026 — reliable work item resolution (approved 29 Sep 2026)

*Why:* in live testing, "scrum 25" and "scrum-24" were missed while "SCRUM-24"
was found; another member's story described in words was never matched,
because Agent 1 saw only the sender's own stories; "code completed, testing in
progress" was filed as Completed; and Submit on the 14a card was dropped
silently. The user asked for a foolproof design. Four layers, each catching
what the previous one misses. Code owns keys, candidates and every decision;
Agent 1 owns reading the words.

21. **Keys are found by code.** Before Agent 1 is called, any form of a key
    for the configured project in the member's text ("scrum 25", "Scrum-25",
    "SCRUM25", "scrum_25") is rewritten to its canonical form (SCRUM-25). Any
    key Agent 1 returns is canonicalised the same way. Only the key's
    formatting changes; the member's words are otherwise untouched.
22. **Agent 1 sees the whole active sprint.** Candidates are every open (not
    Done) story in the active sprint, each labelled with its assignee (or
    "unassigned"); the sender's own stories are listed first. Backlog and
    other sprints are not sent. Above 40 candidates, code keeps the sender's
    own stories, every story keyed in the message, and the 30 others whose
    titles share the most words with the message. *(Replaces items 4–5's
    "the member's open items".)*
23. **Agent 1 may only answer with a known key.** A key is accepted only if it
    is a candidate or appears in the member's text (then checked in Jira as
    before, item 15 of the rules). Any other key is treated as "no work item"
    (item 13). The model cannot invent a story.
24. **Unsure is never guessed.** When the words could mean more than one
    candidate, Agent 1 returns up to three alternatives instead of a key.
    Code sends a card: *"Which story is this? '<their words>'"* with one
    button per alternative (key, title, owner) and **None of these**.
    - Choosing the sender's own story records it.
    - Choosing another person's story records it under the sender with
      "(assigned to <owner>)" — the choice is the confirmation (as 14a).
    - Choosing an unassigned story, or None, records nothing and says why.
    - Same card rules as 14a: data in the buttons, Jira re-checked, twice
      records once, expired or closed records nothing.
25. **Completed means the story is done** (user decision, 29 Sep 2026). A
    story is Completed only when the member says the story itself is
    finished. A finished step with steps still to come ("code completed,
    testing in progress", "coding done, deploying tomorrow") is In Progress.
    The comment keeps their words.
26. **Every card press is answered.** Card data is read tolerantly (Teams
    leaves empty fields out); a press that still cannot be read gets *"I
    couldn't read that button press, nothing was recorded, please send the
    update again"* and is logged by field names only.

**Not in this amendment** (later, by the user's decision): a Jira board per
team; matching work outside the active sprint by words; a member on two
teams.

### Amendment 29 Sep 2026 (evening) — fixes from the live test (approved by the user, 29 Sep 2026)

27. **Vague words are asked about, even with one story** (user: "ask"). Agent
    1 is told not to prefer the member's own stories, and that vague words
    ("the service work", "my task", "the ticket") point to no story. **Code
    guard:** a key the member did not type is accepted only if their words
    for that item share at least one meaningful word with the story's title
    (or with an open blocker's text on that story). Otherwise it becomes a
    "Which story is this?" question (item 24) offering that story; for a
    blocker, it becomes a blocker with no work item (item 19). *(Live test 8:
    "Finished the service work" was filed as Completed on SCRUM-28.)*
28. **One reply per card press.** The card is replaced with the outcome; a
    separate message is sent only if Teams refuses the replacement.
    *(Every press was answered twice.)*
29. **Clearer wording.** The someone-else's-story line reads *"SCRUM-26 is
    assigned to sailaja, not you. Please confirm below if you still want it
    recorded."* and the unsure line *"Which story is '<words>'? Please choose
    below."* — no leading "?". Lines are separated so Teams shows them on
    their own lines.
29a. *Added 29 Sep 2026 (user decision, option A, after eval case e59).*
    **Status does not depend on knowing the story.** "Wrapped up", "finished",
    "done" are completed even when the story is unclear; a finished step with
    more to come stays in progress. The "Which story is this?" card shows
    *"Will be recorded as: <status>"* before anything is written.
30. **Meetings and similar are left out** (user decision). Meetings, reviews
    (code or design), ceremonies, training and leave are not work items and
    produce no entry, so the member gets no "couldn't find a work item" line
    for them. Real work that matches no story still gets item 13's reply.
    Rule "work that belongs to no item is still recorded with storyRef null"
    is withdrawn: since item 11 such entries are never written.
    *Eval relabel:* **e30** — "Spent yesterday reviewing pull requests. Today
    I'm back on my own tickets." — completed becomes empty (PR review is an
    activity); in progress stays one entry with no story ("my own tickets" is
    vague). Added: e58 "Finished my task" and e59 "Wrapped up the service
    work" (vague → no key).

**Also in this round, outside SPEC-004:** working days per team (SPEC-003
item 9, SPEC-008 Schedule); the eval's own usage counter (below);
`scripts/install-app.mjs` installs with the bot's registration.

**Eval budget** (user decision). The eval counts its calls under its own
scope (`LLM_USAGE_SCOPE=eval`), so it can never use up the service's daily
limit. A separate Gemini key for testing is recommended as a later step for
the user.

### Amendment 30 Sep 2026 (night) — intent, not keywords (approved by the user, 30 Sep 2026)

*Why:* the 30 Sep demo audience's verdict was that the assistant matches
keywords, not intent. That was true, and mostly our doing: a code guard
(item 27) kept a match only when the member's words shared a word with the
story **title**; Agent 1 saw titles only; the member's own stories were listed
first and marked "yours"; and Agent 1 ran on the smallest model. Live case:
Sailaja, *"added the circuit breaker and the backoff retries"* — the model
guessed her own SCRUM-34, the guard rejected it for sharing no title word, and
she got a picker. The work is in SCRUM-32's acceptance criteria.

31. **Intent is the requirement** (user decision). Agent 1 reads what the
    member did and finds the story that work belongs to, whatever words they
    used. A message that shares **no word** with a story's title must still
    match it when the work belongs to it.
32. **Agent 1 sees what each story is about.** Each candidate is sent with its
    title, owner, status and the **User Story** and **Acceptance Criteria**
    text from its Jira description (read as plain text; everything from
    "Design Traceability" on is dropped; at most 800 characters per story).
    A story with no description is sent with its title only. Candidates are
    listed **in key order**, the owner shown as plain information — the
    sender's own stories are no longer listed first. *(Replaces item 22's
    ordering. Above 40 candidates, the 30 "others" are chosen by overlap with
    title and description.)*
33. **The keyword guard is removed.** *(Replaces item 27's code guard; its
    prompt rule on vague words stays.)* For every entry with a key, Agent 1
    returns a short **reason** in its own words naming what in that story the
    work belongs to (*"circuit breaker and backoff are in SCRUM-32's
    acceptance criteria"*). Code rejects a match only when the reason is
    missing or made of vague words alone ("my task", "the ticket", "my
    work"); a rejected match is treated as unsure (item 34c). The reason is
    never written to Firestore, the tracker or the logs.
34. **Which story — decided by these rules** (user decisions, 30 Sep 2026):
    - **a. Her own story matches** → recorded straight away. No card, and no
      check of whether other stories would match too.
    - **b. Exactly one story matches, and it is someone else's** → the 14a
      card (Submit / Cancel), as today.
    - **c. Several stories match, none of them hers** → one card, *"Which
      story is '<their words>'?"*, listing every match (key, title, owner,
      "Will be recorded as: <status>"), at most **4**, plus **None of these**.
      After a pick, a **confirmation** before anything is written: the 14a
      card for someone else's story; *"Record your update against SCRUM-34
      (yours)?"* **Submit / Cancel** for her own. *(Replaces item 24's "the
      choice is the confirmation".)*
    - **d. Nothing matches** → item 13 (not recorded; her open items listed).
    - **Blockers** follow a and b. A blocker that fits several stories, or
      none, is a blocker with no work item (item 19, unchanged by the user's
      decision of 30 Sep).
35. **No part of a message is dropped** (issue #6). Every piece of work in the
    message appears in exactly one entry. Clauses run together without "and",
    "also" or punctuation are still separate: *"blocked on Azure Key Vault
    access implement scalable functional requirement"* is a blocker on one
    story **and** work on another. *(Sailaja, 5:13 and 5:15: the second clause
    vanished; with "also worked on" at 5:17 it was recorded.)*
36. **A stronger model for Agent 1** (user: "no issues to use it"). Agent 1
    uses `AGENT1_MODEL`, default `gemini-3.5-flash`; Agent 2 keeps
    `LLM_MODEL`. If the eval shows it is not enough, `gemini-3.5-pro` is the
    next step. No fallback: a failure retries the same model, then fails.
37. **Eval.** `eval/stories.json` gains the stories' User Story and
    Acceptance Criteria text. New cases:
    - **intent** — about 8 messages written from acceptance criteria that
      share no word with any title (e.g. "added the circuit breaker and the
      backoff retries" → SCRUM-32; "load tested it at 10k requests a minute"
      → the scalability story);
    - **run-on** — Sailaja's three message shapes above (no joining word, a
      comma, "also worked on"), rewritten against the eval's fixed stories,
      each expecting both stories;
    - **own first** — a message matching the member's own story and, less
      well, someone else's → own story, no alternatives.
    Passing: overall accuracy ≥ 90%, and every intent and run-on case correct.
    One run is about 70 live calls; it is run only with the user's go-ahead.

38. *Added 1 Oct 2026 (user decision; replaces 34b, 34c and, for work
    items, item 13's text list).* **One card whenever the update is not
    clearly her own story.** If the model picks one story, the member could
    never choose another (user: "what if she is giving an update for
    SCRUM-31? She will never see that story"). So:
    - **Her own story fits** → recorded straight away (34a, unchanged).
    - **Otherwise** — it fits someone else's story, several stories, or none
      of hers — one card lists **her own open stories first, then every
      other story it could fit**, at most 5 rows (other people's matches are
      always kept; her own fill the rest). Unassigned stories are not offered
      (item 14).
      > *Your update didn't match a story assigned to you.*
      > *These stories could fit "<her words>":*
      > *Will be recorded as: <status>* (and the blocker, if any)
      > **SCRUM-34** <title> — assigned to you **[Submit]**
      > **SCRUM-32** <title> — not assigned to you (Pravallika) **[Submit]**
      > **SCRUM-31** <title> — not assigned to you (Vardhan) **[Submit]**
      > **[None of these]**
      When every row is hers (vague words), the heading is *"Which of your
      stories is this?"*.
    - **Submit** records it at once — the card already says whose story it
      is, so there is no second confirmation. Someone else's story is
      recorded under her name with "(assigned to <owner>)", as 14a.
    - **None of these** records nothing.
    - **Blockers** use the same card. Submit writes the Blocked row and then
      alerts the Scrum Master with that story (as 14b). None of these writes
      nothing but **still alerts** the Scrum Master, as a blocker with no
      story (SPEC-005 2a). A blocker on her own story is alerted at once; a
      blocker that fits no story at all ("my laptop is broken") is alerted at
      once (item 19, unchanged).
    - Work that fits nothing and a member with no open stories → item 13's
      text reply, as before.
    - Agent 1 lists every story the work could plausibly belong to in
      "alternatives" (up to four) alongside its best pick, for work items and
      blockers alike, unless it is clearly her own story.
    - Card rules as 14a: data in the buttons, Jira re-read on Submit, twice
      records once, expired or closed records nothing.
    - Agent 1's answer limit is 8,192 tokens (a thinking model's reasoning
      counts against it). Agent 1 runs on `gemini-3.5-flash` in development,
      the eval and production alike, so the eval measures what runs (user
      decision, 1 Oct 2026). The summary (Agent 2) keeps `LLM_MODEL`.

**Also in this round, outside SPEC-004:** tracker resilience (SPEC-002 item
5a); Reopen stand-up (SPEC-008 10l).

### Amendment 4 Oct 2026 — general updates (approved by the user, 4 Oct 2026)

*Why:* a new joiner with no story, or a whole team between sprints, is told
"not recorded" every day and counted as a non-responder, although they did
report. User decision, 4 Oct 2026 (LATER.md L12). No admin setting and no mode:
code decides from Jira on every update.

39. **No story assigned to the member → General update.** When the team has
    **no active sprint**, or the sender has **no open (not Done) story
    assigned in the active sprint**, the update goes straight in as a
    **General** row (SPEC-002 2b), with no story matching and no card — also
    when the words fit a teammate's story. The tracker mirrors Jira: no open
    ticket of their own, nothing to put on a story. *(E.g. Sai Krishna, no
    story; Santhosh, whose only story is Done.)*
    - Agent 1 is still called, to read the message (update / nothing /
      not an update, status, blockers); it is sent no candidate stories.
    - The row: `WIN` empty, Description *General*, Assigned To and Updated By
      the sender, Comment their words — every part, including training and
      meetings (item 30 does not apply here), Status *In Progress*, or
      *Blocked* with `AnyBlocker` set. One General row per member per day;
      later messages that day update it (item 7).
    - The member counts as **responded**. Reply: *"Saved as a general update:
      '<their words>'."*
    - **A blocker** goes in the General row and the Scrum Master is alerted
      at once, as a blocker with no story (item 19, SPEC-005 2a).
    - **Unchanged:** "not an update" (item 15) and "nothing to report"
      (item 16) record nothing; a member not linked to Jira (item 20) is still
      refused, because code can't tell whether they have a story.
    - **Members who have an open story assigned:** today's flow, unchanged (items
      34, 38) — own story recorded, otherwise the card, None of these records
      nothing.
    - *Replaces item 12's "nothing is recorded" and item 11 for this case.*

    **Decisions (all taken 4 Oct 2026):**
    - (a) *Decided 4 Oct 2026: keep.* No active sprint → the team's Scrum
      Master still gets item 12's alert, once per team per day (wording:
      *"No active sprint in <project>. Stand-up updates are being saved as
      general updates."*).
    - (b) *Decided 4 Oct 2026:* only an open (not Done) story counts. All of
      the member's stories Done → General, no card.
    - (c) *Decided 4 Oct 2026:* General updates are **not** in the summary
      (SPEC-006 unchanged). They are mostly new joiners' KT and access
      status, which is not for stakeholders; they stay in the tracker. A
      blocker in a General row is **also left out** of the summary's
      Blockers section — the Scrum Master is alerted at once instead. With
      no sprint, SPEC-006's existing rule applies (no sprint figures, the gap
      stated).

### Amendment 5 Oct 2026 — blocker with no story asks the member (approved by the user, 5 Oct 2026)

*Why:* live test 5 Oct, Madhavi: *"DB access not working"* → Agent 1 found no
story → item 19 alerted the Scrum Master at once and nothing was written. The
member was never asked which of her tickets it blocks, so the blocker is not
on any story. User decision, 5 Oct 2026: show her a card, and the blocker is
recorded against the ticket she submits. *(Reverses the 30 Sep decision to
keep item 19 — issue #5.)*

40. **Blocker that fits no story, member has an open story → card.**
    - The same card as item 38, listing **her own open stories** (at most 5,
      key order), headed *"Which story is '<her words>' blocking?"*, with
      *"Will be recorded as: Blocked"* and the blocker text, plus
      **None of these**.
    - **Submit** → Blocked row on that story with `AnyBlocker` set (merged
      into her row for that story if one exists today, item 7), **then** the
      usual alert with the story (as 14b).
    - **None of these** → a **General** row (item 39: `WIN` empty,
      Description *General*, Status *Blocked*, `AnyBlocker` set), then the
      usual alert as a blocker with no story (SPEC-005 2a).
    - Card rules as 14a/38: data in the buttons, Jira re-read on Submit,
      twice records once, expired or closed records nothing.
    - **Unchanged:** a member with no open story → item 39 (General row,
      alerted at once); a blocker that fits a story → items 34a/38.
    - *Replaces item 19 and item 38's "a blocker that fits no story at all is
      alerted at once" for members with an open story.*

### Amendment 8 Oct 2026 — answer first (approved by the user, maturity plan M4)

41. **The member gets an answer at once.** Teams expects the HTTP answer in
    about 15 s; reading an update takes 20–25 s, and a late answer can make
    Teams deliver the message twice. So the assistant replies immediately
    *"Got it, working on it…"*, hands the update to itself as a new request
    (kept open until done — Cloud Run gives CPU only to open requests), and
    **replaces that same message** with the result. The member ends with one
    message; story cards follow below it as before. If the hand-over is not
    possible, the update is processed in the turn as before. If processing
    fails, the line is replaced with the usual failure reply. The member's
    words travel only inside the service and are never stored.

42. *Added 8 Oct 2026 (approved by the user, maturity plan M12).* **No story
    of their own, or not linked to Jira → context match, then general.** When
    the sprint has stories but the member owns none of them (or is not linked
    to Jira), Agent 1 is offered every sprint story and finds the one each
    piece of work belongs to **by context** (title and About text, item 31).
    A fit → the item 38 card (Submit records it under its owner, "updated by"
    the member). Work that fits no story, and blockers on no story, go into
    the member's **General** row (item 39 rules: every part kept, blockers
    alerted at once). Replaces item 20's refusal and item 39's "no card".
    No sprint, or nothing open in it → item 39 as before.

## Interface

```ts
interface ExtractionInput {
  text: string; memberId: string; memberName: string; teamId: string;
}

interface ExtractionOutput {
  // each item carries the work item it refers to, when the member named one
  completed: { storyRef: string | null; comment: string }[];
  inProgress: { storyRef: string | null; comment: string }[];
  blockers: { description: string; storyRef: string | null }[];
  confidence: 'high' | 'low';
  kind: 'update' | 'nothing' | 'not_update';   // added 28 Sep 2026 (items 15–16)
  // no `degraded` flag: output either came from the model or the call failed
}

extractUpdate(input: ExtractionInput): Promise<ExtractionOutput>;
```

**Mapping to tracker rows (code, not the agent).** SPEC-002 stores one row per
work item, so code turns this output into `TrackerRow[]`:

| From | Row |
|---|---|
| each `completed[i]` | `WIN` = `storyRef`, `Comment` = `comment`, `Status` = `Completed` |
| each `inProgress[i]` | `WIN` = `storyRef`, `Comment` = `comment`, `Status` = `In Progress` |
| a blocker whose `storyRef` matches a row above | that row's `AnyBlocker`; an `In Progress` row becomes `Blocked`, a `Completed` row stays `Completed` |
| a blocker with no match | its own row, `Status` = `Blocked`, `Comment` empty |

Amended 24 Sep 2026: a blocked item used to keep `Status` = `In Progress`, so a
Status filter for `Blocked` missed it. Found live on Tiwari Satyam's SCRUM-20
update.

`Description` is never produced by the agent. Code fills it from
`lookup_story(storyRef)` against Jira/ADO, and leaves it empty when there is no
`storyRef` (A8).

Read-only tools in `src/agents/tools/`:

| Tool | Returns |
|---|---|
| `lookup_story(id)` | Story key, title, status, assignee, points — or not found |
| `get_member_open_items(memberId)` | The member's open sprint items |

Prompt lives in `src/agents/prompts/updateProcessor.md`, not inline.
Model id comes from config; never hardcoded at a call site (coding rule 18).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `AGENT1_MAX_TOOL_ITERATIONS` | number | 3 | Cap on tool round-trips |
| `AGENT1_TIMEOUT_MS` | number | 20000 | Wall clock before the call fails |
| `AGENT1_MAX_RETRIES` | number | 2 | Retries against the same model before failing |
| `LLM_PROVIDER` | gemini / anthropic / vertex | gemini | Which provider the adapter uses (A12) |
| `LLM_MODEL` | string | set in `.env` | Model id for the selected provider |

The LLM sits behind a provider adapter (`src/llm/`) exposing one interface:
prompt in, validated structured output out. Providers are interchangeable by
config alone — no call site knows which one is active (coding rule 8).

**Delivery position (A12):** the PRD names Claude; **Gemini is the approved
substitute and is what ships**. FR-03's ≥ 90% accuracy figure is measured and
reported against Gemini, because that is what runs. The adapter keeps Claude a
one-line change if the decision is revisited, but no accuracy claim is ever
carried across providers.

**No fallback (user decision, 17 Sep 2026):** there is no non-LLM extraction
path. Every recorded extraction came from the model or does not exist. This is
deliberate — an output that could have been produced by the program is not
evidence that the model works.

## Edge cases

- **"Nothing to report" / "same as yesterday".** *Superseded 28 Sep 2026 by
  item 16:* not recorded, counts as non-responder for now.
- **Message that is clearly not an update** ("thanks!", an emoji). *Superseded
  28 Sep 2026 by item 15:* not filed, member told, non-responder.
- **Story id mentioned that does not exist.** Tool returns not found;
  `storyRef` stays `null`, and item 13 applies (member told, not recorded).
- **Several blockers in one message.** All captured, each with its own story
  reference or `null`.
- **Message from someone not on any roster.** Politely ignored, logged, not
  filed.
- **Message arrives before the day's reminder, or after the summary.** Accepted
  and filed against today's date; the summary reflects what existed when it ran.
- **Very long message.** Truncated at a configured limit with the truncation
  recorded.
- **Attachment or voice message.** Not supported (A10). The member is told
  plainly to reply in text.
- **LLM provider outage.** Retries, then fails explicitly. Nothing is written to
  the tracker. The member is told plainly that their update could not be
  processed and asked to resend. The failure is recorded and visible.

## Out of scope

Sending the blocker alert (SPEC-005). Building the daily summary (SPEC-006).
Counting participation (SPEC-007). Voice input (A10, not built).

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Extraction accuracy ≥ 90% | `eval/` run over ~40 labelled updates | Accuracy report (FR-03) |
| 2 | Varied free-text formats accepted | Live run with differently worded replies | Screenshots (FR-02) |
| 3 | End-to-end under 30 s | Timing instrumentation over the eval set | Latency report (NFR) |
| 4 | Story reference resolved and validated | Eval cases with ids and descriptions | Accuracy report (A8) |
| 5 | Timeout fails explicitly, writes nothing | Fault injection | Log + empty tracker + member notified |
| 6 | Invalid agent JSON never reaches the tracker | Unit test with malformed output | Test output |
| 7 | Two messages same day produce one record | Live repeat | Tracker state (A11) |
| 8 | Agents hold no write or send tools | Code review of `agents/tools/` | Review note |
| 9 | No active sprint: nothing written, member told, one SM alert per day | Unit test + live with sprint not started | Test output; Teams screenshots |
| 10 | Unknown item and unassigned item refused with reason; other person's item offered as a Submit/Cancel card | Unit tests on the intake with a fake PM client | Test output |
| 10a | Submit records under the sender with "(assigned to …)"; Cancel records nothing; twice records once; expired card records nothing | Unit tests on the submit handler; live in Teams | Test output; tracker; screenshot |
| 11 | Garbage and "nothing to report" not written, member told, stays non-responder | Unit test + eval cases labelled with `kind` | Test output; eval report |
| 12 | Confirmation lists WIN, title, status per recorded item | Unit test on the reply text + live | Test output; screenshot |
| 13 | Accuracy stays ≥ 90% with the new `kind` field | `eval/` run — **live LLM, ask the user first** | Accuracy report |
| 14 | Every key form resolves to the same story | Unit tests on the normaliser; eval cases "scrum 25", "scrum-24", "SCRUM25" | Test output; eval report |
| 15 | Another member's story described in words is matched to its key | New eval cases with the whole sprint as candidates | Eval report |
| 16 | "Code done, testing now" is In Progress; "story done" is Completed | New eval cases | Eval report |
| 17 | Ambiguous wording returns alternatives, never a guessed key; the picker records only what the member chose | Eval cases; unit tests on the picker handler | Eval report; test output |
| 18 | A key the model returns that is neither a candidate nor in the text is dropped | Unit test with a fake model | Test output |
| 19 | Every card press gets a reply, including one that cannot be read | Unit test; live press on each card, checked in the logs | Test output; log lines |
| 20 | No eval case ends with a wrong work item written | Eval report reviewed case by case | Eval report |
| 21 | Item 39: no sprint, no story, or only Done stories → one General row, responded, no card; a blocker also alerts; a member with an open story is unchanged | Unit tests on the intake with a fake PM client; live as Sai Krishna (no story) | Test output; tracker row; Teams screenshot |
| 22 | Item 39(c): General rows, and blockers on them, do not appear in the summary | Unit test on the summary facts | Test output |
