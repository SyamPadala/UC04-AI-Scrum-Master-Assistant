# Setup Checklist — UC-04 AI Scrum Master Assistant

The single source of truth for setup state. Read this first in a new session.

**Last updated:** 19 Sep 2026
**Focus right now:** setup only. No coding until setup is further along and the
specs are approved (item 20).

Record values that come out of each item in `.env` — never in this file, never
in chat.

---

## Where we are in one line

**The app is built, deployed and running unattended.** Cloud Scheduler wakes it
every 5 minutes; it sends stand-up reminders, accepts a plain-language reply,
writes it to the SharePoint tracker, and chases only those who have not replied.
Proven live on 19 Sep 2026: the scheduler fired at 22:55 IST and delivered
reminders to two members.

Live service: `https://scrum-assistant-lxz5k662sa-el.a.run.app`

**Demonstrable now:** FR-01, FR-02, FR-04, FR-05.
**Blocked on funding an LLM:** FR-03, FR-06, FR-07, FR-08.

**Progress: 17 of 23 done.** Remaining: Excel workbook (7), Jira sprint data (9),
Azure DevOps (10), LLM funding (19), spec approval (20), AI Journal (21).
Two members (Sai Krishna Akula, Tiwari Satyam) still cannot be messaged — the
app is not installed for them.

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

- [x] **3. Create test users** — DONE 17 Sep 2026 (3 users; 4th deferred)
      Created: Madhavi Andoju, Tiwari Satyam, Saikrishna Akula
      (`@SyamPadala.onmicrosoft.com`), Business Basic licence, role User.
      One sign-in verified. Trial has **25** licences, not 5.
      Scrum Master for the demo: not yet decided (4th user or admin).
      Demo roles live in bot config, not in M365 — M365 has no such role.

      Original plan below, kept for reference:
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

- [x] **4. Teams team + stakeholder channel** — DONE 17 Sep 2026
      Team "Scrum Team Alpha" (private), first channel "Stakeholder Updates".
      IDs in `.env`. Ignore the auto-created org-wide team "SyamPadala".
      New Teams: create team via the compose icon ˅ -> New team.
      Sign in to Teams as the admin, create a team, add the four users, add a
      channel for stakeholders.
      *Record:* team ID, channel ID -> `TEAMS_TEAM_ID`, `STAKEHOLDER_CHANNEL_ID`
      Note: adding a user to the team is not the same as onboarding them — see
      item 5a.

- [x] **5. Register the bot** — DONE 18 Sep 2026
      Teams Developer Portal, bot "Scrum Assistant".
      `BOT_APP_ID` and `BOT_APP_PASSWORD` are in `.env`.
      Endpoint address deliberately left empty — set at item 17 to the Dev
      Tunnel URL + `/api/messages`, later to the Cloud Run URL.

- [ ] **5a. Onboard the four members** — the step that makes them real

      Creating an account is not enough. Until each of these is done the
      assistant physically cannot message that person.

      For each of the four users:
      - **Sign in to Teams once as that user** (teams.microsoft.com, or the
        desktop app in a separate browser profile / InPrivate window). An
        account that has never opened Teams has no Teams presence.
      - **Accept them into the team** created in item 4.
      - **Install the bot app for them.** Either install the app into the team
        so every member gets it, or have each user add it personally from the
        Teams app catalogue.

      **Why the install matters:** the bot can only send someone a direct
      message if it already holds a *conversation reference* for them, and that
      reference is only created when the app is installed for that person. No
      install means no reminder, no follow-up, no blocker prompt — for that
      person only. This is the single most common reason a demo half-works.

      *Record:* for each member — object ID, display name, and which one is the
      Scrum Master. These go into the **team config seeded into Firestore**
      (`TeamConfig.members` and `scrumMasterId` in SPEC-001), not into `.env`.

      *Verify:* after the service is running, each member should appear in the
      stored conversation references. A member missing from that list will be
      silently skipped at reminder time.

- [ ] **5b. Keep identities consistent across systems**

      The same four people must exist, with matching names, in:
      - Microsoft 365 / Teams (items 3-5a)
      - the tracker's AssignedTo column (items 6-7)
      - Jira, as story assignees (item 9)
      - Azure DevOps, as work item assignees (item 10)

      If a Jira assignee does not match a roster member, their stories will not
      be attributed to them in the summary and story lookup will come back empty.

      **Canonical names — DECIDED 18 Sep 2026.** The casing was fixed in M365
      (`TIWARI SATYAM` -> `Tiwari Satyam`) and verified through Graph. These
      exact strings are the roster, and must be reproduced letter for letter in
      Jira, Azure DevOps and the tracker's AssignedTo column:

      | Display name | Login |
      |---|---|
      | `Madhavi Andoju` | madhavi.andoju |
      | `Sai Krishna Akula` | saikrishna.akula |
      | `Tiwari Satyam` | tiwari.satyam |
      | `Syam Padala` | syam.padala |

      `Sai Krishna Akula` carries a space that his login does not. The login and
      display name need not match each other; the display name must match
      across systems. Re-verify through Graph before creating accounts
      elsewhere — a rename in M365 silently breaks attribution.

- [x] **6. SharePoint "Daily Status Tracker" list** — DONE 18 Sep 2026
      On the team site `https://syampadala.sharepoint.com/sites/ScrumTeamAlpha`
      (created with the team; no separate site needed).
      Columns (user's format, 18 Sep — one row per work item; see SPEC-002):
      Date, WIN, Description, AssignedTo, Comment, Status (Choice:
      In Progress / Completed / Blocked), AnyBlocker.
      `SHAREPOINT_SITE_ID` and `SHAREPOINT_LIST_ID` resolved via Graph and
      recorded in `.env` — DONE 18 Sep 2026.

      **Columns were recreated 18 Sep.** They had been renamed after creation,
      which in SharePoint changes only the display name — the internal name
      Graph reads and writes stays fixed at creation. The result was
      AssignedTo→`Date`, WIN→`Member`, Description→`Completed`, Date→`Date0`.
      The four were deleted and re-added with space-free names so internal and
      display now match. Verified: all seven internal names correct, and a test
      row written, read back and deleted through Graph.
      If a column is ever renamed again, re-verify the internal names before
      trusting a write.

- [ ] **7. Excel Online workbook** (the second tracker destination)
      Same seven headers as item 6, in the same order, on a sheet named `Status`.
      *Record:* `EXCEL_DRIVE_ID`, `EXCEL_ITEM_ID`, `EXCEL_WORKSHEET`

- [x] **8. Entra app + Graph permissions, admin consented** — DONE 18 Sep 2026
      Separate single-tenant app registration (not the bot's app). Application
      permissions, admin consented: Sites.ReadWrite.All, Files.ReadWrite.All,
      Mail.Send, User.Read.All.
      `GRAPH_CLIENT_ID` and `GRAPH_CLIENT_SECRET` are in `.env` (secret expires
      18 Sep 2028).

      **`ChannelMessage.Send` was deliberately dropped.** It is delegated-only,
      so a background service cannot use it to post the sprint summary to a
      Teams channel. The bot posts to the channel itself using its own channel
      reference — see the open design point in POC-Plan Section 0 and SPEC-006.

      *Verified:* client-credentials token issued, site and list resolved, and
      a row written, read back and deleted in the tracker list.

## B. Project management tools

- [ ] **9. Jira Cloud (free tier)** — connection DONE 18 Sep 2026, data NOT done
      Site `https://demo-jira-validation.atlassian.net`, project `SCRUM`
      (AIDemo), board 1. Auth verified (HTTP Basic, `email:token`).
      `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` and
      `JIRA_STORY_POINTS_FIELD` are all in `.env`.

      Story points live in `customfield_10016` ("Story point estimate").
      This ID is per-site, never hardcode it — see SPEC-002 Configuration.

      **The sprint data does not yet support the features.** Audited 18 Sep:
      - The active sprint "SCRUM Sprint 0" contains **0 issues**; all 9 sit in
        the backlog. Agent 2 would find nothing, so FR-07 has no data.
      - That sprint **ended 15 Sep**, three days before the audit. A5 (at-risk)
        and A6 (velocity) both reason about progress against elapsed time.
      - **Every issue is UNASSIGNED.** FR-07 cannot attribute work and FR-06
        cannot resolve a blocker to a member's story (A8).
      - Only 3 of 9 issues carry points, so completion and velocity are
        meaningless.
      - **Only one assignable Jira user exists (`syam`).** The three test users
        have no Atlassian account, so they cannot be assigned anything. This is
        the hard blocker — see item 5b.

      *To finish:* invite the three members (free tier allows 10 users) with
      display names matching M365 exactly; create a sprint spanning today;
      put ~6 pointed issues in it, assigned across all four people, with mixed
      statuses (some Done, some In Progress, one To Do) so the summary and
      velocity output are visibly non-trivial.

- [ ] **10. Azure DevOps (free tier)**
      Org, project, iteration, work items with points.
      *Record:* `ADO_ORG_URL`, `ADO_PROJECT`, `ADO_PAT`

## C. Google Cloud

Account and project already exist: `api-project-631634995359`, Rs28,663 trial
credit. These items are the services inside it.

- [x] **11. Firestore database** — DONE 18 Sep 2026
      Native mode, Standard edition, single region `asia-south1` (Mumbai).
      Cloud Run must be deployed to the same region. The location is permanent.

      **The database ID is `default`, not `(default)`.** These are different
      names: `(default)` is the special primary-database ID the SDKs assume
      when none is given, and `default` is an ordinary named database.
      `FIRESTORE_DATABASE=default` in `.env`, and **the code must pass
      `databaseId` explicitly** when constructing the Firestore client or it
      fails with `5 NOT_FOUND`. SPEC-001 already carries the config value.
      Trade-off accepted knowingly: Firestore's free tier applies only to
      `(default)`, so this database bills from the first read. At a few hundred
      operations a day that is a rupee or two a month, and likely covered by
      the GCP trial credit — not worth recreating the database over.

      *Verified:* write, read, same-ID overwrite and delete against
      `runs/{teamId}_{localDate}_{jobType}`. The overwrite left one document,
      which is the idempotency mechanism SPEC-001 relies on.

- [x] **12. Cloud APIs enabled** — DONE 18 Sep 2026
      Cloud Firestore, Cloud Run Admin, Cloud Scheduler, Secret Manager,
      Cloud Build and Artifact Registry. The last two are not in the original
      list but are required — `gcloud run deploy` from source builds through
      Cloud Build and stores the image in Artifact Registry.

- [x] **13. Service account + JSON key** — DONE 18 Sep 2026
      `scrum-assistant@api-project-631634995359.iam.gserviceaccount.com`.
      Roles: **Cloud Datastore User** (the Firestore read/write role — its name
      is historical, there is no "Firestore User" role) and **Secret Manager
      Secret Accessor**. Deliberately not Owner or Editor.
      Key at `C:/UC04-AI-Scrum-Master-Assistant/service-account-key.json`,
      path in `GOOGLE_APPLICATION_CREDENTIALS`. Covered by `.gitignore`
      (`service-account*.json`) — verified, and it is a live credential.
      Delete it from the console once Cloud Run runs on its own identity.

- [ ] **14. Install the `gcloud` CLI** locally — **not doing this**
      Deliberate: this is an Accenture-managed machine. Items 11-13 were done
      through the Cloud console instead. Cloud Run deploys and Cloud Scheduler
      jobs will need either the CLI or the console when that point is reached.

## D. Local and repository

- [x] **15. Node 24, npm, git** — installed
- [x] **16. Repo initialised** — `.gitignore`, `.env.example`, `.env` in place,
      first commit `39dc77d`
- [x] **17. Dev Tunnel** — **REMOVED from scope 19 Sep 2026, do not re-add**
      A Dev Tunnel gives a laptop a temporary public web address so Teams can
      reach an app running locally. It is a convenience for developers who want
      to test without redeploying — it is not required.
      The app is deployed to Cloud Run and the bot registration points at the
      Cloud Run URL. One address, one place. Decision made by the user.
- [x] **18. GitHub repository** + first push — DONE 18 Sep 2026
      `https://github.com/SyamPadala/UC04-AI-Scrum-Master-Assistant`
      Local branch renamed `master` -> `main` and rebased onto the
      auto-created README commit, so history is linear.
      *Verified before pushing:* no secret was ever committed — only docs
      appear in history, and `.env`, `teamdetails.txt`, `*-key.json` and
      `service-account*.json` are all git-ignored. Re-check this before any
      future push that adds a credential-shaped file.

      **No CI/CD on this engagement (19 Sep 2026).** Automated build and
      deploy pipelines are disallowed. GitHub is used for source only.
      Deployment is a manual `gcloud run deploy --source .` run by hand from
      Cloud Shell, the browser terminal in the Google Cloud console. Do not
      propose GitHub Actions, Cloud Build triggers or any deploy-on-push
      arrangement.

## E. Fill the gaps already open in `.env`

Checked 17 Sep 2026 — these keys exist but are still **empty**:

- [ ] **19. Blank values in `.env`** — BLOCKED 18 Sep 2026, needs a funded LLM
      - `GEMINI_API_KEY` — pasted, valid, and **unusable**. Every call returns
        `429 RESOURCE_EXHAUSTED / prepayment credits are depleted`.
        Google issues free Gemini API access on this account as a prepaid
        credit balance, not as an RPM/RPD quota. A balance does not refill on
        a clock, so waiting does nothing.
        Verified closed: a new key on the same project fails the same way
        (keys are credentials, the balance is per project), and a key on a
        **new project fails too** — the grant is per account, not per project.
        The ₹28,663 GCP trial credit does not cover it either.
        **The only ways forward are to activate billing on the Gemini project
        or to fund `LLM_PROVIDER=anthropic`.** Do not re-try new keys.
      - `LLM_MODEL` — currently `gemini-3.5-flash-lite`. Change before the eval:
        lite tiers trade accuracy for cost, and FR-03 needs >=90% extraction
        accuracy. Start at a full flash tier and only drop to lite if the eval
        shows headroom. Latency has a 30 s budget and is not the tight
        constraint; accuracy is.
      - ~~`M365_TENANT_ID`~~ — DONE, taken from the team link. The tenant GUID (admin centre -> Settings ->
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
