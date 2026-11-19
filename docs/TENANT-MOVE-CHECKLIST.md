# Tenant move checklist — old tenant to new tenant

**Started:** 16 Nov 2026. The old tenant's (`SyamPadala.onmicrosoft.com`)
Business Basic licence ends today. We move to a new Business Basic free trial on
a **new tenant**.

**Unchanged:** the code, Google Cloud (Cloud Run, Firestore, Scheduler, Secret
Manager), Gemini, Jira, the live web address.
**Redone:** everything on the Microsoft side.

**Status (18 Nov 2026): MOVED.** New tenant `Indsyam.onmicrosoft.com` is live; see "Notes 18 Nov" at the end. The rest of this paragraph is the original plan.
we go through this list together, one item at a time. Nothing is done yet.
Section A was meant for today. If it is missed, the old data may still be
reachable for a short grace period after expiry.

Record values in `.env` only. Never put them in this file or in chat.

---

## A. Today, before the old licence ends

- [ ] A1. Download the old SharePoint tracker list (Export to Excel) if you
      want to keep its rows.
- [ ] A2. Note the names of the old teams, members, schedules and stakeholders
      on the admin page (a screenshot is enough). You set them up again in J.
- [ ] A3. Decide what happens to the old tenant: let it expire (recommended,
      no action) or cancel it. Nothing in the app depends on it after step H.

## B. New tenant

- [x] B1. Sign up for Microsoft 365 Business Basic free trial with a **new
      email** and a new tenant name.
- [x] B2. Admin account created, sign-in security (MFA) set up.
- [ ] B3. **Reminder in your phone: cancel the trial by 15 Dec 2026** (trial ends 18 Dec) or it
      starts charging. (Google Cloud credit also ends 17 Dec 2026.)
- [x] B4. Record: tenant ID and tenant domain → `M365_TENANT_ID`,
      `M365_TENANT_DOMAIN`.
- [x] B5. Record: the admin's object ID → `ADMIN_USER_IDS` and
      `SUMMARY_SENDER_USER_ID` (the summary email is sent from this mailbox).

## C. Teams settings

- [x] C1. Teams admin centre → Setup policies → Global: allow uploading
      custom apps.
- [ ] C2. Teams admin centre → Manage apps → Org-wide app settings: custom
      apps allowed.

## D. Users

- [x] D1. Create the test users in admin.microsoft.com (not the Teams admin
      centre). Business Basic licence each, no forced password change.
- [x] D2. Sign in to Teams once as each user. A user who has never opened
      Teams cannot be messaged.

## E. Bot registration (new bot)

- [x] E1. Teams Developer Portal (signed in as the new admin) → new bot
      "Scrum Assistant".
- [x] E2. Messaging address: `https://scrum-assistant-lxz5k662sa-el.a.run.app/api/messages`.
- [x] E3. Record: bot ID and password → `BOT_APP_ID`, `BOT_APP_PASSWORD`.
- [x] E4. Entra → App registrations → the bot's app → Application permission
      **TeamsAppInstallation.ReadWriteForUser.All** → Grant admin consent.
      (Lets the admin page install the app for each member.)

## F. Graph app (new app registration, single tenant)

- [x] F1. Entra → App registrations → New, single tenant.
- [x] F2. Application permissions, then **Grant admin consent**:
      - Sites.ReadWrite.All
      - Files.ReadWrite.All
      - Mail.Send
      - User.Read.All
      - GroupMember.Read.All
      - TeamMember.ReadWrite.All
      - AppCatalog.Read.All
      - *(Later, only once SPEC-008 10s is built: Sites.Manage.All.)*
- [x] F3. Delegated: openid, profile, User.Read (admin page sign-in).
- [x] F4. Authentication → Web redirect URI:
      `https://scrum-assistant-lxz5k662sa-el.a.run.app/admin/auth/callback`
- [ ] F5. New client secret. Record: `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`.
      Note the secret's expiry date.

## G. App package (Claude does this)

- [x] G1. Put the new bot ID into the Teams app manifest (both the app id and
      the bot id) and rebuild the zip.
- [x] G2. You upload the zip in the Teams admin centre → Manage apps →
      Upload. It must be in the **organisation's catalogue**, not just
      side-loaded, or the automatic install fails.

## H. Teams teams, channel and tracker

- [x] H1. Teams team "Scrum Team Alpha". The owner is the admin.
- [x] H2. A **separate** Teams team "Stakeholder" with the channel
      "Stakeholder Channel" (decided 24 Sep: never inside the dev team).
- [x] H3. On Scrum Team Alpha's own SharePoint site, create the list "Daily
      Status Tracker" with these columns, typed with **no spaces** and never
      renamed afterwards: Date, WIN, Description, AssignedTo, Comment,
      Status (Choice: In Progress / Completed / Blocked), AnyBlocker,
      UpdatedBy.
- [x] H4. Record: `TEAMS_TEAM_ID`, `STAKEHOLDER_CHANNEL_ID`,
      `SHAREPOINT_SITE_ID`, `SHAREPOINT_LIST_ID` (Claude can look these up
      once the Graph app works).
- [x] H5. Excel (`EXCEL_*`): parked, leave as is.
- [ ] H6. Optional: a second Teams team plus its own tracker list, to show FR-10.

## I. Put it live (you run the commands)

- [x] I1. Update `.env` with the 12 keys: `M365_TENANT_ID`,
      `M365_TENANT_DOMAIN`, `BOT_APP_ID`, `BOT_APP_PASSWORD`,
      `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `TEAMS_TEAM_ID`,
      `STAKEHOLDER_CHANNEL_ID`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_LIST_ID`,
      `SUMMARY_SENDER_USER_ID`, `ADMIN_USER_IDS`.
- [x] I2. `node scripts/secrets.mjs` (copies the new bot and Graph passwords
      to the vault).
- [x] I3. `node scripts/deploy.mjs`.
- [x] I4. Check `/health` and sign in to `/admin` as the new admin.

## J. Old team records — update them in place (decided 16 Nov 2026)

The existing teams are kept and re-pointed at the new tenant from the admin
page, not deleted. Do it in this order:

- [x] J1. Set each team to **not Running** first, so no reminders go to the
      old members while you work.
- [x] J2. Remove each old member. Removing a member also does their
      offboarding. Two steps will fail because the old tenant is gone (Teams
      team, app uninstall) and the member lands on the "Leaving" list. Tick
      those as done. Their **Jira access is really removed** at this point;
      it comes back when the Jira account is linked to the new member in K3.
      Old members must be removed **before** K3, because a Jira account can't
      be linked to two people.
- [x] J3. Old participation history stays in the database under the old
      people. It is harmless: nobody on the team matches it.

## K. Re-point each team (admin page)

- [x] K1. Existing team → change its linked Teams team to the new one →
      choose the new tracker list.
- [x] K2. Add members (the app installs for each automatically) and the Scrum
      Master.
- [x] K3. Jira: link each member to their Jira account again. The Jira
      accounts stay; only the Microsoft side of the link is new.
- [x] K4. Schedule, timezone, stakeholder channel and stakeholder emails.
- [x] K5. Add the app to the "Stakeholder" Teams team so the bot can post
      the summary there.
- [ ] K6. Readiness panel all green → Running.

## L. Prove it works (every FR on the new tenant)

- [x] L1. Admin page sign-in (NFR Config).
- [ ] L2. Reminder arrives (FR-01) → reply in words → written to the tracker
      (FR-02, FR-03, FR-04).
- [ ] L3. No reply → follow-up (FR-05).
- [ ] L4. Blocker → Scrum Master alert (FR-06).
- [x] L5. Summary → stakeholder channel and email (FR-07, FR-08).
- [ ] L6. Participation flag (FR-09).
- [ ] L7. Second team runs separately (FR-10).

## N. Remove the old tenant's apps (after L passes)

Sign in to entra.microsoft.com as the **old** admin → App registrations:

- [ ] N1. Delete the old bot app ("Scrum Assistant").
- [ ] N2. Delete the old Graph app.
- [ ] N3. Optional: Teams Developer Portal (old admin) → delete the old bot
      and app entries.

Wait until L passes: until then the old apps are a reference for the settings
being copied.

## M. Documents to update afterwards

- [ ] M1. CLAUDE.md: the demo tenant name.
- [ ] M2. SETUP-CHECKLIST: section A redone for the new tenant, and the new
      trial's cancel date.
- [ ] M3. POC-Plan and the demo script: tenant name and user names.
- [ ] M4. Claude's memory notes.

---

## Notes 18 Nov 2026 (move done)

- New tenant `Indsyam.onmicrosoft.com`, trial ends 18 Dec: **cancel by 15 Dec** (B3 reminder still to set).
- Members (Scrum Team Alpha): Gowtham, AJINKYA, SaiKrishna, VARDHAN, SAILAJA, Ganesh. Scrum Master: syam.r.padala.
  Stakeholder emails: mujahid, Jyothirmayi, Anurag, Gowtham. Stakeholder channel connected (shows as "Stakeholder › General").
- Jira project for the team: **REQ** (REQ Sprint 2). Members were linked to **newly invited** Jira accounts, but the sprint
  stories are assigned to their older accounts (Gowtham Palla, vardhan, sailaja kagita, Bora ganesh): reassign or re-link.
- Readiness said "No active sprint" after switching to REQ although REQ Sprint 2 is active: re-check.
- Graph consent failed at first ("no subscription or service principal for Microsoft Graph"). Fixed with the direct
  admin-consent link `https://login.microsoftonline.com/<tenant>/adminconsent?client_id=<graph app id>`.
- Sites.Manage.All was never granted; the tracker list was created by hand (8 columns, checked).
- Still open: C2 org-wide custom apps switch (was greyed; upload worked anyway), Scrum Team Beta still points at the
  old tenant (no members), admin page member-email hint still says `@SyamPadala` (needs a spec item), N and M sections.
- Tested live: reminder, member updates, story card, manual summary to channel + email.
