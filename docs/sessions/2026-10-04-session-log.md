# Session log — 4 Oct 2026

Written so the 5 Oct session can start cold. Code state: **everything below is
committed, deployed to Cloud Run and pushed to GitHub** (`901d03a`). 164 unit
tests pass. No live LLM evals were run.

## 1. What happened

| # | Event | Result |
|---|---|---|
| 1 | Tracker comment on someone else's story started "Updated by <sender>: " | Removed — Updated By already says who sent it; the comment holds only the member's words (SPEC-002 2f). Deployed. |
| 2 | Committed everything since `b65ae83` | `4b97adf` |
| 3 | KNOWN-DEBT item 2 (retries) | Graph half closed (SPEC-002 5a). Teams adapter half stays open. |
| 4 | Retry for proactive Teams sends discussed | Parked as **L13** (see section 2) |
| 5 | Readiness on page load suggested | Parked as **L14** |
| 6 | L5 (work outside the sprint) | **Not now** — active sprint only |
| 7 | L12 (Sprint / General work setting) | Replaced by **SPEC-004 item 39** — no setting, automatic from Jira. Approved, built, deployed, committed `901d03a`. |
| 8 | Admin page team isolation reviewed | Admin UI isolates teams correctly; Jira does not (L4). |
| 9 | L4 (Jira board per team) | Started; planned for 5 Oct |
| 10 | Pushed to GitHub | 8 commits (`1d4c002` … `901d03a`) |

## 2. Decisions

**Item 39 — general updates** (`docs/specs/SPEC-004-update-intake-agent1.md`):
- No active sprint, **or** the member has no **open (not Done)** story of their
  own → every part of the update goes into **one General row** (WIN empty,
  Description "General"). No matching, no card — even if the words fit a
  teammate's story. ("The tracker is a replica of Jira.")
- Agent 1 is offered no stories and told to keep every part (KT, access,
  training, meetings); the system prompt is unchanged, the note is in the user
  turn.
- Counts as responded. Reply: *"Saved as a general update: '…'"*.
- A blocker goes in the row (Status Blocked) and alerts the Scrum Master at once.
- Second message the same day joins the same General row.
- (a) No sprint: the once-a-day per-team no-sprint alert **stays**, reworded
  *"…Stand-up updates are being saved as general updates."*
- (b) Only an open (not Done) story counts. Santhosh (story Done) → General.
- (c) General rows **and their blockers** are left out of the summary.
- Members with an open story: today's flow unchanged (items 34, 38).

**L13 — Teams send retry** (not specced): retry on 429 **and** 5xx (2 s, 5 s,
Retry-After ≤ 10 s), never a 404 "chat gone". Accepted risk: a 5xx after
delivery can send a duplicate — the user's point: a "failed" label leads to a
manual rerun anyway. Outbox rejected: still at-least-once, and it would put
update content (alerts, summary) in Firestore.

**L14 — readiness on page load** (not specced): catches setup problems only,
not momentary 429/5xx.

**L4 — Jira board per team** (in progress):
- Decided: **admin only** links a team to its board.
- Proposed defaults, not yet confirmed: dropdown of Jira boards in the New team
  form and next to the team name; Scrum Master sees it read-only; Alpha set to
  the current SCRUM board; key normalising ("scrum 25") per team's project;
  readiness check "Jira board".
- **Open, ask first tomorrow:** may two teams share one board? Recommended: no,
  refused ("Board X is already used by Team Alpha").
- Note for the user: one Jira account reads every project; isolation is by the
  assistant's configuration, not Jira permissions.

## 3. Admin page isolation (answered today)

| Who | Creates teams | Sees / edits |
|---|---|---|
| Admin (`ADMIN_USER_IDS`) | yes | all teams |
| Scrum Master | no | only teams they run |

Enforced on the server (`teamFor`, `src/admin/service.ts:57`, 403 + logged).
Gaps: only admins create teams; LLM usage tab is deployment-wide (counts only);
**one Jira project for every team (L4)**; a shared SharePoint list is visible
in full to anyone with SharePoint access.

## 4. Next, in order

1. **L4** — ask "two teams on one board?", confirm the defaults, write the spec
   (SPEC-008 + SPEC-004), get approval, build, deploy.
2. **Live test item 39** as Sai Krishna (no story): *"Completed the KT session
   on the gateway, waiting for Azure DevOps access"* → General row, Blocked;
   reply "Saved as a general update"; Scrum Master alert with no story.
3. **Live tests 6–8** from the 1 Oct log (still not run).
4. Scrum Team Alpha is still **paused** — switching to Running runs every
   overdue job at once.
5. Then L6 (member on two teams), L7 (onboarding), L13, L14.

## 5. Facts worth knowing

- Deploy: `node scripts/deploy.mjs` from the repo (no local gcloud); forces
  `LLM_CACHE=false`, reads `.env`.
- Tests read `dist/`: run `npm run build` before `npm test`.
- Eval member always has open stories, so item 39 does not change eval results.
- PowerShell: `git commit -F -` with a here-string fails; write the message to
  a file in the scratchpad and use `-F <file>`.
