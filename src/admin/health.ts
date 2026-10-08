import type { TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { localDate } from '../config/time.js'
import { graphRequest } from '../graph/client.js'
import { pmFor } from '../pm/factory.js'
import type { Story } from '../pm/types.js'
import { chatState } from '../bot/reachability.js'
import { trackerFor } from '../trackers/factory.js'
import { assessReadiness, type ReadinessFacts, type ReadinessRow } from './readiness.js'
import { assessOnboarding, type OnboardingFacts, type OnboardingStep, type Unknown } from './onboarding.js'
import { scrumMasterOf, summaryHasRun } from '../store/index.js'
import { hasTeamsLicence, jira, short, teamsTeamOf } from './common.js'

/**
 * Behaviour 10d: is this team ready for today? Read-only, no LLM calls.
 *
 * Every fact is gathered even when an earlier one fails, so one broken
 * connection does not hide the other problems.
 */
export async function readiness (team: TeamConfig): Promise<{ checkedAt: string, rows: ReadinessRow[] }> {
  const today = localDate(new Date(), team.timezone)
  const client = jira()

  const sprintFacts = async (): Promise<Pick<ReadinessFacts, 'sprint' | 'jiraError' | 'noJiraProject'>> => {
    if (team.jira === undefined) return { sprint: undefined, noJiraProject: true }
    if (client === undefined) return { sprint: undefined, jiraError: 'Jira is not configured on this server.' }
    try {
      const data = await pmFor(team).getSprintData()
      return { sprint: data === undefined ? undefined : { name: data.sprintName, items: data.items } }
    } catch (error) {
      return { sprint: undefined, jiraError: error instanceof Error ? error.message.slice(0, 160) : String(error) }
    }
  }

  const scrumMasterFacts = async (): Promise<ReadinessFacts['scrumMaster']> => {
    const sm = await scrumMasterOf(team)
    if (sm === undefined) return undefined
    try {
      return { name: sm.displayName, chat: await chatState(sm.conversationRef) }
    } catch (error) {
      return { name: sm.displayName, chat: 'error', chatError: error instanceof Error ? error.message.slice(0, 120) : String(error) }
    }
  }

  const [sprint, members, tracker, summaryRanToday, scrumMaster] = await Promise.all([
    sprintFacts(),
    Promise.all(team.members.map(async (member): Promise<ReadinessFacts['members'][number]> => {
      const linked = (member.jiraAccountId ?? '') !== ''
      try {
        return { name: member.displayName, linked, chat: await chatState(member.conversationRef) }
      } catch (error) {
        return { name: member.displayName, linked, chat: 'error', chatError: error instanceof Error ? error.message.slice(0, 120) : String(error) }
      }
    })),
    // M11: an unset tracker reads as empty, but it is not ready.
    (team.tracker.kind === 'unset' ? Promise.reject(new Error("no tracker list chosen yet — pick this team's own list on the Schedule tab")) : trackerFor(team).readToday(team.teamId, today))
      .then(() => ({ ok: true }))
      .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message.slice(0, 160) : String(error) })),
    summaryHasRun(team.teamId, today),
    scrumMasterFacts()
  ])

  const rows = assessReadiness({
    ...sprint,
    pointsFieldConfigured: config.jira.storyPointsField !== '',
    members,
    ...(scrumMaster === undefined ? {} : { scrumMaster }),
    tracker,
    summaryRanToday,
    standupTime: team.standupTime,
    summaryTime: team.summaryTime
  })
  console.log(JSON.stringify({ event: 'admin.readiness', teamId: team.teamId, red: rows.filter((r) => !r.ok).map((r) => r.check) }))
  return { checkedAt: new Date().toISOString(), rows }
}

// ── SPEC-008 10m: Teams team per scrum team, and the onboarding checklist ──

/**
 * SPEC-008 10m: each member's onboarding steps, read when the Dev team tab
 * opens. Read-only; a source that fails shows as "Could not check" on its step.
 */
export async function onboarding (team: TeamConfig): Promise<{
  teamsTeam: { id: string, name: string } | null
  teamsTeamError: string | null
  members: Record<string, { steps: OnboardingStep[], done: number, total: number }>
}> {
  const client = jira()
  const teamsTeam = await teamsTeamOf(team)
  const group = teamsTeam !== undefined && !('error' in teamsTeam) ? teamsTeam : undefined

  const groupMembers = async (): Promise<Set<string> | Unknown | undefined> => {
    if (teamsTeam === undefined) return undefined
    if ('error' in teamsTeam) return teamsTeam
    try {
      const found = await graphRequest<{ value: Array<{ id: string }> }>('GET', `/groups/${encodeURIComponent(teamsTeam.id)}/members?$select=id&$top=999`)
      return new Set(found.value.map((m) => m.id))
    } catch (error) {
      return { error: short(error) }
    }
  }

  // The tracker is on the Teams team's own site when that site's library belongs to the group.
  const trackerOnGroupSite = async (): Promise<boolean> => {
    if (group === undefined || team.tracker.kind !== 'sharepoint') return false
    try {
      const drive = await graphRequest<{ owner?: { group?: { id?: string } } }>('GET', `/sites/${team.tracker.siteId}/drive?$select=owner`)
      return drive.owner?.group?.id === group.id
    } catch {
      return false
    }
  }

  const sprintStories = async (): Promise<Story[] | 'noSprint' | Unknown> => {
    if (team.jira === undefined) return 'noSprint'
    if (client === undefined) return { error: 'Jira is not configured on this server.' }
    try {
      const data = await pmFor(team).getSprintData()
      return data === undefined ? 'noSprint' : data.items
    } catch (error) {
      return { error: short(error) }
    }
  }

  const [members, onSite, stories, licences, chats] = await Promise.all([
    groupMembers(),
    trackerOnGroupSite(),
    sprintStories(),
    Promise.all(team.members.map(async (m) => await hasTeamsLicence(m.memberId))),
    Promise.all(team.members.map(async (m) => await chatState(m.conversationRef).catch((error: unknown): Unknown => ({ error: short(error) }))))
  ])

  const result: Record<string, { steps: OnboardingStep[], done: number, total: number }> = {}
  team.members.forEach((m, index) => {
    const facts: OnboardingFacts = {
      teamsTeamName: group?.name,
      licence: licences[index],
      inTeamsTeam: members === undefined ? undefined : members instanceof Set ? members.has(m.memberId) : members,
      chat: chats[index],
      linked: (m.jiraAccountId ?? '') !== '',
      story: Array.isArray(stories)
        ? stories.some((s) => s.assigneeAccountId === m.jiraAccountId && s.statusCategory !== 'Done')
        : stories,
      tracker: onSite ? { via: 'group' } : { via: 'hand', tick: m.onboarding?.trackerAccess ?? null },
      noJiraProject: team.jira === undefined
    }
    result[m.memberId] = assessOnboarding(facts)
  })
  return {
    teamsTeam: group ?? null,
    teamsTeamError: teamsTeam !== undefined && 'error' in teamsTeam ? teamsTeam.error : null,
    members: result
  }
}
