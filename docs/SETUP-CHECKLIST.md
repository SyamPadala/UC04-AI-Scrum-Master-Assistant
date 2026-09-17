# Setup Checklist — UC-04 AI Scrum Master Assistant

The single source of truth for setup state. Read this first in a new session.

**Last updated:** 17 Sep 2026
**Focus right now:** setup only. No coding until setup is further along and the
specs are approved (item 20).

Record values that come out of each item in `.env` — never in this file, never
in chat.

---

## Where we are in one line

GCP and the Gemini key are sorted. A Microsoft 365 tenant we fully control now
exists. The next block of work is all inside that tenant: users, a team, a
tracker, and the bot registration.

**Progress: 2 of 20 done.**

---

## A. Microsoft 365 — the critical path

- [x] **1. A tenant we control** — DONE 17 Sep 2026
      Microsoft 365 Business Basic trial on a clean personal Microsoft account.
      Tenant `SyamPadala.onmicrosoft.com`. Admin account created, MFA configured.
      5 licences included.
      **ACTION: cancel by day 25 (~12 Oct 2026)** or it starts billing at
      roughly Rs145/user/month.

- [x] **2. Enable custom app upload** — DONE 17 Sep 2026
      Teams admin centre -> Setup policies -> Global (Org-wide default).
      Without this the bot cannot be installed.

- [ ] **3. Create 4 test users**  <-- IN PROGRESS, DO THIS NEXT
      Where: **admin.microsoft.com** -> Users -> Active users -> Add a user.
      (NOT the Teams admin centre — that can only manage existing users. This
      was a wrong turn taken once already.)

      | Display name | Username | Demo role |
      |---|---|---|
      | Priya Sharma | priya@SyamPadala.onmicrosoft.com | Team member |
      | Rahul Verma  | rahul@SyamPadala.onmicrosoft.com | Team member |
      | Anita Desai  | anita@SyamPadala.onmicrosoft.com | Team member |
      | Vikram Rao   | vikram@SyamPadala.onmicrosoft.com | Scrum Master |

      On each: choose "Let me create the password", use the same password for
      all four, and **untick "Require this user to change their password"**.
      Assign a **Microsoft 365 Business Basic** licence to each.
      4 users + admin = 5 licences = exactly what the trial gives.

      *Record after:* each user's Entra **object ID** (admin centre -> the user
      -> their profile). The config identifies people by object ID, not email.

- [ ] **4. Teams team + stakeholder channel**
      Sign in to Teams as the admin, create a team, add the four users, add a
      channel for stakeholders.
      *Record:* team ID, channel ID -> `TEAMS_TEAM_ID`, `STAKEHOLDER_CHANNEL_ID`

- [ ] **5. Register the bot** — Teams Developer Portal (dev.teams.microsoft.com)
      Creates the identity Teams uses to deliver messages to our service.
      *Record:* `BOT_APP_ID`, `BOT_APP_PASSWORD`

- [ ] **6. SharePoint site + "Daily Status Tracker" list**
      Columns: Date, Member, Completed, InProgress, Blockers, RawUpdate
      *Record:* `SHAREPOINT_SITE_ID`, `SHAREPOINT_LIST_ID`

- [ ] **7. Excel Online workbook** (the second tracker destination)
      *Record:* `EXCEL_DRIVE_ID`, `EXCEL_ITEM_ID`, `EXCEL_WORKSHEET`

- [ ] **8. Entra app + Graph permissions, admin consented**
      Sites.ReadWrite.All, Files.ReadWrite.All, Mail.Send, ChannelMessage.Send,
      User.Read.All
      *Record:* `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`

## B. Project management tools

- [ ] **9. Jira Cloud (free tier)**
      Project, one active sprint, 5-6 stories **with story points**, assigned
      across the four test users.
      *Record:* `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`

- [ ] **10. Azure DevOps (free tier)**
      Org, project, iteration, work items with points.
      *Record:* `ADO_ORG_URL`, `ADO_PROJECT`, `ADO_PAT`

## C. Google Cloud

Account and project already exist: `api-project-631634995359`, Rs28,663 trial
credit. These items are the services inside it.

- [ ] **11. Create the Firestore database** — Native mode, choose a region
- [ ] **12. Verify Cloud Run, Cloud Scheduler and Secret Manager are enabled**
- [ ] **13. Service account + JSON key** for local development
      *Record:* path -> `GOOGLE_APPLICATION_CREDENTIALS` (key file stays out of git)
- [ ] **14. Install the `gcloud` CLI** locally

## D. Local and repository

- [x] **15. Node 24, npm, git** — installed
- [x] **16. Repo initialised** — `.gitignore`, `.env.example`, `.env` in place,
      first commit `39dc77d`
- [ ] **17. Dev Tunnel** (VS Code extension) so Teams can reach the local service
- [ ] **18. GitHub repository** + first push

## E. Fill the gaps already open in `.env`

Checked 17 Sep 2026 — these keys exist but are still **empty**:

- [ ] **19. Three blank values in `.env`**
      - `GEMINI_API_KEY` — the key was obtained but never pasted in
      - `LLM_MODEL` — set to the Gemini model id we are using
      - `M365_TENANT_ID` — the tenant GUID (admin centre -> Settings ->
        Org settings, or Entra overview). `M365_TENANT_DOMAIN` is already set.

## F. Project decisions still open

- [ ] **20. Approve the specs** — change Status `Draft` -> `Approved` in
      `docs/specs/SPEC-001..008`. Process rule 1 blocks all production code
      until this is done.
- [ ] **21. AI Journal** — purpose, format, contents, who reviews it.
      Recommendation: maintain it continuously during the build, not at the end.

---

## Setup routes already tried and closed — do not re-attempt

**M365 Developer Program (E5 instant sandbox).** Joined successfully, Visual
Studio Professional subscription linked, Microsoft billing account created
("Your account is ready"). The sandbox form's Billing account dropdown stayed
empty through repeated refreshes. The billing account was attached to the
managed `@accenture.com` work identity, which had also returned "not eligible"
for the Visual Studio Azure credit. Read as org policy on the managed identity,
not a transient glitch. Abandoned in favour of item 1.

**The Accenture production tenant.** Out of the question. No admin rights, and
installing a custom bot into an employer's live tenant is not acceptable.

**Claude via Vertex AI / Model Garden.** Claude on Vertex is a Marketplace
purchase, and GCP promotional credits do not apply to Marketplace purchases, so
the Rs28,663 trial credit cannot pay for it. GCP is retained for Cloud Run,
Firestore, Cloud Scheduler and Secret Manager, which the credit does cover.
Gemini is the approved LLM (assumption A12 in POC-Plan).

---

## Scope changes unlocked by removing the deadline (17 Sep 2026)

- Working-days calendar — no reminders at weekends or on holidays
- Azure DevOps demonstrated live rather than with mocks
- Specs may be deepened where depth earns its place
- Target Node 24 (installed) rather than Node 22
