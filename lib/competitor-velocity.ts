/**
 * Tốc độ có review mới của 3 đối thủ đứng đầu (T07): lấy review MỚI NHẤT của từng đối thủ qua Outscraper reviews-v3 với
 * cutoff = 90 ngày trước (chỉ trả và chỉ tính tiền review trong 90 ngày), tối đa N review/quán. Cache 14 ngày theo tập
 * đối thủ. Giới hạn chi phí bằng biến môi trường:
 *   COMPETITOR_REVIEW_SAMPLE  số đối thủ lấy review (mặc định 3, tối đa 5; 0 = tắt)
 *   COMPETITOR_REVIEW_LIMIT   số review tối đa mỗi đối thủ (mặc định 20, tối đa 30)
 * Tối đa mỗi lần không có cache: SAMPLE × LIMIT review (mặc định 60 review ≈ $0,18 ≈ 4.700đ ngoài 500 review miễn phí/tháng).
 */
import { fetchOutscraperReviews, mapReviews, outscraperConfigured } from '@/lib/gbp-outscraper'
import type { GbpReviewItem } from '@/lib/gbp-snapshot-types'
import type { CompetitorVelocity, CompetitorVelocityItem } from '@/lib/audit-engine/types'

export const VELOCITY_CACHE_DAYS = 14
const CACHE_KEY = 'competitor_velocity'

const intEnv = (name: string, def: number, max: number) => {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def
}
export const velocitySample = () => intEnv('COMPETITOR_REVIEW_SAMPLE', 3, 5)
export const velocityLimit = () => Math.max(1, intEnv('COMPETITOR_REVIEW_LIMIT', 20, 30))

/** Hàm thuần: review đã tải (mới nhất trước, chỉ trong 90 ngày) -> số liệu tốc độ. `capped` = chạm giới hạn, số 90 ngày là cận dưới. */
export function summariseVelocity(name: string, placeId: string, reviews: GbpReviewItem[], limit: number): CompetitorVelocityItem {
  const ages = reviews.map((r) => r.age_days_est).filter((d): d is number => typeof d === 'number')
  return {
    name,
    placeId,
    newestAgeDays: ages.length ? Math.min(...ages) : null,
    last30: ages.filter((d) => d <= 30).length,
    last90: ages.filter((d) => d <= 90).length,
    capped: reviews.length >= limit,
  }
}

type Comp = { name: string; placeId?: string | null; rank?: number }

export function pickVelocitySample(competitors: Comp[] | undefined, n: number): Array<{ name: string; placeId: string }> {
  return (competitors ?? [])
    .map((c, i) => ({ c, r: typeof c.rank === 'number' ? c.rank : i + 1 }))
    .sort((a, b) => a.r - b.r)
    .filter((x) => !!x.c.placeId)
    .slice(0, n)
    .map((x) => ({ name: x.c.name, placeId: String(x.c.placeId) }))
}

export async function fetchCompetitorVelocity(
  sample: Array<{ name: string; placeId: string }>,
  limit: number,
  deps: { fetchReviews?: typeof fetchOutscraperReviews; now?: Date } = {},
): Promise<CompetitorVelocity> {
  const now = deps.now ?? new Date()
  const fetchReviews = deps.fetchReviews ?? fetchOutscraperReviews
  const cutoff = Math.floor(now.getTime() / 1000) - 90 * 86_400
  const items = await Promise.all(
    sample.map(async (s) => {
      try {
        const place = await fetchReviews({ placeId: s.placeId, reviewsLimit: limit, cutoff, budgetMs: 60_000 })
        if (!place) return null
        const { items } = mapReviews(place.reviews_data, now.getTime())
        return summariseVelocity(s.name, s.placeId, items.slice(0, limit), limit)
      } catch {
        return null
      }
    }),
  )
  return { fetchedAt: now.toISOString(), limit, items: items.filter((x): x is CompetitorVelocityItem => !!x) }
}

/** Dùng trong audit: cache 14 ngày (cùng tập đối thủ), không có thì gọi Outscraper (trong giới hạn chi phí) rồi ghi cache. */
export async function collectCompetitorVelocity(args: {
  competitors: Comp[] | undefined
  clientId?: string | null
  workspaceId: string
}): Promise<{ velocity: CompetitorVelocity | undefined; from: 'cache' | 'live' | 'none'; note?: string }> {
  const n = velocitySample()
  if (n === 0) return { velocity: undefined, from: 'none', note: 'COMPETITOR_REVIEW_SAMPLE=0' }
  if (!outscraperConfigured()) return { velocity: undefined, from: 'none', note: 'Chưa cấu hình OUTSCRAPER_API_KEY' }
  const sample = pickVelocitySample(args.competitors, n)
  if (sample.length < 2) return { velocity: undefined, from: 'none', note: 'Chưa đủ đối thủ có place_id' }
  const key = sample.map((s) => s.placeId).sort().join(',')
  const { readAuditCache, writeAuditCache } = await import('@/lib/audit-cache')
  if (args.clientId) {
    const cached = await readAuditCache<CompetitorVelocity & { key?: string }>(args.clientId, args.workspaceId, CACHE_KEY, VELOCITY_CACHE_DAYS, (v) => v?.key === key)
    if (cached) return { velocity: cached.value, from: 'cache' }
  }
  const velocity = await fetchCompetitorVelocity(sample, velocityLimit())
  if (velocity.items.length >= 2 && args.clientId) await writeAuditCache(args.clientId, args.workspaceId, CACHE_KEY, { ...velocity, key })
  return { velocity, from: 'live' }
}
