import type { JobType, TeamConfig } from '../types.js'
import { config } from '../config/env.js'
import { graphRequest } from '../graph/client.js'
import { jiraSite, pmFor } from '../pm/factory.js'
import { installApp, reason } from './provision.js'
import { type Unknown } from './onboarding.js'
import { allTeams, getTeam, recordConfigChange, saveTeam } from '../store/index.js'
import { mayManage, normaliseEmail } from './validate.js'

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
export const jira = jiraSite

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

export interface GraphUser {
  id: string
  displayName?: string | null
  mail?: string | null
  userPrincipalName?: string | null
  userType?: string | null
  accountEnabled?: boolean | null
}

export async function lookUpUser (idOrEmail: string): Promise<GraphUser | undefined> {
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
 * SPEC-008 10o (M2): the Scrum Master gets the app the moment they are set,
 * as members do on Add (10n). The install event then stores their chat. A
 * failure is reported, never fatal: the team was still created or changed.
 */
export async function installForScrumMaster (userId: string, name: string): Promise<string> {
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

export interface GraphGroup { id: string, displayName?: string | null, resourceProvisioningOptions?: string[] | null }

export const short = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  // Graph's 403 text is long and does not name the permission that is missing.
  return / 403 /.test(text) ? 'the Graph app is missing the GroupMember.Read.All permission.' : text.slice(0, 120)
}

/** Set explicitly, or the team's own id (Scrum Team Alpha was created from its Teams team). */
export function resolvedGroupId (team: TeamConfig): string {
  return team.teamsGroupId ?? team.teamId
}

/** The group, when it is a Teams team that no other scrum team uses. */
export async function checkTeamsTeam (groupId: string, teams: TeamConfig[], exceptTeamId?: string): Promise<{ id: string, name: string }> {
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

/** The team's Teams team, or undefined when none is set (or its own id is not one). */
export async function teamsTeamOf (team: TeamConfig): Promise<{ id: string, name: string } | Unknown | undefined> {
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

export async function hasTeamsLicence (memberId: string): Promise<boolean | Unknown> {
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
