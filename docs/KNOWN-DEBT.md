# Known Debt

Deviations from `docs/rules/coding-rules.md` and `process-rules.md`, recorded
deliberately, to be fixed when the user decides. Not a backlog of ideas — every
item is a rule the repo already binds itself to.

**Last reviewed:** 25 Sep 2026, after the LLM-call review.

## Open

| # | Rule | What was done instead | Where |
|---|---|---|---|
| 1 | 11 — external payloads parsed through a schema at the boundary | Teams activities and Graph responses are still cast and trusted. Jira and both LLM providers *are* parsed through Zod. | `bot/handler.ts`, `graph/client.ts`, `trackers/sharepoint.ts` |
| 2 | 20 — retry with backoff on 429 and 5xx, honour `Retry-After` | Graph and the Teams adapter still have no retries. Jira and the LLM providers use `util/retry.ts`. | `graph/client.ts`, `bot/adapter.ts` |
| 3 | 9 — no module-level singletons holding live clients | The Firestore client and the Teams adapter are still created at module load. The LLM client, the Jira client and the tracker are now injected. | `store/firestore.ts`, `bot/adapter.ts` |
| 4 | 25 — structured JSON logs with `teamId`, `jobType`, `correlationId` | New code logs structured JSON with `teamId`; there is still no `correlationId`, and the older modules log plain strings. | `jobs/reminder.ts`, `graph/client.ts` |
| 5 | 27 — time every tracker write | Agent calls and the whole update path are timed. Tracker writes on their own are not, so the Latency NFR cannot be split into its parts. | `trackers/sharepoint.ts` |
| 8 | Process rule 1 — no production code before specs are Approved | SPEC-001..008 are still Draft. Code was written while they remain so, at the user's explicit instruction, on 19 Sep and again on 21 Sep. | — |
| 9 | SPEC-006 — Agent 2 reads its facts through four read-only tools | Agent 2 is given no tools. Code gathers the updates, sprint data, blockers and participation and passes them in the prompt. | `jobs/summary.ts`, `agents/summaryBuilder.ts` |
| 10 | SPEC-004, SPEC-006 — prompts live in `.md` files | Prompts are `.ts` modules exporting strings. | `agents/prompts/` |
| 11 | Privacy NFR — update content lives only in the tracker | The LLM response cache writes model output to `.llm-cache/` on disk. Git-ignored, forced off on Cloud Run by `scripts/deploy.mjs`. | `llm/cache.ts` |
| 12 | 24 — secrets come from Secret Manager | Three secrets, soon four with the Gemini key, sit in plain text in the Cloud Run configuration. | Cloud Run config |
| 13 | Success metric — participation is measured *within the grace period* | Everyone who replied is recorded as `withinGrace: true` without the arrival time ever being checked. A member chased at the cut-off and replying two hours later is recorded as punctual, so the metric cannot be reported. | `jobs/participation.ts` |
| 14 | FR-09 — participation reflects who reported that day | Who replied is derived from the tracker at the moment the count runs, and tracker rows carry a date but no time. A reply that lands after the count is in the tracker yet recorded as missed, so the tracker, the summary and the participation record can disagree about the same day. | `jobs/participation.ts`, `trackers/sharepoint.ts` |
| 19 | LLM calls — cost and reliability (review 25 Sep 2026, fix after the demo) | Gemini is only *asked* for JSON in the prompt; `responseMimeType: application/json` with a response schema is not used, so malformed output costs a retry. | `llm/gemini.ts` |
| 20 | LLM calls — retries | Two retry layers multiply: 2 HTTP attempts × 3 agent attempts = up to 6 calls per update. Agent attempts retry every error, including a 401 that cannot succeed (the expired Jira token, 24 Sep). Should retry only timeouts, 429/5xx and invalid output. | `agents/updateProcessor.ts`, `agents/summaryBuilder.ts` |
| 21 | LLM calls — tool round-trips | Agent 1 is offered the story tool even when the member's open items are already in the prompt. Each tool round-trip resends the whole conversation, roughly doubling that update's tokens. | `agents/updateProcessor.ts` |
| 22 | LLM calls — thinking tokens | No `thinkingConfig` is set. If `gemini-3.5-flash-lite` thinks by default, simple extraction is billed and slowed for it. Check the default first. | `llm/gemini.ts` |

## Closed since 19 Sep

| # | Rule | How it was closed |
|---|---|---|
| 6 | 28, 29, 30 — unit tests, first-class mock tracker, `eval/` | 24 unit tests over extraction shaping, schedule evaluation and tracker mapping; `trackers/mock.ts` is fully working; `eval/` holds 40 labelled updates and a scorer. |
| 7 | 8 — one source per setting | The message handler now resolves the team from the sender's roster and takes the tracker from that team's record. `trackers/factory.ts` is the single place a tracker is built. This was the item with a live failure mode. |
| — | FR-02 — updates are collected in one-to-one Teams chat | Channel messages were being recorded as stand-up updates, and a channel message also replaced the sender's personal chat reference, which would have sent their next reminder to the whole team. Channel activity is now used for one thing only: learning where to post the summary. Found and fixed 23 Sep 2026. |
| 15 | FR-10 — configuration is per team | Every place that used the single team id from the server settings now resolves the team from the sender: their conversation reference is stored on their own team (and nobody is added to a roster by messaging the assistant), a channel is stored only as the summary channel of the team that configured it, and `setup` / `status` / `pause` / `resume` / `run` act on the sender's own team. Closed 24 Sep 2026. |
| 16 | FR-07 — the summary lists **active** blockers | A blocker stays in the summary, whatever day it was raised, until the same member reports that item again without one (SPEC-006 4a, `BLOCKER_LOOKBACK_DAYS`). Closed 25 Sep 2026. |
| 17 | FR-07/FR-08 — the summary is read by stakeholders | Agent 2 returns the sections as validated JSON; code lays them out as an Adaptive Card in the channel and an HTML email. Closed 25 Sep 2026. |
| 18 | A member's name is their own | A Teams event with no sender name no longer overwrites the stored name. Closed 25 Sep 2026. |

## Notes on the open items

**Item 9 is the one to challenge first.** SPEC-006 has Agent 2 fetch its own
facts through `get_today_updates`, `get_sprint_data`, `get_active_blockers` and
`get_participation`. It is built the other way round: code gathers everything
and hands it over. Two reasons, both deliberate.

- Every tool round-trip resends the whole conversation, so four tool calls cost
  roughly four times one prompt. The summary runs once a day, so the money is
  small, but the same reasoning is what keeps Agent 1 affordable.
- Completion percentages, velocity and the at-risk date arithmetic are now done
  in code, where they can be checked against Jira. A figure the model worked out
  itself cannot be.

The spec should be amended to match, or the code changed to match the spec.
Either is fine; the present state, where they disagree, is not.

**Item 11** is contained but real. A recorded response holds extracted update
content. It is acceptable for local runs and the eval, which use sample data.
It must never be switched on for the deployed service — `deploy.mjs` sets
`LLM_CACHE=false` regardless of what `.env` says.

**Item 12** now matters more than it did: the Gemini API key is a billable
credential, and anyone with Cloud Run console access can read it.
