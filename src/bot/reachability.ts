import type { ConversationReference } from '@microsoft/agents-activity'
import { config } from '../config/env.js'
import { serviceToken } from '../auth/tokens.js'

/**
 * Whether a stored chat still exists in Teams, asked without sending anything
 * (SPEC-008 10d). Reads the conversation's member list through the bot's own
 * connection — the same credentials every send uses, so no new permission.
 */

const botToken = async (): Promise<string> => await serviceToken('botConnector')

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
