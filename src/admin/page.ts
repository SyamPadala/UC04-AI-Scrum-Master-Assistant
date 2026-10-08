import { ADMIN_STYLES } from './pageStyles.js'
import { adminScript } from './pageScript.js'

/**
 * The admin page (SPEC-008): one HTML document, a small script, no framework.
 *
 * Every value from the server is inserted with textContent, never innerHTML,
 * so a display name or email address cannot inject markup. The only markup
 * built in the script is the fixed icon set below.
 */

function escapeHtml (text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

const ICONS: Record<string, string> = {
  team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  channel: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>'
}

function icon (name: string): string {
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`
}

export function adminPage (userName: string): string {
  const initials = userName.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scrum Assistant Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${ADMIN_STYLES}
</style>
</head>
<body>
<dialog id="new-team" aria-labelledby="new-team-title">
  <form id="new-team-form" method="dialog">
    <h2 id="new-team-title">New team</h2>
    <p class="muted">The team starts Paused with an empty roster. The Scrum Master runs it but is not on the roster. Nothing is sent until you switch it to Running.</p>
    <div class="field"><label for="nt-name">Team name</label><input id="nt-name" name="name" required maxlength="60" placeholder="Scrum Team Beta"></div>
    <div class="field"><label for="nt-tz">Timezone</label><input id="nt-tz" name="timezone" value="Asia/Kolkata" required></div>
    <div class="field"><label for="nt-teams">Teams team</label><select id="nt-teams"><option value="">Not set</option></select><small>The team's own Teams team. Used for the onboarding checklist; can be set later.</small></div>
    <div class="field"><label for="nt-jira">Jira project</label><select id="nt-jira"><option value="">None (general updates only)</option></select><small>One project per team. Can be set later.</small></div>
    <div class="field"><label for="nt-sm">Scrum Master email</label><input id="nt-sm" name="scrumMasterEmail" type="email" placeholder="Leave empty to be the Scrum Master yourself"><small>May already run other teams, but must not be on any team's roster.</small></div>
    <p class="error" id="nt-error" role="alert" hidden style="color:var(--bad);margin:0"></p>
    <div class="dialog-actions">
      <button class="btn ghost" type="button" id="nt-cancel">Cancel</button>
      <button class="btn" type="submit" id="nt-create">${icon('plus')} Create team</button>
    </div>
  </form>
</dialog>
<div class="app">
  <aside>
    <div class="brand">
      <div class="logo">${icon('repeat')}</div>
      <div><b>Scrum Assistant</b><small>Admin console</small></div>
    </div>
    <div class="team-pick">
      <label for="team">Team</label>
      <select id="team" hidden></select>
      <div class="team-name" id="team-name">&nbsp;</div>
      <button class="btn ghost small" type="button" id="new-team-btn" hidden>${icon('plus')} New team</button>
    </div>
    <nav role="tablist">
      <button role="tab" data-tab="team" aria-selected="true">${icon('team')} Dev team</button>
      <button role="tab" data-tab="stakeholders">${icon('mail')} Stakeholders</button>
      <button role="tab" data-tab="schedule">${icon('clock')} Schedule</button>
      <button role="tab" data-tab="readiness">${icon('check')} Readiness</button>
      <button role="tab" data-tab="run">${icon('play')} Run now</button>
      <button role="tab" data-tab="activity">${icon('activity')} Activity</button>
      <button role="tab" data-tab="llm">${icon('cpu')} LLM usage</button>
    </nav>
    <div class="me">
      <div class="avatar" style="background:linear-gradient(135deg,#5b5bd6,#8b5cf6)">${escapeHtml(initials)}</div>
      <div class="who"><b>${escapeHtml(userName)}</b><small>Scrum Master</small></div>
      <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button>
    </div>
  </aside>

  <main>
    <div class="top">
      <div><h1 id="title">Dev team</h1><p id="subtitle">Who receives the stand-up reminders and sends updates.</p></div>
      <span class="badge" id="state-badge"></span>
    </div>

    <div id="nothing" class="card" hidden><div class="empty">You are not the Scrum Master of any team.</div></div>

    <div class="stats" id="stats">
      <div class="stat"><div class="ic">${icon('team')}</div><div><b id="s-members" class="skeleton">00</b><span>Team members</span></div></div>
      <div class="stat"><div class="ic ok" id="s-reach-ic">${icon('bell')}</div><div><b id="s-reach" class="skeleton">0 / 0</b><span>Can be messaged</span></div></div>
      <div class="stat"><div class="ic">${icon('mail')}</div><div><b id="s-stake" class="skeleton">00</b><span>Stakeholder emails</span></div></div>
      <div class="stat"><div class="ic">${icon('clock')}</div><div><b id="s-next" class="skeleton">00:00</b><span id="s-next-label">Daily stand-up</span></div></div>
    </div>

    <section id="tab-team" class="active">
      <div class="card">
        <div class="card-head">
          <div><h2>Scrum Master</h2><p>Runs the team and receives blocker alerts. Not on the roster: no reminders, no stand-up updates.</p></div>
          <button class="btn ghost" type="button" id="change-sm" hidden>Change</button>
        </div>
        <div class="card-body" id="sm-row"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h2>Teams team</h2><p>The team's own Teams team. Membership is checked for each member's onboarding.</p></div>
        </div>
        <div class="card-body" id="teams-team-row"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h2>Jira project</h2><p>Where this team's sprint and stories come from. Optional: without one, every update is saved as a general update.</p></div>
        </div>
        <div class="card-body" id="jira-project-row"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div><h2>Members</h2><p>Adding a member also adds them to the Teams team, installs the app and links Jira, where it can.</p></div>
          <form class="inline-add" id="add-member">
            <input type="email" name="email" placeholder="name@SyamPadala.onmicrosoft.com" required aria-label="Member email">
            <button class="btn" type="submit">${icon('plus')} Add</button>
          </form>
        </div>
        <table>
          <thead><tr><th>Member</th><th>Teams</th><th class="hide-sm">Jira account</th><th>Onboarding</th><th></th></tr></thead>
          <tbody id="members"></tbody>
        </table>
      </div>
      <div class="card" id="leaving-card" hidden>
        <div class="card-head">
          <div><h2>Leaving</h2><p>Removed members. The assistant removed what it could; the rest is to do by hand.</p></div>
        </div>
        <div class="card-body" id="leaving"></div>
      </div>
    </section>

    <section id="tab-stakeholders">
      <div class="card">
        <div class="card-head">
          <div><h2>Email recipients</h2><p>Receive the daily sprint summary in their inbox.</p></div>
          <form class="inline-add" id="add-stakeholder">
            <input type="email" name="email" placeholder="stakeholder@company.com" required aria-label="Stakeholder email">
            <button class="btn" type="submit">${icon('plus')} Add</button>
          </form>
        </div>
        <table><tbody id="stakeholders"></tbody></table>
      </div>
      <div class="card">
        <div class="card-body kv">
          <div class="ic">${icon('channel')}</div>
          <div style="flex:1"><b>Stakeholder channel in Teams</b><small id="channel-hint">The summary is also posted there; everyone in that Teams team can read it.</small></div>
          <span class="badge" id="channel"></span>
        </div>
        <div class="card-body inline-add" style="padding-top:0;max-width:none;flex-wrap:wrap">
          <select id="channel-pick" aria-label="Stakeholder channel" style="flex:1;min-width:0"><option value="">Loading channels…</option></select>
          <button class="btn" type="button" id="channel-connect">${icon('channel')} Connect</button>
          <button class="btn ghost" type="button" id="channel-disconnect">Disconnect</button>
        </div>
      </div>
    </section>

    <section id="tab-schedule">
      <form class="card" id="schedule">
        <div class="card-head"><div><h2>Daily cycle</h2><p>Times are in the team's timezone. Changes apply within five minutes.</p></div></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label for="standupTime">Stand-up reminder</label><input id="standupTime" name="standupTime" type="time" required><small>Prompt sent to every member</small></div>
            <div class="field"><label for="gracePeriodMinutes">Follow-up after</label><input id="gracePeriodMinutes" name="gracePeriodMinutes" type="number" min="5" max="1440" required><small>Minutes after the reminder</small></div>
            <div class="field"><label for="summaryTime">Daily summary</label><input id="summaryTime" name="summaryTime" type="time" required><small>Sent to stakeholders; closes the stand-up</small></div>
            <div class="field"><label for="timezone">Timezone</label><input id="timezone" name="timezone" required><small>For example Asia/Kolkata</small></div>
            <div class="field"><label for="habitualThreshold">Flag non-responders after</label><input id="habitualThreshold" name="habitualThreshold" type="number" min="1" required><small id="threshold-hint">Missed days</small></div>
            <div class="field"><label>Working days</label>
              <div class="days" id="working-days" role="group" aria-label="Working days"></div>
              <small>No reminders, follow-ups or summaries on other days</small>
            </div>
            <div class="field"><label>&nbsp;</label>
              <label class="switch" for="active"><input type="checkbox" id="active" name="active"><span><b id="active-label">Running</b><small>Reminders, follow-ups and summaries</small></span></label>
            </div>
          </div>
          <div class="form-foot"><button class="btn" type="submit">Save changes</button></div>
        </div>
      </form>
      <div class="card">
        <div class="card-head"><div><h2>Tracker</h2><p>Where each member's extracted update is written. Checked before it is saved.</p></div></div>
        <div class="card-body">
          <div class="choices" id="tracker-options" role="radiogroup" aria-label="Tracker destination"></div>
          <div id="tracker-list-row" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px"></div>
          <p class="muted" id="tracker-detail" style="margin:14px 0 0"></p>
        </div>
      </div>
    </section>

    <section id="tab-readiness">
      <div class="card">
        <div class="card-head"><div><h2>Is everything ready?</h2><p>Checks Jira, Teams chats, the tracker and today's schedule. Read-only: it sends nothing, changes nothing and makes no model calls.</p></div>
          <button class="btn" type="button" id="readiness-btn">${icon('check')} Check readiness</button></div>
        <table><tbody id="readiness-rows"><tr><td class="empty">Press Check readiness before a demo or at the start of the day.</td></tr></tbody></table>
      </div>
    </section>

    <section id="tab-run">
      <div class="card">
        <div class="card-head"><div><h2>Today's stand-up</h2><p id="standup-state">Checking…</p></div>
          <button class="btn" id="reopen-btn" hidden>${icon('repeat')} Reopen stand-up</button></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Run a job now</h2><p>For testing or a demo. It does not use up today's scheduled run and does not close the stand-up.</p></div></div>
        <div class="card-body">
          <div class="jobs">
            <div class="job"><div class="ic">${icon('bell')}</div><b>Reminder</b><span>Stand-up prompt to every member</span><button class="btn" data-job="reminder">${icon('play')} Run</button></div>
            <div class="job"><div class="ic">${icon('repeat')}</div><b>Follow-up</b><span>Chase members who have not replied</span><button class="btn" data-job="followup">${icon('play')} Run</button></div>
            <div class="job"><div class="ic">${icon('file')}</div><b>Summary</b><span>Build the summary and send it to stakeholders</span><button class="btn" data-job="summary">${icon('play')} Run</button></div>
            <div class="job"><div class="ic">${icon('chart')}</div><b>Participation</b><span>Count today's replies, flag non-responders</span><button class="btn" data-job="participation">${icon('play')} Run</button></div>
          </div>
          <div class="result" id="run-result"><span class="badge" id="run-badge"></span><span id="run-text"></span></div>
        </div>
      </div>
    </section>

    <section id="tab-activity">
      <div class="card">
        <div class="card-head"><div><h2>Today</h2><p id="today-hint">Scheduled jobs that have run today.</p></div></div>
        <table><tbody id="runs"></tbody></table>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Change history</h2><p>Who changed this team's settings, and when.</p></div></div>
        <ul class="timeline" id="changes"></ul>
      </div>
    </section>
    <section id="tab-llm">
      <div class="stats">
        <div class="stat"><div class="ic">${icon('cpu')}</div><div><b id="l-today" class="num">—</b><span id="l-today-label">Calls today</span></div></div>
        <div class="stat"><div class="ic">${icon('activity')}</div><div><b id="l-tokens" class="num">—</b><span>Tokens today</span></div></div>
        <div class="stat"><div class="ic">${icon('chart')}</div><div><b id="l-total" class="num">—</b><span id="l-total-label">Calls, last 14 days</span></div></div>
        <div class="stat"><div class="ic" id="l-live-ic">${icon('bell')}</div><div><b id="l-live">—</b><span id="l-model">Model</span></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Calls per day</h2><p>Every call to the model: reading an update (Agent 1) and writing the summary (Agent 2).</p></div></div>
        <div class="card-body">
          <div id="l-chart" class="chart" role="img" aria-label="Model calls per day, last 14 days"></div>
          <div id="l-axis" class="axis"></div>
          <div style="margin-top:22px"><div class="muted" id="l-cap"></div><div class="meter"><div id="l-meter" style="width:0"></div></div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Daily detail</h2><p>Counts and token totals only. No update text is stored.</p></div></div>
        <table>
          <thead><tr><th>Date</th><th class="right">Calls</th><th class="right hide-sm">Agent 1</th><th class="right hide-sm">Agent 2</th><th class="right">Input tokens</th><th class="right">Output tokens</th></tr></thead>
          <tbody id="l-rows"></tbody>
        </table>
      </div>
    </section>
  </main>
</div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
${adminScript(icon)}
</script>
</body>
</html>`
}
