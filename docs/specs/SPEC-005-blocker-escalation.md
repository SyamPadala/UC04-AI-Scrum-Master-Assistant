# SPEC-005: Blocker detection and escalation

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-06 |
| **Assumptions** | A1 (alert sent as part of update processing, target < 30 s), A8 (story resolution) |
| **Depends on** | SPEC-004 |
| **Owner** | Claude |

## Intent

**In plain words:** the moment someone says they're stuck, the Scrum Master
gets a direct message about it — who is stuck, what on, and which story it
affects. They don't have to wait for the end-of-day summary to find out.

## Behaviour

1. When Agent 1's extraction contains one or more blockers, code sends a direct
   message to the team's Scrum Master (FR-06). The agent does not send it.
2. The alert names the member, the blocker description, and the affected story
   with a link — or "not specified" when no story could be resolved (A8).
3. Several blockers from one member arrive as one alert listing all of them, not
   as several messages.
4. The alert is sent as part of update processing, so it lands within the same
   30-second budget (A1) and comfortably inside the PRD's 5-minute metric.
5. The same blocker from the same member on the same day is alerted once. A
   genuinely new blocker later the same day produces a new alert.
6. The time from message receipt to alert delivery is measured and recorded for
   every alert — this is the evidence for the blocker-response metric.
7. If the Scrum Master cannot be reached, the failure is recorded and the update
   is still filed. A failed alert never loses the update.
8. Under `DRY_RUN`, the alert is logged rather than sent.

## Interface

```ts
interface BlockerAlert {
  teamId: string; memberId: string; memberName: string;
  blockers: { description: string; storyRef: string | null; storyUrl?: string }[];
  detectedAt: Date; deliveredAt?: Date; latencyMs?: number;
}

sendBlockerAlert(team: TeamConfig, alert: BlockerAlert): Promise<void>;
```

Card: `src/cards/blockerAlert.json` — member name, blocker text, story link,
timestamp. Text-first so it reads correctly on mobile.

De-duplication key: `teamId + memberId + localDate + normalised blocker text`.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `scrumMasterId` (per team) | string | — | Who receives alerts |
| `BLOCKER_ALERT_DEDUPE` | boolean | true | Suppress repeat alerts for the same blocker |
| `DRY_RUN` | boolean | false | Log instead of send |

## Edge cases

- **No blockers in the update.** Nothing sent. Silence is the correct output.
- **Member repeats yesterday's blocker today.** New day, new alert — the Scrum
  Master needs to know it is still live.
- **Member restates the same blocker in a second message the same day.** One
  alert only (dedupe key).
- **Blocker with no resolvable story.** Alert still sent, story shown as "not
  specified" — an unattributed blocker is still a blocker.
- **Scrum Master has no conversation reference** (never installed the app).
  Recorded with a clear reason; surfaced at setup rather than discovered on
  demo day.
- **Scrum Master is also the member reporting the blocker.** Alert still sent —
  it is the record, not just the notification.
- **Extraction failed.** No alert is sent, because there is no extraction to
  alert on. The failure is recorded and surfaced, so a missing alert is never
  mistaken for an absence of blockers.

## Out of scope

Resolving or tracking the blocker to closure — the PRD leaves impediment removal
with the Scrum Master. Including blockers in the daily summary (SPEC-006).
Flagging non-responders (SPEC-007).

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Blocker in a reply produces a Scrum Master DM | Live run | Screenshot (FR-06) |
| 2 | Alert carries member, description and story | Live run with a real story id | Screenshot (FR-06) |
| 3 | Delivered well within 5 minutes | Timing instrumentation | Latency log (PRD metric) |
| 4 | Multiple blockers arrive as one alert | Live run | Screenshot |
| 5 | Duplicate blocker same day alerts once | Live repeat | Log showing suppression |
| 6 | Unresolvable story shows "not specified" | Eval case | Screenshot (A8) |
| 7 | Failed alert does not lose the update | Fault injection | Tracker state + log |
