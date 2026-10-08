# Session log — 6 to 8 Oct 2026

Written so the next session can start cold. Code state: **everything below is
committed, deployed to Cloud Run and pushed to GitHub**. 177 unit tests pass.
No live LLM evals were run.

## 1. What happened

| # | Event | Result |
|---|---|---|
| 1 | Code review, architecture review, design review (SOLID + patterns) | `docs/reviews/2026-10-06-arch-code-review.md` and the doc "UC-04 Architecture Review" (claude.ai) |
| 2 | Maturity plan discussed item by item | `docs/MATURITY-PLAN.md`, M1–M18 agreed; backup Scrum Master parked (user's manager) |
| 3 | User: "Review done, please proceed with implementation" | Built in order, one commit per item, deployed in batches; status table in the plan |
| 4 | Scrum Team Beta found (created during a demo): Running, no members, tracker = Alpha's list | Tracker cleared to "unset" (M11); Beta must pick its own list |
| 5 | Alpha's Jira project | Set to SCRUM (SCRUM board) before the per-team Jira code went live |

## 2. What changed for users

- **Member message** → instant *"Got it, working on it…"*, replaced by the result (M4).
- **Member with no story of their own, or not linked to Jira** → work matched by context to a teammate's story and confirmed on a card; the rest saved as a general update (M12). Item 20's refusal is gone.
- **Blocker alerts** are never lost to a failed send; the member is only told "the Scrum Master has been told" when it went (M1).
- **Teams sends** retried on busy/temporary errors (M9).
- **Admin page:** Jira project per team; tracker list only from the team's own SharePoint site; a team can't run without a reachable Scrum Master and its own tracker; the Scrum Master gets the app installed automatically; re-added members get Jira access back; friendly errors with a reference.

## 3. Waiting on the user

1. Grant the deploy account (`scrum-assistant@api-project-631634995359.iam.gserviceaccount.com`) two roles in Google Cloud IAM: **Secret Manager Admin** and **Monitoring Editor**. Then: `node scripts/secrets.mjs`, add `CLOUD_RUN_SECRETS=secret-manager` to `.env`, deploy; and `node scripts/alerts.mjs`.
2. **M8:** create a Jira account for the assistant (site admin), give its email + API token.
3. **M15:** check the Gemini key is on the paid tier.
4. **M6 decision:** Sites.Selected means every new team's SharePoint site must be granted to the app by hand.
5. Live tests in Teams: M4, M12, item 40, M13.

## 4. Facts worth knowing

- Jira team-managed projects have "simple" boards with sprints; Kanban boards are excluded.
- A Jira user removed from the site is still found by search but GET /user answers 404.
- Cloud Run gives CPU only while a request is open; M4 hands work to the service itself as a request kept open until done.
- `DB_PROVIDER=memory` runs the whole service on the in-memory store (tests use it).
