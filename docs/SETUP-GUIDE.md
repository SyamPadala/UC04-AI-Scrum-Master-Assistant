# Setup Guide — AI Scrum Master Assistant

A complete, start-to-finish guide to setting up the Scrum Assistant from nothing.
Follow the parts in order. Each step says **where** to click or what to run,
**what to write down**, and **how to check** it worked.

> **Golden rules**
> - Every value you are told to "record" goes into the `.env` file on your
>   computer — never into a document, a chat, an email or git.
> - Do the parts in order. Later parts need values from earlier ones.
> - When a step says *Check*, do the check. Most "it half works" problems come
>   from a skipped check.

---

## Contents

1. [What you are building](#1-what-you-are-building)
2. [What you need before you start](#2-what-you-need-before-you-start)
3. [Your computer](#3-your-computer)
4. [Microsoft 365 tenant](#4-microsoft-365-tenant)
5. [Teams settings](#5-teams-settings)
6. [Users](#6-users)
7. [Bot registration](#7-bot-registration)
8. [Graph app registration](#8-graph-app-registration)
9. [Teams app package](#9-teams-app-package)
10. [Jira Cloud](#10-jira-cloud)
11. [Gemini (the AI model)](#11-gemini-the-ai-model)
12. [Google Cloud](#12-google-cloud)
13. [The `.env` file — every setting](#13-the-env-file--every-setting)
14. [First deploy](#14-first-deploy)
15. [Secrets into Secret Manager](#15-secrets-into-secret-manager)
16. [Point Microsoft at the live address](#16-point-microsoft-at-the-live-address)
17. [Cloud Scheduler (the clock)](#17-cloud-scheduler-the-clock)
18. [Failure alerts](#18-failure-alerts)
19. [Teams teams and the stakeholder channel](#19-teams-teams-and-the-stakeholder-channel)
20. [The tracker list (SharePoint)](#20-the-tracker-list-sharepoint)
21. [Set up a scrum team on the admin page](#21-set-up-a-scrum-team-on-the-admin-page)
22. [Prove it works](#22-prove-it-works)
23. [Day-to-day running](#23-day-to-day-running)
24. [Changing things later](#24-changing-things-later)
25. [Troubleshooting](#25-troubleshooting)
26. [Housekeeping and dates](#26-housekeeping-and-dates)
27. [Reference](#27-reference)

---

## 1. What you are building

The Scrum Assistant is a Microsoft Teams bot. Every working day it:

1. sends each team member a **stand-up reminder** in Teams,
2. reads their reply in **plain words** with an AI model (Gemini),
3. writes what they finished, what they're on and what blocks them into the
   team's **tracker** (a SharePoint list, or comments on Jira tickets),
4. **chases** people who haven't replied,
5. **alerts the Scrum Master** at once about blockers,
6. sends stakeholders a **daily sprint summary** (Teams channel and email),
7. tracks **participation** and flags people who keep missing.

One deployment serves **many scrum teams**, each with its own schedule, members,
tracker, Jira project and stakeholders, all managed on one **admin web page**.

```
                    every 5 min
 Cloud Scheduler ───────────────►  POST /tick ─┐
                                                │
 Teams (members, ──── messages ──► /api/messages│      Cloud Run service
  Scrum Master)  ◄─── replies ───               ├──►  (the Scrum Assistant)
                                                │        │   │    │    │
 Browser ───────── admin page ───► /admin ──────┘        │   │    │    │
                                                         ▼   ▼    ▼    ▼
                                                 Firestore Gemini Jira Microsoft Graph
                                                 (settings) (AI)  (sprint) (SharePoint,
                                                                         mail, users)
```

**Where data lives.** What members *say* is stored **only** in the team's
tracker. The database (Firestore) holds settings, who-can-be-messaged links and
participation counts — never update text. Keep it that way.

---

## 2. What you need before you start

| You need | Why | Cost |
|---|---|---|
| A **Microsoft 365** tenant where you are the admin (Business Basic trial is enough) | Teams, SharePoint, mail, users | Free 1-month trial, then paid |
| A **Google Cloud** account with billing | Hosts the service, database, scheduler, secrets | New accounts get trial credit; this runs for a few rupees/dollars a month |
| A **Google AI Studio** (Gemini) API key on a **paid** plan | The AI model that reads updates | Pennies per day at this volume |
| A **Jira Cloud** site where you are site admin (free plan is enough) | Sprints and stories. **Optional** — teams work without Jira, every update is then a "general update" | Free up to 10 users |
| A **GitHub** account (or any git host) | Keeping the source code | Free |
| A computer with **Node.js 24** and **git** | Running the deploy and helper scripts | Free |

**Do not use your employer's production Microsoft 365.** You need full admin
rights, and you will install a custom bot. Use a tenant you own.

**Time:** about half a day the first time, mostly waiting for Microsoft
settings to take effect.

---

## 3. Your computer

1. Install **Node.js 24** (nodejs.org) and **git**.
   *Check:* `node --version` shows `v24…`.
2. Get the code:
   ```
   git clone https://github.com/<owner>/UC04-AI-Scrum-Master-Assistant.git
   cd UC04-AI-Scrum-Master-Assistant
   npm install
   ```
3. Create your settings file from the template:
   ```
   copy .env.example .env        (Windows)
   cp .env.example .env          (Mac/Linux)
   ```
   `.env` is ignored by git. **Never commit it.**
4. Switch on the local commit check (it refuses code commits that don't name an
   approved spec):
   ```
   git config core.hooksPath .githooks
   ```
5. *Check:* `npm run build` and `npm test` both finish with no failures.

> You do **not** need the `gcloud` command-line tool on your computer. The
> first deploy is done in **Cloud Shell** (a terminal inside the Google Cloud
> web console); every later deploy is a Node script.

---

## 4. Microsoft 365 tenant

A **tenant** is your organisation's own Microsoft 365 space: its users, Teams,
SharePoint and mail.

1. Sign up for **Microsoft 365 Business Basic** (free trial) with a **new**
   email address and choose a tenant name, e.g. `contoso` →
   `contoso.onmicrosoft.com`.
2. Create the admin account and set up sign-in security (MFA).
3. **Put a reminder in your phone** to cancel or pay before the trial ends
   (trial length is shown in the admin centre under *Billing → Your products*).
   If it lapses, Teams, SharePoint and mail stop and the assistant stops with
   them.
4. **Record:**
   - Tenant ID → `M365_TENANT_ID`
     (entra.microsoft.com → *Overview* → *Tenant ID*)
   - Tenant domain → `M365_TENANT_DOMAIN` (e.g. `contoso.onmicrosoft.com`)
   - Your admin account's **Object ID** → `ADMIN_USER_IDS` and
     `SUMMARY_SENDER_USER_ID`
     (entra.microsoft.com → *Users* → you → *Object ID*). The summary email is
     sent **from** this mailbox. Several admins: comma-separate their IDs in
     `ADMIN_USER_IDS`.

> **Browser tip.** If your normal browser is signed in to a different
> Microsoft account, do every Microsoft step in a **separate browser profile**
> (or private window) signed in as the new admin. Mixing accounts is the most
> common cause of "permission denied" and "wrong tenant" errors.

---

## 5. Teams settings

In the **Teams admin centre** (admin.teams.microsoft.com):

1. *Teams apps → Setup policies → Global (Org-wide default)* → **Upload custom
   apps: On** → Save.
2. *Teams apps → Manage apps → Org-wide app settings* → **Custom apps: allowed**.
   (On some trials this switch is greyed out but uploads still work — carry on.)

These can take up to a few hours to apply. Do them early.

---

## 6. Users

Create every person who will take part: members, Scrum Masters, stakeholders.

1. Go to **admin.microsoft.com** → *Users → Active users → Add a user*.
   (**Not** the Teams admin centre — it can only manage existing users.)
2. For each person: name, username, **Microsoft 365 Business Basic** licence,
   "Let me create the password", and **untick** "Require this user to change
   their password".
3. **Sign in to Teams once as each user** (teams.microsoft.com, private window).
   A user who has never opened Teams cannot be messaged by the bot.

Roles (member, Scrum Master, stakeholder) are **not** set in Microsoft 365. You
set them later on the admin page.

**Rules the assistant enforces:**
- A person is on **one** team's roster at a time.
- A **Scrum Master is not a member**: they get alerts, not reminders. One person
  can be Scrum Master of several teams.
- A person can't be both a member and a Scrum Master.

---

## 7. Bot registration

The **bot** is the identity that sends and receives Teams messages.

1. Open the **Teams Developer Portal** (dev.teams.microsoft.com), signed in as
   the admin → *Tools → Bot management → New bot* → name it **Scrum Assistant**.
2. *Configure* → **Endpoint address**:
   `https://<your-cloud-run-address>/api/messages`.
   You don't have the address yet — put any placeholder and fix it in
   [part 16](#16-point-microsoft-at-the-live-address).
3. Tick the **Microsoft Teams** channel.
4. *Client secrets → Add a client secret* → copy it immediately.
5. **Record:**
   - Bot ID (the app/client ID) → `BOT_APP_ID`
   - The secret → `BOT_APP_PASSWORD` (note its **expiry date** in your calendar)
6. Give the bot permission to install itself for people (this lets the admin
   page install the app for each new member automatically):
   entra.microsoft.com → *App registrations → All applications* → the bot's app
   → *API permissions → Add → Microsoft Graph → Application permissions* →
   **TeamsAppInstallation.ReadWriteForUser.All** → Add → **Grant admin consent**.
7. The bot runs as a **single-tenant** app on your tenant (the code passes your
   tenant ID). If the portal asks, choose *single tenant*.

---

## 8. Graph app registration

**Microsoft Graph** is Microsoft's API for users, SharePoint, mail and Teams.
The assistant uses a **second, separate** app registration for it, and the
same app signs people in to the admin page.

1. entra.microsoft.com → *App registrations → New registration* → name
   "Scrum Assistant Graph", **single tenant** → Register.
2. *API permissions → Add → Microsoft Graph → **Application** permissions*, add
   all of these:

   | Permission | Used for |
   |---|---|
   | Sites.ReadWrite.All | Writing rows to the SharePoint tracker |
   | Files.ReadWrite.All | Tracker access (and the parked Excel tracker) |
   | Mail.Send | Emailing the daily summary |
   | User.Read.All | Looking up people by email on the admin page |
   | GroupMember.Read.All | Checking who is in a Teams team (onboarding checklist) |
   | TeamMember.ReadWrite.All | Adding / removing a member to the team's Teams team |
   | AppCatalog.Read.All | Finding the Scrum Assistant app in your catalogue |

3. Still in *API permissions*, add **Delegated**: `openid`, `profile`,
   `User.Read` (for admin page sign-in).
4. Click **Grant admin consent for <tenant>**. Every row must show a green tick.
   *If consent fails* with "no subscription or service principal for Microsoft
   Graph", open this link in the admin's browser instead and accept:
   `https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<graph-app-id>`
5. *Authentication → Add a platform → Web* → Redirect URI:
   `https://<your-cloud-run-address>/admin/auth/callback`
   (placeholder for now; fixed in part 16).
6. *Certificates & secrets → New client secret* → copy it.
7. **Record:**
   - Application (client) ID → `GRAPH_CLIENT_ID`
   - The secret → `GRAPH_CLIENT_SECRET` (note its **expiry date**)

> Not needed: `ChannelMessage.Send` (delegated-only, unusable by a background
> service — the bot posts to channels itself) and `Sites.Manage.All` (only for
> an approved-but-not-built feature that creates tracker lists automatically;
> today you create the list by hand in part 20).

---

## 9. Teams app package

The **app package** is a small zip (manifest + two icons) that puts the bot into
Teams.

1. Open `appPackage/manifest.json` and set **both** of these to your `BOT_APP_ID`:
   - `"id"`
   - `"bots"[0]."botId"`
   Update `developer.name` and the URLs if you like.
2. Rebuild the zip with exactly these three files at its top level (no folder):
   `manifest.json`, `color.png`, `outline.png` → `appPackage/ScrumAssistant.zip`.
3. **Teams admin centre → Teams apps → Manage apps → Upload new app** → choose
   the zip.
   It **must** be in the **organisation's catalogue**. A copy side-loaded from
   the Teams client exists only for the person who uploaded it, and automatic
   installs for other people will fail.
4. *Check:* search "Scrum Assistant" in Teams → Apps → *Built for your org*.

---

## 10. Jira Cloud

Optional, but without it there are no sprints or stories: every update is saved
as a general update and the summary has no sprint figures.

1. Create a Jira Cloud site (free plan) — e.g. `https://<site>.atlassian.net`.
   The account you use must be **site admin** (the assistant invites and
   removes members' Jira access).
   *Better:* create a dedicated account for the assistant so its actions don't
   look like yours.
2. Create an **API token**: id.atlassian.com → *Security → API tokens → Create*.
3. **Record:**
   - `JIRA_BASE_URL` = `https://<site>.atlassian.net`
   - `JIRA_EMAIL` = the account's email
   - `JIRA_API_TOKEN` = the token (note its expiry)
4. Find the **story points field**. It differs per site, so never guess it:
   open `https://<site>.atlassian.net/rest/api/3/field` in the browser (signed
   in), search the page for **"Story point estimate"** (or "Story Points") and
   copy its `id`, e.g. `customfield_10016` → `JIRA_STORY_POINTS_FIELD`.
5. For each scrum team, create (or choose) a **Jira project with a Scrum board**.
   One project per team. In it:
   - create the stories,
   - **assign each story** to the member doing it (unassigned stories can't be
     updated by anyone),
   - give each a **story point** estimate,
   - put them in a sprint, set a **sprint goal**, and **start the sprint**.
6. Optional settings:
   - `JIRA_PROJECT_KEY` / `JIRA_BOARD_ID` — legacy server defaults; each team's
     project is now picked on the admin page. Leave `JIRA_BOARD_ID` empty.
   - `JIRA_STANDUP_ISSUE_KEY` — only if a team uses the **Jira comment**
     tracker: create one ticket (e.g. a Task called "General update", kept
     **outside any sprint**) and put its key here. Updates that name no ticket
     go there as comments.
7. Members are invited to Jira **automatically** when you add them on the admin
   page. Each person then accepts the invite email once.

---

## 11. Gemini (the AI model)

1. aistudio.google.com → *Get API key* → create a key in a Google Cloud project.
2. **Set up billing on it (paid tier).** Required, not optional: on the free
   tier Google may use submitted text to improve its models, which breaks the
   privacy rule. Check the key shows a *Paid* tier.
3. **Record:**
   - `GEMINI_API_KEY` = the key
   - `LLM_PROVIDER=gemini`
   - `LLM_MODEL=gemini-3.5-flash-lite` (the summary builder's model)
   - The update reader uses `gemini-3.5-flash` by default (`AGENT1_MODEL` to
     override).

**Spending guards** (already built in):

| Setting | Meaning |
|---|---|
| `LLM_LIVE` | Master switch. Off = no paid calls. The deploy script sets the live service from `CLOUD_RUN_LLM_LIVE` in `.env` — set `CLOUD_RUN_LLM_LIVE=true` to let the live service call the model |
| `LLM_MAX_CALLS_PER_DAY` | Hard daily ceiling (default 200), counted in the database |
| `LLM_CACHE` | Replays recorded answers locally. **Always off on the live service** (forced by the deploy script) |

If the model fails, the assistant retries the same model, then fails openly. It
never makes up an answer itself.

---

## 12. Google Cloud

### 12.1 Project and billing
1. console.cloud.google.com → create a project (or use the Gemini one).
   **Record** its ID → `GCP_PROJECT_ID`.
2. Attach billing.
3. Pick **one region** and use it everywhere, e.g. `asia-south1` (Mumbai).
   Record it as `CLOUD_RUN_REGION` (default `asia-south1`).

### 12.2 Turn on the APIs
*APIs & Services → Enable APIs*: **Cloud Firestore, Cloud Run Admin, Cloud
Scheduler, Secret Manager, Cloud Build, Artifact Registry, Cloud Storage,
Cloud Monitoring, Cloud Logging**.

### 12.3 Firestore (the database)
1. *Firestore → Create database* → **Native mode**, the **same region** as
   above. The location can never be changed.
2. Database ID: either `(default)` or a name of your own (e.g. `default`).
   **Record** it exactly → `FIRESTORE_DATABASE`. Note `default` and `(default)`
   are different databases.

No collections need creating; the service creates them.

### 12.4 Deploy service account
This account is what the Node scripts on your computer use.

1. *IAM & Admin → Service accounts → Create* → e.g. `scrum-assistant`.
2. Give it these roles on the project:

   | Role | Needed for |
   |---|---|
   | Cloud Datastore User | Helper scripts reading/writing Firestore |
   | Cloud Build Editor | Building the container |
   | Storage Object Admin | Uploading the source |
   | Artifact Registry Reader + Writer | Storing the container image |
   | Cloud Run Admin | Releasing new versions |
   | Service Account User | Letting Cloud Run run as its runtime account |
   | Secret Manager Admin | `scripts/secrets.mjs` (part 15) |
   | Secret Manager Secret Accessor | Reading secrets |
   | Monitoring Editor | `scripts/alerts.mjs` (part 18) |
   | Logs Configuration Writer | `scripts/alerts.mjs` log-based alerts |

3. *Keys → Add key → JSON* → save it inside the project folder as
   `service-account-key.json` (git ignores `service-account*.json`).
   **Record** its path → `GOOGLE_APPLICATION_CREDENTIALS`.
   Treat this file like a password.

### 12.5 Runtime account
The live service runs as its own account (by default the project's *Compute
Engine default service account*). It needs **Cloud Datastore User**; the
secrets script gives it access to each secret automatically.

---

## 13. The `.env` file — every setting

Fill these in as you go. **Required** settings stop the service from starting if
empty; the error lists every missing one at once.

### Microsoft
| Setting | Required | Value |
|---|---|---|
| `M365_TENANT_ID` | yes | Part 4 |
| `M365_TENANT_DOMAIN` | no | Part 4 |
| `BOT_APP_ID` | yes | Part 7 |
| `BOT_APP_PASSWORD` | yes | Part 7 (secret) |
| `GRAPH_CLIENT_ID` | yes | Part 8 |
| `GRAPH_CLIENT_SECRET` | yes | Part 8 (secret) |
| `TEAMS_TEAM_ID` | yes | The first dev team's Teams team ID (part 19). Legacy: teams are now chosen on the admin page, but the setting must not be empty |
| `STAKEHOLDER_CHANNEL_ID` | no | Legacy; channels are chosen on the admin page |
| `SHAREPOINT_SITE_ID` | yes | The first team's tracker site ID (part 20). Legacy, must not be empty |
| `SHAREPOINT_LIST_ID` | yes | The first team's tracker list ID (part 20). Legacy, must not be empty |
| `SUMMARY_SENDER_USER_ID` | no* | Part 4. *Empty = summary email is skipped |
| `EXCEL_DRIVE_ID`, `EXCEL_ITEM_ID`, `EXCEL_WORKSHEET` | no | Excel tracker is **not built**; leave empty |

### Admin page
| Setting | Required | Value |
|---|---|---|
| `ADMIN_USER_IDS` | yes in practice | Part 4, comma-separated object IDs |
| `ADMIN_SESSION_SECRET` | yes in practice | A long random string (e.g. 64 random characters). Empty = admin page **switched off** (secret) |
| `ADMIN_SESSION_HOURS` | no | Sign-in lasts this long (default 8) |
| `PUBLIC_BASE_URL` | yes in practice | The live address, e.g. `https://scrum-assistant-xxxx.a.run.app` (no trailing `/`). Set after part 14 |

### Google Cloud
| Setting | Required | Value |
|---|---|---|
| `GCP_PROJECT_ID` | yes | Part 12.1 |
| `FIRESTORE_DATABASE` | yes | Part 12.3, exactly |
| `GOOGLE_APPLICATION_CREDENTIALS` | local only | Part 12.4 key path. Never sent to the live service |
| `TICK_SHARED_SECRET` | yes | A long random string; the scheduler sends it (part 17) (secret) |
| `CLOUD_RUN_REGION` | no | Default `asia-south1` |
| `CLOUD_RUN_SERVICE` | no | Default `scrum-assistant` |
| `CLOUD_RUN_SECRETS` | no | `secret-manager` after part 15 |
| `CLOUD_RUN_LLM_LIVE` | no | `true` to let the live service call the AI |
| `DB_PROVIDER` | no | `firestore` (default) or `memory` for local tests |

### Jira
| Setting | Required | Value |
|---|---|---|
| `JIRA_BASE_URL`, `JIRA_EMAIL` | no* | Part 10. *Empty = no Jira features |
| `JIRA_API_TOKEN` | no* | Part 10 (secret) |
| `JIRA_STORY_POINTS_FIELD` | no | Part 10 step 4 |
| `JIRA_STANDUP_ISSUE_KEY` | no | Part 10 step 6, only for the Jira comment tracker |
| `JIRA_PROJECT_KEY`, `JIRA_BOARD_ID` | no | Legacy; leave board empty |

### AI
| Setting | Required | Value |
|---|---|---|
| `LLM_PROVIDER` | no | `gemini` |
| `LLM_MODEL` | yes in practice | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | yes in practice | Part 11 (secret) |
| `ANTHROPIC_API_KEY` | no | Only if `LLM_PROVIDER=anthropic` (secret) |
| `AGENT1_MODEL` | no | Override the update reader's model |
| `LLM_LIVE` | local | `true` only when you deliberately run paid calls locally |
| `LLM_CACHE` | local | `true` locally to replay recorded answers |
| `LLM_MAX_CALLS_PER_DAY` | no | Default 200 |
| `AGENT1_*`, `AGENT2_*` | no | Timeouts/retries; defaults are fine |

### Behaviour
| Setting | Default | Meaning |
|---|---|---|
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | Timezone for new teams. **Must be set in `.env`** — the deploy script refuses to run without it |
| `DEFAULT_GRACE_MINUTES` | 120 | Not read by the service today, but **must be set in `.env`** — the deploy script refuses to run without it. Put `120` |
| `STALE_PROGRESS_DAYS` | 2 | Days with no progress before a story is "at risk" |
| `BLOCKER_ALERT_DEDUPE` | `true` | Don't alert the same blocker twice a day |
| `APPROVAL_REMINDER_MINUTES` | 30 | Chase waiting approvals this long before the summary |
| `DRY_RUN` | `false` | `true` = log instead of sending Teams messages (local testing) |
| `HANDOFF_ENABLED` | `false` | Leave off (known issue with slow hand-over) |

---

## 14. First deploy

The very first deploy creates the Cloud Run service. Do it **once** from
**Cloud Shell** (the `>_` icon top-right in the Google Cloud console):

1. In Cloud Shell:
   ```
   git clone https://github.com/<owner>/UC04-AI-Scrum-Master-Assistant.git
   cd UC04-AI-Scrum-Master-Assistant
   gcloud config set project <GCP_PROJECT_ID>
   gcloud run deploy scrum-assistant --source . --region <region> \
     --allow-unauthenticated
   ```
   `--allow-unauthenticated` is required: Teams and the scheduler call the
   service from outside Google. The service protects itself (Teams signs its
   requests; `/tick` needs the secret; `/admin` needs Microsoft sign-in).
   This first start may report a failure because no settings are set yet —
   that's expected. What matters is that the service now exists (Cloud Run
   → Services shows `scrum-assistant`).
2. Copy the service address it prints (e.g.
   `https://scrum-assistant-xxxx.a.run.app`) → `PUBLIC_BASE_URL` in your `.env`.
3. From now on deploy from **your computer**:
   ```
   node scripts/deploy.mjs
   ```
   It packages the code, builds it in Cloud Build, and releases it with every
   setting from `.env` (1 CPU, 512 MB, 0–2 instances, 300 s timeout).
4. *Check:* it ends with
   `health: {"status":"ok","firestore":"ok",...}`.
   Opening `https://<address>/health` in a browser shows the same.

> **No automated pipelines.** Deploying is always a deliberate, manual run of
> the deploy script. Don't add GitHub Actions or deploy-on-push.

---

## 15. Secrets into Secret Manager

Until this step, passwords are plain settings on the Cloud Run service, visible
to anyone who can view it. Move them into Google's vault:

1. Make sure the deploy account has **Secret Manager Admin** (part 12.4).
2. Run:
   ```
   node scripts/secrets.mjs
   ```
   It copies these from `.env` into Secret Manager and lets the service read
   them: `BOT_APP_PASSWORD`, `GRAPH_CLIENT_SECRET`, `JIRA_API_TOKEN`,
   `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_SESSION_SECRET`,
   `TICK_SHARED_SECRET`. It prints names only, never values.
3. Add `CLOUD_RUN_SECRETS=secret-manager` to `.env`.
4. `node scripts/deploy.mjs` — it now prints `secrets from Secret Manager`.

> **Every time you change one of those secrets in `.env`, run
> `node scripts/secrets.mjs` first, then `node scripts/deploy.mjs`.** A deploy
> alone does **not** carry a new secret over; the live service would keep the
> old one.

---

## 16. Point Microsoft at the live address

Now that you have the real address:

1. **Bot endpoint** — Teams Developer Portal → *Bot management* → your bot →
   Endpoint address: `https://<address>/api/messages` → Save.
2. **Admin sign-in redirect** — entra.microsoft.com → the Graph app →
   *Authentication* → Redirect URI: `https://<address>/admin/auth/callback`
   (must match exactly) → Save.
3. Make sure `PUBLIC_BASE_URL` in `.env` is that same address, then deploy.
4. *Check:* open `https://<address>/admin`, sign in as the admin. You should see
   the admin page (with no teams yet).

---

## 17. Cloud Scheduler (the clock)

The service has no clock of its own. Cloud Scheduler calls it every 5 minutes;
each time, it runs whatever is due for each team in that team's timezone.

Google Cloud console → *Cloud Scheduler → Create job*:

| Field | Value |
|---|---|
| Name | `scrum-assistant-tick` |
| Region | your region |
| Frequency | `*/5 * * * *` |
| Timezone | any (the service uses each team's own timezone) |
| Target type | HTTP |
| URL | `https://<address>/tick` |
| HTTP method | POST |
| Headers | `x-tick-secret: <TICK_SHARED_SECRET value>` |
| Auth header | None |

*Check:* press **Force run** → the job shows *Success*. A wrong secret shows
HTTP 401.

Running a job twice never sends twice: every job is recorded per team, date and
job type, so repeats are ignored.

---

## 18. Failure alerts

Emails the admins when something breaks.

1. The deploy account needs **Monitoring Editor** and **Logs Configuration
   Writer** (part 12.4).
2. Run `node scripts/alerts.mjs` (safe to re-run). It creates an email channel
   to every admin and four alerts: a scheduled job failed; an update couldn't be
   processed; an update took over 30 seconds; the service stopped answering its
   health check.
3. Confirm the verification email if Google sends one.

---

## 19. Teams teams and the stakeholder channel

For **each scrum team**:

1. In Teams → *Teams → + → Create team → From scratch → Private* → name it,
   e.g. **Scrum Team Alpha**. You (admin) are the owner. Teams creates its
   **General** channel and its own SharePoint site automatically.
   Don't add members by hand — the admin page does that.

For **stakeholders** (once):

2. Create a **separate** Teams team, e.g. **Stakeholder**, and add the
   stakeholders. **Never** use a channel inside a dev team — every developer
   could read it.
3. Optional: one channel per scrum team inside it (e.g. "Scrum Team Alpha",
   "Scrum Team Beta"). Otherwise teams share its General channel.
4. **Add the Scrum Assistant app to the Stakeholder team** (team → *⋯ → Manage
   team → Apps → Get more apps* → Scrum Assistant → Add). The bot can only list
   and post to channels in teams where it is installed.

**Record** the first dev team's Teams team ID → `TEAMS_TEAM_ID` (Teams → the team
→ *⋯ → Get link to team* → the `groupId=` value).

---

## 20. The tracker list (SharePoint)

Each scrum team writes to a **Daily Status Tracker** list on **its own Teams
team's SharePoint site**, so only that team's members can open it.

### The first team — build the list
1. Open the team's site: Teams → the team → *Files → ⋯ → Open in SharePoint*
   (address like `https://<tenant>.sharepoint.com/sites/ScrumTeamAlpha`).
2. *+ New → List → Blank list* → name **Daily Status Tracker** → Create.
3. Add these columns. **Type the names exactly, with no spaces, and never rename
   them later** (SharePoint keeps the first name internally; a renamed column
   breaks writes):

   | Column | Type |
   |---|---|
   | Title | (already there — not used; see step 4) |
   | Date | Date and time (date only) |
   | WIN | Single line of text |
   | Description | Multiple lines of text |
   | AssignedTo | Single line of text |
   | Comment | Multiple lines of text |
   | Status | Choice: `In Progress`, `Completed`, `Blocked` |
   | AnyBlocker | Single line of text |
   | UpdatedBy | Single line of text |

   **"Description already exists"?** SharePoint has a hidden built-in column of
   that name and blocks adding it from the modern list screen. Try
   *⚙ → List settings → Create column* (the classic screen); if that also
   refuses, copy the list from a team that already has it (below). Whatever
   you do, the column's internal name must end up exactly `Description` — the
   admin page's Tracker check tells you if it didn't.
4. **The Title column.** SharePoint adds it to every list; the assistant never
   fills it. It can't be deleted, so:
   - **Make it not required:** *⚙ → List settings → Title → "Require that this
     column contains information": No* → OK. If it stays required, SharePoint
     can refuse the assistant's rows.
   - **Hide it:** in the list, click the **Title** column header → *Column
     settings → Hide this column*, so people don't see an empty column.

### Every further team — copy the list
On the new team's site: *+ New → List → **From existing list*** → pick the
first team's site → *Daily Status Tracker* → name it **Daily Status Tracker** →
Create. All columns, including Description, come across exactly; rows don't.
Then do step 4 (Title column) on the copy too.

### Record (first team only)
`SHAREPOINT_SITE_ID` and `SHAREPOINT_LIST_ID` — the legacy settings that must not
be empty. Get them from Graph Explorer (developer.microsoft.com/graph/graph-explorer):
`GET https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/ScrumTeamAlpha`
→ `id`; then `GET …/sites/<site-id>/lists` → the tracker's `id`.

*Check:* the admin page (part 21, Tracker) lists the list with **no missing
columns**.

> **Alternative tracker: Jira comments.** A team can instead write each update
> as a comment on the Jira ticket it's about. Needs a Jira project on the team
> and `JIRA_STANDUP_ISSUE_KEY` (part 10). **Excel Online is not built.**

---

## 21. Set up a scrum team on the admin page

Everything about a team is managed on **one page**: `https://<address>/admin`.
Don't edit the database or run scripts for team setup.

The page has tabs: **Dev team, Stakeholders, Schedule, Readiness, Run now,
Activity, LLM usage**, and a team selector.

> The page asks for confirmation in browser pop-ups (e.g. "Remove …?"). Read
> them before clicking OK.

Do these in order:

1. **New team** (admin only) → name, timezone, Scrum Master's email (blank =
   you). The team starts **Paused** with an empty roster. Nothing is sent while
   Paused.
2. **Dev team → Scrum Master.** Check it's right; *Change* if not. The app is
   installed for the Scrum Master automatically.
3. **Dev team → Teams team** → choose the team's Teams team → Save.
4. **Dev team → Jira project** → choose the team's project → Save
   (or *None* = general updates only). One project per team.
5. **Schedule → Tracker** → *SharePoint list* → choose **Daily Status Tracker**
   → *Use this list*. (Or *Jira comment*.)
6. **Dev team → Members → Add** each member by email. For each one the
   assistant automatically: adds them to the Teams team, installs the app for
   them, invites/links their Jira account. The **Onboarding** column shows each
   step; anything it couldn't do is shown with the reason.
   Moving someone between teams: **remove** from the old team first, then add.
   Removing also takes them out of the Teams team, uninstalls the app and
   removes Jira access (Jira refuses while tickets are assigned to them — that's
   fine if they're moving).
7. **Ask every member — and the Scrum Master — to open Scrum Assistant in Teams
   and send `help` once.** This is what lets the bot message them.
8. **Stakeholders** → add each email (they get the summary by email) → choose
   the **channel** → *Connect*.
9. **Schedule** → stand-up time, follow-up after (minutes), summary time,
   timezone, non-responder threshold, working days → *Save changes*.
   The **summary closes the stand-up** for the day; updates after it are
   refused (the Scrum Master can *Reopen* on the Today box).
10. **Readiness → Check readiness.** Every row should be green:
    active sprint · stories · every story assigned · story points · Jira links ·
    Teams chats (every member messageable) · Scrum Master chat · tracker
    reachable · schedule. Fix any red row — the page says how.
11. **Schedule → Running** → *Save changes*. The page refuses if the Scrum
    Master can't be messaged yet.

Repeat for each team. Each team can have different times, tracker, Jira project
and stakeholders.

---

## 22. Prove it works

Use **Run now** to trigger jobs without waiting (doesn't use up the day's
scheduled run, doesn't close the stand-up).

| # | Do | Expect | Requirement |
|---|---|---|---|
| 1 | Run now → **Reminder** | Each member gets the stand-up prompt in Teams | FR-01 |
| 2 | A member replies in their own words, describing the work (don't type ticket numbers) | Reply lists each item with its ticket and status; rows appear in **that team's** tracker | FR-02, 03, 04 |
| 3 | A member says they're blocked | Scrum Master gets an alert at once with member, blocker and ticket | FR-06 |
| 4 | A member sends something vague ("working on my tasks") | A card of their stories plus **Save as general update** / **None of these** | FR-02 |
| 5 | Run now → **Follow-up** | Only people who haven't replied get chased | FR-05 |
| 6 | Run now → **Summary** | Summary in the stakeholder channel and inboxes: roll-up, blockers, progress vs sprint goal, at-risk items | FR-07, 08 |
| 7 | Let a test member miss 2 working days | Scrum Master gets a non-responder flag | FR-09 |
| 8 | Two teams with different times and trackers | Each team's updates go only to its own tracker; each gets its own summary | FR-10 |

Example reply for test 2 (adapt to your stories):
> *Yesterday I finished the login page. Today I'm working on the password reset
> emails.*

---

## 23. Day-to-day running

### Chat commands (Scrum Master, in their chat with the bot)
| Command | Does |
|---|---|
| `help` | Lists what you can do |
| `setup` | Link to the admin page |
| `status` | What ran today |
| `pause` / `resume` | Stop / restart the daily messages |
| `run reminder` (or `followup`, `approvals`, `summary`, `participation`) | Run one job now, for testing |

Members just reply in plain words. `help` works for them too.

### What members experience
- Reply in their own words; several messages in a day are combined.
- An update clearly about their own story is recorded at once.
- Not clear which story → a card: pick a story, **Save as general update**, or
  **None of these**.
- An update on **someone else's** story waits for the Scrum Master's
  approval card.
- Messages after the summary has gone out are refused for that day.

### Admin page, daily
- **Today box** — stand-up open/closed, *Reopen*, and "General update only
  today: …" (members who gave only a general update).
- **Activity** — jobs run today and their outcome; change history.
- **LLM usage** — AI calls and tokens per day against the daily limit.

### Helper scripts (run from your computer; most are for testing)
| Script | Use |
|---|---|
| `node scripts/deploy.mjs` | Deploy |
| `node scripts/secrets.mjs` | Copy changed secrets to the vault (before deploy) |
| `node scripts/alerts.mjs` | Create the failure alerts |
| `node scripts/check-reach.mjs` | Who the bot can message |
| `node scripts/install-app.mjs` | Install the app for every member and Scrum Master |
| `node scripts/clear-today.mjs [job]` | Let today's scheduled job run again (testing only) |
| `node scripts/preview-summary.mjs` | Build today's summary and print it, send nothing (one AI call) |
| `npm test` | Unit tests (no AI calls) |
| `npm run eval` | AI accuracy test against labelled updates. **Makes ~70 paid AI calls** — needs `LLM_LIVE=true` |

Older scripts (`seed-team.mjs`, `link-jira.mjs`) are replaced by the admin page.

---

## 24. Changing things later

| Change | How |
|---|---|
| A password / key / token | Update `.env` → `node scripts/secrets.mjs` → `node scripts/deploy.mjs` |
| Any other setting in `.env` | Update `.env` → `node scripts/deploy.mjs` |
| Code | Commit (naming an approved spec) → `node scripts/deploy.mjs` |
| Team, members, schedule, tracker, stakeholders | Admin page only |
| New bot ID (e.g. new tenant) | Edit manifest (part 9), re-zip, re-upload in the Teams admin centre |
| Move to a new Microsoft 365 tenant | Follow `docs/TENANT-MOVE-CHECKLIST.md` |
| New sprint | Start it in Jira. The assistant picks up the active sprint by itself |

---

## 25. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Service won't start, log lists missing settings | Required `.env` values empty | Fill them (part 13), deploy |
| `/health` shows `firestore: unreachable` | Wrong `FIRESTORE_DATABASE` or runtime account lacks Datastore User | Check the exact database ID; grant the role |
| A member gets no reminder | App not installed for them, or they never opened it | Ask them to open Scrum Assistant and send `help`; check Readiness → Teams chats |
| Admin page: "Not switched to Running. … can't be messaged" | Scrum Master never opened the app | Scrum Master sends `help` to the bot |
| Auto-install of the app fails | App side-loaded, not in the org catalogue; or the bot lacks TeamsAppInstallation.ReadWriteForUser.All | Re-upload in Teams admin centre (part 9); grant + consent the permission (part 7) |
| Adding a member to the Teams team fails | Graph app lacks TeamMember.ReadWrite.All | Add + consent (part 8) |
| Graph consent error "no service principal" | Known first-time glitch | Use the direct admin-consent link (part 8 step 4) |
| Admin sign-in loops or errors | Redirect URI ≠ `PUBLIC_BASE_URL` + `/admin/auth/callback`, or `ADMIN_SESSION_SECRET` empty | Make them match exactly; set the secret; deploy |
| "You are not the Scrum Master of any team" | Signed in as someone who isn't admin or a Scrum Master | Add their object ID to `ADMIN_USER_IDS`, or make them Scrum Master |
| Tracker list not offered | Team has no Teams team set, or the list is missing columns | Set the Teams team; fix columns (part 20) |
| SharePoint "Description already exists" | Hidden built-in column | Classic List settings, or copy the list (part 20) |
| Rows land in the wrong column | A column was renamed after creation | Delete and re-create it with the exact name |
| Jira tracker: "stand-up issue … cannot be found" | `JIRA_STANDUP_ISSUE_KEY` points at a ticket that doesn't exist | Create a "General update" ticket, set the key, deploy (part 10) |
| Every update saved as "general" | No active sprint, or the member has no open story assigned, or team has no Jira project | Start the sprint; assign stories; set the Jira project |
| "Not assigned to you" / update refused | Story unassigned or assigned to someone else | Assign it in Jira; someone else's story needs Scrum Master approval |
| Readiness: no story points | Points not set | Set estimates in Jira; the summary skips unpointed stories |
| Jira 401/403 after changing the token | New token only in `.env` | `node scripts/secrets.mjs` then deploy |
| AI calls fail / "not live" | `CLOUD_RUN_LLM_LIVE` not true, key rejected, or daily limit hit | Set it and deploy; check the key is paid; see LLM usage |
| Summary not emailed | `SUMMARY_SENDER_USER_ID` empty or Mail.Send not consented | Set it to the admin's object ID; consent Mail.Send |
| Summary not in the channel | App not added to the stakeholder team, or channel not connected | Part 19 step 4; Stakeholders → Connect |
| Late update refused | Stand-up closed when the summary ran | Today box → Reopen (if appropriate) |
| Scheduler shows 401 | Header value ≠ `TICK_SHARED_SECRET` | Fix the header |
| Admin page freezes in browser automation | Confirm/prompt pop-ups | Answer the pop-up; automation must handle dialogs |

**Logs:** Google Cloud console → *Cloud Run → scrum-assistant → Logs*. Every
message and job has a correlation id to follow it through.

---

## 26. Housekeeping and dates

Put these in a calendar:

- **Microsoft 365 trial end** — cancel or pay before it.
- **Google Cloud credit end** — billing moves to your card after.
- **Bot secret and Graph secret expiry** (parts 7, 8) — create new ones before
  they expire, then `secrets.mjs` + deploy.
- **Jira API token expiry** — same.

**Privacy rules to keep:**
- Update text lives only in the tracker. Never store it in the database or logs.
- Keep `LLM_CACHE` off on the live service (the deploy script enforces it).
- Keep Gemini on a **paid** plan.

**Costs to expect** at a few teams: Cloud Run, Firestore, Scheduler and Secret
Manager — a few units of currency a month; Gemini — pennies a day; Jira free up
to 10 users; Microsoft 365 — per user after the trial.

**Closing it all down:** Teams admin centre → remove the app; Entra → delete
both app registrations; Google Cloud → *IAM & Admin → Settings → Shut down*
the project, then close the billing account; cancel the Microsoft 365
subscription.

---

## 27. Reference

### Addresses on the service
| Path | Who calls it |
|---|---|
| `/api/messages` | Teams (the bot endpoint) |
| `/tick` | Cloud Scheduler, every 5 minutes, with `x-tick-secret` |
| `/admin` | People, in a browser (Microsoft sign-in) |
| `/health` | You, and the uptime alert |

### Database collections (Firestore) — settings and counts only
`teams`, `scrumMasters`, `botTeams`, `runs`, `runLogs`, `participation`, `flags`,
`blockerAlerts`, `approvals`, `notices`, `configChanges`, `llmUsage`.

### Permissions summary
| Where | Permission | Type |
|---|---|---|
| Bot app (Entra) | TeamsAppInstallation.ReadWriteForUser.All | Application, admin consent |
| Graph app | Sites.ReadWrite.All, Files.ReadWrite.All, Mail.Send, User.Read.All, GroupMember.Read.All, TeamMember.ReadWrite.All, AppCatalog.Read.All | Application, admin consent |
| Graph app | openid, profile, User.Read | Delegated |
| Teams app manifest | identity, messageTeamMembers; scopes personal + team | — |

### Related documents
- `PRD-UC04-AI-Scrum-Master-Assistant.md` — the requirements.
- `docs/POC-Plan.md` — architecture and assumptions.
- `docs/specs/` — what each feature does, in detail.
- `docs/TENANT-MOVE-CHECKLIST.md` — moving to a new Microsoft 365 tenant.
- `docs/SETUP-CHECKLIST.md` — the history of the original setup.
- `docs/OPEN-ITEMS.md` — decisions still open.
