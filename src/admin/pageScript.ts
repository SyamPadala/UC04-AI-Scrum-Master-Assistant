/**
 * The admin page's browser script (SPEC-008). Every value from the server is
 * inserted with textContent, never innerHTML. `icon` supplies the fixed icon set.
 */
export function adminScript (icon: (name: string) => string): string {
  return `(() => {
  const $ = (id) => document.getElementById(id)
  const TITLES = {
    team: ['Dev team', 'Who receives the stand-up reminders and sends updates.'],
    stakeholders: ['Stakeholders', 'Who receives the daily sprint summary.'],
    schedule: ['Schedule', 'When the assistant runs each part of the day.'],
    readiness: ['Readiness', 'Everything the day depends on, checked in one go.'],
    run: ['Run now', 'Trigger any job immediately.'],
    activity: ['Activity', 'What ran today and what changed.'],
    llm: ['LLM usage', 'How often the language model is called, and what it consumes.']
  }
  const PALETTE = ['#5b5bd6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444']
  const FIELD_NAMES = { standupTime: 'stand-up time', summaryTime: 'summary time', timezone: 'timezone',
    gracePeriodMinutes: 'follow-up delay', habitualThreshold: 'non-responder threshold', active: 'running state',
    members: 'team members', stakeholders: 'stakeholders' }
  let teamId = null
  let view = null

  function toast (message, isError) {
    const t = $('toast')
    t.textContent = message
    t.className = 'show' + (isError ? ' error' : '')
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => { t.className = '' }, isError ? 8000 : 3500)
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

  function colourFor (text) {
    let h = 0
    for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return PALETTE[h % PALETTE.length]
  }

  function avatar (name) {
    const a = el('div', name.split(/\\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase(), 'avatar')
    a.style.background = colourFor(name)
    return a
  }

  function person (name, sub) {
    const wrap = el('div', null, 'person')
    wrap.append(avatar(name))
    const text = el('div')
    text.style.minWidth = '0'
    text.append(el('b', name))
    if (sub) text.append(el('small', sub))
    wrap.append(text)
    return wrap
  }

  function badge (text, kind) { return el('span', text, 'badge ' + kind) }

  function removeButton (label, onClick) {
    const b = el('button', null, 'icon-btn')
    b.type = 'button'
    b.title = label
    b.setAttribute('aria-label', label)
    b.innerHTML = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    b.addEventListener('click', onClick)
    return b
  }

  async function act (control, work) {
    if (control) control.disabled = true
    try {
      const result = await work()
      if (result && result.message) toast(result.message)
      await load()
      return result
    } catch (error) {
      if (error.message !== 'signed out') toast(error.message, true)
      throw error
    } finally {
      if (control) control.disabled = false
    }
  }

  function renderStats () {
    const reachable = view.members.filter((m) => m.reachable).length
    const set = (id, text) => { const n = $(id); n.textContent = text; n.classList.remove('skeleton') }
    set('s-members', String(view.members.length))
    set('s-reach', reachable + ' / ' + view.members.length)
    $('s-reach-ic').className = 'ic ' + (reachable === view.members.length ? 'ok' : 'warn')
    set('s-stake', String(view.stakeholders.emails.length))
    set('s-next', view.schedule.standupTime)
    $('s-next-label').textContent = 'Stand-up · summary ' + view.schedule.summaryTime
    const state = $('state-badge')
    state.textContent = view.schedule.active ? 'Running' : 'Paused'
    state.className = 'badge ' + (view.schedule.active ? 'ok' : 'warn')
  }

  // SPEC-008 10l: closed by the scheduled summary; reopening lets updates in again.
  function renderStandup () {
    const s = view.standup
    const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    $('standup-state').textContent = s.reopenedAt
      ? 'Open. Reopened by ' + s.reopenedBy + ' at ' + time(s.reopenedAt) + '; the summary will not be sent again today.'
      : s.closed
        ? 'Closed at ' + (s.closedAt ? time(s.closedAt) : 'summary time') + ' (summary sent). Late updates are refused.'
        : 'Open. It closes when the scheduled summary is sent at ' + view.schedule.summaryTime + '.'
    $('reopen-btn').hidden = !s.closed
  }

  // SPEC-008 10f/10j: the Scrum Master is shown apart from the roster; only an
  // admin sees New team and Change (the server refuses them to anyone else).
  function renderScrumMaster () {
    $('new-team-btn').hidden = !view.meIsAdmin
    $('change-sm').hidden = !view.meIsAdmin
    const row = $('sm-row')
    row.replaceChildren()
    if (view.scrumMaster === null) { row.append(el('span', 'No Scrum Master is set.', 'muted')); return }
    const line = el('div')
    line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '12px'; line.style.flexWrap = 'wrap'
    line.append(person(view.scrumMaster.name, view.scrumMaster.email || ''))
    line.append(view.scrumMaster.reachable ? badge('Can be messaged', 'ok') : badge('App not installed', 'warn'))
    row.append(line)
  }

  $('change-sm').addEventListener('click', (event) => {
    const email = prompt('Email of the new Scrum Master for ' + view.name + '. They may already run other teams, but must not be on any roster.')
    if (email === null || email.trim() === '') return
    act(event.currentTarget, () => api('PUT', '/teams/' + teamId + '/scrum-master', { email: email.trim() }))
      .then(() => loadTeams(teamId)).catch(() => {})
  })

  function renderMembers () {
    const body = $('members')
    body.replaceChildren()
    for (const m of view.members) {
      const tr = el('tr')
      const who = el('td')
      const p = person(m.displayName, m.email || '')
      if (m.isScrumMaster) { p.querySelector('b').append(' '); p.querySelector('b').append(badge('Scrum Master', 'brand plain')) }
      who.append(p)
      tr.append(who)

      const status = el('td')
      status.append(m.reachable ? badge('Can be messaged', 'ok') : badge('App not installed', 'warn'))
      tr.append(status)

      const jiraCell = el('td', null, 'hide-sm')
      const select = document.createElement('select')
      select.setAttribute('aria-label', 'Jira account for ' + m.displayName)
      select.append(new Option('Not linked', ''))
      for (const u of view.jiraUsers) select.append(new Option(u.displayName, u.accountId))
      if (m.jiraAccountId && !view.jiraUsers.some((u) => u.accountId === m.jiraAccountId)) {
        select.append(new Option('Linked (not listed)', m.jiraAccountId))
      }
      select.value = m.jiraAccountId || ''
      select.addEventListener('change', () => act(select, () =>
        api('PUT', '/teams/' + teamId + '/members/' + encodeURIComponent(m.memberId) + '/jira', { jiraAccountId: select.value })).catch(() => {}))
      jiraCell.append(select)
      tr.append(jiraCell)

      // SPEC-008 10m: filled in by loadOnboarding once the checks return.
      const onboardCell = el('td')
      onboardCell.append(badge('Checking…', 'plain'))
      onboardCell.dataset.member = m.memberId
      tr.append(onboardCell)

      const actions = el('td', null, 'right')
      actions.append(removeButton('Remove ' + m.displayName, (event) => {
        if (!confirm('Remove ' + m.displayName + ' from the roster? They are also removed from the Teams team, the app is uninstalled and their Jira access is removed.')) return
        act(event.currentTarget, () => api('DELETE', '/teams/' + teamId + '/members/' + encodeURIComponent(m.memberId))).catch(() => {})
      }))
      tr.append(actions)
      body.append(tr)
      const details = el('tr')
      details.hidden = true
      details.dataset.details = m.memberId
      const cell = el('td')
      cell.colSpan = 5
      details.append(cell)
      body.append(details)
    }
  }

  // SPEC-008 10m: the Teams team, set by an admin; read-only for a Scrum Master.
  let teamsTeams = null
  async function teamsTeamList () {
    if (teamsTeams === null) teamsTeams = (await api('GET', '/teams-teams')).teams
    return teamsTeams
  }
  function renderTeamsTeam () {
    const row = $('teams-team-row')
    row.replaceChildren()
    const line = el('div')
    line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '12px'; line.style.flexWrap = 'wrap'
    const shown = view.teamsTeam || onboardingTeam
    if (!view.meIsAdmin) {
      line.append(shown ? el('b', shown.name) : el('span', 'Not set. An admin sets it.', 'muted'))
      row.append(line)
      return
    }
    const select = document.createElement('select')
    select.setAttribute('aria-label', 'Teams team')
    select.style.flex = '1'; select.style.minWidth = '0'
    select.append(new Option(shown ? shown.name : 'Loading Teams teams…', shown ? shown.id : ''))
    const save = el('button', 'Save', 'btn')
    save.type = 'button'
    save.addEventListener('click', () => act(save, () => api('PUT', '/teams/' + teamId + '/teams-team', { groupId: select.value })).catch(() => {}))
    line.append(select, save)
    row.append(line)
    teamsTeamList().then((teams) => {
      const current = shown ? shown.id : ''
      select.replaceChildren(new Option('Not set', ''), ...teams.map((t) => new Option(t.name, t.id)))
      select.value = current
    }).catch((e) => {
      select.replaceChildren(new Option(e.message, shown ? shown.id : ''))
      save.disabled = true
    })
  }

  let onboardingTeam = null
  async function loadOnboarding () {
    const forTeam = teamId
    onboardingTeam = null
    let result
    try {
      result = await api('GET', '/teams/' + forTeam + '/onboarding')
    } catch (e) {
      document.querySelectorAll('#members td[data-member]').forEach((cell) => { cell.replaceChildren(badge('Could not check', 'bad')); cell.title = e.message })
      return
    }
    if (forTeam !== teamId) return
    onboardingTeam = result.teamsTeam
    // Not set explicitly, but the team's own id is its Teams team (Scrum Team Alpha).
    if (!view.teamsTeam && result.teamsTeam) renderTeamsTeam()
    for (const cell of document.querySelectorAll('#members td[data-member]')) {
      const memberId = cell.dataset.member
      const member = result.members[memberId]
      if (!member) continue
      const ready = member.done === member.total
      const button = el('button', null, 'btn ghost small')
      button.type = 'button'
      button.append(badge(ready ? 'Ready' : member.done + ' of ' + member.total, ready ? 'ok' : 'warn'))
      button.setAttribute('aria-expanded', 'false')
      const details = document.querySelector('#members tr[data-details="' + memberId + '"]')
      button.addEventListener('click', () => {
        details.hidden = !details.hidden
        button.setAttribute('aria-expanded', String(!details.hidden))
      })
      cell.replaceChildren(button)
      renderSteps(details.firstChild, memberId, member.steps)
    }
  }

  function renderSteps (cell, memberId, steps) {
    const list = el('div')
    list.style.display = 'grid'; list.style.gap = '8px'; list.style.padding = '4px 0 8px'
    for (const step of steps) {
      const line = el('div')
      line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '10px'; line.style.flexWrap = 'wrap'
      line.append(badge(step.state === 'done' ? 'Done' : step.state === 'unknown' ? 'Could not check' : 'To do',
        step.state === 'done' ? 'ok' : step.state === 'unknown' ? 'bad' : 'warn'))
      line.append(el('b', step.label))
      line.append(el('span', step.detail, 'muted'))
      if (step.manual) {
        const label = el('label')
        label.style.display = 'flex'; label.style.alignItems = 'center'; label.style.gap = '6px'; label.style.marginLeft = 'auto'
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.checked = step.state === 'done'
        box.addEventListener('change', () => act(box, () =>
          api('PUT', '/teams/' + teamId + '/members/' + encodeURIComponent(memberId) + '/tracker-access', { done: box.checked })).catch(() => {}))
        label.append(box, el('span', 'Done'))
        line.append(label)
      }
      list.append(line)
    }
    // SPEC-008 10n: run the automatic steps again once whatever blocked them is fixed.
    if (steps.some((st) => st.state !== 'done' && ['teamsTeam', 'app', 'jira'].includes(st.key))) {
      const retry = el('button', 'Retry automatic steps', 'btn ghost small')
      retry.type = 'button'
      retry.style.justifySelf = 'start'
      retry.addEventListener('click', () => act(retry, () =>
        api('POST', '/teams/' + teamId + '/members/' + encodeURIComponent(memberId) + '/provision')).catch(() => {}))
      list.append(retry)
    }
    cell.replaceChildren(list)
  }

  // SPEC-008 10n: removed members' offboarding checklists.
  function renderLeaving () {
    const leaving = view.leaving || []
    $('leaving-card').hidden = leaving.length === 0
    const box = $('leaving')
    box.replaceChildren()
    for (const l of leaving) {
      const block = el('div')
      block.style.display = 'grid'; block.style.gap = '8px'; block.style.padding = '8px 0 14px'
      const head = el('div')
      head.style.display = 'flex'; head.style.alignItems = 'center'; head.style.gap = '12px'; head.style.flexWrap = 'wrap'
      head.append(person(l.displayName, 'Removed by ' + l.removedBy + ' on ' + new Date(l.removedAt).toLocaleDateString()))
      const finish = el('button', 'Mark finished', 'btn ghost small')
      finish.type = 'button'
      finish.style.marginLeft = 'auto'
      finish.addEventListener('click', () => {
        if (!confirm('Mark the offboarding of ' + l.displayName + ' as finished? They leave this list.')) return
        act(finish, () => api('POST', '/teams/' + teamId + '/leaving/' + encodeURIComponent(l.memberId) + '/finish')).catch(() => {})
      })
      head.append(finish)
      block.append(head)
      for (const item of l.items) {
        const line = el('div')
        line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '10px'; line.style.flexWrap = 'wrap'
        line.append(badge(item.state === 'auto' ? 'Done automatically' : 'To do by hand', item.state === 'auto' ? 'ok' : 'warn'))
        line.append(el('b', item.label))
        line.append(el('span', item.detail, 'muted'))
        block.append(line)
      }
      box.append(block)
    }
  }

  function renderStakeholders () {
    const body = $('stakeholders')
    body.replaceChildren()
    if (view.stakeholders.emails.length === 0) {
      const tr = el('tr'); const td = el('td', 'No email recipients yet — the summary goes to the Teams channel only.', 'empty'); tr.append(td); body.append(tr)
    }
    for (const email of view.stakeholders.emails) {
      const tr = el('tr')
      const who = el('td'); who.append(person(email, 'Daily summary by email')); tr.append(who)
      const actions = el('td', null, 'right')
      actions.append(removeButton('Remove ' + email, (event) =>
        act(event.currentTarget, () => api('DELETE', '/teams/' + teamId + '/stakeholders/' + encodeURIComponent(email))).catch(() => {})))
      tr.append(actions)
      body.append(tr)
    }
    const channel = $('channel')
    channel.textContent = view.stakeholders.channelConnected ? 'Connected' : 'Not connected'
    channel.className = 'badge ' + (view.stakeholders.channelConnected ? 'ok' : 'warn')
    $('channel-disconnect').hidden = !view.stakeholders.channelConnected
    renderChannelPick()
  }

  // Read from Teams only when the Stakeholders tab is opened: it is a live
  // call per Teams team, and the other tabs have no use for it.
  let channelList = null

  async function loadChannels () {
    const pick = $('channel-pick')
    pick.replaceChildren(new Option('Loading channels…', ''))
    try {
      channelList = await api('GET', '/teams/' + teamId + '/channels')
    } catch (error) {
      channelList = { channels: [], unavailable: [], error: error.message }
    }
    renderChannelPick()
  }

  function renderChannelPick () {
    if (channelList === null) return
    const pick = $('channel-pick')
    pick.replaceChildren()
    const current = view.stakeholders.channelId
    const list = channelList.channels
    pick.append(new Option(list.length === 0 ? 'No channels — add the app to a Teams team first' : 'Choose a channel…', ''))
    for (const c of list) pick.append(new Option(c.teamName + ' › ' + c.channelName, c.channelId))
    pick.value = list.some((c) => c.channelId === current) ? current : ''
    const connected = list.find((c) => c.channelId === current)
    const notes = []
    if (view.stakeholders.channelConnected && connected) notes.push('Posting to ' + connected.teamName + ' › ' + connected.channelName + '.')
    else notes.push('The summary is also posted there; everyone in that Teams team can read it.')
    if (channelList.unavailable.length > 0) notes.push('Not reachable: ' + channelList.unavailable.join(', ') + ' (app removed?).')
    if (channelList.error) notes.push('Could not read channels: ' + channelList.error)
    $('channel-hint').textContent = notes.join(' ')
  }

  $('channel-connect').addEventListener('click', (event) => {
    const channelId = $('channel-pick').value
    if (!channelId) { toast('Choose a channel first.', true); return }
    act(event.currentTarget, () => api('PUT', '/teams/' + teamId + '/channel', { channelId })).catch(() => {})
  })

  $('channel-disconnect').addEventListener('click', (event) => {
    if (!confirm('Disconnect the stakeholder channel? The summary will go by email only.')) return
    act(event.currentTarget, () => api('PUT', '/teams/' + teamId + '/channel', { channelId: '' })).catch(() => {})
  })

  function renderSchedule () {
    const s = view.schedule
    for (const key of ['standupTime', 'summaryTime', 'timezone', 'gracePeriodMinutes', 'habitualThreshold']) $(key).value = s[key]
    $('habitualThreshold').max = s.habitualWindowDays
    $('threshold-hint').textContent = 'Missed days within ' + s.habitualWindowDays + ' working days'
    $('active').checked = s.active
    $('active-label').textContent = s.active ? 'Running' : 'Paused'
    // SPEC-003 item 9: Monday first, as a working week reads.
    const days = $('working-days')
    days.replaceChildren()
    for (const [value, label] of [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]) {
      const box = document.createElement('label')
      box.className = 'day'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.value = String(value)
      input.checked = s.workingDays.includes(value)
      box.append(input, document.createTextNode(' ' + label))
      days.append(box)
    }
    renderTracker()
  }

  // Fixed icon markup from the server, never data: safe to set as HTML.
  const TRACKER_ICONS = { sharepoint: '${icon('db')}', jira: '${icon('file')}' }
  const TRACKER_HINTS = {
    sharepoint: 'One row per work item in the Daily Status Tracker list',
    jira: 'A comment on each work item; others on the stand-up issue'
  }

  // SPEC-008 10q (M11): only lists on the team's own SharePoint site are offered.
  function renderTrackerLists (open) {
    const row = $('tracker-list-row')
    row.replaceChildren()
    if (view.tracker !== 'sharepoint' && !open) {
      if (view.tracker === 'unset') row.append(el('span', "No tracker yet. Choose SharePoint and pick this team's own list.", 'muted'))
      return
    }
    const select = document.createElement('select')
    select.setAttribute('aria-label', 'Tracker list')
    select.style.flex = '1'; select.style.minWidth = '0'
    select.append(new Option("Loading lists on the team's site…", ''))
    const save = el('button', 'Use this list', 'btn')
    save.type = 'button'
    save.disabled = true
    save.addEventListener('click', () => {
      if (!confirm('Write new stand-up updates to this list?\\n\\nUpdates already recorded today stay where they are.')) return
      act(save, () => api('PUT', '/teams/' + teamId + '/tracker', { kind: 'sharepoint', listId: select.value })).catch(() => {})
    })
    row.append(select, save)
    api('GET', '/teams/' + teamId + '/tracker-lists').then((r) => {
      if (r.problem) { select.replaceChildren(new Option(r.problem, '')); return }
      const options = r.lists.map((l) => {
        const o = new Option(l.name + (l.missing.length ? ' — missing columns: ' + l.missing.join(', ') : ''), l.listId)
        o.disabled = l.missing.length > 0
        return o
      })
      select.replaceChildren(new Option(r.lists.length ? 'Choose a list on ' + r.site : 'No lists on ' + r.site + ' yet — create one with the tracker columns', ''), ...options)
      select.value = view.trackerListId || ''
      save.disabled = select.value === '' || select.value === view.trackerListId
      select.addEventListener('change', () => { save.disabled = select.value === '' || select.value === view.trackerListId })
    }).catch((e) => { select.replaceChildren(new Option(e.message, '')) })
  }

  // SPEC-008 10p (M10): admin picks the project; the Scrum Master sees it.
  let jiraProjectList = null
  async function jiraProjectsList () {
    if (jiraProjectList === null) jiraProjectList = (await api('GET', '/jira-projects')).projects
    return jiraProjectList
  }
  const projectValue = (p, b) => p.key + '|' + b.id
  function renderJiraProject () {
    const row = $('jira-project-row')
    row.replaceChildren()
    const current = view.jira
    const label = current ? current.projectKey + (current.boardName ? ' — ' + current.boardName : '') : 'None: every update is saved as a general update'
    if (!view.meIsAdmin) { row.append(current ? el('b', label) : el('span', label, 'muted')); return }
    const line = el('div')
    line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '12px'; line.style.flexWrap = 'wrap'
    const select = document.createElement('select')
    select.setAttribute('aria-label', 'Jira project')
    select.style.flex = '1'; select.style.minWidth = '0'
    select.append(new Option(label, current ? current.projectKey + '|' + (current.boardId || '') : ''))
    const save = el('button', 'Save', 'btn')
    save.type = 'button'
    save.addEventListener('click', () => {
      const [projectKey, boardId] = select.value.split('|')
      act(save, () => api('PUT', '/teams/' + teamId + '/jira', { projectKey: projectKey || '', boardId: boardId || '' })).catch(() => {})
    })
    line.append(select, save)
    row.append(line)
    jiraProjectsList().then((projects) => {
      const options = [new Option('None (general updates only)', '')]
      for (const p of projects) {
        if (p.boards.length === 0) { const o = new Option(p.key + ' — ' + p.name + ' (no sprint board)', ''); o.disabled = true; options.push(o) }
        for (const b of p.boards) options.push(new Option(p.key + ' — ' + p.name + (p.boards.length > 1 ? ' · ' + b.name : ''), projectValue(p, b)))
      }
      select.replaceChildren(...options)
      select.value = current ? current.projectKey + '|' + (current.boardId || '') : ''
    }).catch((e) => { select.replaceChildren(new Option(e.message, '')); save.disabled = true })
  }

  function renderTracker () {
    const box = $('tracker-options')
    box.replaceChildren()
    for (const option of view.trackerOptions) {
      const b = el('button', null, 'choice')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(view.tracker === option.kind))
      b.disabled = !option.available
      const ic = el('div', null, 'ic')
      ic.innerHTML = TRACKER_ICONS[option.kind] || ''
      const text = el('div')
      text.append(el('b', option.label))
      text.append(el('small', option.available ? TRACKER_HINTS[option.kind] : 'Not configured on this server'))
      b.append(ic, text, el('span', null, 'dot'))
      b.addEventListener('click', () => {
        if (view.tracker === option.kind) return
        // M11: a SharePoint list is picked from the team's own site, below.
        if (option.kind === 'sharepoint') { renderTrackerLists(true); return }
        if (!confirm('Write new stand-up updates to: ' + option.label + '?\\n\\nUpdates already recorded today stay where they are.')) return
        act(b, () => api('PUT', '/teams/' + teamId + '/tracker', { kind: option.kind })).catch(() => {})
      })
      box.append(b)
    }
    const detail = $('tracker-detail')
    detail.replaceChildren()
    if (view.trackerDetail) {
      detail.append('Updates naming no work item go to ')
      const link = el('a', view.trackerDetail.split('/').pop())
      link.href = view.trackerDetail
      link.target = '_blank'
      link.rel = 'noopener'
      detail.append(link)
      detail.append('.')
    }
  }

  function outcomeKind (outcome) { return outcome === 'success' ? 'ok' : outcome === 'failed' ? 'bad' : 'warn' }

  function renderActivity () {
    $('today-hint').textContent = 'Scheduled jobs that have run today, ' + view.today + '.'
    const runs = $('runs')
    runs.replaceChildren()
    if (view.runs.length === 0) { const tr = el('tr'); tr.append(el('td', 'Nothing has run yet today.', 'empty')); runs.append(tr) }
    for (const r of view.runs) {
      const tr = el('tr')
      const name = el('td'); name.append(el('b', r.jobType.charAt(0).toUpperCase() + r.jobType.slice(1))); tr.append(name)
      const out = el('td'); out.append(badge(r.outcome, outcomeKind(r.outcome))); tr.append(out)
      tr.append(el('td', r.detail || '', 'hide-sm'))
      runs.append(tr)
    }
    const list = $('changes')
    list.replaceChildren()
    if (view.changes.length === 0) list.append(el('li', 'No changes recorded yet.'))
    for (const c of view.changes) {
      const li = el('li')
      li.append(el('b', c.changedBy))
      li.append(el('small', new Date(c.changedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })))
      const tags = el('div', null, 'tags')
      for (const f of c.fields) tags.append(badge(FIELD_NAMES[f] || f, 'brand plain'))
      li.append(tags)
      list.append(li)
    }
  }

  const fmt = (n) => Number(n).toLocaleString()

  async function loadLlm () {
    const u = await api('GET', '/llm')
    const days = u.days
    const today = days[days.length - 1]
    const total = days.reduce((sum, d) => sum + d.calls, 0)
    $('l-today').textContent = fmt(today.calls)
    $('l-today-label').textContent = 'Calls today · limit ' + fmt(u.maxCallsPerDay)
    $('l-tokens').textContent = fmt(today.inputTokens + today.outputTokens)
    $('l-total').textContent = fmt(total)
    $('l-total-label').textContent = 'Calls, last ' + days.length + ' days'
    $('l-live').textContent = u.live ? 'Live' : 'Offline'
    $('l-live-ic').className = 'ic ' + (u.live ? 'ok' : 'warn')
    $('l-model').textContent = u.provider + ' · ' + u.model

    const max = Math.max(1, ...days.map((d) => d.calls))
    const step = max <= 5 ? 1 : Math.ceil(max / 4)
    const top = Math.ceil(max / step) * step
    const chart = $('l-chart')
    chart.replaceChildren()
    for (let v = step; v <= top; v += step) {
      const g = el('div', null, 'gridline')
      g.style.bottom = (v / top * 100) + '%'
      g.append(el('span', String(v)))
      chart.append(g)
    }
    const axis = $('l-axis')
    axis.replaceChildren()
    days.forEach((d, i) => {
      const slot = el('div', null, 'bar-slot')
      const bar = el('div', null, 'bar' + (d.calls === 0 ? ' zero' : ''))
      bar.style.height = (d.calls / top * 100) + '%'
      const tip = el('div', null, 'tip')
      tip.append(el('div', d.localDate))
      tip.append(el('div', fmt(d.calls) + ' calls · ' + fmt(d.inputTokens + d.outputTokens) + ' tokens'))
      slot.append(bar, tip)
      chart.append(slot)
      axis.append(el('span', (days.length - 1 - i) % 2 === 0 ? d.localDate.slice(5) : ''))
    })

    const used = Math.min(100, today.calls / u.maxCallsPerDay * 100)
    $('l-meter').style.width = used + '%'
    $('l-cap').textContent = 'Today: ' + fmt(today.calls) + ' of ' + fmt(u.maxCallsPerDay) + ' calls allowed (' + used.toFixed(1) + '%). The daily limit stops runaway spending.'

    const rows = $('l-rows')
    rows.replaceChildren()
    for (const d of [...days].reverse()) {
      const tr = el('tr')
      tr.append(el('td', d.localDate))
      tr.append(el('td', fmt(d.calls), 'right num'))
      tr.append(el('td', fmt(d.byLabel.agent1 || 0), 'right num hide-sm'))
      tr.append(el('td', fmt(d.byLabel.agent2 || 0), 'right num hide-sm'))
      tr.append(el('td', fmt(d.inputTokens), 'right num'))
      tr.append(el('td', fmt(d.outputTokens), 'right num'))
      rows.append(tr)
    }
  }

  async function load () {
    if (!teamId) return
    view = await api('GET', '/teams/' + teamId)
    renderStats(); renderStandup(); renderScrumMaster(); renderMembers(); renderStakeholders(); renderSchedule(); renderActivity()
    renderTeamsTeam()
    renderJiraProject()
    renderTrackerLists(false)
    renderLeaving()
    loadOnboarding()
  }

  document.querySelectorAll('nav button').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((t) => t.setAttribute('aria-selected', String(t === tab)))
    document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab.dataset.tab))
    const [title, subtitle] = TITLES[tab.dataset.tab]
    $('title').textContent = title
    $('subtitle').textContent = subtitle
    $('stats').hidden = tab.dataset.tab === 'llm'
    if (tab.dataset.tab === 'llm') loadLlm().catch((e) => toast(e.message, true))
    if (tab.dataset.tab === 'stakeholders') loadChannels()
  }))

  function addForm (id, path) {
    $(id).addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.currentTarget
      act(form.querySelector('button'), async () => {
        const result = await api('POST', '/teams/' + teamId + path, { email: form.email.value })
        form.reset()
        return result
      }).catch(() => {})
    })
  }
  addForm('add-member', '/members')
  addForm('add-stakeholder', '/stakeholders')

  $('active').addEventListener('change', () => { $('active-label').textContent = $('active').checked ? 'Running' : 'Paused' })

  $('schedule').addEventListener('submit', (event) => {
    event.preventDefault()
    const f = event.currentTarget
    act(f.querySelector('button[type=submit]'), () => api('PATCH', '/teams/' + teamId + '/schedule', {
      standupTime: f.standupTime.value,
      summaryTime: f.summaryTime.value,
      timezone: f.timezone.value.trim(),
      gracePeriodMinutes: Number(f.gracePeriodMinutes.value),
      habitualThreshold: Number(f.habitualThreshold.value),
      active: f.active.checked,
      workingDays: [...document.querySelectorAll('#working-days input:checked')].map((i) => Number(i.value))
    })).catch(() => {})
  })

  // SPEC-008 10d: one row per check, green or red, with the fix in words.
  $('readiness-btn').addEventListener('click', () => {
    const button = $('readiness-btn')
    const rows = $('readiness-rows')
    button.disabled = true
    rows.replaceChildren()
    const waiting = el('tr'); waiting.append(el('td', 'Checking…', 'empty')); rows.append(waiting)
    api('GET', '/teams/' + teamId + '/readiness').then((result) => {
      rows.replaceChildren()
      for (const r of result.rows) {
        const tr = el('tr')
        const name = el('td'); name.append(el('b', r.check)); tr.append(name)
        const state = el('td'); state.append(badge(r.ok ? 'Ready' : 'Fix', r.ok ? 'ok' : 'bad')); tr.append(state)
        tr.append(el('td', r.detail))
        rows.append(tr)
      }
      const red = result.rows.filter((r) => !r.ok).length
      toast(red === 0 ? 'Everything is ready.' : red + (red === 1 ? ' thing needs' : ' things need') + ' fixing.', red > 0)
    }).catch((e) => {
      rows.replaceChildren()
      const tr = el('tr'); tr.append(el('td', e.message, 'empty')); rows.append(tr)
    }).finally(() => { button.disabled = false })
  })

  $('reopen-btn').addEventListener('click', () => {
    act($('reopen-btn'), () => api('POST', '/teams/' + teamId + '/reopen')).catch(() => {})
  })

  document.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => {
    const job = b.dataset.job
    const box = $('run-result')
    box.className = 'result show'
    $('run-badge').textContent = 'Running'
    $('run-badge').className = 'badge brand'
    $('run-text').textContent = 'Running the ' + job + '…'
    act(b, () => api('POST', '/teams/' + teamId + '/run/' + job)).then((result) => {
      const failed = /: failed/.test(result.message)
      const partial = /: partial/.test(result.message)
      $('run-badge').textContent = failed ? 'Failed' : partial ? 'Partial' : 'Done'
      $('run-badge').className = 'badge ' + (failed ? 'bad' : partial ? 'warn' : 'ok')
      $('run-text').textContent = result.message
    }).catch((error) => {
      $('run-badge').textContent = 'Failed'
      $('run-badge').className = 'badge bad'
      $('run-text').textContent = error.message
    })
  }))

  $('team').addEventListener('change', (event) => {
    teamId = event.target.value
    $('team-name').textContent = event.target.selectedOptions[0].textContent
    load().catch((e) => toast(e.message, true))
  })

  $('logout').addEventListener('click', async () => {
    await fetch('/admin/logout', { method: 'POST', headers: { 'x-admin-request': '1' } })
    location.href = '/admin/login'
  })

  async function loadTeams (selectId) {
    const { teams, isAdmin } = await api('GET', '/teams')
    // Known before any team loads, so an admin can create the first team.
    $('new-team-btn').hidden = !isAdmin
    if (teams.length === 0) {
      $('nothing').hidden = false
      $('stats').hidden = true
      document.querySelector('nav').hidden = true
      document.querySelectorAll('main section').forEach((s) => { s.hidden = true })
      $('team-name').textContent = '—'
      return
    }
    const pick = $('team')
    pick.replaceChildren(...teams.map((t) => new Option(t.name, t.teamId)))
    pick.hidden = teams.length < 2
    $('team-name').hidden = teams.length > 1
    const chosen = teams.find((t) => t.teamId === (selectId ?? teamId)) ?? teams[0]
    pick.value = chosen.teamId
    $('team-name').textContent = chosen.name
    teamId = chosen.teamId
    return load()
  }

  const dialog = $('new-team')
  $('new-team-btn').addEventListener('click', () => {
    $('new-team-form').reset(); $('nt-tz').value = 'Asia/Kolkata'; $('nt-error').hidden = true; dialog.showModal()
    teamsTeamList().then((teams) => {
      $('nt-teams').replaceChildren(new Option('Not set', ''), ...teams.map((t) => new Option(t.name, t.id)))
    }).catch((e) => { $('nt-teams').replaceChildren(new Option('Not set (' + e.message + ')', '')) })
    jiraProjectsList().then((projects) => {
      const options = [new Option('None (general updates only)', '')]
      for (const p of projects) for (const b of p.boards) options.push(new Option(p.key + ' — ' + p.name + (p.boards.length > 1 ? ' · ' + b.name : ''), projectValue(p, b)))
      $('nt-jira').replaceChildren(...options)
    }).catch(() => {})
  })
  $('nt-cancel').addEventListener('click', () => dialog.close())
  $('new-team-form').addEventListener('submit', (event) => {
    event.preventDefault()
    // Read by id: on a form, f.name is the form's own name attribute, not the
    // "name" input, which sent every team without a name (found 28 Sep 2026).
    const [jiraProjectKey, jiraBoardId] = $('nt-jira').value.split('|')
    const body = { name: $('nt-name').value, timezone: $('nt-tz').value, scrumMasterEmail: $('nt-sm').value, teamsGroupId: $('nt-teams').value, jiraProjectKey: jiraProjectKey || '', jiraBoardId: jiraBoardId || '' }
    const button = $('nt-create')
    const error = $('nt-error')
    error.hidden = true
    button.disabled = true
    api('POST', '/teams', body)
      .then((result) => { dialog.close(); toast(result.message); return loadTeams(result.teamId) })
      // Shown inside the dialog: a toast sits behind a modal and is never seen.
      .catch((e) => { if (e.message !== 'signed out') { error.textContent = e.message; error.hidden = false } })
      .finally(() => { button.disabled = false })
  })

  loadTeams().catch((e) => { if (e.message !== 'signed out') toast(e.message, true) })
})()`
}
