# Setup Checklist

Everything that must exist before the POC can run live. Worked through one at a
time. Tick items as they complete; record the values that come out of each in
`.env` (never in this file, never in chat).

**Done already:** GCP account + project `api-project-631634995359` (₹28,663
trial credit) · Gemini API key · Node 24 · npm · git

---

## A. Microsoft 365 — critical path

Nothing Teams-side works without these. Item 1 is the biggest unknown left.

- [x] **1. A tenant we control** — DONE via M365 Business Basic trial, 17 Sep 2026
      Tenant `SyamPadala.onmicrosoft.com`, admin created, MFA configured,
      values recorded in `.env`. **Cancel by day 25** or it starts billing.
      Dev-program route abandoned — history below.


      *Attempted:* M365 Developer Program. Joined successfully and the Visual
      Studio Professional subscription linked. The E5 instant-sandbox form then
      could not be completed: the Billing account dropdown stayed empty after
      repeated refreshes, despite a Microsoft billing account being created
      successfully ("Your account is ready"). The billing account attached to the
      org work identity (`@accenture.com`), which also returned "not eligible"
      for the Visual Studio Azure credit earlier. Read as org policy on the
      managed identity, not a transient glitch. Not worth further time.

      *Do not use:* the Accenture production tenant. No admin rights there, and
      installing a custom bot into an employer's live tenant is out of the
      question.

      *Next route:* Microsoft 365 Business Basic trial on a **clean personal**
      Microsoft account — no eligibility check, no VS subscription, no billing
      linkage, full tenant admin. Free 30 days, card for verification, cancel by
      day 25. Tenant starts empty, so test users are created by hand (~15 min).

      *Record when done:* tenant ID, tenant domain, admin credentials

- [x] **2. Enable custom app upload** — DONE (Global org-wide policy, 17 Sep 2026)
      Teams admin centre → Setup policies. Required to install our bot.

- [ ] **3. Register the bot** — Teams Developer Portal (dev.teams.microsoft.com)
      *Record:* Bot App ID, client secret

- [ ] **4. Choose test users**
      2–3 as team members, 1 as Scrum Master.
      *Record:* display names + Entra object IDs

- [ ] **5. Teams team + stakeholder channel**
      *Record:* team ID, channel ID

- [ ] **6. SharePoint site + Daily Status Tracker list**
      Columns: Date, Member, Completed, InProgress, Blockers, RawUpdate
      *Record:* site ID, list ID

- [ ] **7. Excel Online workbook** (second tracker destination)
      *Record:* drive ID, item ID, worksheet name

- [ ] **8. Entra app + Graph permissions, admin consented**
      Sites.ReadWrite.All, Files.ReadWrite.All, Mail.Send, ChannelMessage.Send,
      User.Read.All
      *Record:* client ID, client secret

## B. Project management tools

- [ ] **9. Jira Cloud (free)**
      Project, active sprint, 5–6 stories **with story points**, assigned to the
      test users.
      *Record:* site URL, account email, API token

- [ ] **10. Azure DevOps (free)**
      Org, project, iteration, work items with points.
      *Record:* org URL, project name, PAT

## C. Google Cloud

- [ ] **11. Create the Firestore database** — Native mode, pick a region
- [ ] **12. Verify Cloud Run, Cloud Scheduler, Secret Manager are enabled**
- [ ] **13. Service account + JSON key** for local development
- [ ] **14. Install the `gcloud` CLI** locally

## D. Local and repository

- [ ] **15. Dev Tunnel** (VS Code extension) so Teams can reach the local service
- [ ] **16. GitHub repository** + first push

## E. Project decisions still open

- [ ] **17. AI Journal** — purpose, format, contents, who reviews it.
      Recommendation: maintain it continuously during the build, not at the end.
- [ ] **18. Approve the specs** — `Draft` → `Approved` (process rule 1)

---

## Scope changes unlocked by removing the deadline

Recorded 17 Sep 2026 when the Friday constraint was lifted:

- Working-days calendar — no reminders at weekends or on holidays
  (was a documented limitation in SPEC-003 / SPEC-007 purely for time)
- Azure DevOps demonstrated live rather than with mocks
- Specs may be deepened where depth earns its place
- Target Node 24 (installed) rather than Node 22
