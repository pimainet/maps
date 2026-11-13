/**
 * Lấy snapshot hồ sơ Google Maps của 1 doanh nghiệp (client) cho audit, có lưu vào bảng gbp_snapshots.
 *
 * Thứ tự: bản đã lưu còn hạn (nếu không ép làm mới) -> gọi Outscraper (+ Places) -> nếu thất bại,
 * dùng bản đã lưu gần nhất (kèm cờ `origin` để nơi gọi báo cho người dùng biết dữ liệu có thể cũ).
 *
 * Không tự ghi rate-limit/usage: route gọi hàm này quyết định khi nào tính 1 lượt.
 */

import {
  GBP_DEEP_KEYS,
  createPendingSnapshot,
  getFreshSnapshotForClient,
  getLatestSnapshotForClient,
  updateSnapshot,
} from '@/lib/gbp-snapshots'
import { hasProfileData, runGbpPublicSnapshot, type RunGbpSnapshotResult } from '@/lib/gbp-snapshot'
import { outscraperConfigured } from '@/lib/gbp-outscraper'
import { buildMapsSearchUrl, extractPlaceIdFromUrl } from '@/lib/place-identity'
import type { GbpSnapshotStatus } from '@/lib/gbp-snapshot-types'

export type SnapshotClient = {
  id: string
  name?: string | null
  area?: string | null
  gbp_link?: string | null
  place_id?: string | null
}

export type ClientSnapshot = {
  /** Dòng gbp_snapshots (đã hydrate). null = không có dữ liệu nào dùng được. */
  snapshot: Record<string, any> | null
  /** cache = bản còn hạn; live = vừa lấy; stored_after_failure = lấy mới thất bại, dùng bản cũ gần nhất. */
  origin: 'cache' | 'live' | 'stored_after_failure' | 'none'
  /** Lỗi của lần lấy mới (nếu có) — chỉ để ghi log/hiển thị, không chứa khoá bí mật. */
  error: string | null
}

const GENERIC_FAILURE = 'Không đọc được hồ sơ Google Maps lần này.'

/**
 * Lấy mới thất bại thì chỉ dùng bản đã lưu nếu còn tương đối mới. Bản quá cũ (vd tên/ảnh/bài đăng từ nhiều tháng trước)
 * sẽ khiến audit kết luận sai về hồ sơ hiện tại — thà báo lỗi để người dùng xử lý nguyên nhân.
 */
const STALE_FALLBACK_MAX_MS = 30 * 24 * 60 * 60 * 1000

function statusOf(result: RunGbpSnapshotResult): GbpSnapshotStatus {
  if (!hasProfileData(result)) return 'failed'
  const reviewsFailed = result.coverage?.sections.reviews === 'error'
  return result.error || reviewsFailed ? 'partial' : 'ok'
}

/** Gọi nguồn dữ liệu và lưu kết quả thành 1 dòng gbp_snapshots. Trả về dòng đã lưu + kết quả gốc. */
async function captureLive(client: SnapshotClient, workspaceId: string) {
  const placeId = client.place_id || extractPlaceIdFromUrl(client.gbp_link)
  const input = {
    mapsUrl: client.gbp_link || undefined,
    placeId,
    businessName: client.name || undefined,
    area: client.area || undefined,
    depth: 'deep' as const,
  }
  const mapsUrl = buildMapsSearchUrl(input)

  const pending = await createPendingSnapshot({
    workspace_id: workspaceId,
    client_id: client.id,
    place_id: placeId,
    maps_url: mapsUrl,
    source: outscraperConfigured() ? 'outscraper' : 'places',
  })

  try {
    await updateSnapshot(pending.id, workspaceId, { status: 'running' })
    const result = await runGbpPublicSnapshot(input)
    const status = statusOf(result)

    const deep = Object.fromEntries(GBP_DEEP_KEYS.map((k) => [k, (result as any)[k] ?? null]))
    const saved = await updateSnapshot(pending.id, workspaceId, {
      status,
      error_message: result.error || null,
      captured_at: new Date().toISOString(),
      place_id: result.place_id || placeId || null,
      maps_url: result.maps_url || mapsUrl,
      business_name: result.business_name || client.name || null,
      description: result.description || null,
      primary_category: result.primary_category || null,
      rating: result.rating ?? null,
      review_count: result.review_count ?? null,
      phone: result.phone || null,
      website_url: result.website_url || null,
      address_text: result.address_text || null,
      posts_signal: result.posts_signal || null,
      recent_posts: result.recent_posts || [],
      photos_signal: result.photos_signal || null,
      photos_count_est: result.photos_count_est ?? null,
      reviews: result.reviews || [],
      // Bản sao các trường "sâu" trong raw_json.deep: dùng được cả khi chưa chạy migration 015.
      raw_json: { ...(result.raw && typeof result.raw === 'object' ? (result.raw as object) : {}), deep },
      // Cột riêng (migration 015) — chưa có cột thì updateSnapshot tự bỏ qua.
      opening_hours: result.opening_hours || null,
      additional_categories: result.additional_categories || null,
      services: result.services || [],
      attributes: result.attributes || [],
      action_links: result.action_links || [],
      photo_categories: result.photo_categories || [],
      business_status: result.business_status || null,
      claim_signal: result.claim_signal || null,
      rating_distribution: result.rating_distribution || null,
      review_stats: result.review_stats || null,
      coverage: result.coverage || null,
    })
    return { saved, status, error: result.error || null }
  } catch (err: any) {
    // Lỗi bất ngờ (DB...) giữa chừng: đánh dấu failed để dòng pending không treo mãi, rồi báo lên trên.
    await updateSnapshot(pending.id, workspaceId, { status: 'failed', error_message: GENERIC_FAILURE }).catch(() => null)
    throw err
  }
}

export async function getClientSnapshot(
  client: SnapshotClient,
  workspaceId: string,
  opts: { force?: boolean; maxAgeMs?: number } = {},
): Promise<ClientSnapshot> {
  if (!opts.force) {
    const fresh = await getFreshSnapshotForClient(client.id, workspaceId, opts.maxAgeMs)
    if (fresh) return { snapshot: fresh, origin: 'cache', error: null }
  }

  let error: string | null = null
  try {
    const live = await captureLive(client, workspaceId)
    if (live.status !== 'failed') return { snapshot: live.saved, origin: 'live', error: live.error }
    error = live.error || GENERIC_FAILURE
  } catch (err: any) {
    console.error('getClientSnapshot live failed:', err?.message || err)
    error = GENERIC_FAILURE
  }

  const stored = await getLatestSnapshotForClient(client.id, workspaceId, { onlyOk: true }).catch(() => null)
  const age = stored?.captured_at ? Date.now() - new Date(stored.captured_at).getTime() : Infinity
  return stored && age <= STALE_FALLBACK_MAX_MS
    ? { snapshot: stored, origin: 'stored_after_failure', error }
    : { snapshot: null, origin: 'none', error }
}
