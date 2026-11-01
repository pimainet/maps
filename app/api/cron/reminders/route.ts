// Vercel Cron gọi route này mỗi sáng (xem vercel.json). Chỉ gửi cho người có việc đến hạn/quá hạn
// (và nhắc nhẹ vào thứ Hai nếu còn việc), tối đa 1 email mỗi ngày, bỏ qua ai đã tắt nhắc.
//
// Bảo vệ: header "Authorization: Bearer <CRON_SECRET>". Vercel tự thêm header này khi
// biến môi trường CRON_SECRET được đặt. Thêm ?dry=1 để xem trước sẽ gửi cho ai mà không gửi thật.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { buildEmailForUser, loadWorkspaceData } from '@/lib/reminders'
import { emailProviderReady, sendEmail, unsubscribeUrl, vnWeekday } from '@/lib/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_USERS_PER_RUN = 300
const MIN_HOURS_BETWEEN_EMAILS = 20
const TIME_BUDGET_MS = 50_000

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = req.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  }
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const summary = {
    dry,
    provider_ready: emailProviderReady(),
    users_checked: 0,
    sent: 0,
    would_send: 0,
    skipped_nothing_due: 0,
    skipped_opted_out: 0,
    skipped_recently_sent: 0,
    skipped_no_email: 0,
    failed: 0,
    truncated: false,
    prefs_unavailable: false,
    errors: [] as string[],
  }

  try {
    // Tải admin client khi chạy (không phải lúc build), vì module này ném lỗi nếu thiếu biến môi trường.
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const today = new Date()

    // 1) Workspace nào có việc đang chờ cần quan tâm hôm nay?
    const todayKey = new Date(today.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
    const isMonday = vnWeekday(today) === 1
    let pendingQuery = admin.from('tasks').select('workspace_id').or('status.eq.pending,status.is.null').limit(5000)
    if (!isMonday) pendingQuery = pendingQuery.lte('due_date', todayKey)
    const pendingRes = await pendingQuery
    if (pendingRes.error) throw pendingRes.error
    const workspaceIds = [...new Set((pendingRes.data || []).map((r: any) => r.workspace_id).filter(Boolean))] as string[]
    if (workspaceIds.length === 0) return NextResponse.json({ ...summary, message: 'Không có việc nào cần nhắc hôm nay.' })

    // 2) Ai thuộc các workspace đó
    const membersRes = await admin.from('workspace_members').select('workspace_id, user_id').in('workspace_id', workspaceIds).limit(5000)
    if (membersRes.error) throw membersRes.error
    const workspacesByUser = new Map<string, string[]>()
    for (const m of membersRes.data || []) {
      const list = workspacesByUser.get(m.user_id) || []
      list.push(m.workspace_id)
      workspacesByUser.set(m.user_id, list)
    }
    const userIds = [...workspacesByUser.keys()]

    // 3) Tùy chọn của từng người. Không có dòng = mặc định bật nhắc.
    const prefs = new Map<string, { email_enabled: boolean; last_sent_at: string | null }>()
    const prefsRes = await admin.from('notification_prefs').select('user_id, email_enabled, last_sent_at').in('user_id', userIds)
    if (prefsRes.error) summary.prefs_unavailable = true // chưa chạy migration 014
    else for (const p of prefsRes.data || []) prefs.set(p.user_id, p)

    // 4) Dữ liệu việc/doanh nghiệp của các workspace, một lần cho tất cả
    const data = await loadWorkspaceData(admin, workspaceIds)

    const profilesRes = await admin.from('profiles').select('id, full_name').in('id', userIds)
    const names = new Map<string, string | null>((profilesRes.data || []).map((p: any) => [p.id, p.full_name]))

    for (const userId of userIds) {
      if (summary.users_checked >= MAX_USERS_PER_RUN || Date.now() - startedAt > TIME_BUDGET_MS) {
        summary.truncated = true
        break
      }
      summary.users_checked += 1

      const pref = prefs.get(userId)
      if (pref && pref.email_enabled === false) {
        summary.skipped_opted_out += 1
        continue
      }
      if (pref?.last_sent_at && Date.now() - new Date(pref.last_sent_at).getTime() < MIN_HOURS_BETWEEN_EMAILS * 3600 * 1000) {
        summary.skipped_recently_sent += 1
        continue
      }

      const email = buildEmailForUser({
        userId,
        fullName: names.get(userId),
        workspaceIds: workspacesByUser.get(userId) || [],
        data,
        now: today,
      })
      if (!email) {
        summary.skipped_nothing_due += 1
        continue
      }

      const userRes = await admin.auth.admin.getUserById(userId)
      const to = userRes.data?.user?.email
      if (!to) {
        summary.skipped_no_email += 1
        continue
      }

      if (dry) {
        summary.would_send += 1
        continue
      }

      const sent = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, unsubscribeUrl: unsubscribeUrl(userId) })
      if (!sent.ok) {
        summary.failed += 1
        if (summary.errors.length < 5) summary.errors.push(sent.skipped ? `Chưa cấu hình gửi email (${sent.skipped})` : sent.error || 'Lỗi không rõ')
        // Chưa có dịch vụ gửi email thì dừng luôn, khỏi lặp lại cho mọi người
        if (sent.skipped) break
        continue
      }
      summary.sent += 1
      if (!summary.prefs_unavailable) {
        await admin.from('notification_prefs').upsert({ user_id: userId, last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      }
    }

    return NextResponse.json(summary)
  } catch (e: any) {
    console.error('cron reminders:', e?.message)
    return NextResponse.json({ ...summary, error: 'Không thể hoàn tất lượt gửi nhắc việc.' }, { status: 500 })
  }
}
