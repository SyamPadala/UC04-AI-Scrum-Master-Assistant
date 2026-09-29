# AI Journal — UC-04 AI-Powered Scrum Master Assistant

How the POC was built with an AI coding assistant (Claude Code), day by day:
what the AI did, what the human decided, where the AI went wrong, and the
evidence. Written from the git history, the session logs in `docs/sessions/`,
`docs/POC-Plan.md` and the working sessions themselves.

**Format note.** The journal's purpose, format and reviewer are still open
(`docs/SETUP-CHECKLIST.md` item 20). This file uses one entry per working day
until that is decided. Dates before 21 Sep are reconstructed from commit
timestamps and are accurate to the day, not the hour.

| | |
|---|---|
| Human | Syam Padala — product owner, Scrum Master, tenant admin, reviewer of every spec |
| AI | Claude Code (Anthropic), working in the repo and the cloud accounts through its tools |
| Product LLM | Gemini `gemini-3.5-flash-lite` (approved substitute for Claude, A12) |
| Method | Spec-driven: spec → human review → implement → verify (`docs/rules/process-rules.md`) |
| Period | 16 – 29 Sep 2026 |

---

## Summary

| | |
|---|---|
| Functional requirements | 10 of 10 built and deployed on Cloud Run |
| FR-03 extraction accuracy | **91.5%** (43/47) on the labelled eval, 29 Sep; target ≥ 90% |
| Unit tests | 104, all passing |
| Specs | SPEC-001 … SPEC-008, amended as decisions were made |
| Worst latency | 7.7 s of a 30 s budget |

**Division of labour.** The AI wrote the specs, the code, the tests, the eval
and the deploy script, and ran the checks. The human made every product
decision, approved every spec, did the tenant and account setup, and tested in
Teams. The AI never decided scope; where it did so by accident, it is recorded
below as a mistake.

---

## 16 Sep — Plan and stack

- **AI:** read the PRD and proposed the stack: TypeScript on Node.js, Microsoft
  365 Agents SDK, Adaptive Cards, Microsoft Graph, Jira, Firestore, Cloud Run.
  Wrote `docs/POC-Plan.md`: architecture, assumptions (Section 5), build order,
  traceability (Section 6).
- **Human:** chose Google Cloud over Azure (no Azure credit), Gemini as the LLM,
  and **no fallback**: an LLM failure fails explicitly, the program never
  substitutes its own output.

## 17 Sep — Spec-driven setup

- **AI:** created `CLAUDE.md`, the coding and process rules, SPEC-001 … 008 and
  the setup checklist.
- **Human:** set the governing rule: build to the PRD as written, raise gaps,
  never decide silently. Deadline lifted; real tenant `SyamPadala.onmicrosoft.com`.

## 18 Sep — Accounts and tenant

- **Human, guided by the AI:** created the users, the Teams team, the bot
  registration, the SharePoint tracker list, the Entra app with Graph
  permissions, Firestore, the service account and the Jira connection.
- **AI:** verified each connection with a real call before building on it;
  made the story-points field configurable; fixed the tracker columns.
- **Blocked:** the LLM (no billing yet).

## 19 Sep — First working slice and the schedule

- **AI:** built the first end-to-end path (Teams message → SharePoint row), the
  Teams app package, the manual deploy script, the scheduler (`/tick`,
  reminders, follow-ups), participation tracking (FR-09) and the first admin
  card; fixed the stand-up date (team timezone, midday not midnight).
- **Human:** removed Dev Tunnel, CI/CD and Azure DevOps from scope
  (engagement rules).
- **Evidence:** reminders and follow-ups ran unattended on Cloud Run.

## 20 Sep — Jira identities; a hard session

- **AI:** linked Teams and Jira identities by account id instead of by name.
- **What went wrong:** the AI set up the Jira sprint through the REST API
  instead of letting the human do it in the Jira UI, and answered "explain in
  plain words" with dense tables. The human: *"you are bulldozing things, not
  listening to what I am saying"*.
- **Rules the human set, kept since:** one thing at a time; short answers; lead
  with the precise term, no analogies; the human does hands-on setup where
  practical (`docs/sessions/2026-09-20-session-log.md`).

## 21–22 Sep — The LLM goes live

- **Human:** activated billing on the existing Gemini project.
- **AI:** built Agent 1 (update extraction) and Agent 2 (summary), the Jira
  reads, and three spend guards: recorded responses, a live switch that is off
  by default, and a daily call ceiling counted in Firestore.
- **Evidence:** FR-03 at **92.5%** on 40 labelled updates; the whole day cost
  59 calls and 61,975 tokens (`docs/sessions/2026-09-21-session-log.md`).

## 22–23 Sep — Closing the day

- **AI:** the stand-up closes when the scheduled summary is sent (A14); a `run`
  command triggers any job without touching the scheduled day; channel
  messages are never treated as stand-up updates.

## 24 Sep — Web admin panel

- **AI:** a blocked item is marked Blocked, not In Progress; every message
  resolves its team from the sender; the Adaptive Card setup was replaced by a
  web admin page with an LLM usage tab; a Jira comment tracker (FR-04
  destination 3) and a tracker choice on the page.
- **Human:** the stakeholder channel must not live in the dev team's Teams team.

## 25–26 Sep — Tracker shape, blockers, measurement

- **AI:** stakeholder channel chosen on the page; one tracker row per member
  and work item; open blockers passed to Agent 1 so "that issue is resolved"
  clears them; formatted summary.
- **Experiment (human's request):** "code collects the data, then calls the
  LLM" (preload) vs "the LLM calls tools". Accuracy was a draw (93.6% vs
  95.7%, within run-to-run noise); tools cost 40% more time and 73% more
  tokens. **Human decided: preload** (`docs/AGENT1-CONTEXT-COMPARISON.md`).

## 28 Sep — The demo that failed, and what it taught

**What happened in the demo:** no updates matched a work item, two members
got no reminder, and nothing told anyone why.

| Cause | Whose |
|---|---|
| The new sprint was never started; with no active sprint every update was filed without a work item, silently | Design gap (AI) + setup step |
| Two members' Teams chats had been deleted; the app kept sending to them and just counted "failed" | Design gap (AI) |
| Before the demo, the AI deleted the sprint's stories at the human's request, including `SCRUM-23` — the issue the Jira tracker option depends on — without checking | AI mistake |

**Human decisions** (all written into SPEC-004 before any code):
1. Nothing is swallowed silently. No sprint → member told, Scrum Master
   alerted once a day. No work item found → member told and shown their open
   items.
2. A story assigned to someone else, or unassigned → not recorded; *"not
   assigned to you, please reach out to your Scrum Master"*. A confirmation
   card was proposed and **rejected by the human** as outside the PRD.
3. Garbage text → not recorded, not counted as a response. "Nothing to report"
   → not recorded, non-responder for now (parked).
4. Confirmation lists every recorded item: work item, title, status.
5. A pre-demo **Readiness** panel.

**Built and deployed the same day:** all of the above, plus dead Teams chats
are now detected and shown as "App not installed".

**More AI mistakes that day, all caught and corrected:**
- The first eval run scored **29.8%**: it read stories from live Jira, which
  the AI had just emptied. 47 paid calls measured nothing. Fixed by giving the
  eval a fixed story file; re-run: **91.5%**.
- The AI claimed today's participation needed clearing; it is read from the
  tracker, so it did not.
- The new-team form had never sent a team name (`form.name` is the form's own
  attribute), and the error was hidden behind the dialog. Found when the human
  first used it.

**The human's question:** *"Don't you think about all these while developing?
Why was it not asked in the first place?"* — prompted by finding that a Scrum
Master could manage only one team. The honest answer: the AI built for the
happy path and never checked its own constraints against real roles. Standing
rule since: every new rule is checked against how real teams work, and doubtful
ones are raised as assumptions **before** building.

## 29 Sep — Roles, and a permission on the wrong app

- **Human decisions:** only an admin creates teams and sets Scrum Masters; the
  Scrum Master is a **role**, not a roster member, and may run several teams;
  a Scrum Master does no dev work for now; a member on two teams stays a known
  limitation until each team has its own Jira board.
- **AI:** amended SPEC-008 (10f–10k), implemented, tested, deployed, migrated
  Scrum Team Alpha (the Scrum Master moved off the roster, chat kept for
  alerts), committed.
- **Incident:** a member got "Failed to send" in Teams. The AI found that the
  app-install permission had been granted to the Graph app instead of the bot
  app, so installing for a user had never worked. The human granted the
  permission on the bot's registration; the app was reinstalled for her and
  she was reachable again.

---

## Rules the human set for the AI

| Rule | Why |
|---|---|
| Ask before any live LLM call, with the call count | Eval runs were consuming the production budget |
| One thing at a time; short replies; diagram over long text | Long answers were unreadable |
| Define terms on first use; no analogies | Unexplained product names lost the thread |
| The admin page owns everything; no side steps in scripts or Firestore | One control panel for the Scrum Master |
| Raise real-world assumptions before building | The single-team Scrum Master and the silent intake failures |

## What worked

- **Specs before code.** Every change on 28–29 Sep went through a spec the
  human approved first; the review caught scope the AI would have added (the
  confirmation card).
- **Measured, not asserted.** Accuracy, latency and cost are numbers from real
  runs, and bad runs are reported as bad.
- **Guards on spend.** The live switch and daily ceiling kept testing costs
  bounded and visible.

## What to improve

- Check real-world roles and edge cases before building, not after a demo.
- Check what depends on data before deleting it.
- Test every page feature live before calling it done.
- A pre-demo checklist from day one (now the Readiness panel).

## Open items

- Live testing of the 28–29 Sep changes in Teams (start the sprint first).
- Member onboarding stages on "add member" (Teams team, app install, Jira
  invite, steps). Awaiting the human's clarification of "add member to Graph".
- A member on two teams (needs a Jira board per team).
- `scripts/install-app.mjs` uses the wrong app registration.
- POC-Plan Section 6 traceability to be updated with this week's evidence.
- This journal's format and reviewer (checklist item 20).
