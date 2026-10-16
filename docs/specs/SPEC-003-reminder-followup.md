# SPEC-003: Stand-up reminder and follow-up

| | |
|---|---|
| **Status** | Draft — base text with as-built notes (10 Oct 2026) ready for approval; item 9 (working days) approved 29 Sep 2026; item 10 (send retry) approved 8 Oct 2026; item 11 (parallel sends) approved 16 Oct 2026, not built |
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
9. *Added 29 Sep 2026 (user decision).* **Working days.** Each team has
   `workingDays` (default Monday–Friday), set on the admin page's Schedule tab.
   On any other day, in the team's timezone, no scheduled job runs: no
   reminder, follow-up, summary or participation count. Run now still works.
10. *Added 8 Oct 2026 (approved by the user, maturity plan M9; L13).*
    **Proactive sends are retried.** Reminders, follow-ups, blocker alerts,
    the no-sprint notice, the summary and non-responder flags: when Teams
    answers 429 or 5xx, or does not answer, the send is tried again after 2 s
    and 5 s (Teams' Retry-After honoured, at most 10 s). A chat that is gone
    (404) or a refused request (400/401/403) is not retried. All attempts
    failing is the same failure as before. Accepted: a 5xx after delivery can
    send a message twice. Checking delivery first was rejected (needs
    Chat.Read.All).
11. *Added 16 Oct 2026 (approved by the user, 16 Oct 2026). Not built; waits
    for the user's go-ahead.* **Parallel sends, parallel teams.** Built for
    large teams and many teams with the same stand-up time.
    - **Members:** each job messages up to `SEND_CONCURRENCY` members at the
      same time (default 4). Applies to every proactive send in item 10.
    - **Teams:** each `/tick` runs the due jobs of up to `TEAM_CONCURRENCY`
      teams at the same time (default 4). Jobs of one team still run in order.
    - Unchanged guarantees: each job is claimed before it runs (rule 19), so
      parallel teams never double-send; one member's or one team's failure
      never stops the others (rule 21); item 10's retry applies to every send.
    - One shared limiter helper does the bounding; jobs do not each write
      their own (rule 7). Unit tests prove the limit holds and nobody is
      messaged twice (rule 28).

### As built — differences from the draft above (recorded 10 Oct 2026)

- The reminder and follow-up are **plain text messages**, not Adaptive Cards.
  The text asks the same three questions and says any wording is fine.
  `standupPrompt.json` and `followupPrompt.json` do not exist.
- **Plain text kept** (user, 16 Oct 2026): a member replies by typing, so a
  card adds nothing; plain text reads well on mobile.
- **`reminderTone` dropped** (user, 16 Oct 2026): one standard wording for
  every team, nothing to pick. It was a PRD risk mitigation, not an FR.
- `SEND_CONCURRENCY` is not built yet: members are messaged one after
  another. Replaced by item 11 (approved 16 Oct 2026, not built).
- A member whose chat is gone (404) has their stored chat reference cleared, so
  the admin page shows them as not reachable.

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

The reminder and follow-up are plain text (see As built), which renders on
Teams desktop and mobile (Accessibility NFR).

Conversation references are captured by the bot on `conversationUpdate` and
install events, and stored per member (SPEC-001).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `standupTime` (per team) | `HH:mm` | `09:00` | When the reminder goes out |
| `gracePeriodMinutes` (per team) | number | 120 | Follow-up offset (PRD FR-05) |
| `DRY_RUN` | boolean | false | Log instead of send |
| `SEND_CONCURRENCY` | number | 4 | Members messaged at the same time (item 11; not built) |
| `TEAM_CONCURRENCY` | number | 4 | Teams handled at the same time per tick (item 11; not built) |

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
- **Weekend.** Handled by `workingDays` (item 9). **Public holidays** are not
  handled — recorded as a known limitation.

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
| 8 | No scheduled job runs on a non-working day | Unit test over fixed clocks (Saturday, Monday) | Test output |
