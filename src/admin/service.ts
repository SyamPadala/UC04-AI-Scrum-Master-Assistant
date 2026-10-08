import { randomUUID } from 'node:crypto'
import type { ConversationReference } from '@microsoft/agents-activity'
import type { BotTeam, JobType, Leaver, Member, TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { localDate } from '../config/time.js'
import { graphRequest } from '../graph/client.js'
import { jiraSite, pmFor } from '../pm/factory.js'
import type { Story } from '../pm/types.js'
import { runJobNow } from '../jobs/tick.js'
import { DEFAULT_WORKING_DAYS } from '../jobs/schedule.js'
import { channelReference, listTeamChannels } from '../bot/channels.js'
import { chatState } from '../bot/reachability.js'
import { trackerFor } from '../trackers/factory.js'
import { assessReadiness, type ReadinessFacts, type ReadinessRow } from './readiness.js'
import { addToTeamsTeam, assertLinkedTeamsTeam, installApp, reason, removeFromTeamsTeam, uninstallApp } from './provision.js'
import { cannotRun } from './guards.js'
import { assessOnboarding, type OnboardingFacts, type OnboardingStep, type Unknown } from './onboarding.js'
import {
  allTeams, botTeams, clearChannelRef, configChangesFor, getChannelRef, getTeam, llmUsageForDates, recordConfigChange,
  reopenStandup as markReopened, runsForDate, saveChannelRef, saveScrumMasterRef, saveTeam, scrumMasterOf, standupState, summaryHasRun, teamForMember
} from '../store/index.js'
import { checkSchedule, isValidTimezone, mayAdminister, mayManage, normaliseEmail, overlapProblem } from './validate.js'

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

/** Site-wide Jira work (users, invites); each team's project comes from pmFor (M10). */
const jira = jiraSite

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

export async function teamView (team: TeamConfig, actor: Actor): Promise<unknown> {
  const today = localDate(new Date(), team.timezone)
  const client = jira()

  const [runs, channelRef, changes, jiraUsers, emails, scrumMaster, standup] = await Promise.all([
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
      (await lookUpUser(member.memberId).catch(() => undefined))?.mail ?? null)),
    scrumMasterOf(team),
    standupState(team.teamId, today)
  ])

  return {
    teamId: team.teamId,
    name: team.name,
    today,
    me: actor.oid,
    meIsAdmin: config.admin.userIds.includes(actor.oid),
    scrumMasterId: team.scrumMasterId,
    // A role, not a roster entry (SPEC-008 10f).
    // SPEC-008 10l: closed by today's scheduled summary, or reopened.
    standup: {
      closed: standup.closed,
      closedAt: standup.closedAt?.toISOString() ?? null,
      reopenedAt: standup.reopenedAt?.toISOString() ?? null,
      reopenedBy: standup.reopenedBy
    },
    scrumMaster: scrumMaster === undefined
      ? null
      : { name: scrumMaster.displayName, email: scrumMaster.email ?? null, reachable: (scrumMaster.conversationRef ?? '') !== '' },
    schedule: {
      standupTime: team.standupTime,
      summaryTime: team.summaryTime,
      timezone: team.timezone,
      gracePeriodMinutes: team.gracePeriodMinutes,
      habitualThreshold: team.habitualThreshold,
      habitualWindowDays: team.habitualWindowDays,
      active: team.active,
      workingDays: team.workingDays ?? DEFAULT_WORKING_DAYS
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
    leaving: team.leaving ?? [],
    teamsTeam: team.teamsGroupId === undefined ? null : { id: team.teamsGroupId, name: team.teamsGroupName ?? team.teamsGroupId },
    tracker: team.tracker.kind,
    jira: team.jira ?? null,
    trackerListId: team.tracker.kind === 'sharepoint' ? team.tracker.listId : null,
    trackerDetail: team.tracker.kind === 'jira' ? `${config.jira.baseUrl}/browse/${team.tracker.standupIssueKey}` : null,
    trackerOptions: [
      { kind: 'sharepoint', label: "SharePoint list on the team's own site", available: true },
      { kind: 'jira', label: 'Jira — a comment on each work item', available: config.jira.standupIssueKey !== '' && team.jira !== undefined }
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
  // SPEC-008 10o (M3): switching on needs a Scrum Master who can be messaged.
  if (checked.value.active && !team.active) {
    const problem = await cannotRun(team)
    if (problem !== undefined) throw new AdminError(409, `Not switched to Running. ${problem}`)
  }
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

  const overlap = overlapProblem('addMember', user.id, user.displayName ?? email, await allTeams())
  if (overlap !== undefined) throw new AdminError(409, overlap)

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
  // Rejoining ends an unfinished offboarding (10n).
  const leaving = (team.leaving ?? []).filter((l) => l.memberId !== user.id)
  await applyChange(team, { members: [...team.members, member], ...(leaving.length === (team.leaving ?? []).length ? {} : { leaving }) }, actor.name)
  // SPEC-008 10n: every onboarding step the assistant can do, done now.
  const provisioned = await provisionMember(team.teamId, member.memberId, actor)
  return `Added ${member.displayName}. ${provisioned}`
}

export async function removeMember (team: TeamConfig, memberId: string, actor: Actor): Promise<string> {
  const member = team.members.find((m) => m.memberId === memberId)
  if (member === undefined) throw new AdminError(404, 'That person is not on the team.')
  // SPEC-008 10f: a Scrum Master still on the roster (the old model) may be
  // taken off it. Their chat is kept first, so their alerts keep arriving.
  if (memberId === team.scrumMasterId && (member.conversationRef ?? '') !== '') {
    await saveScrumMasterRef(member.memberId, member.displayName, member.conversationRef as string)
  }
  // SPEC-008 10n: removed completely; what can't be done automatically is their offboarding checklist.
  const items = await offboard(team, member)
  const leaver: Leaver = {
    memberId: member.memberId,
    displayName: member.displayName,
    ...(member.email === undefined ? {} : { email: member.email }),
    removedBy: actor.name,
    removedAt: new Date().toISOString(),
    items
  }
  const fresh = await getTeam(team.teamId) ?? team
  await applyChange(fresh, {
    members: fresh.members.filter((m) => m.memberId !== memberId),
    leaving: [...(fresh.leaving ?? []).filter((l) => l.memberId !== memberId), leaver]
  }, actor.name)
  const auto = items.filter((i) => i.state === 'auto').length
  const manual = items.length - auto
  return `Removed ${member.displayName}. ${auto} offboarding step${auto === 1 ? '' : 's'} done automatically, ${manual} to do by hand — see Leaving on the Dev team tab.`
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

/**
 * Behaviour 10b: a new team, created Paused so nothing is sent until its
 * Scrum Master has set it up and switched it on.
 */
export async function createTeam (actor: Actor, raw: Record<string, unknown>): Promise<{ teamId: string, message: string }> {
  if (!mayAdminister(actor.oid, config.admin.userIds)) throw new AdminError(403, 'Only an admin can create a team.')
  const teams = await allTeams()

  const name = String(raw.name ?? '').trim()
  if (name === '' || name.length > 60) throw new AdminError(400, 'Give the team a name of up to 60 characters.')
  if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new AdminError(409, `A team called "${name}" already exists.`)

  const timezone = String(raw.timezone ?? '').trim() || config.defaultTimezone
  if (!isValidTimezone(timezone)) throw new AdminError(400, `"${timezone}" is not a timezone I recognise. Try Asia/Kolkata.`)

  const rawEmail = String(raw.scrumMasterEmail ?? '').trim()
  let user: GraphUser | undefined
  if (rawEmail === '') {
    user = await lookUpUser(actor.oid)
  } else {
    const email = normaliseEmail(rawEmail)
    if (email === undefined) throw new AdminError(400, 'The Scrum Master email is not an email address.')
    user = await lookUpUser(email)
  }
  if (user === undefined) throw new AdminError(400, 'That Scrum Master is not a user in this Microsoft 365 tenant.')
  if (user.userType === 'Guest' || user.accountEnabled === false) throw new AdminError(400, 'The Scrum Master must be an active member of the tenant.')
  const overlap = overlapProblem('makeScrumMaster', user.id, user.displayName ?? 'That person', teams)
  if (overlap !== undefined) throw new AdminError(409, overlap)

  // SPEC-008 10m: optional here; it can be set later on the Dev team tab.
  const rawGroup = String(raw.teamsGroupId ?? '').trim()
  const group = rawGroup === '' ? undefined : await checkTeamsTeam(rawGroup, teams)

  const team: TeamConfig = {
    teamId: randomUUID(),
    name,
    active: false,
    timezone,
    standupTime: '09:30',
    gracePeriodMinutes: 120,
    summaryTime: '18:00',
    workingDays: DEFAULT_WORKING_DAYS,
    // The Scrum Master is a role, not a member (SPEC-008 10f): the roster starts empty.
    members: [],
    scrumMasterId: user.id,
    scrumMasterName: user.displayName ?? rawEmail,
    scrumMasterEmail: user.mail ?? user.userPrincipalName ?? rawEmail,
    habitualThreshold: 2,
    habitualWindowDays: 5,
    // M11: never another team's list — the admin picks this team's own.
    tracker: { kind: 'unset' },
    stakeholders: { emails: [] },
    ...(group === undefined ? {} : { teamsGroupId: group.id, teamsGroupName: group.name })
  }
  await saveTeam(team)
  await recordConfigChange({
    teamId: team.teamId, changedBy: actor.name, changedAt: new Date(),
    fields: [{ field: 'created', from: null, to: name }]
  })
  console.log(JSON.stringify({ event: 'admin.teamCreated', teamId: team.teamId, actor: actor.oid }))
  // M10: optional at creation, checked the same way as on the Dev team tab.
  let jiraNote = ''
  if (String(raw.jiraProjectKey ?? '').trim() !== '') {
    try {
      jiraNote = await setJiraProject(team, { projectKey: raw.jiraProjectKey, boardId: raw.jiraBoardId }, actor)
    } catch (error) {
      jiraNote = `Jira project not set: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  const installed = await installForScrumMaster(user.id, team.scrumMasterName ?? 'the Scrum Master')
  return { teamId: team.teamId, message: `Created ${name}. It is Paused: add members, choose its tracker list and set the schedule, then switch it to Running. ${installed} ${jiraNote}`.trim() }
}

/**
 * Behaviour 10j (29 Sep 2026): an admin sets the team's Scrum Master by email.
 * Anyone in the tenant who is on no roster; they may already run other teams.
 */
export async function setScrumMaster (team: TeamConfig, rawEmail: unknown, actor: Actor): Promise<string> {
  if (!mayAdminister(actor.oid, config.admin.userIds)) throw new AdminError(403, 'Only an admin can change the Scrum Master.')
  const email = normaliseEmail(rawEmail)
  if (email === undefined) throw new AdminError(400, 'That is not an email address.')
  const user = await lookUpUser(email)
  if (user === undefined) throw new AdminError(400, `${email} is not a user in this Microsoft 365 tenant.`)
  if (user.userType === 'Guest' || user.accountEnabled === false) throw new AdminError(400, 'The Scrum Master must be an active member of the tenant.')
  const name = user.displayName ?? email
  if (user.id === team.scrumMasterId) return `${name} is already the Scrum Master.`

  const overlap = overlapProblem('makeScrumMaster', user.id, name, await allTeams())
  if (overlap !== undefined) throw new AdminError(409, overlap)

  await applyChange(team, {
    scrumMasterId: user.id,
    scrumMasterName: name,
    scrumMasterEmail: user.mail ?? user.userPrincipalName ?? email
  }, actor.name)
  const installed = await installForScrumMaster(user.id, name)
  return `${name} is now the Scrum Master of ${team.name}. Blocker alerts and non-responder flags go to them from the next event. ${installed}`
}

/**
 * SPEC-008 10o (M2): the Scrum Master gets the app the moment they are set,
 * as members do on Add (10n). The install event then stores their chat. A
 * failure is reported, never fatal: the team was still created or changed.
 */
async function installForScrumMaster (userId: string, name: string): Promise<string> {
  try {
    const outcome = await installApp(userId)
    return outcome === 'added'
      ? `Scrum Assistant was installed for ${name}.`
      : `${name} already has Scrum Assistant; if they have never opened it, they need to open it once in Teams.`
  } catch (error) {
    console.error(JSON.stringify({ event: 'admin.scrumMasterInstallFailed', userId, error: String(error) }))
    return `Scrum Assistant could not be installed for ${name} (${reason(error)}). They need to open it in Teams before the team can run.`
  }
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
export async function setTracker (team: TeamConfig, raw: { kind?: unknown, listId?: unknown }, actor: Actor): Promise<string> {
  let tracker: TeamConfig['tracker']
  if (raw.kind === 'sharepoint') {
    // M11: only a list on this team's own SharePoint site, used by no other team.
    const listId = String(raw.listId ?? (team.tracker.kind === 'sharepoint' ? team.tracker.listId : '')).trim()
    if (listId === '') throw new AdminError(400, "Choose one of the lists on the team's own SharePoint site.")
    const option = (await trackerLists(team)).lists.find((l) => l.listId === listId)
    if (option === undefined) throw new AdminError(400, "That list is not on this team's own SharePoint site.")
    if (option.missing.length > 0) throw new AdminError(400, `That list is missing columns: ${option.missing.join(', ')}.`)
    const holder = (await allTeams()).find((t) => t.teamId !== team.teamId && t.tracker.kind === 'sharepoint' && t.tracker.listId === listId)
    if (holder !== undefined) throw new AdminError(409, `That list is already used by ${holder.name}.`)
    tracker = { kind: 'sharepoint', siteId: option.siteId, listId }
  } else if (raw.kind === 'jira') {
    const key = config.jira.standupIssueKey
    if (team.jira === undefined) throw new AdminError(400, 'Set a Jira project for this team first.')
    if (config.jira.baseUrl === '' || key === '') throw new AdminError(503, 'Jira comments are not configured on this server.')
    tracker = { kind: 'jira', projectKey: team.jira.projectKey, standupIssueKey: key }
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

/** The tracker's columns (SPEC-002); a list without them cannot hold the rows. */
const TRACKER_COLUMNS = ['Date', 'WIN', 'Description', 'AssignedTo', 'Comment', 'Status', 'AnyBlocker', 'UpdatedBy']

/**
 * M11: the lists on this team's own SharePoint site — the site of its Teams
 * team, which only its members can open — with any missing tracker columns.
 */
export async function trackerLists (team: TeamConfig): Promise<{ site: string | null, lists: Array<{ siteId: string, listId: string, name: string, missing: string[] }>, problem?: string }> {
  const teamsTeam = await teamsTeamOf(team)
  if (teamsTeam === undefined) return { site: null, lists: [], problem: 'Set the Teams team first: the tracker lives on its SharePoint site.' }
  if ('error' in teamsTeam) return { site: null, lists: [], problem: teamsTeam.error }
  try {
    const site = await graphRequest<{ id: string, displayName?: string }>('GET', `/groups/${encodeURIComponent(teamsTeam.id)}/sites/root?$select=id,displayName`)
    const found = await graphRequest<{ value: Array<{ id: string, displayName?: string, list?: { template?: string, hidden?: boolean } }> }>(
      'GET', `/sites/${site.id}/lists?$select=id,displayName,list`
    )
    const lists = found.value.filter((l) => l.list?.template === 'genericList' && l.list?.hidden !== true)
    const withColumns = await Promise.all(lists.map(async (l) => {
      const columns = await graphRequest<{ value: Array<{ name: string }> }>('GET', `/sites/${site.id}/lists/${l.id}/columns?$select=name`)
      const names = new Set(columns.value.map((c) => c.name))
      return { siteId: site.id, listId: l.id, name: l.displayName ?? l.id, missing: TRACKER_COLUMNS.filter((c) => !names.has(c)) }
    }))
    return { site: site.displayName ?? teamsTeam.name, lists: withColumns }
  } catch (error) {
    return { site: null, lists: [], problem: `The team's SharePoint site could not be read: ${short(error)}` }
  }
}

/** M10: every Jira project on the site with its Scrum boards, for the admin's dropdown. */
export async function jiraProjects (actor: Actor): Promise<{ projects: Array<{ key: string, name: string, boards: Array<{ id: string, name: string }> }> }> {
  if (!mayAdminister(actor.oid, config.admin.userIds)) throw new AdminError(403, 'Only an admin can choose Jira projects.')
  const client = jira()
  if (client === undefined) return { projects: [] }
  try {
    return { projects: await client.listProjects() }
  } catch (error) {
    throw new AdminError(502, `Jira projects could not be listed: ${short(error)}`)
  }
}

/**
 * M10 (SPEC-008 10p): admin only. One project per team; '' takes the team off
 * Jira, after which every update is a general update.
 */
export async function setJiraProject (team: TeamConfig, raw: { projectKey?: unknown, boardId?: unknown }, actor: Actor): Promise<string> {
  if (!mayAdminister(actor.oid, config.admin.userIds)) throw new AdminError(403, 'Only an admin can set the Jira project.')
  const key = String(raw.projectKey ?? '').trim()
  if (key === '') {
    if (team.jira === undefined) return 'Nothing changed.'
    const { jira: _previous, ...rest } = team
    await saveTeam(rest)
    await recordConfigChange({ teamId: team.teamId, changedBy: actor.name, changedAt: new Date(), fields: [{ field: 'jira', from: team.jira, to: null }] })
    return `${team.name} no longer uses Jira. Updates will be saved as general updates.`
  }
  const project = (await jiraProjects(actor)).projects.find((p) => p.key === key)
  if (project === undefined) throw new AdminError(400, `${key} is not a project on this Jira site.`)
  const holder = (await allTeams()).find((t) => t.teamId !== team.teamId && t.jira?.projectKey === key)
  if (holder !== undefined) throw new AdminError(409, `${key} is already used by ${holder.name}.`)
  const boardId = String(raw.boardId ?? '').trim()
  const board = boardId === '' ? (project.boards.length === 1 ? project.boards[0] : undefined) : project.boards.find((b) => b.id === boardId)
  if (board === undefined) {
    throw new AdminError(400, project.boards.length === 0
      ? `${key} has no Scrum board. Create one in Jira first.`
      : `${key} has several boards; choose one.`)
  }
  const changed = await applyChange(team, { jira: { projectKey: key, boardId: board.id, boardName: board.name } }, actor.name)
  return changed.length === 0 ? 'Nothing changed.' : `${team.name} now uses Jira project ${key} (${board.name}).`
}

/**
 * SPEC-008 10l: members may send updates again today. The summary is not sent
 * again — its claim stays, marked reopened.
 */
export async function reopenStandup (team: TeamConfig, actor: Actor): Promise<string> {
  const today = localDate(new Date(), team.timezone)
  const state = await standupState(team.teamId, today)
  if (!state.closed) throw new AdminError(409, "Today's stand-up is already open.")
  await markReopened(team.teamId, today, actor.name)
  await recordConfigChange({
    teamId: team.teamId, changedBy: actor.name, changedAt: new Date(),
    fields: [{ field: 'stand-up', from: 'closed', to: 'reopened' }]
  })
  console.log(JSON.stringify({ event: 'admin.standupReopened', teamId: team.teamId, actor: actor.oid, localDate: today }))
  return "Today's stand-up is open again. Members can send updates for the rest of the day; the summary won't be sent again."
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

interface GraphGroup { id: string, displayName?: string | null, resourceProvisioningOptions?: string[] | null }

const short = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  // Graph's 403 text is long and does not name the permission that is missing.
  return / 403 /.test(text) ? 'the Graph app is missing the GroupMember.Read.All permission.' : text.slice(0, 120)
}

/** Every Teams team in the tenant, for the dropdown. Needs GroupMember.Read.All. */
export async function teamsTeamOptions (actor: Actor): Promise<{ teams: Array<{ id: string, name: string }> }> {
  if (!mayAdminister(actor.oid, config.admin.userIds) && (await teamsFor(actor)).length === 0) {
    throw new AdminError(403, 'You are not the Scrum Master of any team.')
  }
  try {
    const found = await graphRequest<{ value: GraphGroup[] }>(
      'GET', "/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName&$top=999"
    )
    const teams = found.value.map((g) => ({ id: g.id, name: g.displayName ?? g.id }))
    teams.sort((a, b) => a.name.localeCompare(b.name))
    return { teams }
  } catch (error) {
    throw new AdminError(502, `Teams teams could not be listed: ${short(error)}`)
  }
}

/** Set explicitly, or the team's own id (Scrum Team Alpha was created from its Teams team). */
function resolvedGroupId (team: TeamConfig): string {
  return team.teamsGroupId ?? team.teamId
}

/** The group, when it is a Teams team that no other scrum team uses. */
async function checkTeamsTeam (groupId: string, teams: TeamConfig[], exceptTeamId?: string): Promise<{ id: string, name: string }> {
  let group: GraphGroup
  try {
    group = await graphRequest<GraphGroup>('GET', `/groups/${encodeURIComponent(groupId)}?$select=id,displayName,resourceProvisioningOptions`)
  } catch (error) {
    if (error instanceof Error && error.message.includes(' 404 ')) throw new AdminError(400, 'That Teams team does not exist in this tenant.')
    throw new AdminError(502, `The Teams team could not be read: ${short(error)}`)
  }
  if (!(group.resourceProvisioningOptions ?? []).includes('Team')) throw new AdminError(400, 'That group is not a Teams team.')
  const holder = teams.find((t) => t.teamId !== exceptTeamId && resolvedGroupId(t) === group.id)
  if (holder !== undefined) throw new AdminError(409, `${group.displayName ?? 'That Teams team'} is already used by ${holder.name}.`)
  return { id: group.id, name: group.displayName ?? group.id }
}

/** Admin only: the scrum team's Teams team, or '' to clear it. */
export async function setTeamsTeam (team: TeamConfig, rawGroupId: unknown, actor: Actor): Promise<string> {
  if (!mayAdminister(actor.oid, config.admin.userIds)) throw new AdminError(403, 'Only an admin can set the Teams team.')
  const groupId = String(rawGroupId ?? '').trim()
  if (groupId === '') {
    if (team.teamsGroupId === undefined) return 'Nothing changed.'
    const { teamsGroupId: _id, teamsGroupName: _name, ...rest } = team
    await saveTeam(rest)
    await recordConfigChange({
      teamId: team.teamId, changedBy: actor.name, changedAt: new Date(),
      fields: [{ field: 'teamsGroupId', from: team.teamsGroupId, to: null }]
    })
    return 'Teams team cleared.'
  }
  const group = await checkTeamsTeam(groupId, await allTeams(), team.teamId)
  const changed = await applyChange(team, { teamsGroupId: group.id, teamsGroupName: group.name }, actor.name)
  return changed.length === 0 ? 'Nothing changed.' : `${team.name} is linked to the Teams team ${group.name}.`
}

/** The team's Teams team, or undefined when none is set (or its own id is not one). */
async function teamsTeamOf (team: TeamConfig): Promise<{ id: string, name: string } | Unknown | undefined> {
  if (team.teamsGroupId !== undefined) return { id: team.teamsGroupId, name: team.teamsGroupName ?? team.teamsGroupId }
  try {
    const group = await graphRequest<GraphGroup>('GET', `/groups/${encodeURIComponent(team.teamId)}?$select=id,displayName,resourceProvisioningOptions`)
    return (group.resourceProvisioningOptions ?? []).includes('Team') ? { id: group.id, name: group.displayName ?? group.id } : undefined
  } catch (error) {
    // A team made on the admin page has a random id: no such group, so none is set.
    if (error instanceof Error && (error.message.includes(' 404 ') || error.message.includes(' 400 '))) return undefined
    return { error: short(error) }
  }
}

async function hasTeamsLicence (memberId: string): Promise<boolean | Unknown> {
  try {
    const found = await graphRequest<{ value: Array<{ servicePlans?: Array<{ servicePlanName?: string, provisioningStatus?: string }> }> }>(
      'GET', `/users/${encodeURIComponent(memberId)}/licenseDetails?$select=servicePlans`
    )
    return found.value.some((licence) => (licence.servicePlans ?? []).some((plan) =>
      (plan.servicePlanName ?? '').startsWith('TEAMS') && plan.provisioningStatus === 'Success'))
  } catch (error) {
    return { error: short(error) }
  }
}

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

/** SPEC-008 10m: tick or untick tracker access by hand, when it can't be checked. */
export async function tickTrackerAccess (team: TeamConfig, memberId: string, rawDone: unknown, actor: Actor): Promise<string> {
  const member = team.members.find((m) => m.memberId === memberId)
  if (member === undefined) throw new AdminError(404, 'That person is not on the team.')
  const done = rawDone === true
  const members = team.members.map((m): Member => {
    if (m.memberId !== memberId) return m
    const { onboarding: _old, ...rest } = m
    return done ? { ...rest, onboarding: { trackerAccess: { by: actor.name, at: new Date().toISOString() } } } : rest
  })
  await applyChange(team, { members }, actor.name)
  return done ? `Tracker access ticked for ${member.displayName}.` : `Tracker access unticked for ${member.displayName}.`
}

// ── SPEC-008 10n: automatic onboarding and offboarding ─────────────────────

/**
 * Does every onboarding step the assistant can (Teams team, app, Jira). A step
 * that fails is reported and can be retried; it never undoes the steps that
 * worked.
 */
export async function provisionMember (teamId: string, memberId: string, actor: Actor): Promise<string> {
  const team = await getTeam(teamId)
  const member = team?.members.find((m) => m.memberId === memberId)
  if (team === undefined || member === undefined) throw new AdminError(404, 'That person is not on the team.')

  const done: string[] = []
  const problems: string[] = []

  const teamsTeam = await teamsTeamOf(team)
  if (teamsTeam === undefined) {
    problems.push('Teams team: not set for this team')
  } else if ('error' in teamsTeam) {
    problems.push(`Teams team: ${teamsTeam.error}`)
  } else {
    try {
      assertLinkedTeamsTeam(teamsTeam.id, (await allTeams()).map(resolvedGroupId))
      if (await addToTeamsTeam(teamsTeam.id, memberId) === 'added') done.push(`added to ${teamsTeam.name}`)
    } catch (error) {
      problems.push(`Teams team: ${reason(error)}`)
    }
  }

  try {
    if (await installApp(memberId) === 'added') done.push('Scrum Assistant installed')
  } catch (error) {
    problems.push(`App: ${reason(error)}`)
  }

  // Only when the team uses Jira (10n, M10); a member already linked is left alone.
  let jiraAccountId = member.jiraAccountId
  const client = team.jira === undefined ? undefined : jira()
  if (client !== undefined && (jiraAccountId ?? '') === '') {
    const email = member.email ?? (await lookUpUser(memberId).catch(() => undefined))?.mail ?? undefined
    if (email === undefined) {
      problems.push('Jira: no email address for them')
    } else {
      try {
        let accountId = await client.findUserByEmail(email)
        if (accountId === undefined) {
          accountId = await client.inviteUser(email)
          done.push('invited to Jira')
        } else if (!await client.hasJiraAccess(accountId)) {
          // M13: someone removed earlier keeps their account but not Jira itself.
          await client.restoreJiraAccess(accountId, email)
          done.push('Jira access restored')
        }
        const holder = team.members.find((m) => m.jiraAccountId === accountId && m.memberId !== memberId)
        if (holder !== undefined) {
          problems.push(`Jira: that account is already linked to ${holder.displayName}`)
        } else {
          jiraAccountId = accountId
          done.push('linked to Jira')
        }
      } catch (error) {
        problems.push(`Jira: ${reason(error)}`)
      }
    }
  }

  if (jiraAccountId !== member.jiraAccountId && jiraAccountId !== undefined) {
    const members = team.members.map((m): Member => m.memberId === memberId ? { ...m, jiraAccountId } : m)
    await applyChange(team, { members }, actor.name)
  }
  console.log(JSON.stringify({ event: 'admin.provisioned', teamId, memberId, done: done.length, problems: problems.length }))

  const parts = [
    done.length === 0 ? 'Nothing new to do automatically.' : `Done: ${done.join(', ')}.`,
    problems.length === 0 ? '' : `Not done: ${problems.join('; ')}. Use Retry on their onboarding once fixed.`
  ]
  return parts.filter((p) => p !== '').join(' ')
}

/**
 * Removes a member completely, the same way for everyone (user decision,
 * 5 Oct 2026): out of the Teams team, app uninstalled, Jira access removed.
 * What can't be done automatically — the licence, the Atlassian account, a
 * step that failed — is their offboarding checklist. Never throws: a failed
 * step becomes a "to do by hand" item.
 */
async function offboard (team: TeamConfig, member: Member): Promise<Leaver['items']> {
  const items: Leaver['items'] = []
  const teamsTeam = await teamsTeamOf(team)
  const group = teamsTeam !== undefined && !('error' in teamsTeam) ? teamsTeam : undefined

  let teamsRemoved = false
  if (group === undefined) {
    items.push({ label: 'Teams team', state: 'manual', detail: teamsTeam === undefined
      ? "No Teams team is set for this team. Remove them from the team's Teams team by hand."
      : `Could not check (${(teamsTeam as Unknown).error}). Remove them from the team's Teams team by hand.` })
  } else {
    try {
      assertLinkedTeamsTeam(group.id, (await allTeams()).map(resolvedGroupId))
      const outcome = await removeFromTeamsTeam(group.id, member.memberId)
      teamsRemoved = true
      items.push({ label: 'Teams team', state: 'auto', detail: outcome === 'removed' ? `Removed from ${group.name}` : `Was not in ${group.name}` })
    } catch (error) {
      items.push({ label: 'Teams team', state: 'manual', detail: `Could not remove them (${reason(error)}). Remove them from ${group.name} in Teams.` })
    }
  }

  try {
    const outcome = await uninstallApp(member.memberId)
    items.push({ label: 'Scrum Assistant app', state: 'auto', detail: outcome === 'removed' ? 'Uninstalled' : 'Was not installed' })
  } catch (error) {
    items.push({ label: 'Scrum Assistant app', state: 'manual', detail: `Could not uninstall it (${reason(error)}). Uninstall it for them in the Teams admin center.` })
  }

  const client = jira()
  if (client !== undefined) {
    try {
      const email = member.email ?? (await lookUpUser(member.memberId).catch(() => undefined))?.mail ?? undefined
      const accountId = (member.jiraAccountId ?? '') !== ''
        ? member.jiraAccountId as string
        : email === undefined ? undefined : await client.findUserByEmail(email)
      if (accountId === undefined) {
        items.push({ label: 'Jira access', state: 'auto', detail: 'No Jira account found for them' })
      } else if (accountId === await client.myAccountId()) {
        // The assistant's own Jira account: removing it would cut off every team.
        items.push({ label: 'Jira access', state: 'manual', detail: "This is the account the assistant uses for Jira, so it was not removed." })
      } else {
        await client.removeUser(accountId)
        items.push({ label: 'Jira access', state: 'auto', detail: 'Removed from the Jira site' })
        items.push({ label: 'Atlassian account', state: 'manual', detail: 'Their Atlassian account itself stays. Close it in Atlassian administration if they are leaving.' })
      }
    } catch (error) {
      items.push({ label: 'Jira access', state: 'manual', detail: `Could not remove it (${reason(error)}). Remove them in Jira's user management.` })
    }
  }

  const onGroupSite = group !== undefined && team.tracker.kind === 'sharepoint' &&
    await graphRequest<{ owner?: { group?: { id?: string } } }>('GET', `/sites/${team.tracker.siteId}/drive?$select=owner`)
      .then((drive) => drive.owner?.group?.id === group.id).catch(() => false)
  items.push(onGroupSite && teamsRemoved
    ? { label: 'Tracker access', state: 'auto', detail: `Ended with ${group?.name ?? 'the Teams team'} membership. Their rows stay in the tracker.` }
    : { label: 'Tracker access', state: 'manual', detail: 'Remove their tracker access. Their rows stay in the tracker.' })

  items.push({ label: 'Microsoft 365 licence', state: 'manual', detail: 'Remove their licence in the Microsoft 365 admin center if they are leaving the organisation.' })
  return items
}

/** 10n: the offboarding checklist is done; the person leaves the Leaving list. */
export async function finishLeaver (team: TeamConfig, memberId: string, actor: Actor): Promise<string> {
  const leaver = (team.leaving ?? []).find((l) => l.memberId === memberId)
  if (leaver === undefined) throw new AdminError(404, 'That person is not on the Leaving list.')
  await applyChange(team, { leaving: (team.leaving ?? []).filter((l) => l.memberId !== memberId) }, actor.name)
  return `Offboarding of ${leaver.displayName} marked finished.`
}
