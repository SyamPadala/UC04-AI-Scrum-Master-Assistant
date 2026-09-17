# Coding Rules

Binding on all code in this repo. Deviations need a note in the spec saying why.

## Language and style

1. TypeScript, `strict: true`. No `any` — use `unknown` and narrow.
2. ES modules, Node.js 22, top-level `await` permitted in entrypoints only.
3. Named exports. No default exports.
4. `async`/`await` throughout. No raw `.then()` chains.
5. Comment density matches surrounding code. Comments say *why*, not *what*.
6. Files under ~300 lines. Split by responsibility, not by line count.

## Structure

7. One responsibility per module. `jobs/` orchestrate, `trackers/`/`pm/`/`graph/`
   talk to the outside world, `store/` persists, `agents/` reason.
8. External systems sit behind an interface defined in our code, never leaked
   into callers. `Tracker` is the model: one interface, four implementations.
9. Dependencies are injected, not imported at point of use, so tests can
   substitute mocks. No module-level singletons holding live clients.
10. No business logic in `index.ts` — it wires routes to handlers, nothing more.

## Types and data

11. Every external payload (Teams activity, Graph response, Jira issue, agent
    output) is parsed through a Zod schema at the boundary. Inside the boundary,
    types are trusted.
12. Domain types live in `src/types.ts` and are the shared vocabulary:
    `TeamConfig`, `Member`, `StandupUpdate`, `Blocker`, `SprintData`, `RunLog`.
13. Dates and times are UTC internally, `Date` objects, never strings. Timezone
    conversion happens only at schedule evaluation and display.

## Agents

14. Agent modules expose one function, take typed input, return typed output.
    They do not know about Teams, Firestore or trackers.
15. Agent tools are read-only and declared in `agents/tools/`. A tool that
    writes or sends is a build error.
16. Every agent call is bounded: max tool iterations and a wall-clock timeout,
    both from config. On timeout or invalid output, **fail explicitly** — retry
    the same model if retries remain, then record the failure and stop. Never
    substitute program-generated output for model output: a result that could
    have come from either source is not evidence that the model works.
17. Prompts live in dedicated files next to the agent, not inline in logic.
18. Model id comes from config (`claude-opus-5`), never hardcoded in a call site.

## Reliability

19. Every scheduled job is idempotent on `teamId + date + jobType`. Claim the
    run in Firestore before acting.
20. Every outbound call to Teams, Graph, Jira or ADO retries with exponential
    backoff on 429 and 5xx, and honours `Retry-After`.
21. Failures are caught per member, not per team. One member's failed DM must
    not stop the other members' reminders.
22. Every job run writes a `RunLog` entry: team, job, date, outcome, duration,
    error. This is the evidence for the Reliability NFR.

## Privacy

23. Never write update content to Firestore or to logs. Log identifiers,
    counts and timings. This is the Privacy NFR.
24. Secrets come from Secret Manager via `config/`. No secret is read from
    `process.env` outside `config/`, and none is ever logged.

## Errors and logging

25. Structured JSON logs with `teamId`, `jobType`, `correlationId`. One log
    line per meaningful event, not per statement.
26. Errors thrown internally are typed and carry context. Catch at the job
    boundary, log, record in `RunLog`, continue.
27. Time every agent call and every tracker write. The Latency NFR is measured
    from these numbers, so they must be real.

## Testing

28. Unit tests for extraction shaping, schedule evaluation, idempotency and
    tracker mapping — the logic that is easy to get quietly wrong.
29. The mock tracker and mock PM client are first-class, so the daily cycle
    runs end-to-end with no external accounts.
30. `eval/` holds the labelled update set and the accuracy scorer. It is run,
    not read: FR-03 is verified by its number.
