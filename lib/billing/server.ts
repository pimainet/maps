// Phía server: đọc gói hiệu lực của workspace + cắt dữ liệu theo gói. Dùng service role (người dùng không tự sửa được gói).
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ENTITLEMENTS, normalizePlan, resolveEffectivePlan, type Entitlements, type PlanKey } from './plans'

export type PlanState = {
  plan: PlanKey
  entitlements: Entitlements
  periodEnd: string | null
  /** Gói sắp đổi từ kỳ sau (đã trả, chờ tới lượt). */
  scheduled: { plan: PlanKey; start: string } | null
}

const PLAN_TTL_MS = 15_000
const planCache = new Map<string, { at: number; state: PlanState }>()

export async function getPlanState(workspaceId: string): Promise<PlanState> {
  const hit = planCache.get(workspaceId)
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.state
  const state = await loadPlanState(workspaceId)
  planCache.set(workspaceId, { at: Date.now(), state })
  if (planCache.size > 500) planCache.clear()
  return state
}

async function loadPlanState(workspaceId: string): Promise<PlanState> {
  const [{ data: ws }, { data: subs }] = await Promise.all([
    supabaseAdmin.from('workspaces').select('plan').eq('id', workspaceId).maybeSingle(),
    supabaseAdmin
      .from('subscriptions')
      .select('plan,status,current_period_start,current_period_end')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'scheduled'])
      .order('current_period_start', { ascending: true }),
  ])
  const active = (subs || []).find((s: any) => s.status === 'active')
  const scheduled = (subs || []).find((s: any) => s.status === 'scheduled')
  const plan = resolveEffectivePlan(ws?.plan, active)
  return {
    plan,
    entitlements: ENTITLEMENTS[plan],
    periodEnd: active?.current_period_end ?? null,
    scheduled: scheduled ? { plan: normalizePlan(scheduled.plan), start: scheduled.current_period_start } : null,
  }
}

/**
 * Trong các workspace cho trước, những workspace có gói được theo dõi đánh giá (Review Watch).
 * Dùng gói HIỆU LỰC (cùng quy tắc ân hạn với getPlanState). Lỗi truy vấn thì ném lỗi (không cho chạy),
 * để không vô tình tặng tính năng trả phí khi không đọc được gói.
 */
export async function workspaceIdsWithMonitoring(workspaceIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(workspaceIds.filter(Boolean))]
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [wsRes, subRes] = await Promise.all([
      supabaseAdmin.from('workspaces').select('id,plan').in('id', chunk),
      supabaseAdmin.from('subscriptions').select('workspace_id,current_period_end').eq('status', 'active').in('workspace_id', chunk),
    ])
    if (wsRes.error) throw wsRes.error
    if (subRes.error) throw subRes.error
    const activeByWs = new Map<string, { current_period_end: string }>()
    for (const sub of subRes.data || []) activeByWs.set((sub as any).workspace_id, sub as any)
    for (const ws of wsRes.data || []) {
      const plan = resolveEffectivePlan((ws as any).plan, activeByWs.get((ws as any).id))
      if (ENTITLEMENTS[plan].monitoring) out.add((ws as any).id)
    }
  }
  return out
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
