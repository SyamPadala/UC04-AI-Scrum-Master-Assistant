# SPEC-008: Admin configuration card

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | NFR Configuration |
| **Assumptions** | A9 (configuration via Adaptive Card in the bot chat, `setup` command) |
| **Depends on** | SPEC-001 |
| **Owner** | Claude |

## Intent

**In plain words:** the Scrum Master sets the assistant up from inside Teams —
type `setup` in the chat and a form appears. Who's on the team, what time
stand-up is, how long to wait before chasing, where to file the updates, who
gets the summary. No config file, no redeploy, no developer.

## Behaviour

1. The Scrum Master types `setup` in the bot chat and receives an Adaptive Card
   pre-filled with the team's current configuration (A9).
2. The card edits: team name, roster, Scrum Master, timezone, stand-up time,
   grace period, summary time, tracker destination, stakeholder channel and
   emails, and active/paused state.
3. Submitting the card validates the input and saves it. The next heartbeat uses
   the new settings — no restart.
4. Only the team's current Scrum Master, or a configured admin, may change that
   team's configuration. Anyone else gets a polite refusal.
5. `status` returns a read-only summary of the current configuration and today's
   run outcomes, so the Scrum Master can check the assistant is working.
6. `pause` and `resume` set `active`, stopping and restarting all scheduled jobs
   for that team without deleting anything.
7. A Scrum Master running `setup` in a chat with no team yet creates a new team
   (FR-10 — this is how the second team gets added in the demo).
8. Every configuration change is recorded: who changed it, when, and which
   fields, so a misconfigured demo can be traced.

## Interface

```ts
type AdminCommand = 'setup' | 'status' | 'pause' | 'resume' | 'help';

interface ConfigChange {
  teamId: string; changedBy: string; changedAt: Date;
  fields: { field: string; from: unknown; to: unknown }[];
}

handleAdminCommand(cmd: AdminCommand, ctx: TurnContext): Promise<void>;
applyConfig(teamId: string, patch: Partial<TeamConfig>, changedBy: string): Promise<void>;
```

Cards: `src/cards/adminSetup.json`, `src/cards/adminStatus.json`. Roster entries
are picked by name and resolved to object ids via Graph user lookup.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `ADMIN_USER_IDS` | string[] | [] | Users who may configure any team |
| `SETUP_COMMAND` | string | `setup` | Trigger word |

## Edge cases

- **Invalid time format, or grace period that pushes the follow-up past the
  summary.** Rejected with a specific message naming the field, not a generic
  error. Nothing is saved.
- **Roster member who has not installed the app.** Accepted and saved, but the
  card warns plainly that they cannot be messaged until they do — this is the
  most likely demo-day failure and it should be visible before the demo.
- **Timezone that is not a valid IANA name.** Rejected with examples.
- **Tracker destination that cannot be reached with current credentials.**
  Saved, with a warning from a connectivity check, so the problem is found at
  setup rather than at 9 AM.
- **Two people editing at once.** Last write wins; both changes are recorded in
  the change log so the conflict is visible.
- **Non-Scrum-Master runs `setup`.** Refused, and the attempt is logged.
- **`setup` run while jobs are mid-flight.** Config is read once per job at
  start, so a change never applies halfway through a run.
- **Team paused mid-day.** Remaining jobs for the day are skipped with reason
  "paused"; already-sent messages are not recalled.

## Out of scope

A web admin UI — the PRD allows "adaptive card **or** admin UI", and the card is
the lighter path (A9). Per-member preferences. Role management beyond Scrum
Master and admin.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | `setup` returns a pre-filled card | Live run | Screenshot (Configuration NFR) |
| 2 | Changing stand-up time takes effect without restart | Live run, change then wait for tick | Reminder at new time |
| 3 | Changing tracker destination takes effect | Live run | Update in the new destination |
| 4 | Roster change adds and removes reminders | Live run | `ReminderResult` counts |
| 5 | Second team created from the card | Live run | Two teams running (FR-10) |
| 6 | Non-Scrum-Master is refused | Live run as a member | Screenshot + log |
| 7 | Invalid input rejected with a specific message | Live run | Screenshot |
| 8 | `pause` stops jobs, `resume` restarts them | Live run over two ticks | `RunLog` |
| 9 | Changes recorded with author and fields | Inspect change log | Export |
