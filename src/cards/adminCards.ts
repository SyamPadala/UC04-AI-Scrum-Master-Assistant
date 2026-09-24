import type { TeamConfig } from '../types.js'

export function adminStatusCard (
  team: TeamConfig,
  today: string,
  runs: Array<{ jobType: string, outcome: string, detail?: string }>
): unknown {
  const reachable = team.members.filter((m) => (m.conversationRef ?? '') !== '')
  const unreachable = team.members.filter((m) => (m.conversationRef ?? '') === '')

  const body: unknown[] = [
    { type: 'TextBlock', text: team.name, weight: 'Bolder', size: 'Medium', wrap: true },
    {
      type: 'FactSet',
      facts: [
        { title: 'Assistant', value: team.active ? 'Running' : 'Paused' },
        { title: 'Stand-up', value: `${team.standupTime} ${team.timezone}` },
        { title: 'Follow-up', value: `${team.gracePeriodMinutes} minutes later` },
        { title: 'Summary', value: team.summaryTime },
        { title: 'Tracker', value: team.tracker.kind },
        { title: 'Can be messaged', value: `${reachable.length} of ${team.members.length}` }
      ]
    }
  ]

  // Naming who cannot be reached is the point: a member missing here is
  // silently skipped at reminder time, and that is the usual reason a demo
  // only half works.
  if (unreachable.length > 0) {
    body.push({
      type: 'TextBlock',
      text: `Not installed for: ${unreachable.map((m) => m.displayName).join(', ')}`,
      wrap: true,
      color: 'Attention',
      size: 'Small'
    })
  }

  body.push({ type: 'TextBlock', text: `Today (${today})`, weight: 'Bolder', wrap: true, spacing: 'Medium' })

  if (runs.length === 0) {
    body.push({ type: 'TextBlock', text: 'Nothing has run yet today.', wrap: true, isSubtle: true })
  } else {
    for (const run of runs) {
      body.push({
        type: 'TextBlock',
        text: `**${run.jobType}** — ${run.outcome}${run.detail === undefined ? '' : `\n\n${run.detail}`}`,
        wrap: true,
        spacing: 'Small'
      })
    }
  }

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body
  }
}
