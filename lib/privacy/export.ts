/**
 * Xuất dữ liệu của người dùng (quyền xem / được cung cấp dữ liệu — Luật 91/2025 Điều 4; NĐ 356 Điều 5: 10 ngày).
 * Chúng tôi trả ngay, dạng JSON. Phạm vi:
 *  - Dữ liệu cá nhân của chính người dùng (hồ sơ, đồng ý, yêu cầu, thanh toán do họ tạo, yêu cầu tư vấn).
 *  - Dữ liệu nghiệp vụ của workspace họ là chủ sở hữu / quản trị (doanh nghiệp, việc, nội dung, review, ...).
 * KHÔNG xuất: token/khoá bí mật (mã truy cập Google, link token tải ảnh/duyệt review), payload Google Maps
 * (gbp_snapshots, đối thủ trên lưới thứ hạng — Google cấm xuất/ lưu nội dung Maps), dữ liệu của người dùng khác.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONSENT_VERSION } from './policy'

const MAX_ROWS = 5000

type Q = { table: string; select: string; col: string; ids?: string[]; value?: string; order?: string }

async function rows(admin: SupabaseClient, q: Q): Promise<unknown[] | { error: string }> {
  let query = admin.from(q.table).select(q.select).limit(MAX_ROWS)
  query = q.ids ? query.in(q.col, q.ids.length ? q.ids : ['00000000-0000-0000-0000-000000000000']) : query.eq(q.col, q.value as string)
  if (q.order) query = query.order(q.order, { ascending: true })
  const { data, error } = await query
  if (error) return { error: 'Không đọc được bảng này (có thể chưa có trên hệ thống).' }
  return data || []
}

export const CLIENT_EXPORT_COLUMNS =
  'id, created_at, updated_at, name, industry, area, phone, contact_name, brand_voice, website_url, gbp_link, status, notes, place_id, gbp_cid, autopost_enabled, autopost_every_days, autopost_cta, autopost_cta_url, autopost_review_mode'

export async function buildUserExport(
  admin: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<Record<string, unknown>> {
  const { data: authUser } = await admin.auth.admin.getUserById(user.id)
  const u = authUser?.user
  const { data: memberships } = await admin
    .from('workspace_members')
    .select('workspace_id, role, created_at, workspaces(id, name, plan, created_at)')
    .eq('user_id', user.id)
  const managed = (memberships || []).filter((m: any) => m.role === 'owner' || m.role === 'admin').map((m: any) => m.workspace_id as string)

  const { data: clientRows } = await admin.from('clients').select('id').in('workspace_id', managed.length ? managed : ['00000000-0000-0000-0000-000000000000'])
  const clientIds = (clientRows || []).map((c: any) => c.id as string)

  const personal = {
    account: u
      ? {
          id: u.id,
          email: u.email,
          phone: u.phone || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          providers: (u.app_metadata as any)?.providers || [],
          full_name: (u.user_metadata as any)?.full_name || null,
        }
      : { id: user.id, email: user.email || null },
    profile: await rows(admin, { table: 'profiles', select: 'id, full_name, avatar_url, role, created_at, updated_at', col: 'id', value: user.id }),
    memberships: memberships || [],
    notification_prefs: await rows(admin, { table: 'notification_prefs', select: 'email_enabled, last_sent_at, created_at, updated_at', col: 'user_id', value: user.id }),
    consent_records: await rows(admin, { table: 'consent_records', select: 'policy_version, purposes, action, source, consented_at, recorded_at, ip, user_agent', col: 'user_id', value: user.id, order: 'recorded_at' }),
    data_requests: await rows(admin, { table: 'data_requests', select: 'kind, status, received_at, due_at, scheduled_for, completed_at, cancelled_at', col: 'user_id', value: user.id, order: 'received_at' }),
    consultation_requests: await rows(admin, { table: 'consultation_requests', select: 'plan_interest, contact_name, phone, email, business_name, message, status, created_at', col: 'user_id', value: user.id }),
    payments_created_by_you: await rows(admin, { table: 'payments', select: 'order_code, plan, period_months, amount_vnd, paid_amount_vnd, status, created_at, paid_at, receipt_no', col: 'user_id', value: user.id, order: 'created_at' }),
  }

  const ws = (table: string, select: string, order?: string) => rows(admin, { table, select, col: 'workspace_id', ids: managed, order })
  const workspaceData = managed.length
    ? {
        workspaces: (memberships || []).filter((m: any) => managed.includes(m.workspace_id)).map((m: any) => m.workspaces),
        members: await ws('workspace_members', 'workspace_id, user_id, role, created_at'),
        subscriptions: await ws('subscriptions', 'workspace_id, plan, status, current_period_start, current_period_end, created_at'),
        payments: await ws('payments', 'workspace_id, order_code, plan, period_months, amount_vnd, paid_amount_vnd, status, created_at, paid_at, receipt_no'),
        clients: await ws('clients', `workspace_id, ${CLIENT_EXPORT_COLUMNS}`),
        client_business_profiles: await ws('client_business_profiles', 'client_id, summary, main_service, services, confirmed, confirmed_at, updated_at'),
        audits: await ws('audits', 'id, client_id, created_at, module_key, score_overview, audit_result, status', 'created_at'),
        plans: await ws('plans', 'id, client_id, created_at, module_key, plan_result, start_date, end_date, status', 'created_at'),
        tasks: await ws('tasks', 'id, client_id, created_at, title, description, task_type, due_date, status, priority, completed_at', 'created_at'),
        contents: await ws('contents', 'id, client_id, created_at, channel, topic, goal, ai_content, final_content, scheduled_date, published_at, status', 'created_at'),
        client_reviews: await ws('client_reviews', 'client_id, source, author_name, rating, review_text, reviewed_at, owner_reply, draft_reply, final_reply, status, posted_at, first_seen_at', 'first_seen_at'),
        client_photos: await ws('client_photos', 'client_id, original_filename, mime_type, width, height, ai_description, ai_tags, status, used_count, last_posted_at, created_at', 'created_at'),
        autopost_queue: await ws('autopost_queue', 'client_id, topic, caption, cta_type, cta_url, scheduled_for, status, approved_at, approved_via, created_at', 'created_at'),
        google_connections: await ws('google_connections', 'client_id, google_account_email, scope, status, created_at, updated_at'),
        rank_keywords: await ws('rank_keywords', 'client_id, keyword, is_primary, active, created_at'),
        rank_scans_summary: await ws('rank_scans', 'client_id, keyword, status, arp, atrp, solv, top10_pct, found_pct, created_at, completed_at', 'created_at'),
        agency_monthly_reports: await ws('agency_monthly_reports', 'client_id, period_month, status, summary, sent_at'),
      }
    : null

  return {
    format: 'local-growth-os-export',
    format_version: 1,
    exported_at: new Date().toISOString(),
    policy_version: CONSENT_VERSION,
    note:
      'Bản xuất dữ liệu theo yêu cầu của bạn. Không gồm mã bí mật (token Google, link tải ảnh) và nội dung Google Maps mà điều khoản Google không cho xuất lại. Mỗi bảng tối đa ' +
      MAX_ROWS +
      ' dòng; cần đầy đủ hơn hãy liên hệ chúng tôi.',
    personal,
    managed_workspaces: workspaceData,
    managed_client_count: clientIds.length,
  }
}
