# POC Plan — UC-04 AI-Powered Scrum Master Assistant

**Source:** `PRD-UC04-AI-Scrum-Master-Assistant.md` (v1.0)
**Delivery:** Friday 18 Sep 2026, end of day
**Principle:** Build to the PRD as written. Where the PRD is ambiguous, use the documented assumption (Section 5) and make it configurable.

---

## 0. Session Status — Where We Left Off

**Updated:** Mon 21 Sep 2026 (reconciled 22 Sep 2026 against the session log)
**State:** All ten functional requirements are implemented **and deployed**.
The LLM is funded and working; FR-03 is measured at 92.5% against the eval set.

Live service: `https://scrum-assistant-lxz5k662sa-el.a.run.app`
Repository: `https://github.com/SyamPadala/UC04-AI-Scrum-Master-Assistant` (public)

### Implemented and evidenced

| FR | What it does | Evidence |
|---|---|---|
| FR-01 | Sends stand-up reminders on schedule | Fired unattended 19 and 20 Sep, both delivered |
| FR-02 | Accepts a reply written in plain language | Messages from two accounts recorded |
| FR-03 | Extracts completed / in progress / blockers | **92.5% on 40 labelled updates**, `eval/last-run.json` |
| FR-04 | Writes the update to the SharePoint tracker | Rows visible in Daily Status Tracker |
| FR-05 | Chases only those who have not replied | Correctly sent to nobody when both had replied |
| FR-06 | DMs the Scrum Master when a blocker is reported | Built and deployed 21 Sep; not yet demonstrated live |
| FR-07 | Builds the daily consolidated summary | Ran unattended on the server at 21:55 on 21 Sep and built a summary |
| FR-08 | Posts it to the channel and emails stakeholders | Built and deployed 21 Sep; delivery reached nobody — no stakeholder channel reference stored, no stakeholder emails, `SUMMARY_SENDER_USER_ID` unset |
| FR-09 | Records participation, flags repeat non-responders | 50% rate recorded; one flag raised, repeat suppressed |
| FR-10 | Resolves the team from the sender, per-team tracker | Code path built; a second team is not yet configured |
| NFR Latency | Update received to tracker written | Worst case 7.8 s of a 30 s budget |
| NFR Configuration | Scrum Master changes settings from inside Teams | `setup` card saved 09:00 -> 01:00, reminder fired at the new time |

Also working: `status`, `pause`, `resume`, `help`; merging of a member's rows
across several messages on the same day (A11, `mergeRows()`); idempotent jobs;
members who cannot be messaged are named rather than silently skipped.

### The LLM, and what it costs

Billing was activated on the existing Gemini project on 21 Sep 2026 and the key
in `.env` began working unchanged. `gemini-3.5-flash-lite` clears the FR-03
target, so nothing more expensive is needed.

Three guards sit in front of every model call, in `src/llm/`:

| Guard | Setting | Why |
|---|---|---|
| Recorded responses | `LLM_CACHE` | Replays a previous answer to the same request, free. Testing fifty times costs what testing once costs. |
| Live switch | `LLM_LIVE`, **off by default** | A cache miss fails loudly rather than silently billing. Separate from `DRY_RUN`, which only stops Teams messages. |
| Daily ceiling | `LLM_MAX_CALLS_PER_DAY`, default 200 | Counted in Firestore, so a Cloud Run restart cannot reset it. Billing alerts lag 24-48 hours; this acts in time. |

Every call's token counts are recorded in `llmUsage/{date}` — counts only, never
content. The whole of 21 Sep, including a failed first run, the full 40-case
eval and the evening's build, came to **59 calls and 61,975 tokens**.

### Not yet done

1. **Add the bot to the "Stakeholder Updates" channel** — without a stored
   channel reference FR-08 has nowhere to post.
2. **Stakeholder emails and `SUMMARY_SENDER_USER_ID`** — the other half of
   FR-08. The summary is built correctly; only delivery fails.
3. **Install the app for Sai Krishna Akula and Tiwari Satyam** — they cannot be
   messaged until then.
4. **Approve SPEC-001..008** — still Draft. Code was written at the user's
   explicit instruction while they remain so.
5. **Excel workbook** (tracker destination 2) and the **Jira comment** tracker.
   The drive id is already in `.env`.
6. **A second team**, to demonstrate FR-10 end to end.
7. **`README.md` is still empty**, and step 8 of the build order lists it as a
   deliverable.
8. **Known debt** — see `docs/KNOWN-DEBT.md`. Items 6 and 7 are now closed;
   item 9 is a new, deliberate disagreement between SPEC-006 and the code, and
   is the one to settle first.
9. **Four secrets in plain text** in the Cloud Run configuration, now including
   the billable Gemini key, rather than Secret Manager.

**Deployed twice on 21 Sep** (21:50 and ~23:0x, the second carrying the merge
fix). `scripts/deploy.mjs` carries optional keys through and forces `LLM_LIVE`
from `CLOUD_RUN_LLM_LIVE` and `LLM_CACHE=false`, so a laptop's settings can
never become the server's by accident.

**One question left open:** does A11 ("multiple messages from a member on the
same day are combined into one update") match how a Scrum Master actually
works? The code now matches A11; A11 is an assumption we wrote, not a client
requirement, so it is the user's to change.

### Known gap

`teamdetails.txt` holds test-user passwords in plain text. Git-ignored, never
committed, but present on a OneDrive-synced path.

---

## 1. Shared Understanding

- The bot is a **background service** running on a server 24/7. Users see it as a **contact in Teams**; nobody opens an app to make it send messages.
- Stand-up time, roster, tracker and stakeholders are **configured by the Scrum Master** (admin Adaptive Card). Nothing is pulled from Teams meetings or calendars; the bot runs its own schedule.
- One-time setup: register the bot, install the Teams app for members (required before the bot can message them first).
- The bot is the **Scrum Master's assistant**: it takes over admin work (reminders, chasing, recording, summaries). Facilitation, coaching and resolving blockers stay with the Scrum Master.
- "Reminder dispatch" = bot automatically messages each member at the set time. "Natural language status collection" = members reply in free text; no form or template.

---

## 2. Locked Tech Stack

| Purpose | Choice |
|---|---|
| Language / runtime | TypeScript on Node.js 22 |
| Teams bot | Microsoft 365 Agents SDK (Bot Framework protocol); bot registered in Teams Developer Portal (free) |
| Cards (prompts, alerts, admin config) | Adaptive Cards |
| Microsoft 365 (Teams, SharePoint, Excel Online, email, users) | Microsoft Graph API on an M365 Developer Program sandbox tenant |
| Jira | Jira Cloud REST v3 |
| LLM | Provider adapter (A12). Delivered: **Gemini** (approved substitute, 17 Sep 2026). Also supported by config: Anthropic API, Claude via Vertex |
| Hosting | Google Cloud Run |
| Scheduler | Google Cloud Scheduler (one job every 5 min calls `/tick`) |
| Data store | Google Firestore |
| Secrets | Google Secret Manager |
| Code | GitHub. **No CI/CD** — deployment is a manual `gcloud run deploy` from Cloud Shell. Automated pipelines are disallowed on this engagement (19 Sep 2026). |
| Local dev | VS Code; the app is reached through its Cloud Run URL |

---

## 3. Architecture — Hybrid

Code owns everything that must **always** happen. Claude owns language understanding and calls **read-only tools** when it needs facts.

```
Cloud Scheduler (every 5 min) ──► POST /tick ──┐
                                               ▼
Teams ◄──── proactive msgs ──── Bot service (Cloud Run)
Teams ────► POST /api/messages ──►  │
                                    ├── Code (deterministic)
                                    │     schedule, reminders, follow-ups, tracker write,
                                    │     blocker alert send, participation, config, distribution
                                    │
                                    ├── Agent 1: Update processor  (Claude + tools)
                                    └── Agent 2: Summary builder   (Claude + tools)
```

| Layer | Owns | FRs |
|---|---|---|
| **Code** | Scheduling (`/tick`), reminders, follow-ups, tracker write, sending blocker alert, participation counting, multi-team config, summary distribution | FR-01, 04, 05, 06 (send), 08, 09, 10 |
| **Agent 1 — Update processor** | Understand a member's reply, resolve affected stories | FR-03, FR-06 (detect) |
| **Agent 2 — Summary builder** | Build the daily consolidated summary | FR-07 |

### Agent 1 — Update processor
- **Trigger:** each incoming member reply (combined per member per day, A11).
- **Tools:** `lookup_story(id)` (Jira/ADO), `get_member_open_items(memberId)` (sprint items assigned to the member).
- **Output (structured JSON):** `completed[]`, `inProgress[]`, `blockers[{description, storyRef}]`.
- **Then code always:** writes to the tracker; if blockers exist, DMs the Scrum Master (member, blocker, story).

### Agent 2 — Summary builder
- **Trigger:** team's configured end-of-day time.
- **Tools:** `get_today_updates(teamId)` (read from tracker), `get_sprint_data(teamId)` (goal, committed/done points, velocity), `get_active_blockers(teamId)`, `get_participation(teamId)`.
- **Output:** summary text — update rollup, active blockers, completion vs sprint goal, at-risk items, velocity.
- **Then code always:** posts to Teams channel and/or emails the stakeholder list.

### Guardrails
- Agents get **read-only tools only** — no send or write tools.
- Capped tool iterations and a timeout. **No fallback extraction** (user decision, 17 Sep): on failure the call fails visibly and is recorded. Program-generated output must never be mistakable for model output.
- Every tool call and timing logged (evidence for demo).

### Scheduler and data
- **`/tick`:** for each active team, in its time zone, run what's due (reminder, follow-up, summary). Idempotent per team + date + job type. One job covers all teams (FR-10) and stays in the free tier.
- **Privacy NFR:** Firestore stores configuration, conversation references and participation metadata only. Update content is stored only in the team's tracker; Agent 2 reads it back from there.

### Project structure (indicative — to be confirmed by specs)
```
src/
  index.ts            Express server: /api/messages, /tick, /health
  bot/                activity handlers, install handling, commands
  cards/              Adaptive Card templates (prompt, alert, summary, admin)
  jobs/               reminder, follow-up, summary, participation
  agents/             updateProcessor.ts, summaryBuilder.ts
  agents/tools/       stories, sprint, updates, participation
  trackers/           tracker interface + sharepoint, excel, jira, mock
  pm/                 Jira client
  graph/              Graph client, mail, channel, users
  store/              Firestore repositories
  config/             env + secrets loading
eval/                 labelled sample updates + accuracy scorer
appPackage/           Teams app manifest + icons
docs/                 plan, specs, setup guide, demo script
```

---

## 4. Decision Log

| Topic | Decision | Reason |
|---|---|---|
| Scope | All FR-01..FR-10 + NFRs exactly per PRD | POC judged against the document |
| Language | TypeScript / Node.js 22 | Best Teams and SDK support |
| Microsoft 365 | M365 Developer Program sandbox | Admin rights without waiting for company IT consent |
| Azure | **Not used** | Visual Studio Professional Azure credit: "not eligible" (likely org policy) |
| Hosting | Google Cloud free tier | Zero budget; PRD does not mandate Azure hosting |
| LLM (superseded) | Claude via Vertex AI | Superseded 17 Sep — see the three rows below |
| Vertex AI for Claude | **Rejected for the LLM** | Claude on Vertex is a Marketplace purchase; Google promotional credits do not apply to Marketplace, so the ₹28,664 trial credit cannot pay for it. GCP is retained for Cloud Run, Firestore, Scheduler and Secret Manager, which the credit does cover |
| Gemini as the LLM | **Approved** 17 Sep 2026 (A12) | PRD Section 8 names Claude; substitution explicitly approved by the requirement owner, so the deviation is sanctioned rather than silent. Recorded here as a known, approved deviation from PRD v1.0 |
| Provider adapter (`anthropic` / `vertex` / `gemini`) | **Accepted** (A12) | LLM behind one interface; provider is a config value, so switching back to Claude is a one-line change with no code impact |
| Gemini Pro subscription | **Not usable** | Consumer chat plan, not API access |
| Jira vs Azure DevOps | **Jira only** (decided 20 Sep 2026) | PRD line 139 asks which is primary, not for both. Azure DevOps is Phase 2. Closed — do not reopen. |
| Architecture | Hybrid (code + agents with read-only tools) | Full agent risks 99.5% reliability, 30 s latency and 2-day deadline; plain workflow under-uses LLM for story resolution/summary |
| Method | Spec-Driven Development | User decision; specs before code |
| Updates after the summary | **Rejected. The stand-up closes when the summary is sent** (decided 22 Sep 2026) | A stand-up needs a real closing time; accepting updates all day teaches the team there is no deadline. Rollover to the next day was considered and rejected: it lets a member stay permanently a day behind while never being chased or flagged. The PRD is silent on late replies, so this is the user's decision, not a requirement |

---

## 5. Assumptions (PRD ambiguities)

| # | PRD reference | Assumption |
|---|---|---|
| A1 | FR-06, Latency NFR, Metric | Blocker alert sent as part of update processing (target < 30 s; satisfies "immediately" and "within 5 min") |
| A2 | FR-05, User Flow step 6 | "Cut-off time" = reminder time + grace period (default 2 h) |
| A3 | FR-09, Risks | Habitual non-responder = 2 missed updates (configurable) |
| A4 | FR-07, User Flow step 7 | Summary generated daily at a configured end-of-day time per team, text format |
| A5 | FR-07 | At-risk item = sprint item not done that has an active blocker, or no progress mentioned for 2+ working days |
| A6 | Scope: velocity | Velocity = completed story points per sprint (current vs last 3); completion = done / committed points; included in summary as text |
| A7 | FR-04, Integrations | Tracker destinations: SharePoint list, Excel Online, Jira comment. **Jira only** for story lookup and sprint data (decided 20 Sep 2026) |
| A8 | FR-06 | Affected story resolved by Agent 1 from IDs or descriptions in the update, validated via Jira/ADO tools; otherwise "not specified" |
| A9 | Config NFR | Admin configuration via Adaptive Card in the bot chat (Scrum Master runs `setup`) |
| A10 | Open questions | Voice input and velocity trend chart not built |
| A11 | FR-02 | Multiple messages from a member on the same day are combined into one update |
| A12 | Section 8 (LLM) | PRD names Claude; **Gemini approved as substitute by the requirement owner, 17 Sep 2026**. The LLM sits behind a provider adapter (`anthropic` / `vertex` / `gemini`) so the choice is a config value. FR-03 accuracy is measured and reported against whichever provider is actually delivered |
| A13 | Privacy NFR | "No retention in LLM training data" is satisfied only on a paid or enterprise tier. If the delivered LLM runs on a free tier whose terms permit training on submitted data, this is reported as a known NFR gap, and the POC is demonstrated with synthetic data only |
| A14 | FR-02, FR-05, FR-09 | The day closes when the summary job runs. A member who messages after that is told the stand-up is closed and to speak to the Scrum Master; nothing is written to the tracker and they are counted as missed. The day closes whether or not the summary built successfully, because the day's record has been taken either way. Decided 22 Sep 2026 |

---

## 6. Requirement Traceability

| ID | Delivered by | Verified by |
|---|---|---|
| FR-01 | `jobs/reminder` + prompt card | Demo: reminders at scheduled time for 2 teams |
| FR-02 | `bot/` message handler | Demo: varied free-text replies accepted |
| FR-03 | Agent 1 (structured JSON output) | `eval/` accuracy run (target ≥ 90%) |
| FR-04 | `trackers/*` (code, always) | Demo: rows/comments visible in SharePoint, Excel, Jira |
| FR-05 | `jobs/followup` | Demo: follow-up only to non-responders after grace period |
| FR-06 | Agent 1 detects + resolves story; code sends DM | Demo: Scrum Master DM with member, blocker, story; timing log |
| FR-07 | Agent 2 with sprint/update/blocker/participation tools | Demo: summary with rollup, blockers, goal status, at-risk, velocity |
| FR-08 | `graph/` channel post + mail (code) | Demo: summary in Teams channel and inbox |
| FR-09 | `jobs/participation` | Demo: participation rate + non-responder flag |
| FR-10 | Firestore team config + `/tick` | Demo: 2 teams, different times and trackers |
| NFR Reliability | Cloud Scheduler + idempotent jobs + run log | Run log report (partial data by Friday) |
| NFR Latency | Timing instrumentation; capped tool iterations and timeout | Latency report (< 30 s) |
| NFR Privacy | Metadata-only store; Claude via Vertex/API | Design review |
| NFR Accessibility | Adaptive Cards | Demo on Teams desktop + mobile |
| NFR Configuration | Admin card | Demo: change schedule/roster/tracker via card |

### Success metrics in the POC

| Metric | POC evidence |
|---|---|
| Extraction accuracy ≥ 90% | Automated eval on labelled sample set |
| Blocker notified < 5 min | Timing logs |
| Participation ≥ 95% | Participation report from test run |
| Effort reduction ≥ 80% | Not measurable by Friday — before/after survey after POC |
| Stakeholder satisfaction ≥ 85% | Not measurable by Friday — survey after POC |
| Reminder reliability ≥ 99.5% | Instrumented; only ~1 day of data by Friday |

---

## 7. Build Order (after specs are approved)

Follow the daily cycle so a working slice exists early; build against mocks so account setup doesn't block.

1. Foundation: server, config, Firestore store, tracker interface + mock, Teams manifest.
2. Agent 1 + eval set (~40 labelled updates) — riskiest part first; check accuracy and latency.
3. Daily cycle on Cloud Run: FR-01 → FR-02 → FR-03 → FR-04 (SharePoint) → FR-06 → FR-05 → FR-09.
4. Excel Online and Jira comment trackers.
5. Jira/ADO sprint data → Agent 2 (FR-07) → FR-08 distribution.
6. FR-10 multi-team + admin Adaptive Card.
7. Deploy: Cloud Run, Secret Manager, Cloud Scheduler — all deployed by hand from Cloud Shell. No build automation.
8. Prove: 2-team end-to-end, eval report, latency and run-log reports, README, setup guide, demo script.

---

## 8. Schedule (to re-check after SDD setup)

| When | Owner | Work |
|---|---|---|
| Thu morning | User | Account setup (Section 9) |
| Thu morning | Both | SDD: CLAUDE.md, rules, specs |
| Thu afternoon–evening | Claude | Build order steps 1–4 |
| Fri morning | Claude | Steps 5–6 |
| Fri midday | Both | Step 7 |
| Fri afternoon | Both | Step 8, buffer, demo dry run |

---

## 9. Pending Actions (User)

- [ ] Join M365 Developer Program → E5 sandbox (test users, 2 Teams teams, stakeholder channel, SharePoint site + list, Excel workbook)
- [ ] Enable custom Teams app upload; Entra app + Graph permissions with admin consent (in sandbox)
- [ ] Google Cloud free trial; enable Cloud Run, Firestore, Scheduler, Secret Manager
- [ ] Check Claude in Vertex AI Model Garden (enable, quota > 0, trial credit coverage); else get Anthropic API key
- [ ] Jira Cloud Free: project, active sprint, stories with points, API token
- [ ] (Optional) Check Google One plan for Google Cloud credits

---

## 10. Open Questions

- Confirm the team is user + Claude only.
- ~~Is Jira or Azure DevOps primary?~~ **Answered 20 Sep 2026: Jira.**
- Who owns post-POC surveys (effort reduction, stakeholder satisfaction)?
- **Should a second follow-up be sent?** FR-05 specifies one, and the PRD never mentions another. Raised 22 Sep 2026.
- **Should the summary name the members who never replied?** FR-07 lists what the summary contains and non-responders are not in the list. Raised 22 Sep 2026.
- **Should a member confirm the work item the LLM picked before the tracker is written?** User's proposal, 22 Sep 2026. The PRD's own mitigation for this risk is different — Scrum Master review after the fact. Not decided; the user asked to discuss it later.
- **Should the summary show work reported complete that Jira still shows open?** Completion and velocity are read from Jira, so the summary understates progress until someone moves the ticket. Harmless mid-sprint, permanent if it happens at the sprint boundary. Raised 22 Sep 2026.
- SDD structure, spec template and rules (next session).
- **AI Journal:** user to share details next session (purpose, template/format, contents, reviewer). Recommendation: update it continuously during development, not at the end; include it in SDD setup.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Account setup delays | Blocks real integrations | Build against mocks until the accounts are ready |
| Graph permission / proactive install issues | No reminders | Install app to Teams team to capture conversation references; sandbox admin consent |
| Agent latency vs 30 s NFR | NFR miss | Capped tool iterations, tight timeout, smaller model if needed; measure early. No fallback path, so latency must be met by the model itself |
| 2-day timeline incl. SDD setup | Features incomplete | Keep specs lean; build in daily-cycle order; Friday afternoon buffer |
| Reliability NFR needs multi-day data | Partial evidence | Instrument from first deploy; report available data |
