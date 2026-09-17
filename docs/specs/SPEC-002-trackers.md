# SPEC-002: Tracker abstraction and destinations

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-04 |
| **Assumptions** | A7 (destinations: SharePoint list, Excel Online, Jira comment) |
| **Depends on** | SPEC-001 |
| **Owner** | Claude |

## Intent

**In plain words:** the assistant writes everyone's update into the team's own
status sheet, the same way the Scrum Master used to by hand. Different teams
keep that sheet in different places — a SharePoint list, an Excel file, or as
comments on Jira stories — so the assistant supports all three and each team
picks one.

This is also where the update *lives*. We deliberately keep no copy of it.

## Behaviour

1. One `Tracker` interface, four implementations: `sharepoint`, `excel`, `jira`,
   `mock`. The team's config names which one is active.
2. `write(update)` records one member's update for one date: member name, date,
   completed items, in-progress items, blockers, and the raw text.
3. Writing the same member and date twice **updates** the existing record rather
   than adding a second one (A11: a member's messages are combined into one
   update per day).
4. `readToday(teamId)` returns all of today's recorded updates for that team.
   This is how Agent 2 gets its material (SPEC-006) without us storing anything.
5. A tracker failure is reported to the caller and recorded, but never loses the
   member's message — the reply is acknowledged in Teams regardless.
6. The `mock` tracker writes to a local JSON file and is fully functional, so
   the whole daily cycle runs with no Microsoft or Jira account.

## Interface

```ts
interface StandupUpdate {
  teamId: string; memberId: string; memberName: string;
  localDate: string;              // 'YYYY-MM-DD'
  completed: string[]; inProgress: string[];
  blockers: { description: string; storyRef: string | null }[];
  rawText: string; capturedAt: Date;
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

**SharePoint** — one list item per member per day. Columns: Date, Member,
Completed, InProgress, Blockers, RawUpdate. Upsert by filtering on Member+Date.

**Excel Online** — one worksheet row per member per day, same columns, via the
Graph workbook API. Upsert by locating the matching row.

**Jira** — a comment on the affected story when one was resolved (A8); when no
story was resolved, a comment on a configured daily-standup issue. Upsert by
finding our own prior comment for that member and date and editing it.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tracker` (per team) | TrackerConfig | `mock` | Destination for that team |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | string | — | Jira Cloud auth |
| `MOCK_TRACKER_PATH` | string | `./.data/tracker.json` | Mock file location |

## Edge cases

- **Second message from the same member, same day.** Upsert, not append (A11).
- **Tracker unreachable / 401 / list or file missing.** Write fails, error is
  recorded in the job's outcome, member still gets an acknowledgement. Nothing
  is silently dropped.
- **Rate limited (429).** Backoff and retry per coding rule 20.
- **Jira story reference could not be resolved.** Comment goes to the configured
  daily-standup issue, blocker `storyRef` is `null`, marked "not specified" (A8).
- **Empty extraction** (member said "nothing to report"). Still written, with
  empty arrays — absence of content is not absence of participation.
- **Excel worksheet missing headers.** Created on first write.

## Out of scope

Deciding *what* goes into the update — that is Agent 1 (SPEC-004). Reading
sprint data from Jira/ADO for the summary — that is SPEC-006, a different
concern from writing status.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | All four implementations satisfy the same contract | Shared contract test suite | Test output |
| 2 | Same member twice in a day yields one record | Unit test + live repeat | Tracker state |
| 3 | Update visible in SharePoint list | Live run on sandbox | Screenshot (FR-04) |
| 4 | Update visible in Excel Online worksheet | Live run on sandbox | Screenshot (FR-04) |
| 5 | Update visible as Jira comment on the right story | Live run on Jira Cloud | Screenshot (FR-04) |
| 6 | Tracker outage does not lose the member's reply | Fault injection | Log + acknowledgement in Teams |
| 7 | No update content in Firestore after a full cycle | Inspect collections | Export (Privacy NFR) |
