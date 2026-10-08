import { randomUUID } from 'node:crypto'
import type { TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { localDate } from '../config/time.js'
import { runJobNow } from '../jobs/tick.js'
import { DEFAULT_WORKING_DAYS } from '../jobs/schedule.js'
import { cannotRun } from './guards.js'
import { type Unknown } from './onboarding.js'
import { allTeams, configChangesFor, getChannelRef, llmUsageForDates, recordConfigChange, reopenStandup as markReopened, runsForDate, saveTeam, scrumMasterOf, standupState } from '../store/index.js'
import { checkSchedule, isValidTimezone, mayAdminister, normaliseEmail, overlapProblem } from './validate.js'
import { Actor, AdminError, GraphUser, JOB_TYPES, applyChange, checkTeamsTeam, installForScrumMaster, jira, lookUpUser, teamsFor } from './common.js'
import { setJiraProject } from './integrations.js'

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
