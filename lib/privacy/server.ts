/**
 * Phần chạy ở server cho BVDLCN: ghi đồng ý, xoá tài khoản đến hạn, dọn dữ liệu quá hạn.
 * Mọi hàm nhận SupabaseClient service role (supabaseAdmin) để test được bằng client giả.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingRelationError } from './db-compat'
import { consentState, type ConsentRow } from './consent-state'
import { CONSENT_VERSION, planAccountDeletion, type ConsentChoice, type Membership } from './policy'

export type RecordConsentInput = {
  userId: string
  purposes: ConsentChoice
  action: 'grant' | 'withdraw' | 'update'
  source: 'signup' | 'consent_gate' | 'settings' | 'admin'
  consentedAt?: Date
  ip: string | null
  userAgent: string | null
  version?: string
}

export async function loadConsentHistory(admin: SupabaseClient, userId: string): Promise<{ setupRequired: boolean; rows: ConsentRow[] }> {
  const { data, error } = await admin
    .from('consent_records')
    .select('policy_version, purposes, action, source, consented_at, recorded_at')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(50)
  if (error) {
    if (isMissingRelationError(error)) return { setupRequired: true, rows: [] }
    throw new Error(error.message)
  }
  return { setupRequired: false, rows: (data || []) as ConsentRow[] }
}

export async function recordConsent(admin: SupabaseClient, input: RecordConsentInput): Promise<void> {
  const { error } = await admin.from('consent_records').insert({
    user_id: input.userId,
    policy_version: input.version || CONSENT_VERSION,
    purposes: {
      service: input.purposes.service === true,
      cross_border: input.purposes.cross_border === true,
      marketing: input.purposes.marketing === true,
    },
    action: input.action,
    source: input.source,
    consented_at: (input.consentedAt || new Date()).toISOString(),
    ip: input.ip,
    user_agent: input.userAgent,
  })
  if (error) throw new Error(error.message)
}

export async function currentConsent(admin: SupabaseClient, userId: string) {
  const h = await loadConsentHistory(admin, userId)
  return { setupRequired: h.setupRequired, history: h.rows, ...consentState(h.rows) }
}

/** Workspace của user kèm số thành viên / số chủ sở hữu (để biết xoá được hay phải chuyển quyền). */
export async function loadMemberships(admin: SupabaseClient, userId: string): Promise<(Membership & { name: string })[]> {
  const { data: mine, error } = await admin.from('workspace_members').select('workspace_id, role, workspaces(name)').eq('user_id', userId)
  if (error) throw new Error(error.message)
  const ids = (mine || []).map((m: any) => m.workspace_id)
  if (!ids.length) return []
  const { data: all, error: e2 } = await admin.from('workspace_members').select('workspace_id, role').in('workspace_id', ids)
  if (e2) throw new Error(e2.message)
  return (mine || []).map((m: any) => {
    const rows = (all || []).filter((r: any) => r.workspace_id === m.workspace_id)
    return {
      workspace_id: m.workspace_id,
      role: m.role,
      name: m.workspaces?.name || 'Không gian làm việc',
      member_count: rows.length,
      owner_count: rows.filter((r: any) => r.role === 'owner').length,
    }
  })
}

async function removeWorkspaceFiles(admin: SupabaseClient, workspaceId: string): Promise<number> {
  const { data, error } = await admin
    .from('client_photos')
    .select('storage_bucket, storage_path, original_path')
    .eq('workspace_id', workspaceId)
    .limit(5000)
  if (error) throw new Error(error.message)
  const byBucket = new Map<string, string[]>()
  for (const p of data || []) {
    const bucket = (p as any).storage_bucket || 'client-photos'
    for (const path of [(p as any).storage_path, (p as any).original_path]) {
      if (typeof path === 'string' && path) byBucket.set(bucket, [...(byBucket.get(bucket) || []), path])
    }
  }
  let removed = 0
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100)
      const { error: rmErr } = await admin.storage.from(bucket).remove(chunk)
      if (rmErr) throw new Error(`storage: ${rmErr.message}`)
      removed += chunk.length
    }
  }
  return removed
}

export type DeletionRun = { processed: number; done: number; needs_attention: number; skipped?: string }

/**
 * Thực hiện các yêu cầu xoá tài khoản đã qua thời gian huỷ (gọi từ cron hằng ngày).
 * Xoá: workspace chỉ có mình user (kèm doanh nghiệp, review, ảnh, kết nối Google...), rời workspace dùng chung,
 * ẩn danh yêu cầu tư vấn, rồi xoá tài khoản đăng nhập (profiles, nhắc việc xoá theo).
 * GIỮ: payments / bank_transactions / billing_events (chứng từ kế toán ≥10 năm; workspace_id/user_id tự về NULL).
 */
export async function executeDueDeletions(admin: SupabaseClient, now = new Date(), limit = 5): Promise<DeletionRun> {
  const { data: due, error } = await admin
    .from('data_requests')
    .select('id, user_id')
    .eq('kind', 'delete_account')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit)
  if (error) {
    if (isMissingRelationError(error)) return { processed: 0, done: 0, needs_attention: 0, skipped: 'migration 033 chưa chạy' }
    throw new Error(error.message)
  }
  const run: DeletionRun = { processed: 0, done: 0, needs_attention: 0 }
  for (const req of due || []) {
    run.processed++
    const claim = await admin.from('data_requests').update({ status: 'processing' }).eq('id', req.id).eq('status', 'scheduled').select('id')
    if (claim.error || !claim.data?.length) continue
    try {
      const memberships = await loadMemberships(admin, req.user_id)
      const plan = planAccountDeletion(memberships)
      if (plan.blockers.length) {
        await admin
          .from('data_requests')
          .update({
            status: 'needs_attention',
            admin_note: 'Người dùng là chủ sở hữu duy nhất của workspace còn thành viên khác — cần chuyển quyền trước khi xoá.',
            result: { blockers: plan.blockers },
          })
          .eq('id', req.id)
        run.needs_attention++
        continue
      }
      let files = 0
      for (const ws of plan.deleteWorkspaces) {
        files += await removeWorkspaceFiles(admin, ws)
        const del = await admin.from('workspaces').delete().eq('id', ws)
        if (del.error) throw new Error(`workspace: ${del.error.message}`)
      }
      for (const ws of plan.leaveWorkspaces) {
        const del = await admin.from('workspace_members').delete().eq('workspace_id', ws).eq('user_id', req.user_id)
        if (del.error) throw new Error(`member: ${del.error.message}`)
      }
      const scrub = await admin.rpc('privacy_scrub_user', { p_user: req.user_id })
      if (scrub.error) throw new Error(`scrub: ${scrub.error.message}`)
      const delUser = await admin.auth.admin.deleteUser(req.user_id)
      if (delUser.error && !/not.?found/i.test(delUser.error.message)) throw new Error(`auth: ${delUser.error.message}`)
      await admin
        .from('data_requests')
        .update({
          status: 'done',
          completed_at: new Date().toISOString(),
          result: { workspaces_deleted: plan.deleteWorkspaces.length, workspaces_left: plan.leaveWorkspaces.length, files_removed: files, scrub: scrub.data },
        })
        .eq('id', req.id)
      run.done++
    } catch (e: any) {
      console.error('account deletion failed:', req.id, e?.message)
      await admin
        .from('data_requests')
        .update({ status: 'needs_attention', admin_note: String(e?.message || e).slice(0, 500) })
        .eq('id', req.id)
      run.needs_attention++
    }
  }
  return run
}

/** Dọn dữ liệu quá hạn (migration 033: run_privacy_retention). Chưa chạy migration thì bỏ qua, không làm cron lỗi. */
export async function runRetention(admin: SupabaseClient): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc('run_privacy_retention')
  if (error) {
    if (isMissingRelationError(error)) return { skipped: 'migration 033 chưa chạy' }
    throw new Error(error.message)
  }
  return (data || {}) as Record<string, unknown>
}
