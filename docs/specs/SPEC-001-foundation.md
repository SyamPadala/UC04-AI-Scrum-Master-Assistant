# SPEC-001: Foundation, config store and scheduler

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-10, NFR Reliability |
| **Assumptions** | A2 (cut-off = reminder + grace), A4 (per-team end-of-day summary time) |
| **Depends on** | — |
| **Owner** | Claude |

## Intent

The always-on spine of the assistant. One service receives Teams activity and a
five-minute heartbeat, knows which teams exist and what each team's schedule is,
and runs exactly the jobs that are due — once each, in the team's own timezone,
however many times the heartbeat fires.

## Behaviour

1. The service exposes `POST /api/messages` (Teams activity), `POST /tick`
   (scheduler heartbeat) and `GET /health`.
2. `/tick` iterates every team whose config is `active` and evaluates, in that
   team's timezone, whether each job type is due: `reminder`, `followup`,
   `summary`, `participation`.
3. A job is due when the team's local time has passed its configured time for
   that job on the current local date, and that job has not already run for that
   team on that local date.
4. Running a job is claimed atomically before it acts. A second `/tick` covering
   the same window performs no duplicate work.
5. Every attempted job writes a `RunLog` entry recording team, job type, local
   date, outcome, duration and error if any.
6. Each team carries its own roster, schedule, timezone, tracker destination and
   stakeholder list. Teams are independent: a failure in one does not affect
   another (FR-10).
7. `/tick` returns 200 with a per-team summary of what ran, even when individual
   jobs failed. It never returns 5xx for a job-level failure.
8. `/health` reports service liveness and Firestore reachability without auth.

## Interface

```ts
// src/types.ts
type JobType = 'reminder' | 'followup' | 'summary' | 'participation';

interface TeamConfig {
  teamId: string;
  name: string;
  active: boolean;
  timezone: string;              // IANA, e.g. 'Asia/Kolkata'
  standupTime: string;           // 'HH:mm' local
  gracePeriodMinutes: number;    // A2: follow-up offset from standupTime
  summaryTime: string;           // 'HH:mm' local (A4)
  members: Member[];
  scrumMasterId: string;
  tracker: TrackerConfig;        // see SPEC-002
  stakeholders: { channelId?: string; emails: string[] };
}

interface Member {
  memberId: string;              // AAD object id
  displayName: string;
  conversationRef?: string;      // set on app install; required to DM
}

interface RunLog {
  teamId: string; jobType: JobType; localDate: string;
  outcome: 'success' | 'partial' | 'failed' | 'skipped';
  startedAt: Date; durationMs: number; detail?: string;
}
```

```
POST /tick    -> 200 { ran: [{ teamId, jobType, outcome }] }
GET  /health  -> 200 { status, firestore: 'ok' | 'unreachable', version }
```

Firestore collections: `teams/{teamId}`, `runs/{teamId}_{localDate}_{jobType}`,
`participation/{teamId}_{localDate}` (SPEC-007). No update content in any of them.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `PORT` | number | 8080 | Cloud Run listen port |
| `TICK_SHARED_SECRET` | string | — | Required header on `/tick` |
| `GCP_PROJECT_ID` | string | — | Firestore / Secret Manager project |
| `DEFAULT_TIMEZONE` | string | `Asia/Kolkata` | Used when a team omits one |
| `DEFAULT_GRACE_MINUTES` | number | 120 | A2 default, per PRD FR-05 |

## Edge cases

- **Missed ticks.** If the service was down, the next `/tick` still finds the job
  due for that local date and runs it late rather than skipping it. Lateness is
  recorded in `RunLog.detail`.
- **Duplicate ticks.** Claim-before-act makes the second one a no-op `skipped`.
- **DST and timezone shifts.** Due-ness is computed from the team's local wall
  clock on the current local date, so a shift moves the job with the clock.
- **Day rollover mid-tick.** Local date is resolved once per team per tick.
- **Team with no members, or no member with a `conversationRef`.** Job runs,
  outcome `skipped`, detail names the reason. Not an error.
- **Firestore unavailable.** `/tick` returns 200 with outcome `failed` for all
  teams and logs; the next tick retries. `/health` reports `unreachable`.
- **Unauthenticated `/tick`.** 401, no work performed.

## Out of scope

Job bodies themselves — reminder (SPEC-003), follow-up (SPEC-003), summary
(SPEC-006), participation (SPEC-007). This spec provides the dispatcher and the
contract they implement. Admin editing of `TeamConfig` is SPEC-008; until then
config is seeded from a JSON fixture.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Job due-ness across timezones and DST | Unit tests over a table of fixed clocks | Test output |
| 2 | Idempotency: same job, two ticks, one execution | Unit test + repeated live `/tick` | Test output + `RunLog` showing `skipped` |
| 3 | Missed tick runs late, not skipped | Unit test with a clock gap | Test output |
| 4 | Two teams, different timezones and times, both fire correctly | Live run on sandbox | `RunLog` entries for both teams (FR-10) |
| 5 | One team failing does not affect the other | Fault-injected live run | `RunLog`: one `failed`, one `success` |
| 6 | No update content in Firestore | Inspect collections after a full cycle | Screenshot / export |
| 7 | Reliability instrumentation present | `RunLog` query over the demo period | Run-log report (partial data, ~1 day) |
