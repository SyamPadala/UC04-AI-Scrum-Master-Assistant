import type { ConversationReference } from '@microsoft/agents-activity'
import type { BotTeam, TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { graphRequest } from '../graph/client.js'
import { channelReference, listTeamChannels } from '../bot/channels.js'
import { allTeams, botTeams, clearChannelRef, recordConfigChange, saveChannelRef, saveTeam } from '../store/index.js'
import { mayAdminister } from './validate.js'
import { Actor, AdminError, GraphGroup, applyChange, checkTeamsTeam, jira, short, teamsFor, teamsTeamOf } from './common.js'

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

export async function findChannel (channelId: string): Promise<{ holder: BotTeam, channelName: string } | undefined> {
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
export const TRACKER_COLUMNS = ['Date', 'WIN', 'Description', 'AssignedTo', 'Comment', 'Status', 'AnyBlocker', 'UpdatedBy']

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
