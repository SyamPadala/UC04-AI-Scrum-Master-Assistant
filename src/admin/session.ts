import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed cookies for the admin page (SPEC-008).
 *
 * The cookie carries its own content, signed with ADMIN_SESSION_SECRET, so no
 * session store is needed and a Cloud Run restart does not sign anyone out.
 * It holds identifiers and an expiry only.
 */

function signature (body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function seal (payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${signature(body, secret)}`
}

/** Returns the payload if the signature is ours and it has not expired. */
export function unseal<T extends { exp: number }> (value: string | undefined, secret: string): T | undefined {
  if (value === undefined || secret === '') return undefined
  const [body, given] = value.split('.')
  if (body === undefined || given === undefined) return undefined

  const expected = Buffer.from(signature(body, secret))
  const actual = Buffer.from(given)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : undefined
  } catch {
    return undefined
  }
}

export function readCookie (header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim())
    }
  }
  return undefined
}

export function cookie (name: string, value: string, maxAgeSeconds: number): string {
  // Lax, not Strict: the sign-in callback arrives as a navigation from
  // Microsoft's login page, and a Strict cookie would not be sent with it.
  // Writes are protected separately by a required request header.
  return `${name}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}
