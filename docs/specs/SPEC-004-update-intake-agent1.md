# SPEC-004: Update intake and Agent 1 extraction

| | |
|---|---|
| **Status** | Draft |
| **Delivers** | FR-02, FR-03, NFR Latency |
| **Assumptions** | A8 (story resolution), A11 (messages combined per member per day) |
| **Depends on** | SPEC-001, SPEC-002 |
| **Owner** | Claude |

## Intent

**In plain words:** a team member replies to the assistant in whatever words
they like — no form, no template. The assistant reads it and works out three
things: what they finished, what they're working on, and what's blocking them.
It can look up a story number to check it is real. Then it files the result in
the team's tracker.

This is the riskiest part of the build, so it is built and measured first.

## Behaviour

1. Any personal message from a roster member arriving at `/api/messages` is
   treated as a stand-up update. No command, keyword or format is required
   (FR-02).
2. The member is acknowledged in Teams promptly, without waiting for the full
   extraction to finish.
3. Agent 1 extracts three fields from the text: `completed`, `inProgress`,
   `blockers` (FR-03). Output is structured JSON validated against a schema.
4. Agent 1 may call **read-only** tools to establish facts:
   `lookup_story(id)` and `get_member_open_items(memberId)`.
5. A blocker's affected story is resolved from an explicit id or from a
   description matched against the member's open items; when neither succeeds,
   `storyRef` is `null` and it is reported as "not specified" (A8).
6. Code — never the agent — then writes the result to the team's tracker
   (SPEC-002) and, if blockers exist, triggers escalation (SPEC-005).
7. Further messages from the same member on the same day are re-extracted
   together with the earlier text and the record is updated, not duplicated
   (A11).
8. The whole path — message received to tracker written — is timed and must
   complete within 30 seconds (Latency NFR).
9. **No fallback extraction.** If the agent exceeds its cap or timeout, or
   returns invalid JSON, the extraction **fails explicitly**: nothing is written
   to the tracker, the failure is recorded, and the member is told their update
   could not be processed. The program never substitutes its own extraction for
   the model's, because a result that might have come from either is not
   evidence that the model works.
10. A failed call may be **retried** against the same model (a retry is the same
    source; a fallback is a different one). Retries are capped and recorded.

## Interface

```ts
interface ExtractionInput {
  text: string; memberId: string; memberName: string; teamId: string;
}

interface ExtractionOutput {
  completed: string[];
  inProgress: string[];
  blockers: { description: string; storyRef: string | null }[];
  confidence: 'high' | 'low';
  // no `degraded` flag: output either came from the model or the call failed
}

extractUpdate(input: ExtractionInput): Promise<ExtractionOutput>;
```

Read-only tools in `src/agents/tools/`:

| Tool | Returns |
|---|---|
| `lookup_story(id)` | Story key, title, status, assignee, points — or not found |
| `get_member_open_items(memberId)` | The member's open sprint items |

Prompt lives in `src/agents/prompts/updateProcessor.md`, not inline.
Model id comes from config; never hardcoded at a call site (coding rule 18).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `AGENT1_MAX_TOOL_ITERATIONS` | number | 3 | Cap on tool round-trips |
| `AGENT1_TIMEOUT_MS` | number | 20000 | Wall clock before the call fails |
| `AGENT1_MAX_RETRIES` | number | 2 | Retries against the same model before failing |
| `LLM_PROVIDER` | gemini / anthropic / vertex | gemini | Which provider the adapter uses (A12) |
| `LLM_MODEL` | string | set in `.env` | Model id for the selected provider |

The LLM sits behind a provider adapter (`src/llm/`) exposing one interface:
prompt in, validated structured output out. Providers are interchangeable by
config alone — no call site knows which one is active (coding rule 8).

**Delivery position (A12):** the PRD names Claude; **Gemini is the approved
substitute and is what ships**. FR-03's ≥ 90% accuracy figure is measured and
reported against Gemini, because that is what runs. The adapter keeps Claude a
one-line change if the decision is revisited, but no accuracy claim is ever
carried across providers.

**No fallback (user decision, 17 Sep 2026):** there is no non-LLM extraction
path. Every recorded extraction came from the model or does not exist. This is
deliberate — an output that could have been produced by the program is not
evidence that the model works.

## Edge cases

- **"Nothing to report" / "same as yesterday".** Valid update, empty arrays,
  recorded as participation.
- **Message that is clearly not an update** ("thanks!", an emoji). Low
  confidence, empty arrays, still filed — the Scrum Master reviews (PRD risk:
  LLM misclassification).
- **Story id mentioned that does not exist.** Tool returns not found; retained
  as free text, `storyRef` stays `null`.
- **Several blockers in one message.** All captured, each with its own story
  reference or `null`.
- **Message from someone not on any roster.** Politely ignored, logged, not
  filed.
- **Message arrives before the day's reminder, or after the summary.** Accepted
  and filed against today's date; the summary reflects what existed when it ran.
- **Very long message.** Truncated at a configured limit with the truncation
  recorded.
- **Attachment or voice message.** Not supported (A10). The member is told
  plainly to reply in text.
- **LLM provider outage.** Retries, then fails explicitly. Nothing is written to
  the tracker. The member is told plainly that their update could not be
  processed and asked to resend. The failure is recorded and visible.

## Out of scope

Sending the blocker alert (SPEC-005). Building the daily summary (SPEC-006).
Counting participation (SPEC-007). Voice input (A10, not built).

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Extraction accuracy ≥ 90% | `eval/` run over ~40 labelled updates | Accuracy report (FR-03) |
| 2 | Varied free-text formats accepted | Live run with differently worded replies | Screenshots (FR-02) |
| 3 | End-to-end under 30 s | Timing instrumentation over the eval set | Latency report (NFR) |
| 4 | Story reference resolved and validated | Eval cases with ids and descriptions | Accuracy report (A8) |
| 5 | Timeout fails explicitly, writes nothing | Fault injection | Log + empty tracker + member notified |
| 6 | Invalid agent JSON never reaches the tracker | Unit test with malformed output | Test output |
| 7 | Two messages same day produce one record | Live repeat | Tracker state (A11) |
| 8 | Agents hold no write or send tools | Code review of `agents/tools/` | Review note |
