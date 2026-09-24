import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'
import { config } from '../config/env.js'

/**
 * Microsoft sign-in for the admin page (SPEC-008).
 *
 * Authorization-code flow against the tenant, using the existing Graph Entra
 * app. Only the ID token is used — it says who the person is. What they may do
 * is decided by our own roster (their object id against scrumMasterId), not by
 * any permission in Microsoft 365.
 */

const authority = (): string => `https://login.microsoftonline.com/${config.m365.tenantId}`

export function redirectUri (): string {
  return `${config.admin.publicBaseUrl}/admin/auth/callback`
}

export function authorizeUrl (state: string, nonce: string): string {
  const query = new URLSearchParams({
    client_id: config.graph.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: 'openid profile',
    state,
    nonce,
    prompt: 'select_account'
  })
  return `${authority()}/oauth2/v2.0/authorize?${query.toString()}`
}

export interface SignedInUser { oid: string, name: string }

interface Jwk extends JsonWebKey { kid?: string }
let keyCache: { keys: Jwk[], fetchedAt: number } | undefined

async function signingKeys (): Promise<Jwk[]> {
  // Microsoft rotates these keys; an hour's cache follows rotation closely
  // enough without fetching them on every sign-in.
  if (keyCache !== undefined && Date.now() - keyCache.fetchedAt < 3_600_000) return keyCache.keys
  const response = await fetch(`${authority()}/discovery/v2.0/keys`)
  if (!response.ok) throw new Error(`could not fetch Microsoft signing keys: ${response.status}`)
  const body = await response.json() as { keys?: Jwk[] }
  keyCache = { keys: body.keys ?? [], fetchedAt: Date.now() }
  return keyCache.keys
}

function decodePart (part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
}

/** Checks signature, issuer, audience, tenant, expiry and nonce. */
async function verifyIdToken (token: string, nonce: string): Promise<SignedInUser> {
  const [headerPart, payloadPart, signaturePart] = token.split('.')
  if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    throw new Error('malformed ID token')
  }
  const header = decodePart(headerPart)
  if (header.alg !== 'RS256') throw new Error(`unexpected token algorithm ${String(header.alg)}`)

  const jwk = (await signingKeys()).find((key) => key.kid === header.kid)
  if (jwk === undefined) throw new Error('ID token signed with an unknown key')
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signaturePart, 'base64url')
  )
  if (!valid) throw new Error('ID token signature is not valid')

  const claims = decodePart(payloadPart)
  const tenant = config.m365.tenantId
  if (claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0`) throw new Error('ID token from another issuer')
  if (claims.aud !== config.graph.clientId) throw new Error('ID token for another application')
  if (claims.tid !== tenant) throw new Error('ID token from another tenant')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new Error('ID token expired')
  if (claims.nonce !== nonce) throw new Error('ID token nonce does not match')
  if (typeof claims.oid !== 'string') throw new Error('ID token carries no object id')

  return { oid: claims.oid, name: typeof claims.name === 'string' ? claims.name : claims.oid }
}

export async function completeSignIn (code: string, nonce: string): Promise<SignedInUser> {
  const response = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.graph.clientId,
      client_secret: config.graph.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      scope: 'openid profile'
    })
  })
  const body = await response.json() as { id_token?: string, error?: string, error_description?: string }
  if (!response.ok || body.id_token === undefined) {
    throw new Error(`sign-in failed: ${body.error ?? response.status} ${(body.error_description ?? '').split('\n')[0]}`)
  }
  return await verifyIdToken(body.id_token, nonce)
}
