import { config } from '../config/env.js'

interface TokenCache { token: string, expiresAt: number }
let cache: TokenCache | undefined

/**
 * Gets an application-level Microsoft Graph token via client credentials.
 * Cached until a minute before expiry so every call does not re-authenticate.
 */
export async function getGraphToken (): Promise<string> {
  if (cache !== undefined && Date.now() < cache.expiresAt) return cache.token

  const url = `https://login.microsoftonline.com/${config.m365.tenantId}/oauth2/v2.0/token`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.graph.clientId,
      client_secret: config.graph.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  })

  const body = await response.json() as { access_token?: string, expires_in?: number, error_description?: string }
  if (response.ok !== true || body.access_token === undefined) {
    throw new Error(`Graph token request failed: ${response.status} ${body.error_description ?? 'no detail'}`)
  }

  cache = {
    token: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000
  }
  return cache.token
}

/** Calls a Microsoft Graph endpoint, throwing with Graph's own error text on failure. */
export async function graphRequest<T> (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getGraphToken()
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  if (response.ok !== true) {
    throw new Error(`Graph ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as T
}
