import type { ChatState } from '../bot/reachability.js'

/**
 * Onboarding checklist per member (SPEC-008 10m): read-only, no LLM calls.
 *
 * The page performs none of the steps; it shows which are done and what to do
 * next. Kept free of I/O, like readiness (10d), so each step can be tested with
 * plain facts. A fact that could not be read is never shown as done.
 */

/** A fact that could not be read: the message says why. */
export interface Unknown { error: string }

export interface OnboardingFacts {
  /** The team's Teams team, or undefined when none is set. */
  teamsTeamName: string | undefined
  /** Holds a Teams licence that is provisioned. */
  licence: boolean | Unknown
  /** Member of the team's Teams team; undefined when no Teams team is set. */
  inTeamsTeam: boolean | Unknown | undefined
  chat: ChatState | Unknown
  linked: boolean
  /** An open story in the active sprint carries their Jira account. */
  story: boolean | 'noSprint' | Unknown
  /** M10: the team has no Jira project, so the Jira steps are not needed. */
  noJiraProject?: boolean
  /**
   * 'group': the SharePoint tracker is on the Teams team's own site, so group
   * membership is access. Otherwise it is ticked by hand: who and when, or null.
   */
  tracker: { via: 'group' } | { via: 'hand', tick: { by: string, at: string } | null }
}

export type StepState = 'done' | 'todo' | 'unknown'

export interface OnboardingStep {
  key: 'licence' | 'teamsTeam' | 'app' | 'jira' | 'story' | 'tracker'
  label: string
  state: StepState
  detail: string
  /** True when this step is ticked by hand on the page. */
  manual?: boolean
}

const isUnknown = (value: unknown): value is Unknown =>
  typeof value === 'object' && value !== null && 'error' in value

const unknown = (fact: Unknown): { state: StepState, detail: string } =>
  ({ state: 'unknown', detail: `Could not check: ${fact.error}` })

export function assessOnboarding (facts: OnboardingFacts): { steps: OnboardingStep[], done: number, total: number } {
  const team = facts.teamsTeamName
  const steps: OnboardingStep[] = []

  steps.push({
    key: 'licence',
    label: 'Microsoft 365 licence with Teams',
    ...(isUnknown(facts.licence)
      ? unknown(facts.licence)
      : facts.licence
        ? { state: 'done', detail: 'Licensed' }
        : { state: 'todo', detail: 'Assign a licence in the Microsoft 365 admin center.' })
  })

  const membership = (): { state: StepState, detail: string } => {
    if (team === undefined || facts.inTeamsTeam === undefined) return { state: 'todo', detail: 'Teams team not set. An admin sets it on the Dev team tab.' }
    if (isUnknown(facts.inTeamsTeam)) return unknown(facts.inTeamsTeam)
    return facts.inTeamsTeam
      ? { state: 'done', detail: `Member of ${team}` }
      : { state: 'todo', detail: `Add them to ${team} in Teams.` }
  }
  steps.push({ key: 'teamsTeam', label: "Added to the team's Teams team", ...membership() })

  steps.push({
    key: 'app',
    label: 'Scrum Assistant app installed',
    ...(isUnknown(facts.chat)
      ? unknown(facts.chat)
      : facts.chat === 'ok'
        ? { state: 'done', detail: 'Can be messaged' }
        : { state: 'todo', detail: "Install the app for them, or ask them to open Scrum Assistant in Teams and send 'help'." })
  })

  steps.push({
    key: 'jira',
    label: 'Jira account linked',
    ...(facts.noJiraProject === true
      ? { state: 'done', detail: 'Not needed: this team has no Jira project' }
      : facts.linked
      ? { state: 'done', detail: 'Linked' }
      : { state: 'todo', detail: 'Invite them to Jira, then link them here.' })
  })

  const story = (): { state: StepState, detail: string } => {
    if (facts.noJiraProject === true) return { state: 'done', detail: 'Not needed: this team has no Jira project' }
    if (isUnknown(facts.story)) return unknown(facts.story)
    if (!facts.linked) return { state: 'todo', detail: 'Link their Jira account first.' }
    if (facts.story === 'noSprint') return { state: 'todo', detail: 'No active sprint in Jira. Until one starts, updates are saved as general updates.' }
    return facts.story
      ? { state: 'done', detail: 'Has an open story in the sprint' }
      : { state: 'todo', detail: 'Assign them a story in Jira. Until then their updates are matched to stories for them to confirm, or saved as general updates.' }
  }
  steps.push({ key: 'story', label: 'Story assigned in the sprint', ...story() })

  if (facts.tracker.via === 'group') {
    // Same fact as the Teams team step: the tracker is on that team's site.
    const m = membership()
    steps.push({
      key: 'tracker',
      label: 'Tracker access',
      state: m.state,
      detail: m.state === 'done' ? `Through ${team as string}` : m.detail
    })
  } else {
    const tick = facts.tracker.tick
    steps.push({
      key: 'tracker',
      label: 'Tracker access',
      manual: true,
      ...(tick === null
        ? { state: 'todo', detail: 'Give them access to the tracker, then tick.' }
        : { state: 'done', detail: `Ticked by ${tick.by}` })
    })
  }

  const done = steps.filter((s) => s.state === 'done').length
  return { steps, done, total: steps.length }
}
