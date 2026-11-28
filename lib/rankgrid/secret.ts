import crypto from 'node:crypto'
import { RANK_GRID_ENABLED } from '@/lib/features'

export function rankGridFeatureOn(): boolean {
  return RANK_GRID_ENABLED
}

/** Chữ ký HMAC cho pingback của 1 điểm lưới (RANKGRID_PINGBACK_SECRET). */
export function pingbackSig(pointId: string): string | null {
  const secret = process.env.RANKGRID_PINGBACK_SECRET
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(`rankgrid:${pointId}`).digest('base64url').slice(0, 32)
}

export function verifyPingbackSig(pointId: string, sig: string | null | undefined): boolean {
  const expected = pingbackSig(pointId)
  if (!expected || !sig) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Authorization: Bearer <CRON_SECRET> (giống các cron hiện có). */
export function authorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = req.headers.get('authorization') || ''
  const a = Buffer.from(given)
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
