import { createHmac } from 'node:crypto'

const ALLOWED_ORIGINS = [
  'https://maps.bgs.com.vn',
  'https://bgs.com.vn',
  'https://www.bgs.com.vn',
]

function isAllowedOrigin(origin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }

  // Origin headers contain only scheme/host/port. Reject malformed values
  // instead of reflecting paths, credentials, or other attacker-controlled text.
  if (origin !== parsed.origin) return false
  if (ALLOWED_ORIGINS.includes(parsed.origin)) return true

  const landingOrigin = process.env.LANDING_ORIGIN
  if (landingOrigin) {
    try {
      if (parsed.origin === new URL(landingOrigin).origin) return true
    } catch {
      // An invalid optional origin must not widen the allowlist.
    }
  }

  // Localhost is useful for local development, but must not be allowed in production.
  return process.env.NODE_ENV !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
}

export function publicCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  })
  if (origin && isAllowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
}

/** Store a keyed pseudonym instead of a raw IP; the key stays server-side. */
export function clientIpHash(ip: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('IP hashing key is unavailable')
  return createHmac('sha256', key).update(`maps-demo-ip:v1:${ip}`).digest('hex')
}

export function requestText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}
