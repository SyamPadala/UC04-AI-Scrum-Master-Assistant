import { config } from '../config/env.js'
import { graphRequest } from '../graph/client.js'
import { serviceToken } from '../auth/tokens.js'

/**
 * The tenant changes behind automatic onboarding (SPEC-008 10n): Teams team
 * membership and the app install. Each answers what it did ('added' or
 * 'already'; 'removed' or 'absent'), so the page can say so.
 *
 * Teams team membership uses the Graph app (TeamMember.ReadWrite.All). The app
 * install uses the bot's own registration, because a "self" install permission
 * only lets an app install itself (found 29 Sep 2026, scripts/install-app.mjs).
 */

export type Outcome = 'added' | 'already' | 'removed' | 'absent'

const userBind = (userId: string): string => `https://graph.microsoft.com/v1.0/users('${userId}')`

async function membershipId (groupId: string, userId: string): Promise<string | undefined> {
  const found = await graphRequest<{ value: Array<{ id: string, userId?: string }> }>(
    'GET', `/teams/${encodeURIComponent(groupId)}/members?$filter=(microsoft.graph.aadUserConversationMember/userId eq '${userId}')`
  )
  return found.value.find((m) => m.userId === userId)?.id ?? found.value[0]?.id
}

/**
 * M7: TeamMember.ReadWrite.All covers every Teams team in the tenant, and
 * Microsoft offers no narrower version. So the code holds the line: it changes
 * membership only in a Teams team that is linked to a scrum team.
 */
export function assertLinkedTeamsTeam (groupId: string, linkedGroupIds: string[]): void {
  if (!linkedGroupIds.includes(groupId)) throw new Error(`refused: Teams team ${groupId} is not linked to any scrum team`)
}

export async function addToTeamsTeam (groupId: string, userId: string): Promise<Outcome> {
  if (await membershipId(groupId, userId) !== undefined) return 'already'
  await graphRequest('POST', `/teams/${encodeURIComponent(groupId)}/members`, {
    '@odata.type': '#microsoft.graph.aadUserConversationMember',
    roles: [],
    'user@odata.bind': userBind(userId)
  })
  return 'added'
}

export async function removeFromTeamsTeam (groupId: string, userId: string): Promise<Outcome> {
  const id = await membershipId(groupId, userId)
  if (id === undefined) return 'absent'
  await graphRequest('DELETE', `/teams/${encodeURIComponent(groupId)}/members/${encodeURIComponent(id)}`)
  return 'removed'
}

// ── app install, with the bot's own registration ──────────────────────────

async function botGraph<T> (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = await serviceToken('botGraph')
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Graph ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`)
  return (text.trim() === '' ? undefined : JSON.parse(text)) as T
}

async function installation (userId: string): Promise<string | undefined> {
  const found = await botGraph<{ value: Array<{ id: string }> }>(
    'GET', `/users/${encodeURIComponent(userId)}/teamwork/installedApps?$expand=teamsApp&$filter=teamsApp/externalId eq '${config.bot.appId}'`
  )
  return found.value[0]?.id
}

export async function installApp (userId: string): Promise<Outcome> {
  if (await installation(userId) !== undefined) return 'already'
  // The catalogue entry is read with the Graph app (AppCatalog.Read.All).
  const catalogue = await graphRequest<{ value: Array<{ id: string }> }>(
    'GET', `/appCatalogs/teamsApps?$filter=externalId eq '${config.bot.appId}'`
  )
  const app = catalogue.value[0]
  if (app === undefined) throw new Error('Scrum Assistant is not in the organisation catalogue.')
  await botGraph('POST', `/users/${encodeURIComponent(userId)}/teamwork/installedApps`, {
    'teamsApp@odata.bind': `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${app.id}`
  })
  return 'added'
}

export async function uninstallApp (userId: string): Promise<Outcome> {
  const id = await installation(userId)
  if (id === undefined) return 'absent'
  await botGraph('DELETE', `/users/${encodeURIComponent(userId)}/teamwork/installedApps/${encodeURIComponent(id)}`)
  return 'removed'
}

/** A failure as one readable line, with the permission named when it is the cause. */
export function reason (error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/\/teams\/.* 403 /.test(text)) return 'the Graph app is missing the TeamMember.ReadWrite.All permission.'
  if (/installedApps.* 40[34] /.test(text)) return "the app can't be installed yet — usually the Microsoft 365 licence is missing or still being set up."
  if (/license|licence|seat/i.test(text) && /jira|atlassian|user/i.test(text)) return 'Jira has no free seat.'
  return text.slice(0, 160)
}
