// Phía server: đọc gói hiệu lực của workspace + cắt dữ liệu theo gói. Dùng service role (người dùng không tự sửa được gói).
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ENTITLEMENTS, normalizePlan, type Entitlements, type PlanKey } from './plans'

export type PlanState = {
  plan: PlanKey
  entitlements: Entitlements
  periodEnd: string | null
  /** Gói sắp đổi từ kỳ sau (đã trả, chờ tới lượt). */
  scheduled: { plan: PlanKey; start: string } | null
}

/** Gói hiệu lực = workspaces.plan, nhưng nếu kỳ đã hết hạn quá hạn ân hạn mà cron chưa kịp hạ thì vẫn tính là free. */
export async function getPlanState(workspaceId: string): Promise<PlanState> {
  const [{ data: ws }, { data: subs }] = await Promise.all([
    supabaseAdmin.from('workspaces').select('plan').eq('id', workspaceId).maybeSingle(),
    supabaseAdmin
      .from('subscriptions')
      .select('plan,status,current_period_start,current_period_end')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'scheduled'])
      .order('current_period_start', { ascending: true }),
  ])
  let plan = normalizePlan(ws?.plan)
  const active = (subs || []).find((s: any) => s.status === 'active')
  const scheduled = (subs || []).find((s: any) => s.status === 'scheduled')
  if (plan !== 'free' && active) {
    const graceMs = 3 * 86_400_000
    if (new Date(active.current_period_end).getTime() + graceMs < Date.now()) plan = 'free'
  }
  // Gói thủ công do superadmin đặt (vd 'agency') không có kỳ: giữ nguyên là gói đầy đủ nhất được biết
  if (plan === 'free' && ws?.plan && !['free', 'basic', 'full'].includes(ws.plan)) plan = 'full'
  return {
    plan,
    entitlements: ENTITLEMENTS[plan],
    periodEnd: active?.current_period_end ?? null,
    scheduled: scheduled ? { plan: normalizePlan(scheduled.plan), start: scheduled.current_period_start } : null,
  }
}

export async function getEntitlements(workspaceId: string): Promise<Entitlements> {
  return (await getPlanState(workspaceId)).entitlements
}

/** Id các việc được mở theo gói: `limit` việc đầu của mỗi kế hoạch (theo thứ tự tạo). */
export async function unlockedTaskIds(workspaceId: string, planId: string | null, limit: number | null): Promise<Set<string> | null> {
  if (limit === null) return null // không giới hạn
  let q = supabaseAdmin.from('tasks').select('id,plan_id,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: true }).order('id', { ascending: true })
  if (planId) q = q.eq('plan_id', planId)
  const { data } = await q
  const perPlan = new Map<string, number>()
  const out = new Set<string>()
  for (const t of data || []) {
    const k = String((t as any).plan_id ?? '')
    const n = perPlan.get(k) || 0
    if (n < limit) out.add((t as any).id)
    perPlan.set(k, n + 1)
  }
  return out
}

/** true = được dùng. Việc nằm ngoài `taskLimit` đầu tiên của kế hoạch thì bị khoá ở gói miễn phí. */
export async function isTaskUnlocked(workspaceId: string, task: { id: string; plan_id?: string | null }): Promise<boolean> {
  const ent = await getEntitlements(workspaceId)
  if (ent.taskLimit === null) return true
  const open = await unlockedTaskIds(workspaceId, task.plan_id ?? null, ent.taskLimit)
  return !open || open.has(task.id)
}

export const LOCKED_RESPONSE = { error: 'Việc này thuộc gói trả phí. Nâng cấp để mở toàn bộ kế hoạch.', code: 'plan_locked' }
