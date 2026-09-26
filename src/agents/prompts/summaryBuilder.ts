/**
 * Agent 2's standing instructions (SPEC-006, FR-07).
 *
 * In its own module for the same reasons as Agent 1's prompt: coding rule 17,
 * and so it is compiled into `dist/` rather than being a loose file that exists
 * locally and not on Cloud Run.
 */
export const SUMMARY_BUILDER_SYSTEM = `You write the end-of-day stand-up summary that a Scrum Master would otherwise write by hand. Stakeholders read it. They were not in the stand-up and will not read the tracker.

Reply with one JSON object and nothing else, in exactly this shape:

{
  "updates": [ { "member": "<name>", "lines": ["<one short line per item they reported>"] } ],
  "blockers": [ { "member": "<who raised it>", "workItem": "<key such as SCRUM-7, or null>", "description": "<the blocker, one line>", "since": "<the date it was last reported, as given>" } ],
  "progress": "<completed points against committed points, as a figure and a percentage, and whether that is on track for the sprint goal>",
  "atRisk": [ { "workItem": "<key>", "reason": "<why, one line>" } ],
  "velocity": "<this sprint's completed points next to the previous sprints given>",
  "participation": "<how many reported out of the roster, and who did not>"
}

- "updates": one entry per person who reported, in the order given. Each line starts with the work item key when there is one, then its status and what they said. One line per item, no more than about fifteen words.
- "blockers": every active blocker given to you, whatever day it was raised. An empty array when there are none.
- "atRisk": only the at-risk items given to you. An empty array when there are none.

Rules:
- Use only the figures and text you are given. Never estimate, infer or fill a gap.
- If a figure is missing, say it is not available. Do not substitute a plausible number.
- If nobody submitted an update, say so plainly and give the participation figure. Silence is itself the signal.
- If participation was partial, name who did not report. Do not imply the team reported in full.
- Items with no estimate are excluded from the points arithmetic. Say how many were excluded.
- Be brief and factual. No encouragement, no praise, no advice, no closing remarks.
- Plain text inside every string. No markdown, no bullets, no line breaks.`

export interface SummaryFacts {
  teamName: string
  localDate: string
  sprint?: {
    name: string
    goal: string
    committedPoints: number
    completedPoints: number
    unpointedCount: number
    previousVelocities: number[]
    items: Array<{ key: string, title: string, status: string, points: number | null, assignee: string | null }>
  }
  updates: Array<{ member: string, rows: Array<{ win: string | null, status: string, comment: string | null, blocker: string | null }> }>
  /** SPEC-006 4a: not yet cleared, from any day in the look-back window. */
  activeBlockers: Array<{ member: string, workItem: string | null, description: string, since: string }>
  participation: { responded: number, rosterSize: number, missing: string[] }
  atRisk: Array<{ key: string, title: string, reason: string }>
  staleProgressDays: number
}

/**
 * The facts, laid out for the model.
 *
 * Every number is computed by code before it gets here. The model's job is to
 * put them into readable English, not to work them out — arithmetic it does
 * itself cannot be checked against anything.
 */
export function summaryBuilderUser (facts: SummaryFacts): string {
  const lines: string[] = [
    `Team: ${facts.teamName}`,
    `Date: ${facts.localDate}`,
    ''
  ]

  if (facts.sprint === undefined) {
    lines.push('Sprint data: not available — no active sprint was found.', '')
  } else {
    const { sprint } = facts
    const percent = sprint.committedPoints === 0
      ? 'not available (no estimated points in the sprint)'
      : `${Math.round((sprint.completedPoints / sprint.committedPoints) * 100)}%`
    lines.push(
      `Sprint: ${sprint.name}`,
      `Sprint goal: ${sprint.goal === '' ? '(none set)' : sprint.goal}`,
      `Committed points: ${sprint.committedPoints}`,
      `Completed points: ${sprint.completedPoints}`,
      `Completion: ${percent}`,
      `Items with no estimate, excluded from the arithmetic: ${sprint.unpointedCount}`,
      sprint.previousVelocities.length === 0
        ? 'Previous sprint velocities: none recorded'
        : `Previous sprint velocities, oldest first: ${sprint.previousVelocities.join(', ')}`,
      '',
      'Sprint items:',
      ...sprint.items.map((item) =>
        `  ${item.key} [${item.status}] ${item.points ?? 'no estimate'} pts — ${item.title} (${item.assignee ?? 'unassigned'})`),
      ''
    )
  }

  lines.push(
    `Participation: ${facts.participation.responded} of ${facts.participation.rosterSize} reported`,
    facts.participation.missing.length === 0
      ? 'Nobody is missing.'
      : `Did not report: ${facts.participation.missing.join(', ')}`,
    ''
  )

  if (facts.updates.length === 0) {
    lines.push("Today's updates: none were submitted.", '')
  } else {
    lines.push("Today's updates:")
    for (const update of facts.updates) {
      lines.push(`  ${update.member}:`)
      for (const row of update.rows) {
        const item = row.win ?? 'no work item'
        const comment = row.comment ?? ''
        const blocker = row.blocker === null ? '' : ` BLOCKER: ${row.blocker}`
        lines.push(`    [${row.status}] ${item} ${comment}${blocker}`.trimEnd())
      }
    }
    lines.push('')
  }

  lines.push(
    facts.activeBlockers.length === 0
      ? 'Active blockers: none.'
      : 'Active blockers (raised on any day and not yet cleared):',
    ...facts.activeBlockers.map((b) => `  ${b.workItem ?? 'no work item'} — ${b.description} (raised by ${b.member}, last reported ${b.since})`),
    ''
  )

  lines.push(
    facts.atRisk.length === 0
      ? `At-risk items: none (an item is at risk if it is not done and either carries a blocker or has not changed in ${facts.staleProgressDays} days).`
      : 'At-risk items:',
    ...facts.atRisk.map((item) => `  ${item.key} — ${item.title} (${item.reason})`)
  )

  return lines.join('\n')
}
