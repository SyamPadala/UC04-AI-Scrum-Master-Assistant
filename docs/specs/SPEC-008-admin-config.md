# SPEC-008: Admin panel (web)

| | |
|---|---|
| **Status** | Approved (24 Sep 2026) |
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
- **Two people editing at once.** Last write wins; both changes are in the log.
- **Privacy.** The page shows no update content — only configuration, roster,
  run outcomes and counts.

## Out of scope

- Changing who the Scrum Master is, and creating a new team from the page.
  Both are done by `scripts/seed-team.mjs` for now; creating the second team is
  part of the FR-10 work.
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
| 14 | Installing the app in a Teams team leaves personal chats alone | Check the Scrum Master's stored reference after the install | Still `personal` |
