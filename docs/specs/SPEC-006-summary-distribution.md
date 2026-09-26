# SPEC-006: Sprint summary (Agent 2) and distribution

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-07, FR-08 |
| **Assumptions** | A4 (daily at configured end-of-day, text format), A5 (at-risk definition), A6 (velocity and completion), A10 (no trend chart) |
| **Depends on** | SPEC-001, SPEC-002, SPEC-005, SPEC-007 |
| **Owner** | Claude |

## Intent

**In plain words:** at the end of the day the assistant writes the summary the
Scrum Master would otherwise write by hand — what the team did today, what is
blocked, how the sprint is tracking against its goal, and what looks at risk —
then posts it to the stakeholder channel and emails it out.

## Behaviour

1. At the team's `summaryTime`, Agent 2 builds one consolidated summary for that
   team and date (FR-07, A4).
2. The summary contains, in order: team update rollup, active blockers,
   completion status against the sprint goal, at-risk items, and velocity.
3. Agent 2 works only from **read-only** tools:

   | Tool | Returns |
   |---|---|
   | `get_today_updates(teamId)` | Today's updates, read back from the tracker |
   | `get_sprint_data(teamId)` | Sprint goal, committed and completed points, last three sprints' velocity |
   | `get_active_blockers(teamId)` | Blockers not yet marked resolved |
   | `get_participation(teamId)` | Today's participation figures (SPEC-007) |

4. Output is text (A10 — no velocity trend chart in this POC).
   *Amended 25 Sep 2026 (user request — plain text arrived as one wall):*
   Agent 2 returns the five sections as JSON, validated against a schema;
   invalid output fails the call like any other. Code lays it out: an Adaptive
   Card in the Teams channel and an HTML email, same sections, same order.
   The headline figures (reported n of m, points done of committed, blockers,
   at-risk count) are printed by code from the facts, not by the model.
4a. **Active blockers** are blockers raised on any day, not only today, that
    have not been cleared. A blocker on a work item stays active until the same
    member reports that item again without a blocker. A blocker naming no work
    item stays active while it is in that member's most recent update. They are
    read from the tracker's **current state** (`openBlockers`, SPEC-002 4a), not
    by reading earlier days. Each is shown with the date it was last reported.
    *Added 25 Sep 2026, user decision; closes KNOWN-DEBT #16. Look-back window
    replaced by current state 26 Sep 2026.*
5. **At-risk** items are sprint items that are not done and either carry an
   active blocker or have had no progress mentioned for two or more working
   days (A5).
6. **Velocity** is completed story points for the current sprint shown against
   the last three; **completion** is done points over committed points (A6).
7. Code — never the agent — then distributes: posts to the configured Teams
   channel and emails the stakeholder list (FR-08).
8. Distribution is partial-tolerant: if the channel post succeeds and email
   fails, that is recorded as `partial` and the successful half still counts.
9. The job is claimed before building, so a repeated heartbeat produces one
   summary per team per day.
10. **No fallback summary.** If Agent 2 exceeds its cap or timeout, the job
    fails explicitly and no summary is sent. The failure is recorded and the
    Scrum Master is notified so they can send one manually. A program-generated
    summary posing as the model's would make the output untraceable.

## Interface

```ts
interface SprintData {
  sprintName: string; goal: string;
  committedPoints: number; completedPoints: number;
  previousVelocities: number[];          // last three sprints
  items: { key: string; title: string; status: string; points: number | null;
           assignee: string | null }[];
}

interface DailySummary {
  teamId: string; localDate: string;
  text: string; builtAt: Date;   // model output only, or the job failed
}

buildSummary(team: TeamConfig, localDate: string): Promise<DailySummary>;
distributeSummary(team: TeamConfig, summary: DailySummary): Promise<DistributionResult>;
```

Sprint data comes from Jira Cloud REST v3
(A7 — both supported). Prompt in `src/agents/prompts/summaryBuilder.md`.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `summaryTime` (per team) | `HH:mm` | `18:00` | End-of-day build time (A4) |
| `stakeholders.channelId` | string | — | Teams channel for the post |
| `stakeholders.emails` | string[] | [] | Email recipients |
| `pm` (per team) | jira / ado | jira | Source of sprint data |
| `AGENT2_MAX_TOOL_ITERATIONS` | number | 4 | Cap on tool round-trips |
| `AGENT2_TIMEOUT_MS` | number | 45000 | Wall clock before the job fails |
| `AGENT2_MAX_RETRIES` | number | 2 | Retries against the same model before failing |
| `STALE_PROGRESS_DAYS` | number | 2 | At-risk threshold (A5) |

## Edge cases

- **Nobody submitted an update.** Summary still sent, stating plainly that no
  updates were received and showing the participation figure. Silence is itself
  the signal a stakeholder needs.
- **Partial participation.** Summary names who is missing rather than implying
  the team reported fully.
- **No active sprint in Jira/ADO**, or sprint data unreachable. Summary is built
  from updates and blockers alone, with the gap stated explicitly. It does not
  invent sprint figures.
- **Stories with no points.** Excluded from the points arithmetic and counted
  separately, so completion percentages are not quietly wrong.
- **Fewer than three previous sprints.** Show what exists; do not pad.
- **No channel configured, or no emails.** Send via whichever is configured; a
  team with neither is a configuration error surfaced at setup.
- **Email blocked or quarantined by the recipient's organisation.** Recorded as
  a delivery failure — known risk for external corporate addresses.
- **Summary time passes while the service is down.** Built late by the next
  heartbeat, with the actual build time shown.

## Out of scope

Velocity trend charts (A10). Sprint planning, grooming and retrospectives (PRD
out of scope). Per-stakeholder customised summaries.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Summary contains all five required sections | Live run | Summary text (FR-07) |
| 2 | Posted to the Teams stakeholder channel | Live run on sandbox | Screenshot (FR-08) |
| 3 | Delivered by email to the stakeholder list | Live run | Inbox screenshot (FR-08) |
| 4 | At-risk items identified per A5 | Seeded fixture with a stale and a blocked item | Summary text |
| 5 | Velocity and completion correct per A6 | Unit test over known sprint data | Test output |
| 6 | No-updates day produces an honest summary | Live run with an empty day | Summary text |
| 7 | Agent 2 timeout fails visibly, sends nothing | Fault injection | Log + Scrum Master notified |
| 8 | One summary per team per day | Repeated `/tick` | `RunLog` showing `skipped` |
| 9 | Agent 2 holds no write or send tools | Code review | Review note |
