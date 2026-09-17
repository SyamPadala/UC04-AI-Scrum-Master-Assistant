# SPEC-007: Participation tracking

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-09 |
| **Assumptions** | A3 (habitual non-responder = 2 missed updates, configurable) |
| **Depends on** | SPEC-001, SPEC-003, SPEC-004 |
| **Owner** | Claude |

## Intent

**In plain words:** the assistant keeps score of who is actually replying. It
works out the team's daily participation rate, and when someone has missed two
days it quietly tells the Scrum Master — so a person drifting out of the habit
gets noticed early instead of at the retro.

## Behaviour

1. Each day, for each team, participation is recorded per member: `responded`
   or `missed`, along with whether the reply came before or after the cut-off
   (A2).
2. The daily participation rate is responders divided by roster size, measured
   at the team's cut-off time (stand-up time + grace period) — matching the PRD
   metric of "≥ 95% within the grace period".
3. A member who has missed `habitualThreshold` days (default 2) within a rolling
   window is flagged to the Scrum Master as a habitual non-responder (FR-09,
   A3).
4. The flag is delivered as a direct message to the Scrum Master naming the
   member and the missed dates.
5. A member is flagged once per streak, not once per day, so the alert does not
   become noise.
6. Replying again ends the streak and resets the count.
7. Participation figures are available to Agent 2 for the daily summary
   (SPEC-006) through a read-only tool.
8. Only metadata is stored — who replied and when, never what they said
   (Privacy NFR).

## Interface

```ts
interface ParticipationRecord {
  teamId: string; localDate: string;
  entries: { memberId: string; memberName: string;
             status: 'responded' | 'missed';
             respondedAt?: Date; withinGrace?: boolean }[];
  rate: number;               // 0..1, measured at cut-off
}

interface NonResponderFlag {
  teamId: string; memberId: string; memberName: string;
  missedDates: string[]; flaggedAt: Date;
}

recordParticipation(team: TeamConfig, localDate: string): Promise<ParticipationRecord>;
flagHabitualNonResponders(team: TeamConfig, localDate: string): Promise<NonResponderFlag[]>;
```

Stored in Firestore at `participation/{teamId}_{localDate}`. Read-only tool
`get_participation(teamId)` exposes it to Agent 2.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `habitualThreshold` (per team) | number | 2 | Missed days before flagging (A3) |
| `habitualWindowDays` (per team) | number | 5 | Rolling window for counting misses |
| `participationTime` (per team) | `HH:mm` | cut-off | When the daily rate is measured |

## Edge cases

- **Member replies after the cut-off.** Counted as responded, but marked outside
  the grace period, so the PRD's 95%-within-grace metric stays honest.
- **Member added to the roster mid-sprint.** Counted only from their join date;
  no retrospective misses.
- **Member with no conversation reference** (app never installed). Recorded as
  `skipped`, not `missed` — a setup gap is not a behaviour problem, and flagging
  them would be a false accusation.
- **Whole team misses a day** (holiday, incident). Rate of 0 is recorded; every
  member accrues a miss. Weekends and holidays are not excluded in this POC —
  a stated limitation.
- **Member already flagged and still missing.** Not re-flagged until they reply
  and lapse again.
- **Roster size of zero.** Rate is undefined rather than 0, and reported as "no
  roster" so an empty team does not look like a failing team.

## Out of scope

Deciding what to do about a non-responder — escalation beyond notifying the
Scrum Master is theirs to own (PRD leaves coaching with the Scrum Master).
Trend reporting across sprints.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Daily participation rate calculated correctly | Unit test over fixtures | Test output |
| 2 | Rate measured at cut-off, late replies marked | Unit test with timed replies | Test output (PRD metric) |
| 3 | Non-responder flagged after 2 missed days | Live run across two days, one silent user | Scrum Master DM (FR-09) |
| 4 | Flag sent once per streak, not daily | Live run over three days | Log showing one flag |
| 5 | Replying resets the streak | Unit test | Test output |
| 6 | Uninstalled member is skipped, not accused | Live run with an uninstalled user | Participation record |
| 7 | Only metadata stored, no update text | Inspect Firestore | Export (Privacy NFR) |
| 8 | Participation available to the summary | Live run | Summary text (FR-07) |
