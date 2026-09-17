# Process Rules

How work moves in this project. Binding.

## Spec-Driven Development

1. **No production code without an approved spec.** Every feature has a spec in
   `docs/specs/`. Status must be `Approved` before implementation starts.
2. The cycle is **spec → review → implement → verify**:
   - **Spec** — Claude drafts from the PRD FR/NFRs and POC-Plan Section 5.
   - **Review** — user reads and marks `Approved`, or returns comments.
   - **Implement** — Claude builds exactly the approved spec.
   - **Verify** — Claude runs the spec's own Verification section and reports
     the result honestly, including failures.
3. Specs are **lean**. A spec that takes longer to write than the code it
   describes is the wrong size. Target one page.
4. **Specs are the source of truth over code.** If code and spec disagree, the
   spec wins or the spec is amended — not silently, and not after the fact.

## Scope discipline

5. **Build to the PRD as written.** No feature that is not traceable to an FR,
   an NFR, or a POC-Plan Section 5 assumption.
6. A PRD ambiguity is resolved by a Section 5 assumption, made configurable,
   and recorded in the spec. It is never resolved by a silent decision in code.
7. If a spec turns out to be wrong mid-implementation: stop, say so, amend the
   spec, then continue. Do not improvise around it.
8. Out-of-scope ideas go to POC-Plan Section 10 as an open question. They do
   not go into the build.

## Traceability

9. Every spec names the FR/NFR ids it delivers. Every FR in the PRD is claimed
   by exactly one spec.
10. POC-Plan Section 6 is the traceability matrix and stays current. When a
    spec is verified, its evidence goes there.
11. Commits reference the spec id: `SPEC-003: add follow-up grace period job`.

## Honest reporting

12. Report what is actually true. If a test fails, show the output. If a step
    was skipped, say which and why. "Done" means implemented **and** verified.
13. Partial evidence is stated as partial. The Reliability NFR will have about
    one day of data by Friday — the report says that, it does not imply more.
14. Mock-backed results are labelled as mock-backed. A demo against the mock
    tracker is not evidence for FR-04.

## Working agreements

15. Build against mocks first so account setup never blocks coding.
16. Riskiest thing first: Agent 1 accuracy and latency before polish.
17. Prefer the implementation that is easier to demo on Friday.
18. Raise blockers immediately, with the fallback already identified. Do not
    sit on a blocker while working around it.

## Definition of Done (per spec)

- [ ] Implemented to the approved spec
- [ ] Verification section executed, result recorded
- [ ] Rules in `coding-rules.md` observed (idempotency, retries, RunLog, privacy)
- [ ] Traceability row in POC-Plan Section 6 updated
- [ ] Demonstrable in the Friday walkthrough, or explicitly noted as not
