import { z } from 'zod'
import type { ConversationReference } from '@microsoft/agents-activity'
import { config } from '../config/env.js'
import { httpErrorFrom, withRetry } from '../util/retry.js'
import type { BotTeam } from '../types.js'

/**
 * The Teams teams the app is installed in, and their channels (SPEC-008
 * behaviour 6), so the stakeholder channel can be chosen on the admin page.
 *
 * Channels are read through the bot's own Bot Framework connection rather than
 * Graph: listing channels in Graph needs another application permission, and
 * the bot can already see every team it is installed in.
 */

const channelDataSchema = z.object({
  team: z.object({ id: z.string().min(1), name: z.string().optional() })
})

/** The Teams team an activity came from, or undefined outside a team. */
export function teamOfActivity (channelData: unknown): { id: string, name?: string } | undefined {
  const parsed = channelDataSchema.safeParse(channelData)
  return parsed.success ? parsed.data.team : undefined
}

/**
 * A reference that posts into `channelId` as a new post.
 *
 * A reference taken from a message in a channel carries ';messageid=...' and
 * the id of that message; sending with it would bury the summary as a reply
 * in someone's thread.
 */
export function channelReference (reference: ConversationReference, channelId: string): string {
  const { activityId: _thread, ...rest } = reference
  return JSON.stringify({
    ...rest,
    conversation: { ...reference.conversation, id: channelId, conversationType: 'channel', isGroup: true }
  })
}

const channelListSchema = z.object({
  conversations: z.array(z.object({ id: z.string(), name: z.string().nullish() }))
})

export interface TeamChannel { channelId: string, channelName: string }

/** The default channel has no name in the API; Teams shows it as General. */
export function parseChannelList (body: unknown): TeamChannel[] {
  return channelListSchema.parse(body).conversations.map((c) => ({
    channelId: c.id,
    channelName: c.name ?? 'General'
  }))
}

interface TokenCache { token: string, expiresAt: number }
let cache: TokenCache | undefined

async function botToken (): Promise<string> {
  if (cache !== undefined && Date.now() < cache.expiresAt) return cache.token
  const response = await fetch(`https://login.microsoftonline.com/${config.m365.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.bot.appId,
      client_secret: config.bot.appPassword,
      scope: 'https://api.botframework.com/.default',
      grant_type: 'client_credentials'
    })
  })
  const body = await response.json() as { access_token?: string, expires_in?: number, error_description?: string }
  if (response.ok !== true || body.access_token === undefined) {
    throw new Error(`Bot token request failed: ${response.status} ${body.error_description ?? 'no detail'}`)
  }
  cache = { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 }
  return cache.token
}

/** Every channel in a Teams team the app is installed in. Fails if it has been removed. */
export async function listTeamChannels (team: BotTeam): Promise<TeamChannel[]> {
  const reference = JSON.parse(team.reference) as ConversationReference
  const serviceUrl = (reference.serviceUrl ?? '').replace(/\/+$/, '')
  if (serviceUrl === '') throw new Error(`No service address stored for ${team.name}`)

  return await withRetry(async () => {
    const response = await fetch(`${serviceUrl}/v3/teams/${encodeURIComponent(team.teamThreadId)}/conversations`, {
      headers: { authorization: `Bearer ${await botToken()}` }
    })
    if (!response.ok) throw await httpErrorFrom(response)
    return parseChannelList(await response.json())
  }, { label: 'teams.channels' })
}
