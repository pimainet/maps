// Tiện ích dùng chung cho các API hộp thư review (chỉ server).
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { REVIEW_INBOX_ENABLED } from '@/lib/features'

export const REVIEW_COLUMNS =
  'id, client_id, workspace_id, source, gbp_review_name, author_name, rating, review_text, reviewed_at, reviewed_at_exact, relative_time, owner_reply, owner_reply_at, reply_source, sentiment, urgency, topics, ai_summary, draft_reply, draft_warnings, drafted_at, draft_count, final_reply, approved_at, approved_via, status, status_changed_at, post_attempts, posted_at, gbp_reply_state, post_error, task_id, first_seen_at'

/** Cột trả cho trang công khai của chủ quán (không có id nội bộ khác ngoài id review). */
export const PUBLIC_REVIEW_COLUMNS =
  'id, author_name, rating, review_text, reviewed_at, relative_time, urgency, ai_summary, draft_reply, draft_warnings, final_reply, status'

export function inboxOff(): NextResponse | null {
  return REVIEW_INBOX_ENABLED ? null : NextResponse.json({ error: 'Hộp thư review đang tắt.' }, { status: 404 })
}

export function routeError(error: any): NextResponse {
  const m = typeof error?.message === 'string' ? error.message : ''
  if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
  if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
  // Bảng chưa có = chưa chạy migration 029
  if (error?.code === '42P01' || /client_reviews|review_watch_state|review_draft_events/.test(m) && /does not exist|schema cache/.test(m)) {
    return NextResponse.json({ error: 'Chưa chạy migration 029_review_inbox.sql.', code: 'migration_missing' }, { status: 503 })
  }
  return NextResponse.json({ error: publicError(error) }, { status: 500 })
}

/** Bearer cho các API Make gọi. Dùng REVIEWS_MAKE_SECRET nếu đặt, không thì dùng chung AUTOPOST_SECRET (Make đã có sẵn). */
export function makeSecret(): string | null {
  return process.env.REVIEWS_MAKE_SECRET || process.env.AUTOPOST_SECRET || null
}

export function authorizedMake(req: Request): boolean {
  const secret = makeSecret()
  if (!secret) return false
  const a = Buffer.from(req.headers.get('authorization') || '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function makeGuard(req: Request): NextResponse | null {
  const off = inboxOff()
  if (off) return off
  if (!makeSecret()) return NextResponse.json({ error: 'Chưa đặt AUTOPOST_SECRET (hoặc REVIEWS_MAKE_SECRET).' }, { status: 503 })
  if (!authorizedMake(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}

export function newReviewLinkToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(v)

/** 'YYYY-MM' theo giờ VN. */
export function vnMonthKey(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7)
}
