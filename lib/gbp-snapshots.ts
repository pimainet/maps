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
  }
) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('gbp_snapshots')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single()

  if (error) throw error
  return data
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

  const captured = new Date(latest.captured_at).getTime()
  const maxAge = GBP_SNAPSHOT_CACHE_DAYS * 24 * 60 * 60 * 1000
  if (Date.now() - captured > maxAge) return null
  return latest
}

export function snapshotToAuditFields(snapshot: any): {
  description?: string
  primary_category?: string
  review_count?: string
  rating?: string
  recent_posts?: string
  photos_status?: string
  additional_info?: string
} {
  if (!snapshot) return {}

  const posts = Array.isArray(snapshot.recent_posts)
    ? snapshot.recent_posts
    : []
  const postsPreview =
    posts.length > 0
      ? posts
          .slice(0, 3)
          .map((p: any, i: number) => `${i + 1}. ${(p.text || '').slice(0, 120)}`)
          .join('\n')
      : ''

  const additionalParts: string[] = []
  if (snapshot.posts_signal) {
    additionalParts.push(`Tín hiệu bài đăng (quan sát): ${snapshot.posts_signal}`)
  }
  if (postsPreview) {
    additionalParts.push(`Bài gần đây:\n${postsPreview}`)
  }
  if (snapshot.photos_signal) {
    additionalParts.push(`Tín hiệu ảnh: ${snapshot.photos_signal}`)
  }

  return {
    description: snapshot.description || undefined,
    primary_category: snapshot.primary_category || undefined,
    review_count:
      snapshot.review_count != null ? String(snapshot.review_count) : undefined,
    rating: snapshot.rating != null ? String(snapshot.rating) : undefined,
    recent_posts: snapshot.posts_signal || undefined,
    photos_status: snapshot.photos_signal || undefined,
    additional_info: additionalParts.length
      ? additionalParts.join('\n\n')
      : undefined,
  }
}

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
