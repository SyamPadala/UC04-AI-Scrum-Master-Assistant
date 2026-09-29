# Agent 1 context: Preload vs Tools — comparison

**Date run:** 26 Sep 2026
**Model:** Gemini (`gemini-3.5-flash-lite`)
**Test set:** the 47 labelled messages in `eval/`, one live run per variant.

## What was compared

- **Preload:** our application collects the sprint's open stories and active
  blockers, puts them in the prompt, then calls the LLM once.
- **Tools:** the LLM is given read-only tools and decides for itself what to
  fetch.

## Results (47 messages)

| | Preload | Tools |
|---|---|---|
| Accuracy | 93.6% (44/47, 3 misses) | 95.7% (45/47, 2 misses) |
| Average time per message | 2.1 s | 3.0 s (+40%) |
| Slowest message | 4.0 s | 7.9 s |
| Round-trips to Gemini (total) | 55 | 92 (+67%) |
| Tokens sent (total) | ~66,000 | ~114,000 (+73%) |

## Per message

| | Preload | Tools |
|---|---|---|
| Tokens sent per message | ~1,400 | ~2,400 (+1,000) |
| Round-trips to Gemini | ~1.2 | ~2 |

## How accuracy is measured

A message counts as correct only if all three lists (completed, in
progress, blocked) exactly match the hand-labelled answer. Accuracy is
correct messages ÷ 47.

## Why Tools costs more

Gemini keeps no memory between round-trips. Every time it calls a tool, our
application sends everything again: the ~1,000-token instructions, the
message and the tool's answer.

## Outcome

- Accuracy is a draw: one message apart, within the normal ±2% run-to-run
  swing.
- Tools is ~40% slower and uses ~70% more tokens. Both variants stay well
  inside the 30-second limit.
- **Decision (user, 26 Sep 2026): stay on Preload.** `lookup_story` stays as
  the only tool the LLM calls, and only for story keys it doesn't recognise.
  The Tools variant was removed from the code.
