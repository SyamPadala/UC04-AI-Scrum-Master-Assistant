import type { JobType, Member, TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { localDate } from '../config/time.js'
import { graphRequest } from '../graph/client.js'
import { JiraClient } from '../pm/jira.js'
import { runJobNow } from '../jobs/tick.js'
import {
  allTeams, configChangesFor, getChannelRef, getTeam, llmUsageForDates, recordConfigChange, runsForDate, saveTeam,
  teamForMember
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
      channelConnected: channelRef !== undefined
    },
    tracker: team.tracker.kind,
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
