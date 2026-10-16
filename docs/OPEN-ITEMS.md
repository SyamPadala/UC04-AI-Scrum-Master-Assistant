# Open items — walkthrough started 16 Oct 2026

Everything left over across the repo's `.md` files, taken one at a time with
the user. **Nothing here is implemented until the user gives the go-ahead**
(user, 16 Oct 2026) — approving a spec item records the decision; building it
waits.

| # | Item | State | Decision / notes |
|---|---|---|---|
| 1 | Approve SPEC-001 (foundation) | **Approved 16 Oct** | Base text, as-built notes, items 9–15 |
| 2 | Approve SPEC-002 (trackers) | **Approved 16 Oct** | See 2a–2g below |
| 3 | Approve SPEC-003 (reminder, follow-up) | **Approved 16 Oct** | Plain text kept; tone dropped; item 11 parallel sends |
| 4 | Approve SPEC-004 item 41a (M4 hand-over off) | Open | |
| 5 | Approve SPEC-005 (blocker alerts) | Open | |
| 6 | Approve SPEC-006 (sprint summary) | Open | |
| 7 | Approve SPEC-007 (participation) | Open | |
| 8 | Approve SPEC-008 item 10r (friendly errors) | Open | |
| 9 | Commit the commit check (SPEC-001 item 15) | Open | Files written, hook switched on locally, not committed |
| 10 | Logs Configuration Writer role → 3 log alerts (M14) | Open — user step | |
| 11 | Separate Jira account for the assistant (M8) | Open — user step | |
| 12 | Gemini key on paid tier (M15) | Open — user check | |
| 13 | SharePoint access (M6) | **Decided 16 Oct** | Sites.Selected not used; app gets Sites.Manage.All (SPEC-008 10s) |
| 14 | Live tests in Teams: M4, M12, item 40, M13 | Open | |
| 15 | Excel Online tracker | **Parked 16 Oct** | User: SharePoint and Jira are enough for now. Not dropped — PRD/A7 still name it |
| 16 | Voice input, velocity chart | Open | A10 |
| 17 | `reminderTone`, `SEND_CONCURRENCY` | **Decided 16 Oct** | Tone dropped (one standard wording). Parallel members + parallel teams approved as SPEC-003 item 11, waiting for go-ahead |
| 18 | M19 — same-day second update appends | **Approved 16 Oct** (SPEC-002 2g), waiting for go-ahead | Always add, timestamped; blocker: latest wins; status never goes backwards same day; never add the same message twice; Jira too; summary reads the whole comment |
| 19 | M20 — clear the assistant's replies from a chat | Open | |
| 20 | Backup Scrum Master | Parked | User to discuss with their manager |
| 21 | POC-Plan §10 open questions (5) | Open | |
| 22 | LATER parked ideas (L1–L3, L5–L7, L9, L15) | Open | L8, L14 closed by SPEC-008 10s |
| 23 | Composition root (design review) | Open | Deferred 8 Oct |
| 24 | KNOWN-DEBT open items (13) | Open | |
| 25 | Out-of-date docs | Open | SETUP-CHECKLIST ticks, POC-Plan §9, AI Journal, §6 traceability |
| 26 | Build SPEC-008 10s | **Approved, waiting for go-ahead** | |

## 2 — SPEC-002, point by point

| # | Point | State |
|---|---|---|
| 2a | Excel not built | Parked (item 15) |
| 2b | A team with no tracker cannot run | OK — kept; with 10s a team lacks one only if the create failed |
| 2c | Each team its own list on its own site | OK |
| 2d | Jira comment tracker; no Jira project → no Jira tracker | OK, plus: "Daily stand-up" issue created per team (10s; closes L8) |
| 2e | Member's Jira account linked on add; access restored on re-add | OK. One person, one team; moving = remove then add. Jira access is site-wide, not per project |
| 2f | Out-of-date "delete and rewrite" line | **Fixed 16 Oct**; same-day append decided as M19 (item 18) |
| 2g | SharePoint access (M6) | Settled by 10s (item 13) |

## Decisions recorded as spec items

- **SPEC-008 10s** (approved 16 Oct): Teams team and tracker required in the
  New team form; the SharePoint list (8 fixed columns) or the Jira "Daily
  stand-up" issue is created by the assistant; Sites.Manage.All; readiness runs
  on page open and on Running, and the team starts only when all green.
