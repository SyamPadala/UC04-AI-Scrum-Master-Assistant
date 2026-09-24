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
  :root {
    --bg: #f6f7fb; --surface: #ffffff; --surface-2: #f9fafc; --text: #0f172a; --muted: #64748b;
    --line: #e7eaf0; --brand: #5b5bd6; --brand-2: #8b5cf6; --brand-soft: #eef0ff; --on-brand: #ffffff;
    --ok: #16a34a; --ok-soft: #e8f7ee; --warn: #d97706; --warn-soft: #fdf3e2; --bad: #dc2626; --bad-soft: #fdecec;
    --shadow: 0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06);
    --radius: 14px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0e14; --surface: #131722; --surface-2: #181d2a; --text: #e8ecf3; --muted: #94a0b4;
      --line: #252b3a; --brand: #8b8cf8; --brand-2: #a78bfa; --brand-soft: #1f2340; --on-brand: #0b0e14;
      --ok: #4ade80; --ok-soft: #12291c; --warn: #fbbf24; --warn-soft: #2c2410; --bad: #f87171; --bad-soft: #2d1515;
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25);
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14.5px/1.55 Inter, "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  .i { width: 18px; height: 18px; flex: none; }
  .app { display: grid; grid-template-columns: 256px 1fr; min-height: 100vh; }

  /* Sidebar */
  aside { background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column;
    padding: 20px 14px; position: sticky; top: 0; height: 100vh; }
  .brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 20px; }
  .logo { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: #fff;
    background: linear-gradient(135deg, var(--brand), var(--brand-2)); box-shadow: 0 6px 16px rgba(91,91,214,.35); }
  .brand b { display: block; font-size: 15px; letter-spacing: -.01em; }
  .brand small { color: var(--muted); font-size: 12px; }
  .team-pick { margin: 0 4px 18px; }
  .team-pick label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); display: block; margin: 0 0 6px 4px; }
  .team-pick select { width: 100%; }
  .team-name { padding: 9px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); font-weight: 600; }
  nav { display: flex; flex-direction: column; gap: 2px; }
  nav button { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px 12px;
    border: 0; border-radius: 10px; background: none; color: var(--muted); font: inherit; font-weight: 500; cursor: pointer; }
  nav button:hover { background: var(--surface-2); color: var(--text); }
  nav button[aria-selected="true"] { background: var(--brand-soft); color: var(--brand); }
  .me { margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 12px 8px 0; border-top: 1px solid var(--line); }
  .me .who { flex: 1; min-width: 0; }
  .me .who b { display: block; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .me .who small { color: var(--muted); font-size: 12px; }

  /* Main */
  main { padding: 28px 36px 60px; max-width: 1180px; width: 100%; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .top h1 { font-size: 24px; letter-spacing: -.02em; margin: 0; }
  .top p { margin: 4px 0 0; color: var(--muted); }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow);
    display: flex; gap: 14px; align-items: center; }
  .stat .ic { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
  .stat .ic.ok { background: var(--ok-soft); color: var(--ok); }
  .stat .ic.warn { background: var(--warn-soft); color: var(--warn); }
  .stat b { display: block; font-size: 20px; letter-spacing: -.02em; line-height: 1.2; }
  .stat > div:last-child { min-width: 0; }
  .stat span { display: block; color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .card-head h2 { font-size: 15.5px; margin: 0; letter-spacing: -.01em; }
  .card-head p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
  .card-body { padding: 20px 22px; }
  section { display: none; animation: fade .18s ease; }
  section.active { display: block; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* Controls */
  input, select { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line);
    border-radius: 10px; padding: 9px 12px; transition: border-color .15s, box-shadow .15s; }
  input:focus, select:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-soft); }
  .btn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-weight: 600; border-radius: 10px; padding: 9px 16px;
    cursor: pointer; border: 1px solid transparent; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff;
    box-shadow: 0 4px 12px rgba(91,91,214,.25); transition: transform .08s, box-shadow .15s, opacity .15s; }
  .btn:hover { box-shadow: 0 6px 18px rgba(91,91,214,.35); }
  .btn:active { transform: translateY(1px); }
  .btn.ghost { background: var(--surface); color: var(--text); border-color: var(--line); box-shadow: none; }
  .btn.ghost:hover { background: var(--surface-2); }
  .btn:disabled { opacity: .55; cursor: progress; }
  .icon-btn { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; border: 1px solid transparent;
    background: none; color: var(--muted); cursor: pointer; }
  .icon-btn:hover { background: var(--bad-soft); color: var(--bad); }
  .inline-add { display: flex; gap: 10px; flex: 1; max-width: 460px; min-width: 260px; }
  .inline-add input { flex: 1; min-width: 0; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted);
    padding: 12px 22px; background: var(--surface-2); border-bottom: 1px solid var(--line); }
  td { padding: 14px 22px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: var(--surface-2); }
  .person { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .avatar { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; font-size: 13px; color: #fff; flex: none; }
  .person b { display: block; font-weight: 600; }
  .person small { display: block; color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .badge.ok { background: var(--ok-soft); color: var(--ok); }
  .badge.warn { background: var(--warn-soft); color: var(--warn); }
  .badge.bad { background: var(--bad-soft); color: var(--bad); }
  .badge.brand { background: var(--brand-soft); color: var(--brand); }
  .badge.plain::before { display: none; }
  .right { text-align: right; }
  .empty { padding: 28px 22px; text-align: center; color: var(--muted); }

  /* Schedule */
  .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 20px; }
  .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .field small { display: block; color: var(--muted); font-size: 12px; margin-top: 5px; }
  .field input, .field select { width: 100%; }
  .field .switch, .switch { display: flex; margin: 0; font-size: inherit; color: inherit; font-weight: 400; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); }
  .switch input { appearance: none; width: 44px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; padding: 0; border: 0; flex: none; transition: background .2s; }
  .switch input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
  .switch input:checked { background: var(--ok); }
  .switch input:checked::after { transform: translateX(20px); }
  .switch b { display: block; } .switch small { color: var(--muted); font-size: 12.5px; }
  .form-foot { display: flex; justify-content: flex-end; padding-top: 18px; margin-top: 20px; border-top: 1px solid var(--line); }
  .kv { display: flex; align-items: center; gap: 14px; }
  .kv .ic { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); flex: none; }
  .kv b { display: block; } .kv small { color: var(--muted); }
  .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .choice { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; font: inherit; color: var(--text);
    padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); cursor: pointer;
    transition: border-color .15s, box-shadow .15s; }
  .choice:hover { border-color: var(--brand); }
  .choice[aria-checked="true"] { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
  .choice:disabled { opacity: .5; cursor: not-allowed; }
  .choice .ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); flex: none; }
  .choice b { display: block; } .choice small { display: block; color: var(--muted); font-size: 12.5px; }
  .choice .dot { margin-left: auto; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line); flex: none; }
  .choice[aria-checked="true"] .dot { border: 5px solid var(--brand); }

  /* Run now */
  .jobs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
  .job { border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: var(--surface); display: flex; flex-direction: column; gap: 10px;
    transition: border-color .15s, transform .15s, box-shadow .15s; }
  .job:hover { border-color: var(--brand); transform: translateY(-2px); box-shadow: var(--shadow); }
  .job .ic { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
  .job b { font-size: 15px; } .job span { color: var(--muted); font-size: 13px; flex: 1; }
  .job .btn { justify-content: center; }
  .result { margin-top: 18px; padding: 14px 16px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); display: none; gap: 10px; align-items: flex-start; }
  .result.show { display: flex; }

  /* Timeline */
  .timeline { list-style: none; margin: 0; padding: 6px 22px 10px; }
  .timeline li { position: relative; padding: 12px 0 12px 26px; border-left: 2px solid var(--line); margin-left: 6px; }
  .timeline li::before { content: ""; position: absolute; left: -7px; top: 17px; width: 12px; height: 12px; border-radius: 50%; background: var(--surface); border: 2px solid var(--brand); }
  .timeline b { font-weight: 600; } .timeline small { display: block; color: var(--muted); font-size: 12.5px; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }

  .chart { position: relative; height: 220px; display: flex; align-items: flex-end; gap: 2px; padding: 0 4px;
    border-bottom: 1px solid var(--line); margin-top: 18px; }
  .chart .gridline { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--line); pointer-events: none; }
  .chart .gridline span { position: absolute; left: 0; top: -17px; font-size: 11px; color: var(--muted); }
  .bar-slot { flex: 1; height: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative; }
  .bar { width: min(28px, 70%); background: var(--brand); border-radius: 4px 4px 0 0; transition: opacity .15s; }
  .bar.zero { height: 2px !important; background: var(--line); border-radius: 1px; }
  .chart:hover .bar { opacity: .45; }
  .bar-slot:hover .bar { opacity: 1; }
  .tip { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg);
    padding: 8px 10px; border-radius: 8px; font-size: 12px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .12s; z-index: 2; }
  .bar-slot:hover .tip { opacity: 1; }
  .axis { display: flex; gap: 2px; padding: 6px 4px 0; }
  .axis span { flex: 1; text-align: center; font-size: 11px; color: var(--muted); }
  .meter { height: 8px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); overflow: hidden; margin-top: 8px; }
  .meter div { height: 100%; background: var(--brand); border-radius: 999px; }
  .num { font-variant-numeric: tabular-nums; }
  #toast { position: fixed; right: 24px; bottom: 24px; max-width: min(460px, calc(100vw - 32px)); padding: 13px 16px; border-radius: 12px;
    background: var(--text); color: var(--bg); box-shadow: 0 12px 32px rgba(0,0,0,.25); font-weight: 500;
    transform: translateY(20px); opacity: 0; pointer-events: none; transition: all .2s ease; z-index: 10; }
  #toast.show { transform: none; opacity: 1; }
  #toast.error { background: var(--bad); color: #fff; }
  .skeleton { color: transparent !important; background: linear-gradient(90deg, var(--surface-2), var(--line), var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s infinite; border-radius: 6px; }
  @keyframes shimmer { to { background-position: -200% 0; } }

  @media (max-width: 1000px) {
    .stats, .jobs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .app { grid-template-columns: 1fr; }
    aside { position: static; height: auto; padding: 14px 16px; border-right: 0; border-bottom: 1px solid var(--line); }
    .brand { padding-bottom: 12px; }
    nav { flex-direction: row; overflow-x: auto; gap: 4px; }
    nav button { width: auto; white-space: nowrap; }
    .me { display: none; }
    main { padding: 20px 16px 48px; }
    .form-grid, .jobs { grid-template-columns: 1fr; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .hide-sm { display: none; }
    th, td { padding-left: 14px; padding-right: 14px; }
  }
</style>
</head>
<body>
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
    </div>
    <nav role="tablist">
      <button role="tab" data-tab="team" aria-selected="true">${icon('team')} Dev team</button>
      <button role="tab" data-tab="stakeholders">${icon('mail')} Stakeholders</button>
      <button role="tab" data-tab="schedule">${icon('clock')} Schedule</button>
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
          <div><h2>Members</h2><p>A member can be messaged once the Teams app is installed for them.</p></div>
          <form class="inline-add" id="add-member">
            <input type="email" name="email" placeholder="name@SyamPadala.onmicrosoft.com" required aria-label="Member email">
            <button class="btn" type="submit">${icon('plus')} Add</button>
          </form>
        </div>
        <table>
          <thead><tr><th>Member</th><th>Teams</th><th class="hide-sm">Jira account</th><th></th></tr></thead>
          <tbody id="members"></tbody>
        </table>
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
          <div style="flex:1"><b>Stakeholder channel in Teams</b><small>The summary is also posted there; everyone in the team can read it.</small></div>
          <span class="badge" id="channel"></span>
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
          <p class="muted" id="tracker-detail" style="margin:14px 0 0"></p>
        </div>
      </div>
    </section>

    <section id="tab-run">
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
(() => {
  const $ = (id) => document.getElementById(id)
  const TITLES = {
    team: ['Dev team', 'Who receives the stand-up reminders and sends updates.'],
    stakeholders: ['Stakeholders', 'Who receives the daily sprint summary.'],
    schedule: ['Schedule', 'When the assistant runs each part of the day.'],
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

      const actions = el('td', null, 'right')
      if (!m.isScrumMaster) {
        actions.append(removeButton('Remove ' + m.displayName, (event) => {
          if (!confirm('Remove ' + m.displayName + ' from the team? They will stop receiving reminders.')) return
          act(event.currentTarget, () => api('DELETE', '/teams/' + teamId + '/members/' + encodeURIComponent(m.memberId))).catch(() => {})
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
  }

  function renderSchedule () {
    const s = view.schedule
    for (const key of ['standupTime', 'summaryTime', 'timezone', 'gracePeriodMinutes', 'habitualThreshold']) $(key).value = s[key]
    $('habitualThreshold').max = s.habitualWindowDays
    $('threshold-hint').textContent = 'Missed days within ' + s.habitualWindowDays + ' working days'
    $('active').checked = s.active
    $('active-label').textContent = s.active ? 'Running' : 'Paused'
    renderTracker()
  }

  // Fixed icon markup from the server, never data: safe to set as HTML.
  const TRACKER_ICONS = { sharepoint: '${icon('db')}', jira: '${icon('file')}' }
  const TRACKER_HINTS = {
    sharepoint: 'One row per work item in the Daily Status Tracker list',
    jira: 'A comment on each work item; others on the stand-up issue'
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
    renderStats(); renderMembers(); renderStakeholders(); renderSchedule(); renderActivity()
  }

  document.querySelectorAll('nav button').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((t) => t.setAttribute('aria-selected', String(t === tab)))
    document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab.dataset.tab))
    const [title, subtitle] = TITLES[tab.dataset.tab]
    $('title').textContent = title
    $('subtitle').textContent = subtitle
    $('stats').hidden = tab.dataset.tab === 'llm'
    if (tab.dataset.tab === 'llm') loadLlm().catch((e) => toast(e.message, true))
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
      active: f.active.checked
    })).catch(() => {})
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

  api('GET', '/teams').then(({ teams }) => {
    if (teams.length === 0) {
      $('nothing').hidden = false
      $('stats').hidden = true
      document.querySelector('nav').hidden = true
      document.querySelectorAll('main section').forEach((s) => s.remove())
      $('team-name').textContent = '—'
      return
    }
    for (const t of teams) $('team').append(new Option(t.name, t.teamId))
    if (teams.length > 1) { $('team').hidden = false; $('team-name').hidden = true }
    $('team-name').textContent = teams[0].name
    teamId = teams[0].teamId
    return load()
  }).catch((e) => { if (e.message !== 'signed out') toast(e.message, true) })
})()
</script>
</body>
</html>`
}
