import type { SummaryFacts } from '../agents/prompts/summaryBuilder.js'
import type { SummaryOutput } from '../agents/schema.js'

/**
 * The daily summary laid out for people (SPEC-006 item 4, amended 25 Sep 2026).
 *
 * The sections are the model's words; the headline figures are the code's
 * arithmetic from the facts. The same layout twice: an Adaptive Card for the
 * Teams channel and an HTML email, so both audiences see the same thing.
 */

export interface Headline { label: string, value: string }

/** Figures computed by code, never read out of the model's text. */
export function headline (facts: SummaryFacts): Headline[] {
  const sprint = facts.sprint
  const points = sprint === undefined || sprint.committedPoints === 0
    ? 'n/a'
    : `${sprint.completedPoints}/${sprint.committedPoints}`
  const percent = sprint === undefined || sprint.committedPoints === 0
    ? ''
    : ` (${Math.round((sprint.completedPoints / sprint.committedPoints) * 100)}%)`
  return [
    { label: 'Reported', value: `${facts.participation.responded} of ${facts.participation.rosterSize}` },
    { label: 'Points done', value: points + percent },
    { label: 'Blockers', value: String(facts.activeBlockers.length) },
    { label: 'At risk', value: String(facts.atRisk.length) }
  ]
}

const KEY = /^([A-Z][A-Z0-9]+-\d+)\b[\s:—–-]*/

/** Splits a leading work item key off a line so keys line up in their own column. */
export function splitKey (line: string): { key: string | null, rest: string } {
  const match = line.match(KEY)
  return match === null ? { key: null, rest: line } : { key: match[1], rest: line.slice(match[0].length) || line }
}

function raisedBy (b: { member: string, since: string | null }): string {
  return b.since === null ? `Raised by ${b.member}` : `Raised by ${b.member} · last reported ${b.since}`
}

export function summaryTitle (facts: SummaryFacts): string {
  return `Daily sprint summary — ${facts.teamName} — ${facts.localDate}`
}

// ---------------------------------------------------------------- Teams card

const KEY_WIDTH = '80px'

function heading (text: string): unknown {
  return { type: 'TextBlock', text, weight: 'Bolder', color: 'Accent', wrap: true, spacing: 'Medium', separator: true }
}

function subtle (text: string): unknown {
  return { type: 'TextBlock', text, isSubtle: true, wrap: true, spacing: 'Small' }
}

/** A row with a fixed-width key column, so every row's text starts at the same place. */
function keyedRow (key: string | null, text: string, note: string | null, colour: string, boldKey = true): unknown {
  const detail: unknown[] = [{ type: 'TextBlock', text, wrap: true, spacing: 'None' }]
  if (note !== null) detail.push({ type: 'TextBlock', text: note, isSubtle: true, size: 'Small', wrap: true, spacing: 'None' })
  return {
    type: 'ColumnSet',
    spacing: 'Small',
    columns: [
      { type: 'Column', width: KEY_WIDTH, items: [{ type: 'TextBlock', text: key ?? '—', weight: boldKey ? 'Bolder' : 'Default', color: colour, wrap: true }] },
      { type: 'Column', width: 'stretch', items: detail }
    ]
  }
}

export function summaryCard (facts: SummaryFacts, s: SummaryOutput): unknown {
  const body: unknown[] = [
    {
      type: 'Container',
      items: [
        { type: 'TextBlock', text: 'Daily sprint summary', weight: 'Bolder', size: 'Medium', wrap: true },
        {
          type: 'TextBlock',
          text: [facts.teamName, facts.localDate, facts.sprint?.name].filter(Boolean).join('  ·  '),
          isSubtle: true,
          wrap: true,
          spacing: 'None'
        }
      ]
    },
    {
      type: 'ColumnSet',
      spacing: 'Small',
      columns: headline(facts).map((h) => ({
        type: 'Column',
        width: 'auto',
        items: [{ type: 'TextBlock', text: `${h.label} **${h.value}**`, size: 'Small', wrap: true }]
      }))
    }
  ]

  body.push(heading("Today's updates"))
  if (s.updates.length === 0) body.push(subtle('No updates were submitted.'))
  for (const update of s.updates) {
    body.push({ type: 'TextBlock', text: update.member, weight: 'Bolder', wrap: true, spacing: 'Medium' })
    for (const line of update.lines) {
      const { key, rest } = splitKey(line)
      body.push(keyedRow(key, rest, null, 'Default', false))
    }
  }

  body.push(heading('Active blockers'))
  if (s.blockers.length === 0) body.push(subtle('None reported.'))
  for (const b of s.blockers) body.push(keyedRow(b.workItem, b.description, raisedBy(b), 'Attention'))

  body.push(heading('Sprint progress'))
  body.push({ type: 'TextBlock', text: s.progress, wrap: true, spacing: 'Small' })
  if (facts.sprint !== undefined && facts.sprint.goal !== '') body.push(subtle(`Sprint goal: ${facts.sprint.goal}`))

  body.push(heading('At risk'))
  if (s.atRisk.length === 0) body.push(subtle('Nothing flagged.'))
  for (const r of s.atRisk) body.push(keyedRow(r.workItem, r.reason, null, 'Warning'))

  body.push(heading('Velocity'))
  body.push({ type: 'TextBlock', text: s.velocity, wrap: true, spacing: 'Small' })

  // Who did not report needs attention: boxed and coloured whenever anyone is missing.
  body.push({
    type: 'Container',
    style: facts.participation.missing.length > 0 ? 'warning' : 'good',
    spacing: 'Large',
    items: [{ type: 'TextBlock', text: s.participation, wrap: true }]
  })
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    msteams: { width: 'Full' },
    body
  }
}

// --------------------------------------------------------------------- email

/** Everything from the model or a tracker is escaped: it is data, not markup. */
export function escapeHtml (value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const FONT = "font-family:'Segoe UI',Arial,sans-serif;"
const MUTED = 'color:#616161;'

function htmlHeading (text: string): string {
  return `<tr><td style="${FONT}padding:12px 20px 2px;font-size:13px;font-weight:700;color:#4f52b2;border-top:1px solid #eeeeee;">${escapeHtml(text)}</td></tr>`
}

function htmlNote (text: string): string {
  return `<tr><td style="${FONT}${MUTED}padding:1px 20px 4px;font-size:13px;">${escapeHtml(text)}</td></tr>`
}

function htmlRows (rows: Array<{ key: string | null, text: string, note?: string }>, keyColour: string, boldKey = true): string {
  const cells = rows.map((r) =>
    '<tr>' +
    `<td valign="top" style="${FONT}width:80px;padding:2px 0;font-size:13px;font-weight:${boldKey ? 600 : 400};color:${keyColour};">${escapeHtml(r.key ?? '—')}</td>` +
    `<td valign="top" style="${FONT}padding:2px 0;font-size:13px;color:#242424;">${escapeHtml(r.text)}` +
    (r.note === undefined ? '' : `<div style="${MUTED}font-size:12px;">${escapeHtml(r.note)}</div>`) +
    '</td></tr>').join('')
  return `<tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table></td></tr>`
}

export function summaryEmailHtml (facts: SummaryFacts, s: SummaryOutput): string {
  const parts: string[] = []
  const subtitle = [facts.teamName, facts.localDate, facts.sprint?.name].filter(Boolean).join('  ·  ')

  parts.push(
    `<tr><td style="${FONT}padding:14px 20px 4px;">` +
    '<div style="font-size:16px;font-weight:700;color:#242424;">Daily sprint summary</div>' +
    `<div style="${MUTED}font-size:12px;margin-top:1px;">${escapeHtml(subtitle)}</div></td></tr>`
  )

  const stats = headline(facts).map((h) =>
    `<td align="left" style="${FONT}padding:6px 20px 8px 0;font-size:12px;white-space:nowrap;">` +
    `<span style="${MUTED}">${escapeHtml(h.label)}</span> <b style="color:#242424;">${escapeHtml(h.value)}</b></td>`).join('')
  parts.push(`<tr><td style="padding:0 20px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${stats}</tr></table></td></tr>`)

  parts.push(htmlHeading("Today's updates"))
  if (s.updates.length === 0) parts.push(htmlNote('No updates were submitted.'))
  for (const update of s.updates) {
    parts.push(`<tr><td style="${FONT}padding:6px 20px 0;font-size:13px;font-weight:600;color:#242424;">${escapeHtml(update.member)}</td></tr>`)
    parts.push(htmlRows(update.lines.map((line) => { const { key, rest } = splitKey(line); return { key, text: rest } }), '#242424', false))
  }

  parts.push(htmlHeading('Active blockers'))
  if (s.blockers.length === 0) parts.push(htmlNote('None reported.'))
  else parts.push(htmlRows(s.blockers.map((b) => ({ key: b.workItem, text: b.description, note: raisedBy(b) })), '#c4314b'))

  parts.push(htmlHeading('Sprint progress'))
  parts.push(`<tr><td style="${FONT}padding:1px 20px;font-size:13px;color:#242424;">${escapeHtml(s.progress)}</td></tr>`)
  if (facts.sprint !== undefined && facts.sprint.goal !== '') parts.push(htmlNote(`Sprint goal: ${facts.sprint.goal}`))

  parts.push(htmlHeading('At risk'))
  if (s.atRisk.length === 0) parts.push(htmlNote('Nothing flagged.'))
  else parts.push(htmlRows(s.atRisk.map((r) => ({ key: r.workItem, text: r.reason })), '#c19c00'))

  parts.push(htmlHeading('Velocity'))
  parts.push(`<tr><td style="${FONT}padding:1px 20px;font-size:13px;color:#242424;">${escapeHtml(s.velocity)}</td></tr>`)

  parts.push('<tr><td style="padding:14px 20px 16px;">' +
    `<div style="${FONT}font-size:13px;padding:7px 10px;` +
    (facts.participation.missing.length > 0
      ? 'color:#5c2e00;background:#fff4ce;border-left:4px solid #e3a400;'
      : 'color:#0e4d26;background:#dff6dd;border-left:4px solid #107c10;') +
    `">${escapeHtml(s.participation)}</div></td></tr>`)
  return '<!doctype html><html><body style="margin:0;padding:8px;background:#ffffff;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e0e0e0;">' +
    parts.join('') + '</table></body></html>'
}

/** Plain-text rendering, for the notification preview and the run log. */
export function summaryPlainText (facts: SummaryFacts, s: SummaryOutput): string {
  const lines = [summaryTitle(facts), '', headline(facts).map((h) => `${h.label}: ${h.value}`).join(' | '), '', "Today's updates"]
  if (s.updates.length === 0) lines.push('  No updates were submitted.')
  for (const u of s.updates) lines.push(`  ${u.member}`, ...u.lines.map((l) => `    ${l}`))
  lines.push('', 'Active blockers', ...(s.blockers.length === 0 ? ['  None reported.'] : s.blockers.map((b) => `  ${b.workItem ?? '—'}  ${b.description} (${b.member})`)))
  lines.push('', 'Sprint progress', `  ${s.progress}`)
  lines.push('', 'At risk', ...(s.atRisk.length === 0 ? ['  Nothing flagged.'] : s.atRisk.map((r) => `  ${r.workItem}  ${r.reason}`)))
  lines.push('', 'Velocity', `  ${s.velocity}`, '', s.participation)
  return lines.join('\n')
}
