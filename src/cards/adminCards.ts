import type { TeamConfig } from '../types.js'

/**
 * The settings form the Scrum Master edits in Teams (SPEC-008, A9).
 *
 * Every field is pre-filled from the team's current configuration. A form that
 * opens blank invites someone to submit an accidental reset, and Teams sends
 * back every input on the card whether it was touched or not.
 */
export function adminSetupCard (team: TeamConfig): unknown {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: 'Scrum Assistant settings', weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'TextBlock', text: team.name, isSubtle: true, spacing: 'None', wrap: true },

      { type: 'Input.Text', id: 'standupTime', label: 'Stand-up time (24h, HH:mm)', value: team.standupTime },
      {
        type: 'Input.Number',
        id: 'gracePeriodMinutes',
        label: 'Send follow-up after (minutes)',
        value: team.gracePeriodMinutes,
        min: 5,
        max: 1440
      },
      { type: 'Input.Text', id: 'summaryTime', label: 'Daily summary time (24h, HH:mm)', value: team.summaryTime },
      { type: 'Input.Text', id: 'timezone', label: 'Timezone', value: team.timezone },
      {
        type: 'Input.ChoiceSet',
        id: 'active',
        label: 'Assistant',
        value: String(team.active),
        choices: [
          { title: 'Running', value: 'true' },
          { title: 'Paused', value: 'false' }
        ]
      },
      {
        type: 'Input.Text',
        id: 'stakeholderEmails',
        label: 'Stakeholder emails (comma separated)',
        value: team.stakeholders.emails.join(', ')
      },
      {
        type: 'TextBlock',
        text: `Roster: ${team.members.map((m) => m.displayName).join(', ')}`,
        wrap: true,
        isSubtle: true,
        size: 'Small',
        spacing: 'Medium'
      }
    ],
    actions: [{ type: 'Action.Submit', title: 'Save', data: { command: 'saveConfig' } }]
  }
}

/** Read-only view of the configuration and how today's jobs went. */
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
