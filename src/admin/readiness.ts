import type { Story } from '../pm/types.js'
import type { ChatState } from '../bot/reachability.js'

/**
 * Readiness checks (SPEC-008 10d): read-only, no LLM calls.
 *
 * Kept free of I/O so each check can be tested with plain facts. The service
 * gathers the facts; this decides green or red and says how to fix it.
 */

export interface ReadinessFacts {
  /** undefined when the Jira board has no active sprint. */
  sprint: { name: string, items: Story[] } | undefined
  /** M10: the team has no Jira project; Jira checks are not needed. */
  noJiraProject?: boolean
  /** Set when Jira could not be read at all; every Jira check then shows it. */
  jiraError?: string
  pointsFieldConfigured: boolean
  members: Array<{ name: string, linked: boolean, chat: ChatState | 'error', chatError?: string }>
  /** undefined when the team has no Scrum Master set (SPEC-008 10k). */
  scrumMaster?: { name: string, chat: ChatState | 'error', chatError?: string }
  tracker: { ok: boolean, error?: string }
  summaryRanToday: boolean
  standupTime: string
  summaryTime: string
}

export interface ReadinessRow { check: string, ok: boolean, detail: string }

const list = (names: string[]): string => names.join(', ')

export function assessReadiness (facts: ReadinessFacts): ReadinessRow[] {
  const rows: ReadinessRow[] = []
  const sprint = facts.sprint
  const items = sprint?.items ?? []

  if (facts.noJiraProject === true) {
    rows.push({ check: 'Jira project', ok: true, detail: 'Not used by this team: every update is saved as a general update.' })
  } else if (facts.jiraError !== undefined) {
    rows.push({ check: 'Active sprint', ok: false, detail: `Jira could not be read: ${facts.jiraError}` })
  } else if (sprint === undefined) {
    rows.push({ check: 'Active sprint', ok: false, detail: 'No active sprint. Start the sprint in Jira; until then no update can be matched to a work item.' })
  } else {
    rows.push({ check: 'Active sprint', ok: true, detail: sprint.name })

    rows.push(items.length === 0
      ? { check: 'Stories', ok: false, detail: `${sprint.name} has no stories. Add stories to the sprint in Jira.` }
      : { check: 'Stories', ok: true, detail: `${items.length} in the sprint` })

    const unassigned = items.filter((item) => item.assigneeAccountId === null).map((item) => item.key)
    rows.push(unassigned.length > 0
      ? { check: 'Assignees', ok: false, detail: `Unassigned: ${list(unassigned)}. Updates on these are refused until they are assigned in Jira.` }
      : { check: 'Assignees', ok: true, detail: 'Every story is assigned' })

    const unpointed = items.filter((item) => item.points === null).map((item) => item.key)
    rows.push(!facts.pointsFieldConfigured
      ? { check: 'Story points', ok: false, detail: 'No story points field is configured on this server (JIRA_STORY_POINTS_FIELD).' }
      : unpointed.length > 0
        ? { check: 'Story points', ok: false, detail: `No points: ${list(unpointed)}. The summary's progress and velocity leave these out.` }
        : { check: 'Story points', ok: true, detail: 'Every story has points' })
  }

  const unlinked = facts.noJiraProject === true ? [] : facts.members.filter((m) => !m.linked).map((m) => m.name)
  if (facts.noJiraProject !== true) rows.push(unlinked.length > 0
    ? { check: 'Jira links', ok: false, detail: `Not linked: ${list(unlinked)}. Link them on the Dev team tab. Until then their updates are matched to stories for them to confirm, or saved as general updates.` }
    : { check: 'Jira links', ok: true, detail: 'Every member is linked' })

  const noChat = facts.members.filter((m) => m.chat === 'none').map((m) => m.name)
  const gone = facts.members.filter((m) => m.chat === 'gone').map((m) => m.name)
  const errors = facts.members.filter((m) => m.chat === 'error').map((m) => `${m.name} (${m.chatError ?? 'unknown error'})`)
  const chatProblems = [
    noChat.length > 0 ? `App not installed: ${list(noChat)}.` : '',
    gone.length > 0 ? `Chat deleted in Teams: ${list(gone)}.` : '',
    errors.length > 0 ? `Could not check: ${list(errors)}.` : ''
  ].filter((part) => part !== '')
  rows.push(chatProblems.length > 0
    ? { check: 'Teams chats', ok: false, detail: `${chatProblems.join(' ')} Each of them opens Scrum Assistant in Teams and sends "help".` }
    : { check: 'Teams chats', ok: true, detail: 'Every member can be messaged' })

  // The Scrum Master gets the blocker alerts; a dead chat there is silent (10k).
  const sm = facts.scrumMaster
  rows.push(sm === undefined
    ? { check: 'Scrum Master chat', ok: false, detail: 'No Scrum Master is set for this team.' }
    : sm.chat === 'ok'
      ? { check: 'Scrum Master chat', ok: true, detail: `${sm.name} can be messaged` }
      : {
          check: 'Scrum Master chat',
          ok: false,
          detail: sm.chat === 'error'
            ? `Could not check ${sm.name}: ${sm.chatError ?? 'unknown error'}.`
            : `${sm.name} can't be messaged, so blocker alerts won't arrive. They open Scrum Assistant in Teams and send "help".`
        })

  rows.push(facts.tracker.ok
    ? { check: 'Tracker', ok: true, detail: 'Reachable' }
    : { check: 'Tracker', ok: false, detail: `Cannot be reached: ${facts.tracker.error ?? 'unknown error'}` })

  const scheduleProblems = [
    facts.summaryRanToday ? "Today's summary has already run, so today's stand-up is closed: updates are refused until tomorrow." : '',
    facts.standupTime >= facts.summaryTime ? `The stand-up (${facts.standupTime}) is not before the summary (${facts.summaryTime}).` : ''
  ].filter((part) => part !== '')
  rows.push(scheduleProblems.length > 0
    ? { check: 'Schedule', ok: false, detail: scheduleProblems.join(' ') }
    : { check: 'Schedule', ok: true, detail: `Stand-up ${facts.standupTime}, summary ${facts.summaryTime}` })

  return rows
}
