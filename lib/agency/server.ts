// Gói Làm hộ — phía server (service role): kiểm quyền nhân viên, nạp hàng đợi công việc, báo cáo tháng, nhật ký.
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { getCurrentUser, requireSuperAdmin } from '@/lib/auth'
import { effectivePlansFor } from '@/lib/billing/server'
import { isStaffManaged } from '@/lib/billing/plans'
import { AUTO_POST_ENABLED, DONE_FOR_YOU_ENABLED, RANK_GRID_ENABLED, REVIEW_INBOX_ENABLED } from '@/lib/features'
import { appUrl, sendEmail } from '@/lib/notifications'
import { buildMonthlyReport, periodMonthDate, periodStartUtc, addMonths, upcomingReportPeriod, type MonthlyReport, type RankPoint } from './report'
import { buildMonthlyReportEmail } from './emails'

// ── Cổng vào của các API nhân viên ─────────────────────────────────────────
export type Staff = { id: string | null; email?: string }

/** Tắt cờ -> 404. Không phải Super Admin -> 403. Trả Staff khi hợp lệ. */
export async function staffGuard(): Promise<{ staff: Staff } | { res: NextResponse }> {
  if (!DONE_FOR_YOU_ENABLED) return { res: NextResponse.json({ error: 'Gói Làm hộ đang tắt (NEXT_PUBLIC_DONE_FOR_YOU_ENABLED).' }, { status: 404 }) }
  try {
    await requireSuperAdmin()
  } catch (e: any) {
    return { res: NextResponse.json({ error: publicError(e) }, { status: 403 }) }
  }
  const u = await getCurrentUser()
  return { staff: { id: u?.id ?? null, email: u?.email } }
}

export function agencyError(error: any): NextResponse {
  const m = typeof error?.message === 'string' ? error.message : ''
  // Bảng chưa có = chưa chạy migration 032
  if (error?.code === '42P01' || (/consultation_requests|agency_monthly_reports|agency_actions/.test(m) && /does not exist|schema cache/.test(m))) {
    return NextResponse.json({ error: 'Chưa chạy migration 032_done_for_you.sql.', code: 'migration_missing' }, { status: 503 })
  }
  if (m.includes('Unauthorized') || m.includes('Forbidden')) return NextResponse.json({ error: publicError(error) }, { status: 403 })
  return NextResponse.json({ error: publicError(error) }, { status: 500 })
}

export async function logAgencyAction(
  admin: SupabaseClient,
  a: { actor: string | null; workspaceId?: string | null; clientId?: string | null; kind: string; refId?: string | null; data?: unknown },
): Promise<void> {
  const { error } = await admin.from('agency_actions').insert({
    actor: a.actor,
    workspace_id: a.workspaceId ?? null,
    client_id: a.clientId ?? null,
    kind: a.kind,
    ref_id: a.refId ?? null,
    data: a.data ?? null,
  })
  if (error) console.error('agency_actions insert failed:', error.message) // nhật ký lỗi không được chặn thao tác chính
}

/** Workspace nào đang ở gói Làm hộ (theo gói HIỆU LỰC: hết hạn quá ân hạn thì không còn). */
export async function doneForYouWorkspaces(admin: SupabaseClient): Promise<{ id: string; name: string; periodEnd: string | null }[]> {
  const { data: ws, error } = await admin.from('workspaces').select('id, name').eq('plan', 'done_for_you').limit(500)
  if (error) throw error
  const ids = (ws || []).map((w: any) => w.id as string)
  if (!ids.length) return []
  const plans = await effectivePlansFor(ids)
  const { data: subs } = await admin.from('subscriptions').select('workspace_id, current_period_end').eq('status', 'active').in('workspace_id', ids)
  const end = new Map<string, string>((subs || []).map((s: any) => [s.workspace_id, s.current_period_end]))
  return (ws || [])
    .filter((w: any) => isStaffManaged(plans.get(w.id)))
    .map((w: any) => ({ id: w.id, name: w.name, periodEnd: end.get(w.id) ?? null }))
}

/** true nếu workspace đang ở gói Làm hộ hiệu lực (route nhân viên chỉ thao tác trên khách Làm hộ). */
export async function isDoneForYouWorkspace(workspaceId: string): Promise<boolean> {
  const m = await effectivePlansFor([workspaceId])
  return isStaffManaged(m.get(workspaceId))
}

// ── Dữ liệu báo cáo tháng ───────────────────────────────────────────────────
const toPoint = (s: any): RankPoint => ({
  keyword: s.keyword,
  solv: s.solv != null ? Number(s.solv) : null,
  arp: s.arp != null ? Number(s.arp) : null,
  atrp: s.atrp != null ? Number(s.atrp) : null,
  top10: s.top10_pct != null ? Number(s.top10_pct) : null,
  centerRank: s.center_rank ?? null,
  scannedAt: s.completed_at ?? null,
})

/** Gom các số liệu của 1 khách trong 1 tháng (giờ VN) rồi dựng báo cáo. */
export async function buildReportForClient(admin: SupabaseClient, clientId: string, period: string, now = new Date()): Promise<{ report: MonthlyReport; workspaceId: string } | null> {
  const { data: client } = await admin.from('clients').select('id, name, workspace_id').eq('id', clientId).maybeSingle()
  if (!client) return null
  const start = periodStartUtc(period).toISOString()
  const end = periodStartUtc(addMonths(period, 1)).toISOString()

  // Lưới thứ hạng: lần quét xong gần nhất của mỗi từ khoá trong tháng, và mốc gần nhất TRƯỚC tháng
  let rank: { keyword: string; current: RankPoint | null; previous: RankPoint | null }[] | null = null
  if (RANK_GRID_ENABLED) {
    const { data: scans, error } = await admin
      .from('rank_scans')
      .select('keyword, solv, arp, atrp, top10_pct, center_rank, completed_at, status')
      .eq('client_id', clientId)
      .in('status', ['done', 'partial'])
      .not('solv', 'is', null)
      .lt('completed_at', end)
      .order('completed_at', { ascending: false })
      .limit(600)
    if (error && error.code !== '42P01') throw error
    if (!error) {
      const byKw = new Map<string, { current: RankPoint | null; previous: RankPoint | null }>()
      for (const s of (scans || []) as any[]) {
        const e = byKw.get(s.keyword) || { current: null, previous: null }
        const inMonth = s.completed_at >= start
        if (inMonth && !e.current) e.current = toPoint(s)
        else if (!inMonth && !e.previous) e.previous = toPoint(s)
        byKw.set(s.keyword, e)
      }
      rank = [...byKw.entries()].map(([keyword, v]) => ({ keyword, ...v }))
    }
  }

  const count = async (q: PromiseLike<{ count: number | null; error: any }>) => {
    const r = await q
    if (r.error && r.error.code !== '42P01') throw r.error
    return r.error ? 0 : r.count || 0
  }
  const head = { count: 'exact' as const, head: true }
  const [postsPublished, postsPlanned, reviewsNew, reviewsReplied, reviewsOpen, tasksDone, tasksOpen] = await Promise.all([
    count(admin.from('autopost_log').select('id', head).eq('client_id', clientId).eq('success', true).gte('created_at', start).lt('created_at', end) as any),
    count(admin.from('autopost_queue').select('id', head).eq('client_id', clientId).in('status', ['needs_review', 'captioned']) as any),
    count(admin.from('client_reviews').select('id', head).eq('client_id', clientId).gte('first_seen_at', start).lt('first_seen_at', end) as any),
    count(admin.from('client_reviews').select('id', head).eq('client_id', clientId).in('status', ['posted', 'manual_copied']).gte('status_changed_at', start).lt('status_changed_at', end) as any),
    count(admin.from('client_reviews').select('id', head).eq('client_id', clientId).in('status', ['new', 'drafted', 'approved', 'posting', 'failed']) as any),
    count(admin.from('tasks').select('id', head).eq('client_id', clientId).eq('status', 'done').gte('completed_at', start).lt('completed_at', end) as any),
    count(admin.from('tasks').select('id', head).eq('client_id', clientId).eq('status', 'pending') as any),
  ])

  const report = buildMonthlyReport({
    period,
    clientName: (client as any).name,
    now,
    rank,
    work: { postsPublished, postsPlanned, reviewsNew, reviewsReplied, reviewsOpen, tasksDone, tasksOpen },
  })
  return { report, workspaceId: (client as any).workspace_id }
}

export type ReportRow = { id: string; client_id: string; workspace_id: string; period_month: string; status: 'draft' | 'sent'; summary: MonthlyReport; generated_at: string; sent_at: string | null }

/** Tạo/ghi đè bản NHÁP. Báo cáo đã gửi khách thì không ghi đè (trả null). */
export async function generateReport(admin: SupabaseClient, clientId: string, period: string, actor: string | null, now = new Date()): Promise<{ row: ReportRow | null; reason?: 'already_sent' | 'no_client' }> {
  const built = await buildReportForClient(admin, clientId, period, now)
  if (!built) return { row: null, reason: 'no_client' }
  const month = periodMonthDate(period)
  const { data: existing } = await admin.from('agency_monthly_reports').select('id, status').eq('client_id', clientId).eq('period_month', month).maybeSingle()
  if (existing && (existing as any).status === 'sent') return { row: null, reason: 'already_sent' }
  const payload = { workspace_id: built.workspaceId, client_id: clientId, period_month: month, status: 'draft', summary: built.report, generated_by: actor, generated_at: now.toISOString() }
  const q = existing
    ? admin.from('agency_monthly_reports').update(payload).eq('id', (existing as any).id).eq('status', 'draft')
    : admin.from('agency_monthly_reports').insert(payload)
  const { data, error } = await q.select('id, client_id, workspace_id, period_month, status, summary, generated_at, sent_at').maybeSingle()
  if (error) throw error
  return { row: (data as ReportRow) ?? null, reason: data ? undefined : 'already_sent' }
}

export type SendReportResult = { ok: true; emailed: number; recipients: number; emailSkipped: boolean } | { ok: false; error: string; status: number }

/** Công bố báo cáo cho khách (hiện ở trang báo cáo) và gửi email cho owner/admin của workspace. Email lỗi không chặn việc công bố. */
export async function sendReport(admin: SupabaseClient, reportId: string, actor: string | null, opts: { email: boolean } = { email: true }): Promise<SendReportResult> {
  const { data: row } = await admin.from('agency_monthly_reports').select('id, client_id, workspace_id, period_month, status, summary').eq('id', reportId).maybeSingle()
  if (!row) return { ok: false, error: 'Không tìm thấy báo cáo.', status: 404 }
  const r = row as any
  if (r.status === 'sent') return { ok: false, error: 'Báo cáo này đã gửi cho khách.', status: 409 }
  if (!(await isDoneForYouWorkspace(r.workspace_id))) return { ok: false, error: 'Khách không còn ở gói Làm hộ.', status: 409 }

  let recipients: string[] = []
  if (opts.email) {
    const { data } = await admin.rpc('billing_recipients', { p_ws: r.workspace_id })
    recipients = [...new Set(((data as any[]) || []).map((x) => x.email).filter(Boolean))]
  }
  const url = `${appUrl()}/clients/${r.client_id}/monthly-report?period=${String(r.period_month).slice(0, 7)}`
  const mail = buildMonthlyReportEmail(r.summary as MonthlyReport, url)
  let emailed = 0
  let emailSkipped = false
  const sentTo: string[] = []
  for (const to of recipients) {
    const res = await sendEmail({ to, ...mail })
    if (res.ok) {
      emailed++
      sentTo.push(to)
    } else if (res.skipped) {
      emailSkipped = true
      break
    } else console.error('monthly report email failed:', res.error)
  }
  const { data: upd, error } = await admin
    .from('agency_monthly_reports')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: actor, sent_to: sentTo })
    .eq('id', r.id)
    .eq('status', 'draft')
    .select('id')
  if (error) throw error
  if (!upd || upd.length === 0) return { ok: false, error: 'Báo cáo vừa được gửi ở nơi khác.', status: 409 }
  await logAgencyAction(admin, { actor, workspaceId: r.workspace_id, clientId: r.client_id, kind: 'report_send', refId: r.id, data: { emailed, recipients: recipients.length, emailSkipped } })
  return { ok: true, emailed, recipients: recipients.length, emailSkipped }
}

// ── Hàng đợi công việc ──────────────────────────────────────────────────────
export type QueueClient = {
  client_id: string
  name: string
  autopost_enabled: boolean
  has_location: boolean
  posts: { pending: any[]; waiting: number; published_30d: number; last_posted_at: string | null }
  reviews: { pending: any[]; counts: { to_approve: number; to_draft: number; to_post: number; urgent: number }; make_ready: boolean }
  tasks: { pending: any[]; open: number; overdue: number }
  report: { period: string; due_date: string; closing: boolean; id: string | null; status: 'none' | 'draft' | 'sent'; sent_at: string | null }
}
export type QueueWorkspace = { workspace_id: string; name: string; period_end: string | null; clients: QueueClient[] }

const PER_CLIENT_LIMIT = 15
const vnToday = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)

export function emptyQueueTotals() {
  return { posts: 0, reviews: 0, urgentReviews: 0, tasks: 0, tasksOverdue: 0, reportsDue: 0 }
}

export async function loadQueue(admin: SupabaseClient, now = new Date()): Promise<{ workspaces: QueueWorkspace[]; totals: ReturnType<typeof emptyQueueTotals>; flags: Record<string, boolean> }> {
  const flags = { autopost: AUTO_POST_ENABLED, reviews: REVIEW_INBOX_ENABLED, rank: RANK_GRID_ENABLED }
  const totals = emptyQueueTotals()
  const wss = await doneForYouWorkspaces(admin)
  if (!wss.length) return { workspaces: [], totals, flags }
  const wsIds = wss.map((w) => w.id)
  const { data: clients, error } = await admin
    .from('clients')
    .select('id, name, workspace_id, autopost_enabled, gbp_location_resource')
    .in('workspace_id', wsIds)
    .order('name', { ascending: true })
    .limit(500)
  if (error) throw error
  const cl = (clients || []) as any[]
  const ids = cl.map((c) => c.id as string)
  if (!ids.length) return { workspaces: wss.map((w) => ({ workspace_id: w.id, name: w.name, period_end: w.periodEnd, clients: [] })), totals, flags }

  const today = vnToday(now)
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const { period, dueDate, closing } = upcomingReportPeriod(now)

  const safe = async <T,>(p: PromiseLike<{ data: T | null; error: any }>, fallback: T): Promise<T> => {
    const r = await p
    if (r.error) {
      if (r.error.code === '42P01' || r.error.code === '42703') return fallback // bảng/cột chưa có (migration chưa chạy)
      throw r.error
    }
    return (r.data ?? fallback) as T
  }

  const [queueRows, waitingRows, logs, reviews, tasks, reports] = await Promise.all([
    AUTO_POST_ENABLED
      ? safe<any[]>(admin.from('autopost_queue').select('id, client_id, photo_id, caption, topic, status, created_at').in('client_id', ids).eq('status', 'needs_review').order('created_at', { ascending: true }).limit(300), [])
      : Promise.resolve([] as any[]),
    AUTO_POST_ENABLED
      ? safe<any[]>(admin.from('autopost_queue').select('client_id').in('client_id', ids).eq('status', 'captioned').limit(500), [])
      : Promise.resolve([] as any[]),
    AUTO_POST_ENABLED
      ? safe<any[]>(admin.from('autopost_log').select('client_id, created_at').in('client_id', ids).eq('success', true).gte('created_at', since30).limit(2000), [])
      : Promise.resolve([] as any[]),
    REVIEW_INBOX_ENABLED
      ? safe<any[]>(
          admin
            .from('client_reviews')
            .select('id, client_id, author_name, rating, review_text, reviewed_at, urgency, ai_summary, draft_reply, draft_warnings, final_reply, status, post_error, gbp_review_name')
            .in('client_id', ids)
            .in('status', ['new', 'drafted', 'approved', 'failed'])
            .order('reviewed_at', { ascending: false, nullsFirst: false })
            .limit(1500),
          [],
        )
      : Promise.resolve([] as any[]),
    safe<any[]>(admin.from('tasks').select('id, client_id, title, description, task_type, priority, due_date, status').in('client_id', ids).eq('status', 'pending').order('due_date', { ascending: true, nullsFirst: false }).limit(1500), []),
    safe<any[]>(admin.from('agency_monthly_reports').select('id, client_id, status, sent_at').in('client_id', ids).eq('period_month', periodMonthDate(period)), []),
  ])

  // Ảnh xem trước cho bài chờ duyệt (link ký 1 giờ)
  const photoIds = [...new Set(queueRows.map((q) => q.photo_id).filter(Boolean))]
  const photos = new Map<string, any>()
  if (photoIds.length) {
    const rows = await safe<any[]>(admin.from('client_photos').select('id, storage_bucket, storage_path, ai_description').in('id', photoIds), [])
    for (const p of rows) photos.set(p.id, p)
  }
  const signed = new Map<string, string>()
  await Promise.all(
    [...photos.values()].map(async (p) => {
      if (!p.storage_path) return
      const { data } = await admin.storage.from(p.storage_bucket || 'client-photos').createSignedUrl(p.storage_path, 3600)
      if (data?.signedUrl) signed.set(p.id, data.signedUrl)
    }),
  )

  const by = <T extends { client_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) (m.get(r.client_id) || m.set(r.client_id, []).get(r.client_id)!).push(r)
    return m
  }
  const qBy = by(queueRows), wBy = by(waitingRows), lBy = by(logs), rBy = by(reviews), tBy = by(tasks), repBy = by(reports)
  const rank = (u: string) => (u === 'high' ? 0 : u === 'normal' ? 1 : 2)

  const out: QueueWorkspace[] = wss.map((w) => ({
    workspace_id: w.id,
    name: w.name,
    period_end: w.periodEnd,
    clients: cl
      .filter((c) => c.workspace_id === w.id)
      .map((c): QueueClient => {
        const q = (qBy.get(c.id) || []).map((x) => ({ queue_id: x.id, caption: x.caption, topic: x.topic, created_at: x.created_at, photo_url: signed.get(x.photo_id) ?? null, photo_note: photos.get(x.photo_id)?.ai_description ?? null }))
        const rv = (rBy.get(c.id) || []).slice()
        const makeReady = typeof c.gbp_location_resource === 'string' && /^accounts\/[^/]+\/locations\/[^/]+$/.test(c.gbp_location_resource)
        // Việc của nhân viên: new (cần soạn), drafted (cần duyệt), failed (đăng lỗi); approved chỉ khi chưa nối Make (cần dán tay)
        const reviewTodo = rv.filter((x) => x.status !== 'approved' || !makeReady || !x.gbp_review_name).sort((a, b) => rank(a.urgency) - rank(b.urgency) || a.rating - b.rating)
        const counts = {
          to_approve: rv.filter((x) => x.status === 'drafted').length,
          to_draft: rv.filter((x) => x.status === 'new').length,
          to_post: rv.filter((x) => x.status === 'approved' || x.status === 'failed').length,
          urgent: rv.filter((x) => x.urgency === 'high').length,
        }
        const tk = (tBy.get(c.id) || [])
        const overdue = tk.filter((x) => x.due_date && x.due_date < today).length
        const rep = (repBy.get(c.id) || [])[0]
        const logsC = lBy.get(c.id) || []
        totals.posts += q.length
        totals.reviews += counts.to_approve + counts.to_draft
        totals.urgentReviews += rv.filter((x) => x.urgency === 'high' && (x.status === 'drafted' || x.status === 'new')).length
        totals.tasks += tk.length
        totals.tasksOverdue += overdue
        if (closing && (!rep || rep.status !== 'sent')) totals.reportsDue += 1
        return {
          client_id: c.id,
          name: c.name,
          autopost_enabled: !!c.autopost_enabled,
          has_location: makeReady,
          posts: { pending: q, waiting: (wBy.get(c.id) || []).length, published_30d: logsC.length, last_posted_at: logsC.map((l) => l.created_at).sort().pop() ?? null },
          reviews: { pending: reviewTodo.slice(0, PER_CLIENT_LIMIT), counts, make_ready: makeReady },
          tasks: { pending: tk.slice(0, PER_CLIENT_LIMIT), open: tk.length, overdue },
          report: { period, due_date: dueDate, closing, id: rep?.id ?? null, status: rep ? (rep.status as 'draft' | 'sent') : 'none', sent_at: rep?.sent_at ?? null },
        }
      }),
  }))
  return { workspaces: out, totals, flags }
}
