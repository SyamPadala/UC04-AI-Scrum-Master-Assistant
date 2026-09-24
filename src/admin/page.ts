/**
 * The admin page (SPEC-008): one HTML document, a small script, no framework.
 *
 * Every value from the server is inserted with textContent, never innerHTML,
 * so a display name or email address cannot inject markup.
 */

function escapeHtml (text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

export function adminPage (userName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scrum Assistant Admin</title>
<style>
  :root {
    --bg: #f5f6f8; --panel: #ffffff; --text: #1d2330; --muted: #5d6675; --line: #e2e5ea;
    --accent: #3b5bdb; --accent-text: #ffffff; --ok: #2b8a3e; --warn: #c2410c; --bad: #c92a2a;
    --chip: #eef1f6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14171c; --panel: #1c2027; --text: #e6e8eb; --muted: #9aa3b0; --line: #2c323b;
      --accent: #748ffc; --accent-text: #0d1020; --ok: #69db7c; --warn: #ffa94d; --bad: #ff8787;
      --chip: #262b33;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 24px;
    background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header h1 { font-size: 17px; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  header .who { color: var(--muted); font-size: 14px; }
  select, input { font: inherit; color: var(--text); background: var(--panel);
    border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { font: inherit; border-radius: 6px; padding: 7px 14px; cursor: pointer;
    border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); }
  button.quiet { background: transparent; color: var(--text); border-color: var(--line); }
  button.danger { background: transparent; color: var(--bad); border-color: var(--line); }
  button:disabled { opacity: .5; cursor: wait; }
  nav { display: flex; gap: 4px; padding: 0 24px; background: var(--panel);
    border-bottom: 1px solid var(--line); overflow-x: auto; }
  nav button { background: none; border: none; border-bottom: 2px solid transparent;
    border-radius: 0; color: var(--muted); padding: 12px 14px; white-space: nowrap; }
  nav button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  main { max-width: 980px; margin: 0 auto; padding: 24px; }
  section { display: none; }
  section.active { display: block; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  .panel h2 { font-size: 16px; margin: 0 0 4px; }
  .panel p.hint { color: var(--muted); margin: 0 0 16px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  th { color: var(--muted); font-weight: 500; font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  .chip { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; background: var(--chip); }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; margin-top: 14px; }
  .row input[type=email] { flex: 1; min-width: 220px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
  .grid input, .grid select { width: 100%; }
  .jobs { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .job { border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  .job strong { display: block; margin-bottom: 4px; }
  .job span { display: block; color: var(--muted); font-size: 13px; margin-bottom: 10px; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: min(640px, 92vw);
    background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: 8px; display: none; }
  #toast.error { background: var(--bad); color: #fff; }
  .empty { color: var(--muted); padding: 8px 0; }
  .muted { color: var(--muted); font-size: 13px; }
  @media (max-width: 640px) {
    header, nav, main { padding-left: 16px; padding-right: 16px; }
    .hide-sm { display: none; }
  }
</style>
</head>
<body>
<header>
  <h1>Scrum Assistant Admin</h1>
  <select id="team" aria-label="Team"></select>
  <span class="spacer"></span>
  <span class="who">${escapeHtml(userName)}</span>
  <button class="quiet" id="logout">Sign out</button>
</header>
<nav role="tablist">
  <button role="tab" data-tab="team" aria-selected="true">Dev team</button>
  <button role="tab" data-tab="stakeholders">Stakeholders</button>
  <button role="tab" data-tab="schedule">Schedule</button>
  <button role="tab" data-tab="run">Run now</button>
  <button role="tab" data-tab="activity">Activity</button>
</nav>
<main>
  <p id="nothing" class="empty" hidden>You are not the Scrum Master of any team.</p>

  <section id="tab-team" class="active">
    <div class="panel">
      <h2>Dev team</h2>
      <p class="hint">Who receives the stand-up reminders and sends updates. A member can be messaged once the Teams app is installed for them.</p>
      <table>
        <thead><tr><th>Name</th><th class="hide-sm">Email</th><th>Teams</th><th>Jira account</th><th></th></tr></thead>
        <tbody id="members"></tbody>
      </table>
      <form class="row" id="add-member">
        <input type="email" name="email" placeholder="name@SyamPadala.onmicrosoft.com" required aria-label="Member email">
        <button type="submit">Add member</button>
      </form>
    </div>
  </section>

  <section id="tab-stakeholders">
    <div class="panel">
      <h2>Stakeholders</h2>
      <p class="hint">Who receives the daily sprint summary by email.</p>
      <table><tbody id="stakeholders"></tbody></table>
      <form class="row" id="add-stakeholder">
        <input type="email" name="email" placeholder="stakeholder@example.com" required aria-label="Stakeholder email">
        <button type="submit">Add stakeholder</button>
      </form>
    </div>
    <div class="panel">
      <h2>Stakeholder channel</h2>
      <p class="hint">The summary is also posted to the team's stakeholder channel in Teams. Everyone in that team can read it.</p>
      <p id="channel"></p>
    </div>
  </section>

  <section id="tab-schedule">
    <div class="panel">
      <h2>Schedule</h2>
      <p class="hint">Times are in the team's timezone. Changes apply from the next scheduler check, within five minutes.</p>
      <form id="schedule">
        <div class="grid">
          <div><label for="standupTime">Stand-up reminder</label><input id="standupTime" name="standupTime" type="time" required></div>
          <div><label for="gracePeriodMinutes">Follow-up after (minutes)</label><input id="gracePeriodMinutes" name="gracePeriodMinutes" type="number" min="5" max="1440" required></div>
          <div><label for="summaryTime">Daily summary (closes the stand-up)</label><input id="summaryTime" name="summaryTime" type="time" required></div>
          <div><label for="timezone">Timezone</label><input id="timezone" name="timezone" required></div>
          <div><label for="habitualThreshold">Flag after missed days</label><input id="habitualThreshold" name="habitualThreshold" type="number" min="1" required></div>
          <div><label for="active">Assistant</label><select id="active" name="active"><option value="true">Running</option><option value="false">Paused</option></select></div>
        </div>
        <div class="row"><button type="submit">Save schedule</button></div>
      </form>
    </div>
    <div class="panel">
      <h2>Tracker</h2>
      <p class="hint">Where extracted updates are written.</p>
      <p id="tracker"></p>
    </div>
  </section>

  <section id="tab-run">
    <div class="panel">
      <h2>Run now</h2>
      <p class="hint">Runs a job immediately, for testing or a demo. It does not use up today's scheduled run and does not close the stand-up.</p>
      <div class="jobs">
        <div class="job"><strong>Reminder</strong><span>Stand-up prompt to every member</span><button data-job="reminder">Run</button></div>
        <div class="job"><strong>Follow-up</strong><span>Chase members who have not replied</span><button data-job="followup">Run</button></div>
        <div class="job"><strong>Summary</strong><span>Build and send the daily summary</span><button data-job="summary">Run</button></div>
        <div class="job"><strong>Participation</strong><span>Count today's replies, flag non-responders</span><button data-job="participation">Run</button></div>
      </div>
      <p id="run-result" class="muted"></p>
    </div>
  </section>

  <section id="tab-activity">
    <div class="panel">
      <h2>Today</h2>
      <p class="hint" id="today-hint">Scheduled jobs that have run today.</p>
      <table><tbody id="runs"></tbody></table>
    </div>
    <div class="panel">
      <h2>Change history</h2>
      <p class="hint">Who changed this team's settings, and when.</p>
      <table><tbody id="changes"></tbody></table>
    </div>
  </section>
</main>
<div id="toast" role="status"></div>
<script>
(() => {
  const $ = (id) => document.getElementById(id)
  let teamId = null
  let view = null

  function toast (message, isError) {
    const el = $('toast')
    el.textContent = message
    el.className = isError ? 'error' : ''
    el.style.display = 'block'
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => { el.style.display = 'none' }, isError ? 8000 : 4000)
  }

  async function api (method, path, body) {
    const response = await fetch('/admin/api' + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (response.status === 401) { location.href = '/admin/login'; throw new Error('signed out') }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status))
    return data
  }

  function el (tag, text, className) {
    const node = document.createElement(tag)
    if (text !== undefined && text !== null) node.textContent = text
    if (className) node.className = className
    return node
  }

  function button (label, className, onClick) {
    const b = el('button', label, className)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }

  async function act (control, work) {
    if (control) control.disabled = true
    try {
      const result = await work()
      if (result && result.message) toast(result.message)
      await load()
    } catch (error) {
      if (error.message !== 'signed out') toast(error.message, true)
    } finally {
      if (control) control.disabled = false
    }
  }

  function renderMembers () {
    const body = $('members')
    body.replaceChildren()
    for (const m of view.members) {
      const tr = el('tr')
      const name = el('td', m.displayName)
      if (m.isScrumMaster) { name.append(' '); name.append(el('span', 'Scrum Master', 'chip')) }
      tr.append(name)
      tr.append(el('td', m.email || '—', 'hide-sm muted'))
      tr.append(el('td', m.reachable ? 'Can be messaged' : 'App not installed', m.reachable ? 'ok' : 'warn'))

      const jiraCell = el('td')
      const select = document.createElement('select')
      select.setAttribute('aria-label', 'Jira account for ' + m.displayName)
      select.append(new Option('Not linked', ''))
      for (const u of view.jiraUsers) select.append(new Option(u.displayName, u.accountId))
      if (m.jiraAccountId && !view.jiraUsers.some((u) => u.accountId === m.jiraAccountId)) {
        select.append(new Option('Linked (account not listed)', m.jiraAccountId))
      }
      select.value = m.jiraAccountId || ''
      select.addEventListener('change', () => act(select, () =>
        api('PUT', '/teams/' + teamId + '/members/' + encodeURIComponent(m.memberId) + '/jira', { jiraAccountId: select.value })))
      jiraCell.append(select)
      tr.append(jiraCell)

      const actions = el('td')
      if (!m.isScrumMaster) {
        actions.append(button('Remove', 'danger', (event) => {
          if (!confirm('Remove ' + m.displayName + ' from the team? They will stop receiving reminders.')) return
          act(event.currentTarget, () => api('DELETE', '/teams/' + teamId + '/members/' + encodeURIComponent(m.memberId)))
        }))
      }
      tr.append(actions)
      body.append(tr)
    }
  }

  function renderStakeholders () {
    const body = $('stakeholders')
    body.replaceChildren()
    if (view.stakeholders.emails.length === 0) {
      const tr = el('tr'); tr.append(el('td', 'No stakeholder emails yet. The summary goes to the channel only.', 'empty')); body.append(tr)
    }
    for (const email of view.stakeholders.emails) {
      const tr = el('tr')
      tr.append(el('td', email))
      const actions = el('td'); actions.style.textAlign = 'right'
      actions.append(button('Remove', 'danger', (event) =>
        act(event.currentTarget, () => api('DELETE', '/teams/' + teamId + '/stakeholders/' + encodeURIComponent(email)))))
      tr.append(actions)
      body.append(tr)
    }
    const channel = $('channel')
    channel.textContent = view.stakeholders.channelConnected
      ? 'Connected — the summary is posted to the stakeholder channel.'
      : 'Not connected — add the Scrum Assistant app to the team so it can post in the stakeholder channel.'
    channel.className = view.stakeholders.channelConnected ? 'ok' : 'warn'
  }

  function renderSchedule () {
    const s = view.schedule
    for (const key of ['standupTime', 'summaryTime', 'timezone', 'gracePeriodMinutes', 'habitualThreshold']) $(key).value = s[key]
    $('habitualThreshold').max = s.habitualWindowDays
    $('active').value = String(s.active)
    const labels = { sharepoint: 'SharePoint list — Daily Status Tracker', mock: 'Local test file (mock)' }
    $('tracker').textContent = labels[view.tracker] || view.tracker
  }

  function renderActivity () {
    $('today-hint').textContent = 'Scheduled jobs that have run today (' + view.today + ').'
    const runs = $('runs')
    runs.replaceChildren()
    if (view.runs.length === 0) { const tr = el('tr'); tr.append(el('td', 'Nothing has run yet today.', 'empty')); runs.append(tr) }
    for (const r of view.runs) {
      const tr = el('tr')
      tr.append(el('td', r.jobType))
      tr.append(el('td', r.outcome, r.outcome === 'success' ? 'ok' : r.outcome === 'failed' ? 'bad' : 'warn'))
      tr.append(el('td', r.detail || '', 'muted'))
      runs.append(tr)
    }
    const changes = $('changes')
    changes.replaceChildren()
    if (view.changes.length === 0) { const tr = el('tr'); tr.append(el('td', 'No changes recorded.', 'empty')); changes.append(tr) }
    for (const c of view.changes) {
      const tr = el('tr')
      tr.append(el('td', new Date(c.changedAt).toLocaleString(), 'muted'))
      tr.append(el('td', c.changedBy))
      tr.append(el('td', c.fields.join(', ')))
      changes.append(tr)
    }
  }

  async function load () {
    if (!teamId) return
    view = await api('GET', '/teams/' + teamId)
    renderMembers(); renderStakeholders(); renderSchedule(); renderActivity()
  }

  document.querySelectorAll('nav button').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((t) => t.setAttribute('aria-selected', String(t === tab)))
    document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab.dataset.tab))
  }))

  $('add-member').addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget
    act(form.querySelector('button'), async () => {
      const result = await api('POST', '/teams/' + teamId + '/members', { email: form.email.value })
      form.reset()
      return result
    })
  })

  $('add-stakeholder').addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget
    act(form.querySelector('button'), async () => {
      const result = await api('POST', '/teams/' + teamId + '/stakeholders', { email: form.email.value })
      form.reset()
      return result
    })
  })

  $('schedule').addEventListener('submit', (event) => {
    event.preventDefault()
    const f = event.currentTarget
    act(f.querySelector('button[type=submit]'), () => api('PATCH', '/teams/' + teamId + '/schedule', {
      standupTime: f.standupTime.value,
      summaryTime: f.summaryTime.value,
      timezone: f.timezone.value.trim(),
      gracePeriodMinutes: Number(f.gracePeriodMinutes.value),
      habitualThreshold: Number(f.habitualThreshold.value),
      active: f.active.value === 'true'
    }))
  })

  document.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => {
    const job = b.dataset.job
    $('run-result').textContent = 'Running ' + job + '…'
    act(b, async () => {
      const result = await api('POST', '/teams/' + teamId + '/run/' + job)
      $('run-result').textContent = result.message
      return result
    }).catch(() => {})
  }))

  $('team').addEventListener('change', (event) => { teamId = event.target.value; load().catch((e) => toast(e.message, true)) })

  $('logout').addEventListener('click', async () => {
    await fetch('/admin/logout', { method: 'POST', headers: { 'x-admin-request': '1' } })
    location.href = '/admin/login'
  })

  api('GET', '/teams').then(({ teams }) => {
    if (teams.length === 0) {
      $('nothing').hidden = false
      document.querySelector('nav').hidden = true
      document.querySelectorAll('main section').forEach((s) => s.remove())
      $('team').hidden = true
      return
    }
    for (const t of teams) $('team').append(new Option(t.name, t.teamId))
    $('team').hidden = teams.length === 1
    teamId = teams[0].teamId
    return load()
  }).catch((e) => { if (e.message !== 'signed out') toast(e.message, true) })
})()
</script>
</body>
</html>`
}
