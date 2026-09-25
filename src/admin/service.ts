import type { ConversationReference } from '@microsoft/agents-activity'
import type { BotTeam, JobType, Member, TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { localDate } from '../config/time.js'
import { graphRequest } from '../graph/client.js'
import { JiraClient } from '../pm/jira.js'
import { runJobNow } from '../jobs/tick.js'
import { channelReference, listTeamChannels } from '../bot/channels.js'
import {
  allTeams, botTeams, clearChannelRef, configChangesFor, getChannelRef, getTeam, llmUsageForDates, recordConfigChange,
  runsForDate, saveChannelRef, saveTeam, teamForMember
} from '../store/firestore.js'
import { checkSchedule, mayManage, normaliseEmail } from './validate.js'

/**
 * What the admin page can do to a team (SPEC-008).
 *
 * Every operation re-reads the team before changing it, so a conversation
 * reference the bot stored a moment ago is not overwritten by a stale copy.
 */

/** A refusal the person on the page should read, with the HTTP status to send. */
export class AdminError extends Error {
  constructor (readonly status: number, message: string) {
    super(message)
  }
}

export interface Actor { oid: string, name: string }

export const JOB_TYPES: JobType[] = ['reminder', 'followup', 'summary', 'participation']

function jira (): JiraClient | undefined {
  if (config.jira.baseUrl === '' || config.jira.apiToken === '') return undefined
  return new JiraClient({
    baseUrl: config.jira.baseUrl,
    email: config.jira.email,
    apiToken: config.jira.apiToken,
    projectKey: config.jira.projectKey,
    storyPointsField: config.jira.storyPointsField,
    boardId: config.jira.boardId
  })
}

export async function teamsFor (actor: Actor): Promise<Array<{ teamId: string, name: string }>> {
  return (await allTeams())
    .filter((team) => mayManage(team, actor.oid, config.admin.userIds))
    .map((team) => ({ teamId: team.teamId, name: team.name }))
}

/** Loads a team the actor may manage, or refuses. */
export async function teamFor (actor: Actor, teamId: string): Promise<TeamConfig> {
  const team = await getTeam(teamId)
  if (team === undefined) throw new AdminError(404, 'No such team.')
  if (!mayManage(team, actor.oid, config.admin.userIds)) {
    console.log(JSON.stringify({ event: 'admin.forbidden', teamId, actor: actor.oid }))
    throw new AdminError(403, 'You are not the Scrum Master of this team.')
  }
  return team
}

/**
 * Saves a change and records who made it (SPEC-008 behaviour 12).
 * Returns the fields that actually changed; nothing is written when none did.
 */
export async function applyChange (team: TeamConfig, patch: Partial<TeamConfig>, changedBy: string): Promise<string[]> {
  const fields: Array<{ field: string, from: unknown, to: unknown }> = []
  for (const [key, next] of Object.entries(patch)) {
    const before = (team as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(before) === JSON.stringify(next)) continue
    fields.push({ field: key, from: before ?? null, to: next ?? null })
  }
  if (fields.length === 0) return []

  await saveTeam({ ...team, ...patch })
  await recordConfigChange({ teamId: team.teamId, changedBy, changedAt: new Date(), fields })
  return fields.map((f) => f.field)
}

interface GraphUser {
  id: string
  displayName?: string | null
  mail?: string | null
  userPrincipalName?: string | null
  userType?: string | null
  accountEnabled?: boolean | null
}

async function lookUpUser (idOrEmail: string): Promise<GraphUser | undefined> {
  try {
    return await graphRequest<GraphUser>(
      'GET',
      `/users/${encodeURIComponent(idOrEmail)}?$select=id,displayName,mail,userPrincipalName,userType,accountEnabled`
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes(' 404 ')) return undefined
    throw error
  }
}

export async function teamView (team: TeamConfig): Promise<unknown> {
  const today = localDate(new Date(), team.timezone)
  const client = jira()

  const [runs, channelRef, changes, jiraUsers, emails] = await Promise.all([
    runsForDate(team.teamId, today),
    getChannelRef(team.teamId),
    configChangesFor(team.teamId),
    client === undefined
      ? Promise.resolve([])
      : client.listUsers().catch((error: unknown) => {
        console.error(JSON.stringify({ event: 'admin.jiraUsersFailed', error: String(error) }))
        return []
      }),
    // Members seeded before the page existed have no stored address; Graph has it.
    Promise.all(team.members.map(async (member) => member.email ??
      (await lookUpUser(member.memberId).catch(() => undefined))?.mail ?? null))
  ])

  return {
    teamId: team.teamId,
    name: team.name,
    today,
    schedule: {
      standupTime: team.standupTime,
      summaryTime: team.summaryTime,
      timezone: team.timezone,
      gracePeriodMinutes: team.gracePeriodMinutes,
      habitualThreshold: team.habitualThreshold,
      habitualWindowDays: team.habitualWindowDays,
      active: team.active
    },
    members: team.members.map((member, index) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      email: emails[index],
      isScrumMaster: member.memberId === team.scrumMasterId,
      reachable: (member.conversationRef ?? '') !== '',
      jiraAccountId: member.jiraAccountId ?? null,
      jiraName: jiraUsers.find((u) => u.accountId === member.jiraAccountId)?.displayName ?? null
    })),
    jiraUsers,
    stakeholders: {
      emails: team.stakeholders.emails,
      channelId: team.stakeholders.channelId ?? null,
      channelConnected: channelRef !== undefined
    },
    tracker: team.tracker.kind,
    trackerDetail: team.tracker.kind === 'jira' ? `${config.jira.baseUrl}/browse/${team.tracker.standupIssueKey}` : null,
    trackerOptions: [
      { kind: 'sharepoint', label: 'SharePoint list — Daily Status Tracker', available: config.sharepoint.siteId !== '' },
      { kind: 'jira', label: 'Jira — a comment on each work item', available: config.jira.standupIssueKey !== '' }
    ],
    runs,
    changes: changes.map((c) => ({
      changedBy: c.changedBy,
      changedAt: c.changedAt.toISOString(),
      fields: c.fields.map((f) => f.field)
    }))
  }
}

export async function updateSchedule (team: TeamConfig, raw: Record<string, unknown>, actor: Actor): Promise<string[]> {
  const checked = checkSchedule(raw, team.habitualWindowDays)
  if (!checked.ok) throw new AdminError(400, checked.problems.join(' '))
  return await applyChange(team, checked.value, actor.name)
}

export async function addMember (team: TeamConfig, rawEmail: unknown, actor: Actor): Promise<string> {
  const email = normaliseEmail(rawEmail)
  if (email === undefined) throw new AdminError(400, 'That is not an email address.')

  const user = await lookUpUser(email)
  if (user === undefined) throw new AdminError(400, `${email} is not a user in this Microsoft 365 tenant.`)
  if (user.userType === 'Guest') throw new AdminError(400, `${email} is a guest account; only members of the tenant can be added.`)
  if (user.accountEnabled === false) throw new AdminError(400, `${email} is a disabled account.`)

  if (team.members.some((m) => m.memberId === user.id)) return `${user.displayName ?? email} is already on the team.`

  // Rosters must not overlap (SPEC-001): an update from someone on two teams
  // would have no single tracker to go to.
  const other = await teamForMember(user.id)
  if (other !== undefined && other.teamId !== team.teamId) {
    throw new AdminError(409, `${user.displayName ?? email} is already on ${other.name}. Remove them there first.`)
  }

  const member: Member = {
    memberId: user.id,
    displayName: user.displayName ?? email,
    email: user.mail ?? user.userPrincipalName ?? email
  }
  await applyChange(team, { members: [...team.members, member] }, actor.name)
  return `Added ${member.displayName}. They will receive reminders once the Teams app is installed for them.`
}

export async function removeMember (team: TeamConfig, memberId: string, actor: Actor): Promise<string> {
  const member = team.members.find((m) => m.memberId === memberId)
  if (member === undefined) throw new AdminError(404, 'That person is not on the team.')
  if (memberId === team.scrumMasterId) throw new AdminError(400, 'The Scrum Master cannot be removed.')
  await applyChange(team, { members: team.members.filter((m) => m.memberId !== memberId) }, actor.name)
  return `Removed ${member.displayName}. Rows they already wrote stay in the tracker.`
}

export async function linkJira (team: TeamConfig, memberId: string, rawAccountId: unknown, actor: Actor): Promise<string> {
  const member = team.members.find((m) => m.memberId === memberId)
  if (member === undefined) throw new AdminError(404, 'That person is not on the team.')
  const accountId = String(rawAccountId ?? '').trim()

  if (accountId !== '') {
    const client = jira()
    if (client === undefined) throw new AdminError(503, 'Jira is not configured.')
    const known = (await client.listUsers()).find((u) => u.accountId === accountId)
    if (known === undefined) throw new AdminError(400, 'That is not a Jira account on this site.')
    // Two people on one Jira account would silently credit one person's work
    // to the other.
    const holder = team.members.find((m) => m.jiraAccountId === accountId && m.memberId !== memberId)
    if (holder !== undefined) throw new AdminError(409, `That Jira account is already linked to ${holder.displayName}.`)
  }

  const members = team.members.map((m) => {
    if (m.memberId !== memberId) return m
    const { jiraAccountId: _previous, ...rest } = m
    return accountId === '' ? rest : { ...rest, jiraAccountId: accountId }
  })
  await applyChange(team, { members }, actor.name)
  return accountId === '' ? `Unlinked ${member.displayName} from Jira.` : `Linked ${member.displayName} to Jira.`
}

export async function addStakeholder (team: TeamConfig, rawEmail: unknown, actor: Actor): Promise<string> {
  const email = normaliseEmail(rawEmail)
  if (email === undefined) throw new AdminError(400, 'That is not an email address.')
  if (team.stakeholders.emails.map((e) => e.toLowerCase()).includes(email)) return `${email} is already on the list.`
  await applyChange(team, { stakeholders: { ...team.stakeholders, emails: [...team.stakeholders.emails, email] } }, actor.name)
  return `${email} will receive the daily summary.`
}

export async function removeStakeholder (team: TeamConfig, rawEmail: string, actor: Actor): Promise<string> {
  const email = rawEmail.trim().toLowerCase()
  const emails = team.stakeholders.emails.filter((e) => e.toLowerCase() !== email)
  if (emails.length === team.stakeholders.emails.length) throw new AdminError(404, `${email} is not on the list.`)
  await applyChange(team, { stakeholders: { ...team.stakeholders, emails } }, actor.name)
  return `${email} removed from the summary list.`
}

export interface ChannelOption { teamName: string, channelId: string, channelName: string }

/**
 * Behaviour 6: every channel the bot could post the summary to.
 *
 * A Teams team the app has since been removed from is left out rather than
 * failing the list, and reported so the page can say why it is missing.
 */
export async function channelOptions (): Promise<{ channels: ChannelOption[], unavailable: string[] }> {
  const channels: ChannelOption[] = []
  const unavailable: string[] = []
  for (const teamsTeam of await botTeams()) {
    try {
      for (const c of await listTeamChannels(teamsTeam)) {
        channels.push({ teamName: teamsTeam.name, channelId: c.channelId, channelName: c.channelName })
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin.channelsFailed', teamThreadId: teamsTeam.teamThreadId, error: String(error) }))
      unavailable.push(teamsTeam.name)
    }
  }
  channels.sort((a, b) => a.teamName.localeCompare(b.teamName) || a.channelName.localeCompare(b.channelName))
  return { channels, unavailable }
}

/** Behaviour 6: connect the stakeholder channel, or disconnect it with ''. */
export async function setChannel (team: TeamConfig, rawChannelId: unknown, actor: Actor): Promise<string> {
  const channelId = String(rawChannelId ?? '').trim()

  if (channelId === '') {
    const { channelId: _previous, ...rest } = team.stakeholders
    await applyChange(team, { stakeholders: rest }, actor.name)
    await clearChannelRef(team.teamId)
    return 'Channel disconnected. The summary goes by email only.'
  }

  // Only a channel the bot can actually post to is accepted, so a wrong choice
  // shows up here and not as a failed summary at the end of the day.
  const found = await findChannel(channelId)
  if (found === undefined) {
    throw new AdminError(400, 'That channel is not in any Teams team the assistant is installed in.')
  }

  await applyChange(team, { stakeholders: { ...team.stakeholders, channelId } }, actor.name)
  await saveChannelRef(team.teamId, channelReference(JSON.parse(found.holder.reference) as ConversationReference, channelId))
  return `Connected ${found.holder.name} › ${found.channelName}. The summary will be posted there.`
}

async function findChannel (channelId: string): Promise<{ holder: BotTeam, channelName: string } | undefined> {
  for (const holder of await botTeams()) {
    const channels = await listTeamChannels(holder).catch(() => [])
    const channel = channels.find((c) => c.channelId === channelId)
    if (channel !== undefined) return { holder, channelName: channel.channelName }
  }
  return undefined
}

/**
 * Behaviour 7: choose where the team's updates are written (FR-04).
 *
 * The destination is checked before it is saved, so a wrong setting shows up
 * here rather than as a failed update at stand-up time.
 */
export async function setTracker (team: TeamConfig, rawKind: unknown, actor: Actor): Promise<string> {
  let tracker: TeamConfig['tracker']
  if (rawKind === 'sharepoint') {
    tracker = { kind: 'sharepoint', siteId: config.sharepoint.siteId, listId: config.sharepoint.listId }
    try {
      await graphRequest('GET', `/sites/${tracker.siteId}/lists/${tracker.listId}?$select=id`)
    } catch (error) {
      throw new AdminError(502, `The SharePoint list cannot be reached: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`)
    }
  } else if (rawKind === 'jira') {
    const key = config.jira.standupIssueKey
    if (config.jira.baseUrl === '' || key === '') throw new AdminError(503, 'Jira comments are not configured on this server.')
    tracker = { kind: 'jira', projectKey: config.jira.projectKey, standupIssueKey: key }
    const client = jira()
    if (client === undefined || await client.lookupStory(key) === undefined) {
      throw new AdminError(502, `The Jira stand-up issue ${key} cannot be found.`)
    }
  } else {
    throw new AdminError(400, 'Choose SharePoint or Jira.')
  }

  const changed = await applyChange(team, { tracker }, actor.name)
  if (changed.length === 0) return 'Nothing changed.'
  // Updates already recorded today stay where they were written; the summary
  // reads only the current destination.
  return tracker.kind === 'jira'
    ? `Updates will now be added as comments on the Jira work items; those naming no work item go to ${tracker.standupIssueKey}.`
    : 'Updates will now be written to the SharePoint list.'
}

/** Behaviour 8: the same isolated manual run as the chat `run` command (A14). */
export async function runNow (team: TeamConfig, rawJob: string, actor: Actor): Promise<string> {
  const jobType = JOB_TYPES.find((j) => j === rawJob)
  if (jobType === undefined) throw new AdminError(400, `Unknown job "${rawJob}".`)
  console.log(JSON.stringify({ event: 'admin.runNow', teamId: team.teamId, jobType, actor: actor.oid }))
  const entry = await runJobNow(team, jobType)
  return `Manual ${jobType}: ${entry.outcome}${entry.detail === undefined ? '' : ` — ${entry.detail}`}`
}

/**
 * Model usage for the last `days` days (SPEC-008, LLM usage tab).
 *
 * Usage is counted per deployment, not per team, so any Scrum Master may see
 * it. Shows the guards that bound spending alongside the figures.
 */
export async function llmUsage (actor: Actor, days = 14): Promise<unknown> {
  if ((await teamsFor(actor)).length === 0) throw new AdminError(403, 'You are not the Scrum Master of any team.')
  const now = Date.now()
  const dates: string[] = []
  for (let back = days - 1; back >= 0; back--) {
    dates.push(localDate(new Date(now - back * 86_400_000), config.defaultTimezone))
  }
  return {
    provider: config.llm.provider,
    model: config.llm.model === '' ? '(provider default)' : config.llm.model,
    live: config.llm.live,
    maxCallsPerDay: config.llm.maxCallsPerDay,
    days: await llmUsageForDates(dates)
  }
}
