import crypto from 'node:crypto'
import { AUTO_POST_ENABLED } from '@/lib/features'

export function autoPostFeatureOn(): boolean {
  return AUTO_POST_ENABLED
}

/** So khớp Authorization: Bearer <AUTOPOST_SECRET> bằng timingSafeEqual. */
export function authorizedAutopost(req: Request): boolean {
  const secret = process.env.AUTOPOST_SECRET
  if (!secret) return false
  const given = req.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function newUploadToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
