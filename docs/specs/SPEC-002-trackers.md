# SPEC-002: Tracker abstraction and destinations

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-04 |
| **Assumptions** | A7 (destinations: SharePoint list, Excel Online, Jira comment) |
| **Depends on** | SPEC-001 |
| **Owner** | Claude |

## Intent

**Row shape:** the layout below was set by the user on 18 Sep 2026 — one row per
work item, with `WIN`/`Description` naming the item and `Comment` holding the
member's words. The PRD requires only that completed, in-progress and blocker
information stay separately identifiable (FR-03); here `Status` carries that
distinction.

**In plain words:** the assistant writes everyone's update into the team's own
status sheet, the same way the Scrum Master used to by hand. Different teams
keep that sheet in different places — a SharePoint list, an Excel file, or as
comments on Jira stories — so the assistant supports all three and each team
picks one.

This is also where the update *lives*. We deliberately keep no copy of it.

## Behaviour

1. One `Tracker` interface, four implementations: `sharepoint`, `excel`, `jira`,
   `mock`. The team's config names which one is active.
2. `write(update)` records one member's update for one date as **one row per
   work item** (user decision, 18 Sep 2026): work item number, work item
   description, assignee, the member's comment, a status of Completed /
   In Progress / Blocked, and any blocker.
3. Writing the same member and date twice **replaces** that member's rows for
   that date — delete the existing set, write the new one (A11: a member's
   messages are combined into one update per day). This is an upsert on
   member+date over a *set* of rows, not a single row.
4. `readToday(teamId)` returns all of today's recorded updates for that team.
   This is how Agent 2 gets its material (SPEC-006) without us storing anything.
5. A tracker failure is reported to the caller and recorded, but never loses the
   member's message — the reply is acknowledged in Teams regardless.
6. The `mock` tracker writes to a local JSON file and is fully functional, so
   the whole daily cycle runs with no Microsoft or Jira account.

## Interface

```ts
type RowStatus = 'Completed' | 'In Progress' | 'Blocked';

// One tracker row = one work item (or one unattached blocker).
interface TrackerRow {
  win: string | null;             // work item number, e.g. 'PROJ-12'; null when
                                  // the member named none (A8)
  description: string | null;     // the work item's title, read from Jira/ADO —
                                  // never the member's words
  assignedTo: string;             // member display name
  comment: string | null;         // what the member said about it, in their
                                  // words; null on a Blocked row
  status: RowStatus;
  anyBlocker: string | null;
}

interface StandupUpdate {
  teamId: string; memberId: string; memberName: string;
  localDate: string;              // 'YYYY-MM-DD'
  rows: TrackerRow[];
  rawText: string; capturedAt: Date;   // rawText is not written to the tracker
}

interface Tracker {
  write(update: StandupUpdate): Promise<void>;     // upsert on member+date
  readToday(teamId: string, localDate: string): Promise<StandupUpdate[]>;
}

type TrackerConfig =
  | { kind: 'sharepoint'; siteId: string; listId: string }
  | { kind: 'excel'; driveId: string; itemId: string; worksheet: string }
  | { kind: 'jira'; baseUrl: string; projectKey: string }
  | { kind: 'mock'; path: string };
```

**SharePoint** — one list item per work item. Columns:

| Column | Type | Holds |
|---|---|---|
| `Date` | Date and time (no time) | The stand-up date |
| `WIN` | Single line of text | Work item number; empty when none was named (A8) |
| `Description` | Single line of text | The work item's title, from Jira/ADO |
| `AssignedTo` | Single line of text | Member display name |
| `Comment` | Multiple lines of text | The member's own words; empty on a Blocked row |
| `Status` | Choice | `In Progress` / `Completed` / `Blocked` (list order) |
| `AnyBlocker` | Multiple lines of text | The blocker, if any |

Upsert: filter on AssignedTo+Date, delete those items, write the new set.

**Excel Online** — one worksheet row per work item, same columns in the same
order, via the Graph workbook API. Upsert the same way: remove that member's
rows for the date, append the new set.

**Jira** — a comment on each resolved work item, rendering that item's rows;
rows with no WIN go to a configured daily-standup issue. Upsert by finding our
own prior comment for that member and date and editing it.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tracker` (per team) | TrackerConfig | `mock` | Destination for that team |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | string | — | Jira Cloud auth (HTTP Basic, `email:token`) |
| `JIRA_STORY_POINTS_FIELD` | string | — | Custom field ID holding story points |
| `MOCK_TRACKER_PATH` | string | `./.data/tracker.json` | Mock file location |

**Story points are not a fixed field.** Jira exposes story points as a site
allocated custom field, so the ID differs between Jira sites and between
team-managed and company-managed projects. It must never be hardcoded. Read it
from `JIRA_STORY_POINTS_FIELD`; on the delivered site that value is
`customfield_10016` ("Story point estimate"). If the key is unset or the field
is absent on an issue, treat the points as unknown and exclude that issue from
the velocity calculation rather than counting it as zero — counting it as zero
silently understates completion (A6).

## Edge cases

- **Second message from the same member, same day.** That member's rows for the
  date are deleted and rewritten, not appended (A11).
- **Blocker with no work item** ("no VPN access"). Its own row: `WIN` and
  `Description` empty, `Status` = `Blocked`, text in `AnyBlocker`, `Comment`
  empty (user decision, 18 Sep 2026 — the text is not duplicated).
- **Tracker unreachable / 401 / list or file missing.** Write fails, error is
  recorded in the job's outcome, member still gets an acknowledgement. Nothing
  is silently dropped.
- **Rate limited (429).** Backoff and retry per coding rule 20.
- **Work item could not be resolved.** `WIN` and `Description` stay empty; the
  row is still written (A8). For the Jira tracker the comment goes to the
  configured daily-standup issue.
- **Empty extraction** (member said "nothing to report"). One row with `Status`
  = `In Progress`, `Comment` = the member's words and no WIN — absence of
  content is not absence of participation. Participation is counted from the
  reply, not from the row count (SPEC-007).
- **Excel worksheet missing headers.** Created on first write.

## Out of scope

Deciding *what* goes into the update — that is Agent 1 (SPEC-004). Reading
sprint data from Jira/ADO for the summary — that is SPEC-006, a different
concern from writing status.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | All four implementations satisfy the same contract | Shared contract test suite | Test output |
| 2 | Same member twice in a day yields one row set, not duplicates | Unit test + live repeat | Tracker state |
| 2a | A blocker with no work item is written as its own Blocked row | Unit test | Tracker state |
| 3 | Update visible in SharePoint list | Live run on sandbox | Screenshot (FR-04) |
| 4 | Update visible in Excel Online worksheet | Live run on sandbox | Screenshot (FR-04) |
| 5 | Update visible as Jira comment on the right story | Live run on Jira Cloud | Screenshot (FR-04) |
| 6 | Tracker outage does not lose the member's reply | Fault injection | Log + acknowledgement in Teams |
| 7 | No update content in Firestore after a full cycle | Inspect collections | Export (Privacy NFR) |
