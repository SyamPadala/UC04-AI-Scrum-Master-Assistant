# Session log — 5 Oct 2026

Written so the next session can start cold. Code state: **everything below is
committed, deployed to Cloud Run and pushed to GitHub**. 174 unit tests pass.
One live Agent 1 call (the 5-part test); no evals.

## 1. What happened

| # | Event | Result |
|---|---|---|
| 1 | L4 (Jira board per team) | **Parked** — user: "I don't want to tie my product to Jira fully". Settled before parking: one board per team, never shared; the board is created in Jira first. |
| 2 | GCP credit window | Trial 21 Sep → **17 Dec 2026**; account is paid, so charges start after. Recorded in SETUP-CHECKLIST. |
| 3 | Portability (GCP→AWS/Azure, Gemini→other LLM) | Only `src/store/firestore.ts` and `scripts/deploy.mjs` are GCP-specific; LLM switch = config + prompts + eval (OpenAI adapter not written). Login is Entra ID; no credentials stored. |
| 4 | System page idea (LLM/cloud from the admin UI) | Parked as **L15**. |
| 5 | Live test: Madhavi, 5-part message | Matched the spec: SCRUM-33 row (completed + TLS blocker, Status Blocked), 2 cards (load test, "fixed some bugs"), meeting left out, Scrum Master alerted. ~24 s. |
| 6 | Live test: "DB access not working" | Item 19 alerted with no story — user wanted a card. → **SPEC-004 item 40**, approved, built, deployed. Not yet re-tested live. |
| 7 | L7 onboarding | **SPEC-008 10m** (checklist) and **10n** (automatic onboarding/offboarding), approved, built, deployed. |
| 8 | Graph permissions granted by the user | `GroupMember.Read.All`, `TeamMember.ReadWrite.All` (Graph app `6a930f0e…`). |
| 9 | Sai Krishna removed | Removed on the page under the first 10n rule (listed only); then offboarded completely under the corrected rule: out of the Teams team, app uninstalled, Jira product access removed (account still listed in Jira — Atlassian accounts can't be deleted by API). On the Leaving list. |

## 2. Decisions

**Item 40 (SPEC-004):** a blocker that fits no story, member has an open story
→ card with her own open stories + **None of these**. Submit → Blocked row on
that story, then the alert with the story. None of these → **General** row
(Blocked), then the alert with no story. Replaces item 19 for such members.

**10m (SPEC-008):** per-member onboarding checklist on the Dev team tab —
licence, Teams team, app, Jira link, sprint story, tracker access. Teams team
per scrum team (admin picks it; Alpha uses its own group id). Tracker access
follows Teams team membership when the tracker is on that team's site.

**10n (SPEC-008):** Add member also adds to the Teams team, installs the app,
finds/invites and links Jira (only when Jira is configured). Licence and story
stay manual. **Remove member removes completely, the same for everyone**
(user: "delete him completely; if some team needs him they will add him as per
their process") — the first "undo only what the assistant added" rule was
wrong. Licence and Atlassian account go on the Leaving checklist. The
assistant's own Jira account is never removed.

## 3. Next

1. Live test item 40 as Madhavi: "DB access not working" → card; try Submit and None of these.
2. Live test Add member with a spare licensed user (Jira seat used: 7 of 10 after Sai Krishna).
3. Sai Krishna: licence + Atlassian account by hand, then Mark finished.
4. Review checklist (code + architecture, incl. portability) — proposed, not started.
5. Live tests 6–8 from the 1 Oct log; Alpha still **paused**.
6. Parked: L4, L13, L14, L15.

## 4. Facts worth knowing

- The deployed service caches its Graph token up to an hour: after a new
  permission is granted, redeploy (or wait) before it takes effect.
- Jira `DELETE /rest/api/3/user` removes product access; the account stays in
  user search.
- Admin page tests run in the browser only; the page script is syntax-checked
  with `node --check` after build.
