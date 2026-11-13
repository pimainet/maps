/**
 * Lấy nhóm đối thủ cho 1 audit: dùng cache trong gbp_snapshots.competitors (14 ngày), không có thì gọi Outscraper
 * rồi ghi lại vào snapshot mới nhất của client (best-effort — lỗi ghi cache không làm hỏng audit).
 * Mọi lỗi mạng/thiếu dữ liệu đều trả về null: audit khi đó giữ VY01/VY03/T01/T02 ở trạng thái "insufficient".
 */
import { getLatestSnapshotForClient, updateSnapshot } from '@/lib/gbp-snapshots'
import {
  areaFromAddress,
  buildCompetitorQuery,
  fetchCompetitorSet,
  usableCachedSet,
  type CompetitorSet,
} from '@/lib/competitors'
import { outscraperConfigured } from '@/lib/gbp-outscraper'
import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'

export async function resolveCompetitorSet(args: {
  snapshot: GbpSnapshotPayload
  clientId?: string | null
  workspaceId: string
  declaredArea?: string | null
  force?: boolean
}): Promise<{ set: CompetitorSet | null; from: 'cache' | 'live' | 'none'; note?: string }> {
  if (!outscraperConfigured()) return { set: null, from: 'none', note: 'Chưa cấu hình OUTSCRAPER_API_KEY' }

  const area = args.declaredArea || areaFromAddress(args.snapshot.address_text)
  const query = buildCompetitorQuery(args.snapshot.primary_category, area)
  if (!query) return { set: null, from: 'none', note: 'Thiếu danh mục chính hoặc khu vực để tìm đối thủ' }

  let latest: any = null
  if (args.clientId) {
    try {
      latest = await getLatestSnapshotForClient(args.clientId, args.workspaceId, { onlyOk: true })
    } catch {
      latest = null
    }
    if (!args.force) {
      const cached = usableCachedSet(latest?.competitors, query)
      if (cached) return { set: cached, from: 'cache' }
    }
  }

  try {
    const set = await fetchCompetitorSet({
      category: args.snapshot.primary_category,
      area,
      placeId: args.snapshot.place_id,
      name: args.snapshot.business_name,
    })
    if (!set) return { set: null, from: 'none', note: 'Tìm kiếm không trả kết quả' }
    if (latest?.id) {
      try {
        await updateSnapshot(latest.id, args.workspaceId, { competitors: set })
      } catch (e: any) {
        console.warn('competitors cache write failed (non-fatal):', e?.message)
      }
    }
    return { set, from: 'live' }
  } catch (e: any) {
    return { set: null, from: 'none', note: `Tìm đối thủ lỗi: ${String(e?.message || e).slice(0, 120)}` }
  }
}
