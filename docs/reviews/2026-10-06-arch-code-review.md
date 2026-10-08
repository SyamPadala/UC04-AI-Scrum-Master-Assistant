# Architecture & code review — 6 Oct 2026

Scope: `src/` at `431783b` (~9,900 lines). Yardstick: CLAUDE.md hard
boundaries, `docs/rules/coding-rules.md`, POC-Plan architecture, plus standard
security / reliability / scaling checks. Read-only review; nothing changed.

**Verdict:** the architecture matches the plan and the hard boundaries hold.
The real risks are a few correctness gaps on concurrent or failing paths, and
secrets handling that departs from the agreed stack.

## Hard boundaries — all hold

| Boundary | Status | Evidence |
|---|---|---|
| Agents get read-only tools only | ✅ | one tool file, `agents/tools/stories.ts`, reads Jira only |
| Agent output validated, invalid fails the call, no substitute | ✅ | `agents/updateProcessor.ts:213` retries same model then throws |
| No update content in Firestore | ✅ | blocker de-dupe stores a hash (`store/firestore.ts:475`); usage = counts |
| Jobs idempotent on team+date+job | ✅ | transactional claim, `store/firestore.ts:174` |

## Findings, most severe first

| # | Sev | Finding | Where | What goes wrong |
|---|---|---|---|---|
| 1 | High | **Blocker alert claim is taken before the send and is never released.** | `jobs/blockerAlert.ts:58–104` | No Scrum Master / app not installed / send error → claim stays. The same blocker later the same day is "already alerted": nothing is sent, and the member's reply says *"Your Scrum Master has been told"* (`bot/replies.ts`, alerted counts `all blockers already alerted today`). FR-06 silently missed. |
| 2 | High | **A Firestore error on the claim reads as "already alerted".** | `store/firestore.ts:479` (`catch { return false }`) | A transient Firestore failure suppresses the alert, with the same false reply. Same pattern in `claimDailyNotice`. |
| 3 | High | **Two messages from one member within ~20 s race.** | `jobs/updateIntake.ts:450` read → LLM → `:535` write; `trackers/sharepoint.ts:85` | Both read today's rows before either writes: duplicate rows for the same item, or the second write overwrites the first's comment. Likely in practice (people send a correction right after). Card presses race the same way. |
| 4 | High | **Secrets are plain Cloud Run env vars, not Secret Manager.** | `scripts/deploy.mjs:85–130` | BOT_APP_PASSWORD, GRAPH_CLIENT_SECRET, JIRA_API_TOKEN, GEMINI_API_KEY, ADMIN_SESSION_SECRET, TICK_SHARED_SECRET visible to anyone with Cloud Run viewer. Breaks CLAUDE.md stack + coding rule 24; the script's header says it "never reads or writes secrets", which is not true. |
| 5 | Med | **Re-adding a removed member links Jira without restoring access.** | `admin/service.ts` `provisionMember` | Found by email → linked, but removal took product access away; they can't use Jira. (Raised 6 Oct, not fixed.) |
| 6 | Med | **The Teams turn runs the whole update inline (~20–25 s).** | `bot/handler.ts:262` | Bot Framework expects the HTTP reply within ~15 s; a timed-out delivery can be retried, so one message could be processed twice. Not seen in logs yet (PLAUSIBLE). Fix: acknowledge, then process. |
| 7 | Med | **Jira is mandatory per member.** | SPEC-004 item 20, `updateIntake.ts:439` | Not linked → every update refused. Conflicts with the 5 Oct decision that Jira must stay optional. |
| 8 | Med | **Graph / SharePoint responses are cast, not parsed.** | `graphRequest<T>` call sites, `admin/service.ts`, `admin/provision.ts`, `trackers/sharepoint.ts` | Coding rule 11. A shape change surfaces as `undefined` deep inside, not at the boundary. |
| 9 | Low | Store is a module of functions with a module-level `db`, no interface. | `store/firestore.ts:12` | Rules 8–9: callers can't be given a mock store; moving to AWS/Azure means rewriting this file with no contract to test against. |
| 10 | Low | Four separate token caches (Graph app ×1, bot app ×3). | `graph/client.ts`, `bot/channels.ts`, `bot/reachability.ts`, `admin/provision.ts` | Duplicated code; bot token fetched independently in three places. |
| 11 | Low | No `correlationId` in any log line. | — | Rule 25. One message can't be followed across intake → tracker → alert. |
| 12 | Low | Files far over the ~300-line rule. | `admin/page.ts` 1180, `admin/service.ts` 917, `updateIntake.ts` 595, `firestore.ts` 547 | Rule 6. `service.ts` mixes teams, members, onboarding, readiness, LLM usage. |
| 13 | Low | Admin 500 responses return the raw error text. | `admin/routes.ts:55` | Graph/Jira error detail shown in the browser. |
| 14 | Low | `/tick` secret compared with `!==`. | `index.ts:31` | Not constant-time; use `timingSafeEqual` (as `admin/session.ts` does). |
| 15 | Low | Every message reads the whole SharePoint list (twice: today + open blockers). | `trackers/sharepoint.ts:140` | Fine at POC size; grows with items × members. |

## Architecture

| Area | Assessment |
|---|---|
| Code vs LLM split | ✅ as planned: Agent 1 / Agent 2 reason; scheduling, writes, alerts, onboarding are code. |
| Scheduling | ✅ `/tick` + per-team timezone + claim; failure releases the claim so the next tick retries. |
| LLM portability | ✅ `LlmClient` interface; switching = config + prompts + eval. OpenAI adapter not written. |
| Cloud portability | ⚠ only `store/firestore.ts` and `scripts/deploy.mjs` are GCP-specific, but the store has no interface (#9). |
| Jira coupling | ⚠ optional in config, mandatory per member (#7); stories/sprint only from Jira. |
| Security | ✅ admin sign-in verifies signature, issuer, audience, tenant, nonce, expiry; roles checked server-side per request; write header against CSRF; HttpOnly/Secure cookies. ⚠ secrets (#4). |
| Reliability | ⚠ claim-before-send (#1, #2), concurrent writes (#3), inline turn (#6); Teams send retry still open (L13). |
| Tests | 174 unit tests on the pure logic. Untested: admin service I/O (onboarding/offboarding), handler turn flow, SharePoint concurrency. |

## Suggested order

1. #1 + #2 — release the alert claim when the send did not happen; treat a store error as "send anyway".
2. #3 — serialise per member (Firestore lease on `teamId+memberId+date`) or re-read just before writing.
3. #4 — move the six secrets to Secret Manager, referenced from Cloud Run.
4. #5 — restore Jira access on re-add.
5. #6 — reply first, process after.
6. #7 — decide with the user: Jira link optional per member?
7. #8–#15 as clean-up.
