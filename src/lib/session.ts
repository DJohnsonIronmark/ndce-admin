// Edge-compatible signed-cookie session.
// Uses HMAC-SHA256 via the Web Crypto API so middleware can verify on Edge runtime.

const COOKIE_NAME = 'admin_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface SessionPayload {
  user: string
  exp: number
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function signSession(user: string, secret: string): Promise<string> {
  const payload: SessionPayload = { user, exp: Date.now() + SESSION_TTL_MS }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const key = await getKey(secret)
  const sigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes)
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(sigBuf))}`
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  let payloadBytes: Uint8Array
  let providedSig: Uint8Array
  try {
    payloadBytes = base64UrlDecode(parts[0])
    providedSig = base64UrlDecode(parts[1])
  } catch {
    return null
  }
  const key = await getKey(secret)
  const expectedSigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes as BufferSource)
  const expectedSig = new Uint8Array(expectedSigBuf)
  if (!timingSafeEqual(providedSig, expectedSig)) return null
  let payload: SessionPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes))
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null
  return payload
}

export function buildSessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

export function buildClearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export const SESSION_COOKIE_NAME = COOKIE_NAME

// Helper for API routes to require an authenticated session.
// Returns the verified session payload or null. The caller decides
// the response shape (some routes 401, others redirect).
export async function requireSession(request: Request): Promise<SessionPayload | null> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return null
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  if (!match) return null
  const token = decodeURIComponent(match[1])
  return await verifySession(token, secret)
}

// Constant-time string compare for secrets. Same length is enforced
// before the loop runs so we never leak length via early return timing.
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Service auth used for server-to-server calls inside the admin app
// (e.g. /api/assistant calling /api/website/find-replace). Returns
// true when the request carries the configured WEBSITE_SERVICE_TOKEN
// in the X-Service-Token header.
export function hasValidServiceToken(request: Request): boolean {
  const expected = process.env.WEBSITE_SERVICE_TOKEN
  if (!expected) return false
  const provided = request.headers.get('x-service-token')
  if (!provided) return false
  return timingSafeStringEqual(provided, expected)
}

// Combined guard: either a valid admin session OR a matching service
// token. Routes that are called both from the browser (cookie) and
// from inside other routes (token) should use this so they accept
// both legit callers without exposing themselves to the public.
export async function requireSessionOrServiceToken(request: Request): Promise<{ ok: true; via: 'session' | 'service-token' } | { ok: false }> {
  if (hasValidServiceToken(request)) return { ok: true, via: 'service-token' }
  const session = await requireSession(request)
  if (session) return { ok: true, via: 'session' }
  return { ok: false }
}
