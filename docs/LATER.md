# Later

Things parked by the user's decision, to pick up after the current round. Not
rule deviations — those are in `KNOWN-DEBT.md`. Each item says what was seen
and what was suggested; nothing here is approved until the user says so.

**Last updated:** 4 Oct 2026.

## Agent 1 (reading updates)

| # | Parked | What was seen | Suggested | Parked on |
|---|---|---|---|---|
| L1 | Loosely related stories on the choice card | Sailaja: *"Implemented Polly for retry and fault-tolerance pattern…"* — the card also offered SCRUM-30 (IHub middleware), whose acceptance criteria mention "resilient partner dispatch". The prompt (SPEC-004 item 38) asks for every plausible story, and the model took one shared word as enough. | A general prompt rule: offer a story only when its title or acceptance criteria describe that kind of work, not when it shares one general word. No story-specific examples in the prompt. Agree the wording first, then test. | 1 Oct 2026 — "leave it as it is" |
| L2 | Completed vs In Progress | Eval on flash: "added the circuit breaker…" read as Completed (expected In Progress); "Wrapped up the webhook validation work" read as In Progress (expected Completed). The story match was right in both. The card shows "Will be recorded as" before Submit. | Clarify the status rules in the prompt with general wording; re-run the eval. | 1 Oct 2026 |
| L3 | e38 | "Yesterday: SCRUM-7. Today: SCRUM-6." — SCRUM-7 read as In Progress, expected Completed. Fails on every model. | Decide the expected reading first (is "Yesterday: X" finished?). | 29 Sep 2026 |

## Product scope

| # | Parked | Notes | Parked on |
|---|---|---|---|
| L4 | Jira board per team | Today one Jira project serves every team (`JIRA_PROJECT_KEY`), so teams see each other's stories. **4 Oct 2026, planned for 5 Oct:** decided — **admin only** links a team to its board. Proposed defaults (not yet confirmed): admin picks from a dropdown of boards in the New team form and next to the team name; Scrum Master sees it read-only; Alpha set to the current SCRUM board; key normalising per team's project; readiness check "Jira board". **Open:** may two teams share one board? (recommended: no, refused). One Jira account reads all — isolation is by the assistant's config, not Jira permissions. | 29 Sep 2026 |
| L5 | Work outside the active sprint | Only open stories in the active sprint are offered. **4 Oct 2026: not now — active sprint only (user decision).** | 29 Sep 2026 |
| L6 | A member on two teams | Rosters may not overlap today. | 29 Sep 2026 |
| L7 | Onboarding stages when a member is added | Teams team membership (needs `TeamMember.ReadWrite.All`), app install, Jira invite and link, a steps message. | 28 Sep 2026 |
| L8 | Jira stand-up issue | SCRUM-23 (`JIRA_STANDUP_ISSUE_KEY`) was deleted with Sprint 1's stories; the Jira-comment tracker needs a new one. | 29 Sep 2026 |
| L9 | List changes from the app | Adding a SharePoint column needs `Sites.Manage.All`; the Updated By column was added by hand (1 Oct). | 1 Oct 2026 |
| L13 | Retry proactive Teams sends (KNOWN-DEBT 2) | Reminder, follow-up, blocker alert, no-sprint alert, summary, participation have no retry. Agreed direction: retry 429 **and** 5xx (2 s, 5 s, honour `Retry-After` ≤10 s), never a 404 "chat gone"; all attempts fail → job failed. A 5xx after delivery may send twice — accepted, since a "failed" label leads to a manual rerun anyway. Not yet specced. | 4 Oct 2026 |
| L14 | Readiness runs on page load | Run the existing Check readiness (SPEC-008 10d) automatically when the admin page loads, not only on the button. No LLM calls; calls Jira, SharePoint and Teams on every load. Catches setup problems, not momentary 429/5xx. | 4 Oct 2026 |

## Next round: team alignment (spec and build 2 Oct 2026)

One team, set up on the admin page, matching in Teams and Jira. Covers L4–L7
above, plus:

| # | Parked | What the user wants | Open question |
|---|---|---|---|
| L12 | Updates with no sprint / general work — **4 Oct 2026: replaced by SPEC-004 item 39 (no setting, automatic from Jira); the text below is superseded** | Training, onboarding, between-sprint work has **no work item**. Per-team admin setting **"Stand-up updates are about: Sprint work / General work"** (admin or the team's Scrum Master; change history). General work: no story matching or Jira lookup; every update is a **General** row (WIN empty, Description "General") in her words; she counts as responded; blockers still alert; summary says general updates only, no points/velocity; readiness skips the sprint check. Today: no sprint → refused, she is a non-responder, and training is dropped by the prompt (SPEC-004 item 30). | In **Sprint work** mode, does a non-story line ("attended training") become a General row, or is it still left out? |

## Documentation

| # | Parked | Notes |
|---|---|---|
| L10 | AI Journal | Not updated since 29 Sep (afternoon onwards). |
| L11 | POC-Plan §6 traceability | Add SPEC-002 2f, SPEC-004 items 31–38, SPEC-008 10l. |
