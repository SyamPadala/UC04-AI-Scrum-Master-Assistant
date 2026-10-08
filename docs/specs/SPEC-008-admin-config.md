# SPEC-008: Admin panel (web)

| | |
|---|---|
| **Status** | Approved (24 Sep 2026); amendment of 28 Sep 2026 (10d–10e) approved 28 Sep 2026; amendment of 29 Sep 2026 (10f–10k, roles) approved 29 Sep 2026; amendment of 30 Sep 2026 (10l) approved 30 Sep 2026; 10m, 10n approved 5 Oct 2026; 10o, 10p, 10q approved 8 Oct 2026 |
| **Delivers** | NFR Configuration; supports FR-08 (stakeholder list), FR-10 (per-team settings) |
| **Assumptions** | A9 (configuration via a web admin panel, amended 24 Sep 2026) |
| **Depends on** | SPEC-001 |
| **Owner** | Claude |

> **Amended 24 Sep 2026.** Configuration moves from the `setup` Adaptive Card to
> a web page. The PRD allows either ("Teams adaptive card **or** admin UI";
> "admin panel (Teams tab **or** web UI)"). A card cannot manage lists — adding
> and removing members and stakeholders took a round of messages per change.
> The `setup` card is removed once the page works. User decision.

## Intent

**In plain words:** the Scrum Master opens one web page, signs in with their
Microsoft 365 account, and manages everything about their team there: who is on
the team, who receives the summary, when stand-up happens, and running a job by
hand to test it. No script, no config file, no redeploy.

## Three roles

| Role | Who | Gets |
|---|---|---|
| Dev team | The roster | Reminders, follow-ups; sends updates |
| Scrum Master | One roster member | Blocker alerts, non-responder flags; manages the team on this page |
| Stakeholders | Email addresses, plus everyone in the stakeholder channel | The daily summary (FR-08) |

## Behaviour

**Access**

1. The page is served by the same Cloud Run service at `/admin`.
2. Every request requires Microsoft (Entra ID) sign-in on the
   `SyamPadala.onmicrosoft.com` tenant. There is no anonymous view.
3. A signed-in user sees and edits only the teams where they are the Scrum
   Master. A user in `ADMIN_USER_IDS` sees every team. Anyone else sees
   "You are not the Scrum Master of any team" and nothing more.

**Sections of the page** (one team at a time; a selector when the user has more than one)

4. **Schedule** — stand-up time, follow-up grace period, summary time,
   timezone, non-responder threshold (A3), and Running / Paused. Everything the
   `setup` card edits today.
5. **Dev team** — the roster, each member showing: name, email, whether the
   assistant can message them (app installed), and whether they are linked to a
   Jira account.
   - **Add** by email address. The address is looked up in Microsoft 365
     (Graph); the member is stored by their Entra object id, not by name.
   - **Remove** a member. They stop receiving reminders and stop counting
     towards participation. Rows they already wrote stay in the tracker.
   - **Link Jira account** — pick from the Jira site's users. Replaces
     `scripts/link-jira.mjs`. One Jira account cannot be linked to two people.
   - The Scrum Master is marked and cannot be removed.
6. **Stakeholders** — email addresses, added and removed one at a time; and the
   stakeholder channel, chosen from a list and shown as connected or not
   connected. *Amended and approved 25 Sep 2026 — was "cannot be set from here".*
   - The list is every standard channel in every Teams team the app is
     installed in. The bot notes each such Teams team (name, id, and a
     conversation reference to it) when it is installed or sees any channel
     activity there; the channels are read live from Teams through the bot's
     own connection. No new Microsoft permission is needed.
   - **Connect** stores the channel id on the team and a conversation reference
     pointing at that channel, so the summary is posted there as a new post.
     Nobody has to @mention the bot in the channel.
   - **Disconnect** clears both. The summary then goes by email only.
   - The stakeholder channel belongs in a Teams team of its own, not the dev
     team's (user decision, 24 Sep 2026): a channel in the dev team's Teams team
     is readable by every developer. The page does not enforce this.
   - Installing the app into a Teams team, or adding people to one, never
     changes anyone's personal chat reference. Only a one-to-one chat does.
7. **Tracker** — choose where updates are written: SharePoint list or Jira
   comments (FR-04). The destination is checked before it is saved (the list
   is reachable; the Jira stand-up issue exists). Updates already recorded
   today stay where they were written. Excel Online joins the choice when it
   is built. Changed from read-only on 24 Sep 2026 so the destination can be
   switched live.
8. **Run now** — buttons for reminder, follow-up, summary and participation.
   Same behaviour as the chat `run` command (A14): isolated from the scheduled
   cycle, takes no run claim, does not close the stand-up. The result is shown
   on the page.
9. **Today** — what ran today and its outcome, what the chat `status` shows.
10. **Change history** — who changed what and when, for this team.
10a. **LLM usage** — model calls and tokens per day for the last 14 days, split
    by Agent 1 and Agent 2, against the daily call limit; provider, model and
    whether live calls are on. Counts only (Privacy NFR). Added 24 Sep 2026 at
    the user's request.

**Teams and Scrum Master** — *added 26 Sep 2026. Both were out of scope here;
the PRD never excluded them, and FR-10 plus the Configuration NFR need them.*

10b. **New team.** Name, timezone, and Scrum Master (by email; defaults to the
    signed-in user). The team starts **Paused**, with the Scrum Master as its
    only member, default times (stand-up 09:30, follow-up after 120 minutes,
    summary 18:00), no stakeholders, and the same tracker type as the server
    default. Nothing is sent to anyone until the Scrum Master switches it to
    Running. Allowed for users in `ADMIN_USER_IDS` and for anyone who is
    already the Scrum Master of a team.
10c. **Change Scrum Master.** On the Dev team tab, any member can be made the
    Scrum Master. Blocker alerts and non-responder flags go to them from the
    next event. A person who is Scrum Master of this team and not an admin
    loses access to it when they hand it over; the page says so before saving.

**Readiness** — *added and approved 28 Sep 2026. User request after the
28 Sep demo failed on problems a check would have caught in seconds. Not an FR
of its own; it supports the Reliability NFR and the demo constraint, and
changes no behaviour elsewhere.*

10d. **Check readiness** — one button, read-only, **no LLM calls**. One row per
    check, green or red, with the fix in plain words:

    | Check | Red when |
    |---|---|
    | Active sprint | No active sprint in the team's Jira board |
    | Stories | Active sprint has no stories |
    | Assignees | A story in the sprint is unassigned |
    | Story points | A story has no points in the configured field |
    | Jira links | A roster member isn't linked to a Jira account |
    | Teams chats | A member has no chat, or Teams answers "Conversation not found" for it (checked through the bot's own connection; no new permission) |
    | Tracker | The configured list or Jira issue can't be reached |
    | Schedule | Today's summary has already run (stand-up closed), or the stand-up time is later than the summary time |

10e. **Dead chats are shown, not just counted.** When a reminder, follow-up or
    alert send gets "Conversation not found", the member's stored chat is
    cleared, so the Dev team tab shows **App not installed** and the run
    outcome names them. They become reachable again by sending any message
    to the assistant. (Touches SPEC-003's send path.)

**Roles** — *added and approved 29 Sep 2026. User decisions: the Scrum
Master is a role, not a roster member; a Scrum Master may run several teams;
only an admin creates teams and sets Scrum Masters. Supersedes 10b's "anyone
who is already a Scrum Master may create a team" and 10c's hand-over from the
Dev team tab. Not an FR of its own: it serves FR-10 and the Configuration NFR.*

| Action | Admin (`ADMIN_USER_IDS`) | Scrum Master |
|---|---|---|
| Create a team, set or change its Scrum Master | yes | no |
| Members, schedule, stakeholders, tracker, Run now, Readiness | every team | own teams only |
| Teams shown in the selector | all | the ones they run |

10f. **The Scrum Master is not on the roster.** They get no reminders or
    follow-ups, give no stand-up updates and are not counted in participation.
    They still receive blocker alerts, non-responder flags, the no-sprint alert
    and summary-failure notices for every team they run. *("No dev work for
    the Scrum Master", user, 29 Sep 2026.)*
10g. **One person may be Scrum Master of several teams.** Their Teams chat is
    stored once per person (Firestore `scrumMasters/{objectId}`: display name,
    email, conversation reference — no update content), captured whenever they
    message the assistant, and used for all their teams.
10h. **Scrum Masters and members don't overlap.** A person on any roster
    cannot be made a Scrum Master, and a Scrum Master cannot be added to a
    roster, each refused with the reason. One team per member stays (replies
    are routed by roster); a member on two teams is a known limitation (POC-Plan
    §10) until each team has its own Jira board.
10i. **New team (admin only).** Name, timezone, Scrum Master by email (defaults
    to the admin). Starts Paused with an **empty** roster.
10j. **Change Scrum Master (admin only)**, by email, shown next to the team name.
10k. **In chat,** a Scrum Master's message that is not a command gets *"You're
    the Scrum Master of <team>. Scrum Masters don't send stand-up updates."*
    `setup`, `help` work as before; `status`, `pause`, `resume`, `run` work
    when they run one team, and point to the admin page when they run several.
    Readiness (10d) adds a **Scrum Master chat** check.
10l. *Added 30 Sep 2026 (approved by the user, 30 Sep 2026; demo-day issue #8).*
    **Reopen stand-up.** Once the scheduled summary has run, the stand-up is
    closed (A14) and late updates are refused. The team's page shows
    *"Stand-up closed at 18:00 (summary sent)"* with a **Reopen stand-up**
    button, for admins and the team's Scrum Master.
    - Reopening marks today's summary record as reopened (who, when); it
      does **not** delete it, so the scheduler does not send the summary
      again. Members can send updates for the rest of the day.
    - The page then shows *"Reopened by <name> at <time>"*.
    - Recorded in the change log. The next day closes as usual.
    - Run now → Summary still does not close the stand-up (A14 unchanged).
10m. *Added 5 Oct 2026 (approved by the user, 5 Oct 2026; LATER.md L7, user
    decision: checklist only).* **Onboarding checklist per member.** On the
    Dev team tab each member shows *Onboarding 4 of 6* (or *Ready*); opening
    it lists the steps below, each done / not done with what to do next. The
    page **performs none of the steps**. One new **read-only** Graph
    permission, **GroupMember.Read.All** (the user grants it, 5 Oct 2026).

    | Step | How it is known | When not done |
    |---|---|---|
    | M365 licence with Teams | checked: Graph `licenseDetails` (User.Read.All, already granted) | *"Assign a licence in the Microsoft 365 admin center."* |
    | Added to the team's Teams team | checked: member of the team's Microsoft 365 group (GroupMember.Read.All) | *"Add them to <Teams team> in Teams."* |
    | Scrum Assistant app installed | checked: the member has a working chat (same as the Teams chats readiness check) | *"Install the app for them, or ask them to open Scrum Assistant and send 'help'."* |
    | Jira account linked | checked: `jiraAccountId` set (10d Jira links) | *"Invite them to Jira, then link them here."* |
    | Story assigned in the sprint | checked: an open sprint story has their Jira account | *"Assign them a story in Jira. Until then updates are saved as general updates (SPEC-004 item 39)."* |
    | Tracker access | checked: when the SharePoint tracker's site belongs to the team's group (its drive owner), group membership **is** site access. Otherwise (another site, Excel, Jira comment) **ticked by hand** | *"Add them to <Teams team>"* / *"Give them access to the tracker, then tick."* |

    - **Teams team per scrum team.** The admin picks it from a dropdown of the
      tenant's Teams teams, in the New team form (optional) and on the Dev team tab;
      the Scrum Master sees it read-only. Stored on the team (group id). Not set
      and the team's own id is a Teams team (Scrum Team Alpha, created from
      its Teams team `97b9628b-…`) → that one is used. A Teams team already
      used by another scrum team is refused. Not set → steps
      2 and 6 show *"Teams team not set"*, never done.
    - A hand tick records who and when on the member (Firestore, metadata
      only) and goes in the change log; it can be unticked.
    - Checked steps are read when the tab opens, like readiness (10d); a
      step that can't be checked shows *"Could not check"*, never done.
    - Admins and the team's Scrum Master see and tick it (Roles table).
    - Not in scope: adding to the Teams team, installing the app, sending the
      Jira invite or a welcome message (L7's automated part stays parked).
10n. *Added 5 Oct 2026 (approved by the user, 5 Oct 2026; L7, user decision:
    "implement all the checklist items automatically except the M365
    licence"; on remove, "what we added should be removed, or else listed").*
    **Automatic onboarding and offboarding.** *(Extends 10m.)*

    **On Add member** the assistant does, in order, every step it can:

    | Step | Done by the assistant | Needs |
    |---|---|---|
    | 1 Licence | **no** — manual, as 10m | — |
    | 2 Teams team | adds them as a member of the team's Teams team | **TeamMember.ReadWrite.All** (new, Graph app) |
    | 3 App | installs Scrum Assistant for them (as `scripts/install-app.mjs`) | bot app's existing install permission |
    | 4 Jira | only when the team uses Jira: finds their Jira account by email, or invites them to the site; then links it | Jira token is a site admin (checked 5 Oct) |
    | 5 Story | **no** — the Scrum Master's planning decision; the badge reminds | — |
    | 6 Tracker | through step 2 when the tracker is on the Teams team's site; otherwise a hand tick (10m) | — |

    - A step that can't run yet (no licence → no app install, Jira seat
      limit reached, a Graph error) is shown on the checklist with the reason
      and a **Retry** button; the add itself still succeeds.

    **On Remove member** the member is removed **completely, the same way for
    everyone**, whoever added their access (user decision, 5 Oct 2026: *"delete
    him completely; if some team needs him they will add him as per their
    process"*):

    | Access | On remove |
    |---|---|
    | Teams team membership | removed from the Teams team |
    | App install | uninstalled |
    | Jira access | removed from the Jira site (linked account, or found by email); the Atlassian account itself can't be deleted by API — listed. The assistant's own Jira account is never removed. |

    - What can't be done automatically — the M365 licence, the Atlassian
      account, a step that failed — goes on an **Offboarding checklist**: the
      removed member stays listed under *Leaving* on the Dev team tab with
      each item *Done automatically* or *To do by hand*, until an admin or the
      Scrum Master marks it finished.
    - Their tracker rows stay (as today).
    - Every add and undo is logged and in the change log.
    - Admins and the team's Scrum Master (Roles table).

    - *Added 8 Oct 2026 (M13):* on Add, a Jira account found by email that
      has **no Jira access** (removed earlier) gets access back — invited
      again, or added to Jira Software's default group — then linked. Uses
      a seat. Reported as "Jira access restored".

    - *Added 8 Oct 2026 (M7):* membership is added or removed only in a
      Teams team linked to a scrum team; any other group id is refused in
      code, since the permission itself covers the whole tenant.

    *Note:* Jira Free allows 10 users; 8 are used (5 Oct). An invite past the
    limit fails and the checklist says *"Jira has no free seat"*.

10o. *Added 8 Oct 2026 (approved by the user, maturity plan M2 + M3).*
    **The Scrum Master can always be reached.**
    - When a team is created or its Scrum Master is changed, the assistant
      installs Scrum Assistant for the Scrum Master (as for members, 10n).
      The install event stores their chat. A failed install is reported in
      the result message; the create or change still succeeds.
    - A team cannot be switched to **Running** — on the page or with the
      chat `resume` command — until its Scrum Master can be messaged. Refused
      with: *"Not switched to Running. <name> (Scrum Master) can't be messaged
      yet. They need to open Scrum Assistant in Teams once."* Applies to
      whoever is Scrum Master, an admin included.

10p. *Added 8 Oct 2026 (approved by the user, maturity plan M10; replaces L4).*
    **Jira project per team.** The Jira site address and the assistant's
    login stay deployment settings. Each team's **project** (and its sprint
    board, picked when there are several; Kanban boards excluded) is chosen by
    an **admin** on the Dev team tab or in the New team form; the Scrum Master
    sees it read-only. One project per team — a project already used is
    refused (*"SCRUM is already used by Scrum Team Alpha."*). **Optional:** a
    team without a project works — every update is a general update, no
    cards, no sprint figures, no no-sprint notice; readiness shows "Jira
    project: not used" (not an error) and onboarding marks the Jira steps
    "not needed". Scrum Team Alpha was set to SCRUM (SCRUM board) on 8 Oct.
10q. *Added 8 Oct 2026 (approved by the user, maturity plan M11).*
    **Tracker list per team, isolated.** A team's SharePoint tracker is a list
    on **its own Teams team's SharePoint site**, so only its members can open
    it. The admin page offers only those lists, shows any missing tracker
    columns, and refuses a list another team uses. A new team starts with
    **no tracker** (never another team's list): updates are refused with
    *"Your team's tracker hasn't been set up yet…"* and the team cannot be
    switched to Running until one is chosen. Alpha keeps its current list.

**Migration.** Scrum Team Alpha has its Scrum Master (Syam) on the roster. On
deploy his stored chat is copied to `scrumMasters/`, and he is removed from
Alpha's roster; he has no tracker rows or sprint stories today.

**Saving**

11. Every change is validated on the server and saved immediately. The next
    `/tick` uses it; no restart.
12. Every change is recorded in the change log: who, when, which field, from
    and to.

**Teams chat after this ships**

13. `setup` is removed; typing it replies with the admin page link.
14. `help`, `status`, `pause`, `resume` and `run` stay in chat — quick actions
    a Scrum Master may want without leaving Teams.

## Interface

```ts
// Pages and JSON API, all under /admin, all behind sign-in.
GET  /admin                                  // the page
GET  /admin/login  → Entra authorize         // sign-in
GET  /admin/auth/callback                    // sets session cookie
POST /admin/logout

GET    /admin/api/teams                      // teams this user may manage
GET    /admin/api/teams/:teamId              // config, roster status, today's runs, change history
PATCH  /admin/api/teams/:teamId/schedule     // Behaviour 4
PUT    /admin/api/teams/:teamId/tracker      // Behaviour 7 { kind: 'sharepoint' | 'jira' }
POST   /admin/api/teams/:teamId/members      // { email }
DELETE /admin/api/teams/:teamId/members/:memberId
PUT    /admin/api/teams/:teamId/members/:memberId/jira   // { jiraAccountId }
POST   /admin/api/teams/:teamId/stakeholders // { email }
DELETE /admin/api/teams/:teamId/stakeholders/:email
GET    /admin/api/teams/:teamId/channels     // Behaviour 6: channels the bot can post to
PUT    /admin/api/teams/:teamId/channel      // Behaviour 6 { channelId } — '' disconnects
POST   /admin/api/teams                      // Behaviour 10b { name, timezone, scrumMasterEmail? }
PUT    /admin/api/teams/:teamId/scrum-master // Behaviour 10c { memberId }
POST   /admin/api/teams/:teamId/run/:jobType // Behaviour 8
GET    /admin/api/llm                        // Behaviour 10a
```

- Sign-in uses the existing Graph Entra app (`GRAPH_CLIENT_ID`) with the
  authorization-code flow. The ID token is verified against the tenant's keys;
  the user's object id (`oid`) is what authorization checks.
- The session is an HMAC-signed, HttpOnly, Secure, SameSite=Lax cookie. It
  holds the object id, name and expiry — nothing else. Lax, not Strict: the
  sign-in callback is a navigation from Microsoft's login page, and a Strict
  cookie would not be sent with it. Writes are protected by a required header.
- The page is plain HTML with a small script calling the JSON API. No front-end
  framework, no build step beyond `tsc`.
- Code: `src/admin/` (routes, auth, validation), `src/admin/page.ts` (HTML).
  `index.ts` only mounts the router (coding rule 10).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `ADMIN_USER_IDS` | string[] | [] | Users who may manage any team |
| `ADMIN_SESSION_SECRET` | secret | — | Signs the session cookie; required when the page is enabled |
| `ADMIN_SESSION_HOURS` | number | 8 | Session length |
| `PUBLIC_BASE_URL` | string | — | The Cloud Run URL, used to build the sign-in redirect |

**One-time setup (user):** in the Graph Entra app registration, add a **Web**
redirect URI `<PUBLIC_BASE_URL>/admin/auth/callback`. Delegated `openid`,
`profile` and `User.Read` need no admin consent beyond what the tenant already
gives.

## Edge cases

- **Email not found in the tenant, or a guest account.** Refused with the
  reason; nothing saved.
- **Person already on another team's roster.** Refused — rosters must not
  overlap (SPEC-001), or their updates would have no single tracker.
- **Person already on this roster, or stakeholder already listed.** No change,
  no error.
- **Member removed mid-day.** Today's rows stay. They are excluded from
  follow-up and participation from the next job that runs.
- **Member added who has not installed the app.** Saved, and shown as "cannot
  be messaged yet" — visible before the demo, not discovered at reminder time.
- **Invalid time, timezone, or a grace period that pushes the follow-up past the
  summary.** Refused with a message naming the field.
- **Invalid stakeholder email format.** Refused.
- **Session expired.** API returns 401; the page sends the user back to sign-in.
- **Cross-site request.** A required custom request header on every write; a
  form posted from another site cannot send it and is rejected.
- **Scrum Master of team A calls team B's API directly.** 403, logged.
- **New team whose Scrum Master is already on another team's roster.** Refused
  — rosters must not overlap.
- **New team with a name already used.** Refused.
- **Scrum Master set to someone not on the roster.** Refused — add them first.
- **Two people editing at once.** Last write wins; both changes are in the log.
- **Privacy.** The page shows no update content — only configuration, roster,
  run outcomes and counts.

## Out of scope

- Participation reports and non-responder history on the page.
- Pinning the page as a Teams tab (possible later with no code change to the
  page itself).
- Per-member preferences; roles beyond Scrum Master and admin.

## Verification

| # | Check | Method | Evidence |
|---|---|---|---|
| 1 | Page refuses an anonymous visitor | Open `/admin` in a private window | Redirect to Microsoft sign-in |
| 2 | Non-Scrum-Master is refused | Sign in as Madhavi | Screenshot + 403 in log |
| 3 | Schedule change takes effect without restart | Change stand-up time, wait for tick | Reminder at the new time |
| 4 | Member added by email starts receiving reminders | Add, then Run now → reminder | `ReminderResult` counts |
| 5 | Removed member stops receiving reminders | Remove, then Run now → reminder | `ReminderResult` counts |
| 6 | Member on another team is refused | Try to add them | Error shown, nothing saved |
| 7 | Stakeholder email added receives the summary | Add, then Run now → summary | Email in that inbox |
| 8 | Run now does not close the stand-up | Run summary, then send an update | Update recorded |
| 9 | Jira link set from the page | Link, then send an update naming a ticket | Row attributed |
| 10 | Every change is in the history | Inspect the Change history section | Screenshot |
| 11 | `setup` in chat returns the page link | Type `setup` | Screenshot |
| 12 | Unit tests | Validation, authorization, roster overlap | `npm test` |
| 13 | Stakeholder channel chosen on the page receives the summary | Install app in the stakeholder Teams team, Connect, Run now → summary | Post in the channel; outcome `success` |
| 15 | New team created from the page | Create "Scrum Team Beta" | Team selector lists it; starts Paused |
| 16 | Scrum Master changed from the page | Make another member Scrum Master | Next blocker alert reaches them |
| 14 | Installing the app in a Teams team leaves personal chats alone | Check the Scrum Master's stored reference after the install | Still `personal` |
| 17 | Readiness shows red for each broken condition | Unit tests per check with fakes; live with the sprint not started | Test output; screenshot |
| 18 | Readiness makes no LLM call and writes nothing | Code review + LLM usage count unchanged after a check | Review note; usage tab |
| 19 | "Conversation not found" marks the member App not installed | Unit test with a fake send error | Test output |
| 20 | Only an admin can create a team or change its Scrum Master | Unit test on the service; sign in as a non-admin Scrum Master | 403 + no New team button |
| 21 | One Scrum Master runs two teams and sees both | Create Beta with the same Scrum Master | Selector lists both |
| 22 | Scrum Master gets no reminder, still gets the blocker alert | Run now → reminder; send a blocker as a member | ReminderResult counts; alert card |
| 23 | Overlap refused both ways | Unit tests | Test output |
