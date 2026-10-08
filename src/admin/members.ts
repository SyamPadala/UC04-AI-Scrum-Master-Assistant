import type { Leaver, Member, TeamConfig } from '../types.js'
import { graphRequest } from '../graph/client.js'
import { addToTeamsTeam, assertLinkedTeamsTeam, installApp, reason, removeFromTeamsTeam, uninstallApp } from './provision.js'
import { type Unknown } from './onboarding.js'
import { allTeams, getTeam, saveScrumMasterRef, teamForMember } from '../store/index.js'
import { normaliseEmail, overlapProblem } from './validate.js'
import { Actor, AdminError, applyChange, jira, lookUpUser, resolvedGroupId, teamsTeamOf } from './common.js'
import { onboarding } from './health.js'

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
export async function offboard (team: TeamConfig, member: Member): Promise<Leaver['items']> {
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
