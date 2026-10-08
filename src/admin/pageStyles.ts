/** The admin page's styles (SPEC-008), kept apart from its markup and script (design review, 8 Oct 2026). */
export const ADMIN_STYLES = `  :root {
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
  .btn.small { padding: 6px 12px; font-size: 13px; margin-top: 10px; }
  .btn.text { background: none; border: 0; box-shadow: none; color: var(--brand); padding: 4px 8px; font-size: 13px; }
  .btn.text:hover { text-decoration: underline; box-shadow: none; }
  dialog { border: 1px solid var(--line); border-radius: 16px; padding: 0; width: min(460px, calc(100% - 32px)); background: var(--surface); color: var(--text); box-shadow: 0 24px 60px rgba(0,0,0,.25); }
  dialog::backdrop { background: rgba(15,18,30,.45); }
  dialog form { padding: 22px 24px; display: grid; gap: 14px; }
  dialog h2 { margin: 0; font-size: 18px; }
  .days { display: flex; flex-wrap: wrap; gap: 6px 12px; padding-top: 6px; }
  .day { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; cursor: pointer; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }`
