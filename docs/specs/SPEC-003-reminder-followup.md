# SPEC-003: Stand-up reminder and follow-up

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-01, FR-05 |
| **Assumptions** | A2 (cut-off = stand-up time + grace period, default 2 h) |
| **Depends on** | SPEC-001 |
| **Owner** | Claude |

## Intent

**In plain words:** at the team's stand-up time the assistant sends each person
a short personal message asking for their update. Two hours later it quietly
nudges only the people who haven't replied. Nobody who already answered is
chased.

## Behaviour

1. At the team's `standupTime`, the reminder job sends one personal message to
   each member of the roster (FR-01).
2. The message is an Adaptive Card: greeting by name, the three prompts
   (completed / in progress / blockers), and a note that a free-text reply is
   fine (FR-02 sets the expectation; intake is SPEC-004).
3. At `standupTime + gracePeriodMinutes` the follow-up job sends a second,
   shorter message **only** to members with no update recorded for that date
   (FR-05, A2).
4. Members are messaged individually; one member's failure does not stop the
   others (coding rule 21).
5. A member without a stored conversation reference is skipped with a recorded
   reason, not treated as a failure.
6. When `DRY_RUN` is on, messages are logged as simulated deliveries and nothing
   is sent — the full cycle is exercisable without a tenant.
7. Both jobs are claimed before sending, so a repeated heartbeat never sends a
   second reminder (SPEC-001 behaviour 4).
8. Both jobs record per-member outcome counts: sent, skipped, failed.

## Interface

```ts
interface ReminderResult {
  teamId: string; localDate: string; kind: 'reminder' | 'followup';
  sent: string[];
  skipped: { memberId: string; reason: string }[];
  failed: { memberId: string; error: string }[];
}

runReminder(team: TeamConfig, localDate: string): Promise<ReminderResult>;
runFollowup(team: TeamConfig, localDate: string): Promise<ReminderResult>;
```

Cards in `src/cards/`: `standupPrompt.json`, `followupPrompt.json`. Both are
text-first and render on Teams desktop and mobile (Accessibility NFR).

Conversation references are captured by the bot on `conversationUpdate` and
install events, and stored per member (SPEC-001).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `standupTime` (per team) | `HH:mm` | `09:00` | When the reminder goes out |
| `gracePeriodMinutes` (per team) | number | 120 | Follow-up offset (PRD FR-05) |
| `reminderTone` (per team) | standard / friendly | standard | Wording variant (PRD risk: members ignoring bot) |
| `DRY_RUN` | boolean | false | Log instead of send |
| `SEND_CONCURRENCY` | number | 4 | Batched dispatch (PRD risk: Teams rate limits) |

## Edge cases

- **Member already replied before the reminder.** Still reminded — the reminder
  marks the start of the day's cycle. Follow-up correctly skips them.
- **Member replies between reminder and follow-up.** Not chased.
- **Whole roster replied.** Follow-up job runs, sends nothing, outcome `skipped`
  with reason "all responded". Recorded, not an error.
- **Nobody has a conversation reference** (app not installed yet). All skipped,
  outcome names the reason clearly enough to diagnose on demo day.
- **Teams rate limit (429).** Backoff, honour `Retry-After`, retry the remaining
  members rather than restarting the batch.
- **Service was down at stand-up time.** SPEC-001 runs it late; the card wording
  does not claim a time, so a late reminder still reads correctly.
- **Weekend or holiday.** Not handled in this POC — jobs run every day. Recorded
  as a known limitation.

## Out of scope

Reading and understanding the reply (SPEC-004). Deciding who counts as a
habitual non-responder (SPEC-007). Changing the schedule from Teams (SPEC-008).

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Reminder reaches every member at the configured time | Live run, 2 test users | Screenshots + `RunLog` (FR-01) |
| 2 | Follow-up goes only to non-responders | Live run: one replies, one does not | Screenshots (FR-05) |
| 3 | Grace period honoured | Unit test over fixed clocks | Test output |
| 4 | One failed send does not block others | Fault injection | `ReminderResult` counts |
| 5 | Repeated heartbeat sends nothing twice | Live repeat of `/tick` | `RunLog` showing `skipped` |
| 6 | Cards render on Teams desktop and mobile | Manual check | Screenshots (Accessibility NFR) |
| 7 | Full cycle runs with `DRY_RUN` and no tenant | Local run | Log output |
