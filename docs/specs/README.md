# Specs

Spec-Driven Development for UC-04. Rules in `../rules/process-rules.md`.
No production code for a feature until its spec is `Approved`.

## Index

| Spec | Feature | Delivers | Status |
|---|---|---|---|
| SPEC-001 | Foundation, config store and scheduler | FR-10, NFR Reliability | Draft |
| SPEC-002 | Tracker abstraction and destinations | FR-04 | Draft |
| SPEC-003 | Stand-up reminder and follow-up | FR-01, FR-05 | Draft |
| SPEC-004 | Update intake and Agent 1 extraction | FR-02, FR-03, NFR Latency | Draft |
| SPEC-005 | Blocker detection and escalation | FR-06 | Draft |
| SPEC-006 | Sprint summary (Agent 2) and distribution | FR-07, FR-08 | Draft |
| SPEC-007 | Participation tracking | FR-09 | Draft |
| SPEC-008 | Admin panel (web) | NFR Configuration | Approved |

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
