import type { ConversationReference } from '@microsoft/agents-activity'
import { config } from '../config/env.js'

/**
 * Whether a stored chat still exists in Teams, asked without sending anything
 * (SPEC-008 10d). Reads the conversation's member list through the bot's own
 * connection — the same credentials every send uses, so no new permission.
 */

let cached: { token: string, expiresAt: number } | undefined

async function botToken (): Promise<string> {
  if (cached !== undefined && cached.expiresAt > Date.now() + 60_000) return cached.token
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.bot.appId,
    client_secret: config.bot.appPassword,
    scope: 'https://api.botframework.com/.default'
  })
  const response = await fetch(`https://login.microsoftonline.com/${config.m365.tenantId}/oauth2/v2.0/token`, { method: 'POST', body })
  const data = await response.json() as { access_token?: string, expires_in?: number, error_description?: string }
  if (!response.ok || data.access_token === undefined) {
    throw new Error(`bot token request failed: ${data.error_description ?? response.status}`)
  }
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cached.token
}

export type ChatState = 'ok' | 'none' | 'gone'

/** 'none': nothing stored. 'gone': Teams says the chat no longer exists. Other failures throw. */
export async function chatState (reference: string | undefined): Promise<ChatState> {
  if (reference === undefined || reference === '') return 'none'
  const parsed = JSON.parse(reference) as ConversationReference
  const serviceUrl = String(parsed.serviceUrl ?? '').replace(/\/$/, '')
  const conversationId = parsed.conversation?.id ?? ''
  if (serviceUrl === '' || conversationId === '') return 'none'

  const response = await fetch(`${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/members`, {
    headers: { Authorization: `Bearer ${await botToken()}` }
  })
  if (response.ok) return 'ok'
  const text = await response.text()
  if (response.status === 404 && /ConversationNotFound|not found/i.test(text)) return 'gone'
  throw new Error(`Teams answered ${response.status}: ${text.slice(0, 160)}`)
}
