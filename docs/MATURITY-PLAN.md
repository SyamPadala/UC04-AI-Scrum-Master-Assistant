# Maturity plan — from POC to production grade

Started 7 Oct 2026, from the architecture review
([UC-04 Architecture Review](https://claude.ai/code/artifact/567fccdd-14c0-4f4c-8529-15b4bccc73db)).
We discuss the gaps one at a time, highest risk first, note the decision here,
and implement them together once the list is agreed. Each item still gets its
spec line approved before code (process rules).

## Agreed — to implement

| # | What | Decision (user, 7 Oct 2026) | Spec |
|---|---|---|---|
| M1 | **Blocker alert can be lost.** The assistant marks a blocker "already alerted today" *before* sending. If the send fails (no Scrum Master chat, app not installed, Teams error), the mark stays: the blocker is never alerted again that day and the member is told "Your Scrum Master has been told". A Firestore error on the mark is also read as "already alerted". | Fix: if the alert is not sent, remove the mark so the next mention tries again. If Firestore errors on the mark, send anyway. | SPEC-005 (new item) |
| M2 | **Install the app for the Scrum Master automatically.** | When a team is created or its Scrum Master is changed, the assistant installs Scrum Assistant for the Scrum Master (same install as for members, SPEC-008 10n). A failed install is shown on the page with the reason. | SPEC-008 (new item) |
| M3 | **No Running without a reachable Scrum Master.** | A team cannot be switched to Running until its Scrum Master can receive messages (app installed). The page says: "Scrum Master can't be messaged yet. They need to open Scrum Assistant in Teams once." Applies to whoever is Scrum Master, including an admin. | SPEC-008 (new item) |
| M4 | **Answer Teams at once, then work.** Teams expects an answer within ~15 s; processing takes 20–25 s, so Teams may resend the message and it would be processed twice (not seen yet). | The assistant replies immediately "Got it, working on it…", processes the update, then **replaces that same message** with the result, so the member ends with one message. Story cards still follow below as today. | SPEC-004 (new item) |
| M5 | **Passwords into Secret Manager.** Six secrets (bot password, Graph secret, Jira token, Gemini key, admin session secret, tick secret) are plain Cloud Run settings, readable by anyone who can view the service. | Move them into Secret Manager; Cloud Run reads them from there with its own identity; the deploy script stops sending them as plain settings. The user does the console steps (exact steps to be given). | Deploy / config (CLAUDE.md stack, coding rule 24) |
| M6 | **SharePoint: only the tracker site.** The Graph app can read and change every SharePoint site in the tenant (Sites.ReadWrite.All). | Switch to Sites.Selected and grant the app access to the tracker site only. No feature changes. User does the Entra steps. | SPEC-002 / setup |
| M7 | **Teams: only linked Teams teams.** TeamMember.ReadWrite.All covers every Teams team; Microsoft has no per-team version. | Keep the permission; code refuses to add or remove members in any Teams team that is not linked to a scrum team on the admin page. | SPEC-008 (new item) |
| M8 | **Separate Jira account for the assistant.** Today it uses the user's own login (psr.syam@gmail.com) with full admin rights: its actions look like the user's, and it stops if that account changes. | Create a dedicated account in the same Jira site (e.g. scrum-assistant@SyamPadala.onmicrosoft.com), site admin so automatic invites/removals keep working, token in Secret Manager (M5). Uses one Jira seat (7 of 10 in use). | Setup / config |
| M9 | **Retry failed Teams sends** (L13). Reminders, follow-ups, blocker alerts, no-sprint alert, summary and participation flags give up on the first Teams error; one brief hiccup = a missed reminder (99.5% NFR). | On "busy" (429) or a temporary error (5xx) or no answer: wait 2 s, retry, wait 5 s, retry; honour Teams' "wait N s" up to 10 s. Never retry "chat gone" (404). All attempts fail → recorded as failed. Checking delivery first was considered and rejected: it needs Chat.Read.All (read every chat; protected; privacy). Accepted: a rare duplicate after an internal error. | SPEC-003 (new item) |
| M10 | **Jira project per team, chosen on the admin page** (replaces L4). Today one project for all teams comes from the settings file. | The Jira site address and the assistant's login stay in settings (Secret Manager, M5). Each team's **project** is picked from a dropdown on the admin page; the assistant finds its sprint board (admin picks if there are several). Admin only; Scrum Master sees it read-only. One project per team — a project already used is refused. **Optional:** a team with no project works, every update is a general update, no cards, no sprint figures. Alpha set to SCRUM automatically. | SPEC-008 + SPEC-004 + SPEC-002 |
| M11 | **Tracker list per team, isolated.** Today all teams write to one SharePoint list. | Each team has its own tracker list, and **Scrum Team Beta cannot open Alpha's list**. Design: each team's list lives on that team's own Teams team SharePoint site, so only its members can open it (fits M6: the assistant is granted only those sites). Chosen on the admin page per team. Alpha keeps its current list. | SPEC-008 + SPEC-002 |
| M12 | **Members with no story of their own, or not linked to Jira.** Today: no story → always a General row, no card (item 39, 4 Oct); not linked → every update refused (item 20). | The AI reads the message and looks for the sprint story the work belongs to **by context** (meaning, using each story's description and acceptance criteria — item 31; keywords only as the last resort). Found → the item 38 card, member confirms with Submit. Nothing fits → General row. Replaces item 39's "no card" and item 20's refusal for these members. Only for teams that have a Jira project (M10); a team with none → always general. | SPEC-004 (amends items 20, 39) |
| M13 | **Re-added member gets Jira access back.** Removing a member takes away their Jira access (account stays). Re-adding finds and links the old account but does not restore access. | On add, if the Jira account exists without Jira access, restore it (uses one seat). Done through the assistant's own Jira account (M8). | SPEC-008 10n |
| M14 | **Alerts when something fails.** Jobs and errors are logged, but nobody is told. | Google Cloud alerts emailed to the **admin(s)** when: a scheduled job fails; the AI fails several times in a row; an update takes > 30 s; the service stops answering its health check. Mostly console setup + small code changes; free allowance covers it. | New (operability) |
| M15 | **Confirm Gemini is on the paid tier** (Privacy NFR: no training on update content). Free tier may use submitted text; paid tier does not. | **User check, no code:** aistudio.google.com/apikey → the assistant's key → plan must be Paid (Tier 1+); if Free, Set up billing. User will check later. | A13 |
| M16 | **Correlation id.** Log lines of one message or job have nothing tying them together. | Every incoming message and every scheduled job run gets a correlation id when it starts; every log line it writes carries it (coding rule 25). No change for members. | Coding rule 25 |
| M17 | **Database adapter layer + one sign-in helper.** Code calls Firestore directly; no contract. Microsoft sign-in code is written four times. | A database **contract** (interface) with adapters chosen by a setting (`DB_PROVIDER`): **Firestore now**; DynamoDB (AWS) and Cosmos DB / MongoDB (Azure, any cloud) written only when needed; an in-memory adapter for tests. Every adapter must support "create only if it doesn't exist" (idempotent claims). Same pattern as the LLM adapter. ORMs considered: none covers Firestore; a MongoDB-style DB + Prisma noted as a production option. Plus: one shared Microsoft sign-in (token) helper. ~1–2 days. | Coding rules 8–9 |
| M18 | **Small fixes.** | (a) Admin page shows a friendly message instead of raw technical errors. (b) `/tick` secret checked with a constant-time comparison. (c) ~~Read only today's rows~~ — **not needed** (8 Oct): the list holds one row per member per story, updated in place, so it grows only with new stories; each message reads it once. | Clean-up |

## Status — 8 Oct 2026 (night)

| Item | State |
|---|---|
| M1 alert claim · M2 SM auto-install · M3 Running guard · M4 answer first · M7 linked Teams teams only · M9 send retry · M10 Jira project per team · M11 tracker list per team · M12 context match for story-less members · M13 Jira access restored · M16 correlation id · M17 database contract + token helper · M18 small fixes | **Built, tested, deployed** |
| Design review: retired card flows removed; admin service, page, intake and handler split; job registry; one Jira factory | **Built, tested, deployed** |
| Design review: composition root (stop reading the global settings in 20 files) | **Partly** — Jira, store and tokens now come from factories; settings are still read directly. Full DI touches every module for no user-visible change; deferred |
| M5 Secret Manager | **Done 8 Oct** — six secrets in Secret Manager, readable only by the service's runtime account; deploy sends references (`CLOUD_RUN_SECRETS=secret-manager`); verified none left as plain settings |
| M14 alerts | **Partly done 8 Oct** — e-mail channel (admin mailbox), health check and "service not answering" alert live. The three log-based alerts (job failed, update not processed, > 30 s) need *Logs Configuration Writer* on the deploy account, then rerun `scripts/alerts.mjs` |
| M6 SharePoint Sites.Selected | **Needs a decision** — with it, every new team's SharePoint site must be granted to the app by hand before its tracker list can be chosen |
| M8 separate Jira account | **User step** — create the account, then swap JIRA_EMAIL / JIRA_API_TOKEN |
| M15 Gemini paid tier | **User check** |
| Data | Alpha set to Jira project SCRUM; Beta's tracker (was Alpha's list) cleared |

**Not yet tried live in Teams:** M4 ("Got it, working on it…" replaced by the result), M12 (story-less member's work matched by context), item 40 card, M13 restore.

## Facts confirmed in the discussion

- A team always has a Scrum Master: on create it defaults to the admin; it can be changed, never removed.
- Admins (`ADMIN_USER_IDS`) can manage every team, so if a Scrum Master is away an admin adds members or changes the Scrum Master.

## Discussed — downgraded

| # | What | Outcome (7 Oct 2026) |
|---|---|---|
| R2 | Two quick messages from one member | User pointed out: different work items don't clash, and on the same item the last message replaces the row's text by design (tracker = latest state). Only real effect: two messages on the **same** story within ~20 s can create a **duplicate row**. Downgraded to **Low**; not urgent. |

## Decided — not now

| # | What | Decision (7 Oct 2026) |
|---|---|---|
| D1 | Deploy key file (service-account key on the laptop, used for deploys and local scripts) | **Leave as is for now.** Storing it in a bucket was considered and rejected: fetching it needs another credential. Production: a deployment pipeline trusted by Google with no key file, plus a separate development project. Not built now — pipelines are not allowed on this engagement. |

## Raised, not decided

- **M19 — second update on the same story the same day: append, not replace** (user, 8 Oct 2026, to discuss later). Today a second message about SCRUM-33 on the same day **replaces** that row's comment (`mergeRows`: the tracker holds the latest state). The user wants the new words **appended** to the day's comment, possibly with a card asking the member whether to capture it when it is the second or later update that day. Open: always append, or ask; how status changes combine (e.g. In Progress → Completed); what the summary shows. Also relevant: M4's hand-over is off after the live double write; turning it back on must not be able to append twice.

- **Backup Scrum Master.** While the Scrum Master is away, blocker alerts and notices go only to them. Option: a backup who receives the same alerts and can manage the team. **Parked 8 Oct: the user will discuss it with their manager.**

## Next: design review (SOLID + design patterns)

Agreed 8 Oct: a dedicated design review comes next and decides the structure.
It covers the remaining structural items: large admin files (split by
responsibility) and checking Microsoft Graph answers against a schema
(coding rule 11). Findings get discussed one by one, like the items above,
then everything in this plan is built together.

**Done 8 Oct 2026** — added to the review doc as two sections ("Design review:
SOLID principles", "Design review: patterns"). To discuss with the user, one at
a time (next session starts here):

1. Composition root: build every service once in `index.ts` and pass it in (ends 20 global-settings imports).
2. Database adapter (already M17).
3. Result codes instead of sentences (blocker alert; three places compare exact words).
4. Teams handler as a router: one small handler per activity type.
5. Update intake split into extract, verify, write, alert steps.
6. Admin split: TeamService, MemberService + Onboarding, Readiness, Usage; page into separate HTML/JS files.
7. One factory per external system (Jira built by hand in 3 places); job registry for the tick.
8. Delete the two pre-1 Oct card flows (~150 lines).
Estimated 3–4 days after the POC; no change for users.

