# Specs

Spec-Driven Development for UC-04. Rules in `../rules/process-rules.md`.
No production code for a feature until its spec is `Approved`. A local git
hook enforces it (SPEC-001 item 15): switch it on once per clone with
`git config core.hooksPath .githooks`.

**Status line rule.** A spec's Status cell starts with `Approved` only when
the whole spec, base text included, is approved. New items are listed after
it as approved or awaiting approval.

## Index

| Spec | Feature | Delivers | Status (16 Oct 2026) |
|---|---|---|---|
| SPEC-001 | Foundation, config store and scheduler | FR-10, NFR Reliability | Approved 16 Oct 2026 (with as-built notes and items 9–15) |
| SPEC-002 | Tracker abstraction and destinations | FR-04 | Approved 16 Oct 2026; 2g not built; Excel parked |
| SPEC-003 | Stand-up reminder and follow-up | FR-01, FR-05 | Draft — as-built notes ready for approval (10 Oct); items 9–10 approved |
| SPEC-004 | Update intake and Agent 1 extraction | FR-02, FR-03, NFR Latency | Approved (items to 42); item 41a awaiting approval |
| SPEC-005 | Blocker detection and escalation | FR-06 | Draft — as-built notes ready for approval (10 Oct); items 2a–2b approved |
| SPEC-006 | Sprint summary (Agent 2) and distribution | FR-07, FR-08 | Draft — as-built notes ready for approval (10 Oct) |
| SPEC-007 | Participation tracking | FR-09 | Draft — as-built notes ready for approval (10 Oct) |
| SPEC-008 | Admin panel (web) | NFR Configuration | Approved (items to 10q, and 10s); 10r awaiting approval |

## FR coverage

Every PRD functional requirement is claimed by exactly one spec.

| FR | Spec |
|---|---|
| FR-01 | SPEC-003 |
| FR-02 | SPEC-004 |
| FR-03 | SPEC-004 |
| FR-04 | SPEC-002 |
| FR-05 | SPEC-003 |
| FR-06 | SPEC-005 |
| FR-07 | SPEC-006 |
| FR-08 | SPEC-006 |
| FR-09 | SPEC-007 |
| FR-10 | SPEC-001 |

## Build order

Per POC-Plan Section 7: SPEC-001 → SPEC-004 (+ eval) → SPEC-003 → SPEC-002 →
SPEC-005 → SPEC-007 → SPEC-006 → SPEC-008.
Riskiest first: Agent 1 accuracy and latency are proved before anything is polished.
