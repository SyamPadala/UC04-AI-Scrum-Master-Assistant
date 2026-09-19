# Known Debt

Deviations from `docs/rules/coding-rules.md` in the code written on 19 Sep 2026.
Recorded deliberately, to be fixed when the user decides. Not a backlog of
ideas — every item here is a rule the repo already binds itself to.

| # | Rule | What was done instead | Where |
|---|---|---|---|
| 1 | 11 — external payloads parsed through a schema at the boundary | Teams activities and Graph responses are cast and trusted | `bot/handler.ts`, `graph/client.ts`, `trackers/sharepoint.ts` |
| 2 | 20 — retry with backoff on 429 and 5xx, honour `Retry-After` | No retries anywhere; the first failure is final | `graph/client.ts`, `bot/adapter.ts` |
| 3 | 9 — no module-level singletons holding live clients | Firestore client and the Teams adapter are created at module load, so tests cannot substitute them | `store/firestore.ts`, `bot/adapter.ts` |
| 4 | 25 — structured JSON logs with `teamId`, `jobType`, `correlationId` | Plain `console.log` / `console.error` strings | throughout |
| 5 | 27 — time every tracker write | No timings recorded, so the Latency NFR has no evidence | `trackers/sharepoint.ts` |
| 6 | 28, 29, 30 — unit tests, first-class mock tracker, `eval/` | None written; the mock tracker throws | — |
| 7 | 8 — one source per setting | Tracker location lives in both `.env` and the team record; scheduled jobs read the team record, the message handler reads `.env` | `bot/handler.ts` vs `jobs/tick.ts` |
| 8 | Process rule 1 — no production code before specs are Approved | Code written while SPEC-001..008 are still Draft, at the user's explicit instruction | — |

## Notes

Item 7 is the one with a live failure mode: configure a second team with a
different tracker and its members' messages will still be written to the first
team's list, because the message handler never consults the team record.

Item 2 matters most for the demo. Graph and Teams both return 429 under load,
and a stand-up sends several messages in quick succession.

Item 6 blocks FR-03 verification: the accuracy target is proven by the eval
number, and there is no eval.
