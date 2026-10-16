# SPEC-001: Foundation, config store and scheduler

| | |
|---|---|
| **Status** | Approved 16 Oct 2026 — base text with as-built notes (10 Oct 2026) and items 9–15 |
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

### As built — differences from the draft above (recorded 10 Oct 2026)

- `TeamConfig` carries more fields than shown below (working days, habitual
  non-responder thresholds, Scrum Master name and email, linked Teams team,
  leavers, Jira project). Each is owned by the spec that added it (SPEC-003
  item 9, SPEC-007, SPEC-008).
- `DEFAULT_GRACE_MINUTES` is not a setting. A new team starts with 120 minutes,
  set by the admin page (SPEC-008), and the admin can change it.
- Teams are created on the admin page (SPEC-008), not seeded from a JSON fixture.
- A Scrum Master is held in its own record, not only as a roster member
  (SPEC-008 10k).

### Added 10 Oct 2026 — proposed, awaiting approval

These record work already built from the maturity plan without its own spec
item (found in the SDD check of 10 Oct 2026). Items marked *internal* change
nothing for members, Scrum Masters or admins.

9. *Internal (M16).* **Correlation id.** Every incoming Teams message, admin
   request and scheduled job run gets an id when it starts; every log line it
   writes carries that id (coding rule 25).
10. *Internal (M17).* **Database contract.** Code reaches the database only
    through one interface with interchangeable adapters, chosen by `DB_PROVIDER`:
    `firestore` (deployed) and `memory` (tests and local runs). Every adapter
    supports create-only claims, so behaviour 4 holds on any of them. One
    shared helper fetches Microsoft sign-in tokens.
11. *Internal (M5).* **Secrets from Secret Manager.** The bot password, Graph
    secret, Jira token, Gemini key, admin session secret and tick secret are
    stored in Google Secret Manager, readable only by the service's own runtime
    account. Deploy passes references, never values
    (`CLOUD_RUN_SECRETS=secret-manager`). Coding rule 24.
12. *(M14)* **Admins are e-mailed when something fails.** A Google Cloud alert
    e-mails every admin (`ADMIN_USER_IDS`) when: a scheduled job fails; an
    update cannot be processed; an update takes more than 30 s (Latency NFR);
    `/health` does not answer for 10 minutes. Set up by hand with
    `scripts/alerts.mjs`. Live: the health alert. Waiting on a role: the
    three log-based alerts.
13. *Internal (M18b).* The `/tick` secret is compared in constant time.
14. *Internal (design review, 8 Oct 2026).* **Structure.** `/tick` finds each
    job through one registry (job type → job). The admin service and page,
    update intake and Teams handler are split into smaller modules by
    responsibility. Jira is built in one factory. No behaviour changes.
15. **Commit check (process rules 1 and 11).** A local git hook
    (`.githooks/commit-msg`, switched on with
    `git config core.hooksPath .githooks`) stops a commit that changes code
    unless its message names a spec (`SPEC-NNN`) whose status is Approved.
    Documentation-only commits pass. It runs only on the developer's machine,
    not in a pipeline (no CI/CD on this engagement).

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
| 9 | Correlation id on every line of one message | Unit test; Cloud Run log query | Test output |
| 10 | Same behaviour on both database adapters | Full unit suite on `DB_PROVIDER=memory` | Test output |
| 11 | No secret left as a plain Cloud Run setting | Inspect the service configuration | Done 8 Oct 2026: none left |
| 12 | Admin e-mailed on failure | Stop the service / force a job failure | Health alert live 8 Oct 2026; log alerts pending |
| 15 | Code commit without an Approved spec is stopped | `test/check-commit.test.mjs` | Test output |
