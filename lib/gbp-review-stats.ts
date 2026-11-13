import type { GbpReviewItem, GbpReviewStats } from '@/lib/gbp-snapshot-types'

/** Thống kê review từ danh sách đã tải (sắp xếp mới nhất). Dùng chung cho nguồn browser và Outscraper. */
export function computeReviewStats(reviews: GbpReviewItem[]): GbpReviewStats | null {
  if (!reviews.length) return null
  const ages = reviews.map((r) => r.age_days_est).filter((d): d is number => typeof d === 'number')
  const newest = ages.length ? Math.min(...ages) : null
  const oldest = ages.length ? Math.max(...ages) : null
  const replied = reviews.filter((r) => r.reply && r.reply.trim()).length
  const ratings = reviews.map((r) => r.rating)
  return {
    loaded: reviews.length,
    with_text: reviews.filter((r) => r.text.trim()).length,
    newest_age_days: newest,
    oldest_age_days: oldest,
    last_30d: ages.length ? ages.filter((d) => d <= 30).length : null,
    last_90d: ages.length ? ages.filter((d) => d <= 90).length : null,
    window_complete: oldest != null && oldest > 90,
    replied,
    reply_rate: Math.round((replied / reviews.length) * 100) / 100,
    avg_rating_loaded: Math.round((ratings.reduce((s, v) => s + v, 0) / ratings.length) * 10) / 10,
    low_rating_count: ratings.filter((v) => v <= 3).length,
  }
}
