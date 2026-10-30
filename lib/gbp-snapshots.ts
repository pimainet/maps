/**
 * DB helpers cho gbp_snapshots — Giai đoạn A.
 * Copy vào: lib/gbp-snapshots.ts
 */

import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import type { GbpSnapshotPayload, GbpSnapshotStatus } from '@/lib/gbp-snapshot-types'
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
      source: input.source || 'browser',
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
  return data
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
    // Mốc ban đầu nhập tay (source = 'manual') chỉ có điểm đánh giá + số lượt đánh giá,
    // không đủ để tự điền hồ sơ hay làm ngữ cảnh viết bài — bỏ qua ở đây,
    // báo cáo Kết quả có truy vấn riêng nên vẫn dùng được.
    .neq('source', 'manual')
    .order('captured_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (opts?.onlyOk) {
    query = query.in('status', ['ok', 'partial'])
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

/** Snapshot ok/partial còn trong TTL cache. */
export async function getFreshSnapshotForClient(
  clientId: string,
  workspaceId: string
) {
  const latest = await getLatestSnapshotForClient(clientId, workspaceId, {
    onlyOk: true,
  })
  if (!latest?.captured_at) return null

  // Snapshot cũ do agent đọc nông (chưa có coverage) -> coi như hết hạn để lần sau chạy agent mới.
  // Chỉ áp dụng khi cột coverage đã tồn tại (đã chạy migration 015), tránh chạy lại mãi khi chưa migrate.
  if ('coverage' in latest && !latest.coverage) return null

  const captured = new Date(latest.captured_at).getTime()
  const maxAge = GBP_SNAPSHOT_CACHE_DAYS * 24 * 60 * 60 * 1000
  if (Date.now() - captured > maxAge) return null
  return latest
}

export { snapshotToAuditFields } from '@/lib/gbp-audit-fields'

export type { GbpSnapshotPayload }

function parseRating(value: unknown): number | null {
  const n = parseFloat(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= 5 ? Math.round(n * 10) / 10 : null
}

function parseCount(value: unknown): number | null {
  const digits = String(value ?? '').replace(/[^\d]/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Lưu "mốc ban đầu" từ chính điểm đánh giá + số lượt đánh giá khách nhập khi kiểm tra hồ sơ.
 * Nhẹ hơn hẳn lấy dữ liệu bằng trình duyệt, nên có mốc ngay từ ngày đầu để trang Kết quả
 * so sánh được sau này. Không ghi gì nếu không có số hợp lệ, hoặc nếu số y hệt lần lưu gần nhất
 * trong 24 giờ (tránh trùng khi bấm kiểm tra nhiều lần).
 */
export async function saveManualBaselineSnapshot(input: {
  workspace_id: string
  client_id: string
  business_name?: string | null
  rating?: unknown
  review_count?: unknown
}) {
  const rating = parseRating(input.rating)
  const reviewCount = parseCount(input.review_count)
  if (rating == null && reviewCount == null) return null

  const supabase = await createSupabaseServerClient()

  const { data: last } = await supabase
    .from('gbp_snapshots')
    .select('rating, review_count, captured_at')
    .eq('client_id', input.client_id)
    .eq('workspace_id', input.workspace_id)
    .in('status', ['ok', 'partial'])
    .not('captured_at', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (last?.captured_at) {
    const recent = Date.now() - new Date(last.captured_at).getTime() < 24 * 60 * 60 * 1000
    const sameRating = (last.rating != null ? Number(last.rating) : null) === rating
    const sameReviews = (last.review_count != null ? Number(last.review_count) : null) === reviewCount
    if (recent && sameRating && sameReviews) return null
  }

  const { data, error } = await supabase
    .from('gbp_snapshots')
    .insert({
      workspace_id: input.workspace_id,
      client_id: input.client_id,
      source: 'manual',
      status: 'ok' as GbpSnapshotStatus,
      captured_at: new Date().toISOString(),
      business_name: input.business_name ?? null,
      rating,
      review_count: reviewCount,
    })
    .select()
    .single()

  if (error) throw error
  return data
}
