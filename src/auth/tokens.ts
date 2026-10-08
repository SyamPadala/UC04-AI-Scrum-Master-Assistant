import { config } from '../config/env.js'

/**
 * Microsoft sign-in for the service itself (client credentials), in one place
 * (design review, 8 Oct 2026: it was written four times). Each app + audience
 * pair keeps its own token, reused until a minute before it expires.
 */

export type TokenFor = 'graph' | 'botGraph' | 'botConnector'

const sources: Record<TokenFor, () => { clientId: string, secret: string, scope: string, label: string }> = {
  /** The Graph app: SharePoint, users, groups, mail, catalogue. */
  graph: () => ({ clientId: config.graph.clientId, secret: config.graph.clientSecret, scope: 'https://graph.microsoft.com/.default', label: 'Graph' }),
  /** The bot's own registration on Graph: installing the app for someone. */
  botGraph: () => ({ clientId: config.bot.appId, secret: config.bot.appPassword, scope: 'https://graph.microsoft.com/.default', label: 'Bot app' }),
  /** The bot on the Bot Framework connector: chat and channel checks. */
  botConnector: () => ({ clientId: config.bot.appId, secret: config.bot.appPassword, scope: 'https://api.botframework.com/.default', label: 'Bot' })
}

const cache = new Map<TokenFor, { token: string, expiresAt: number }>()

export async function serviceToken (kind: TokenFor): Promise<string> {
  const held = cache.get(kind)
  if (held !== undefined && Date.now() < held.expiresAt) return held.token
  const { clientId, secret, scope, label } = sources[kind]()
  const response = await fetch(`https://login.microsoftonline.com/${config.m365.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope, grant_type: 'client_credentials' })
  })
  const body = await response.json() as { access_token?: string, expires_in?: number, error_description?: string }
  if (!response.ok || body.access_token === undefined) {
    throw new Error(`${label} token request failed: ${response.status} ${body.error_description ?? 'no detail'}`)
  }
  cache.set(kind, { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 })
  return body.access_token
}
