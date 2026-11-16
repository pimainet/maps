/**
 * Bù các trường Outscraper hay thiếu (mô tả, danh mục phụ, bài đăng) bằng nguồn phụ, theo thứ tự:
 * SerpApi (đọc cả bài đăng) -> DataForSEO (chỉ còn thiếu mô tả/danh mục phụ mới gọi). Nguồn nào chưa cấu hình thì bỏ qua.
 */
import type { RunGbpSnapshotInput, RunGbpSnapshotResult } from '@/lib/gbp-snapshot-types'
import { enrichWithSerpApi } from '@/lib/gbp-serpapi'
import { enrichWithDataForSeo } from '@/lib/gbp-dataforseo'

export async function enrichSnapshot(snap: RunGbpSnapshotResult, input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  let cur = snap
  try {
    cur = await enrichWithSerpApi(cur, { placeId: input.placeId || cur.place_id })
  } catch (e: any) {
    console.warn('serpapi enrich failed (non-fatal):', e?.message)
  }
  try {
    cur = await enrichWithDataForSeo(cur, input)
  } catch (e: any) {
    console.warn('dataforseo enrich failed (non-fatal):', e?.message)
  }
  return cur
}
