/** DB helpers cho bảng gbp_snapshots. */

import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import type { GbpSnapshotStatus } from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_CACHE_DAYS } from '@/lib/gbp-snapshot-types'

export async function createPendingSnapshot(input: {
  workspace_id: string
  client_id: string
  place_id?: string | null
  maps_url?: string | null
  source?: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('gbp_snapshots')
    .insert({
      workspace_id: input.workspace_id,
      client_id: input.client_id,
      place_id: input.place_id ?? null,
      maps_url: input.maps_url ?? null,
      source: input.source || 'outscraper',
      status: 'pending' as GbpSnapshotStatus,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSnapshot(
  id: string,
  workspaceId: string,
  patch: {
    status?: GbpSnapshotStatus
    error_message?: string | null
    captured_at?: string | null
    place_id?: string | null
    maps_url?: string | null
    business_name?: string | null
    description?: string | null
    primary_category?: string | null
    rating?: number | null
    review_count?: number | null
    phone?: string | null
    website_url?: string | null
    address_text?: string | null
    posts_signal?: string | null
    recent_posts?: unknown
    photos_signal?: string | null
    photos_count_est?: number | null
    reviews?: unknown
    competitors?: unknown
    raw_json?: unknown
    // cột mới (migration 015)
    opening_hours?: string | null
    additional_categories?: string | null
    services?: unknown
    attributes?: unknown
    action_links?: unknown
    photo_categories?: unknown
    business_status?: string | null
    claim_signal?: string | null
    rating_distribution?: unknown
    review_stats?: unknown
    coverage?: unknown
  }
) {
  const supabase = await createSupabaseServerClient()

  const run = (body: Record<string, unknown>) =>
    supabase
      .from('gbp_snapshots')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single()

  let { data, error } = await run(patch)

  // Chưa chạy migration 015 -> PostgREST báo thiếu cột. Lưu lại phần cột cũ thay vì làm hỏng cả lần quan sát.
  if (error && isMissingColumnError(error)) {
    const legacy: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (!NEW_COLUMNS.has(k)) legacy[k] = v
    }
    console.warn('gbp_snapshots: thiếu cột migration 015, chỉ lưu cột cũ.')
    ;({ data, error } = await run(legacy))
  }

  if (error) throw error
  return hydrateSnapshot(data)
}

/**
 * Bản sao các trường "sâu" được lưu thêm trong raw_json.deep (cột raw_json có từ trước).
 * Nhờ vậy dữ liệu mới (giờ mở cửa, dịch vụ, thuộc tính, review_stats, coverage...) vẫn dùng được
 * ngay cả khi chưa chạy migration 015. Cột thật (nếu có) luôn được ưu tiên.
 */
export const GBP_DEEP_KEYS = [
  'opening_hours',
  'hours_today',
  'additional_categories',
  'services',
  'attributes',
  'action_links',
  'photo_categories',
  'business_status',
  'claim_signal',
  'rating_distribution',
  'review_stats',
  'coverage',
] as const

export function hydrateSnapshot<T extends Record<string, any> | null | undefined>(row: T): T {
  if (!row) return row
  const deep = row.raw_json && typeof row.raw_json === 'object' ? (row.raw_json as any).deep : null
  if (!deep || typeof deep !== 'object') return row
  const out: Record<string, any> = { ...row }
  for (const k of GBP_DEEP_KEYS) {
    const cur = out[k]
    const empty = cur == null || (Array.isArray(cur) && cur.length === 0)
    if (empty && deep[k] != null) out[k] = deep[k]
  }
  return out as T
}

const NEW_COLUMNS = new Set([
  'opening_hours',
  'additional_categories',
  'services',
  'attributes',
  'action_links',
  'photo_categories',
  'business_status',
  'claim_signal',
  'rating_distribution',
  'review_stats',
  'coverage',
])

function isMissingColumnError(err: any): boolean {
  const code = String(err?.code || '')
  const msg = String(err?.message || '')
  return code === 'PGRST204' || code === '42703' || /column .* (does not exist|of relation)|Could not find the '.*' column/i.test(msg)
}

export async function getLatestSnapshotForClient(
  clientId: string,
  workspaceId: string,
  opts?: { onlyOk?: boolean }
) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('gbp_snapshots')
    .select('*')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    // Dòng cũ source = 'manual' (mốc nhập tay từ phiên bản trước) chỉ có sao + số review,
    // không đủ làm snapshot hồ sơ — bỏ qua ở đây; báo cáo Kết quả (lib/reports.ts) có truy vấn riêng.
    .neq('source', 'manual')
    .order('captured_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (opts?.onlyOk) {
    query = query.in('status', ['ok', 'partial'])
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return hydrateSnapshot(data)
}

/** Snapshot ok/partial còn trong TTL cache (mặc định GBP_SNAPSHOT_CACHE_DAYS ngày, hoặc `maxAgeMs` nếu truyền). */
export async function getFreshSnapshotForClient(
  clientId: string,
  workspaceId: string,
  maxAgeMs: number = GBP_SNAPSHOT_CACHE_DAYS * 24 * 60 * 60 * 1000
) {
  const latest = await getLatestSnapshotForClient(clientId, workspaceId, { onlyOk: true })
  if (!latest?.captured_at) return null

  // Snapshot cũ (trước khi có coverage) -> coi như hết hạn để lần sau lấy lại bằng pipeline mới.
  // Snapshot mới luôn có coverage (cột hoặc raw_json.deep).
  const rawDeep = (latest as any).raw_json?.deep
  if (!latest.coverage && !rawDeep) return null

  const age = Date.now() - new Date(latest.captured_at).getTime()
  return age >= 0 && age <= maxAgeMs ? latest : null
}
