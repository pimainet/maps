// Chạy thử Outscraper với dữ liệu THẬT và báo cáo trường nào có / không có.
//
//   npx tsx --env-file=.env.local scripts/check-outscraper-live.ts "Tên quán + quận" [--reviews=20]
//   npx tsx --env-file=.env.local scripts/check-outscraper-live.ts ChIJxxxxxxxx          (place_id)
//
// Mỗi lần chạy tốn khoảng 1 bản ghi địa điểm + N review của Outscraper. KHÔNG in API key ra màn hình.
import { fetchOutscraperPlace, fetchOutscraperReviews, mapOutscraperToPayload, outscraperConfigured } from '../lib/gbp-outscraper'

async function main() {
  if (!outscraperConfigured()) {
    console.error('Thiếu OUTSCRAPER_API_KEY. Đặt trong .env.local rồi chạy lại với --env-file=.env.local')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const reviewsArg = args.find((a) => a.startsWith('--reviews='))
  const reviewsLimit = reviewsArg ? Number(reviewsArg.split('=')[1]) : 20
  const q = args.filter((a) => !a.startsWith('--')).join(' ').trim()
  if (!q) {
    console.error('Cần truyền tên quán (kèm khu vực), link Google Maps, hoặc place_id.')
    process.exit(1)
  }
  const input = /^ChIJ|^[0-9a-f]{8,}:/i.test(q)
    ? { placeId: q }
    : /^https?:\/\//.test(q)
      ? { mapsUrl: q }
      : { businessName: q }

  const t0 = Date.now()
  const [place, reviewsPlace] = await Promise.all([
    fetchOutscraperPlace(input),
    fetchOutscraperReviews({ ...input, reviewsLimit }).catch((e) => {
      console.warn('! Lấy review lỗi:', e.message)
      return null
    }),
  ])
  console.log(`\nXong sau ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  if (!place) {
    console.error('Không tìm thấy địa điểm.')
    process.exit(2)
  }

  const has = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  const rows: Array<[string, string, unknown]> = [
    ['Tên', 'name', place.name],
    ['Place ID', 'place_id', place.place_id],
    ['Danh mục chính', 'type', place.type],
    ['Danh mục phụ', 'subtypes', place.subtypes],
    ['Đã xác minh', 'verified', place.verified],
    ['Sao', 'rating', place.rating],
    ['Số review', 'reviews', place.reviews],
    ['Số ảnh', 'photos_count', place.photos_count],
    ['Giờ mở cửa', 'working_hours', place.working_hours],
    ['Mô tả', 'description', place.description],
    ['Thuộc tính (about)', 'about', place.about],
    ['Phân bố sao', 'reviews_per_score_1', place.reviews_per_score_1 ?? place.reviews_per_score],
    ['Bài đăng', 'posts', place.posts],
    ['Link đặt lịch/menu', 'booking/menu', place.booking_appointment_link || place.menu_link || place.reservation_links],
    ['Website', 'website', place.website],
  ]
  console.log('=== TRƯỜNG HỒ SƠ ===')
  for (const [label, key, v] of rows) console.log(`${has(v) ? '✅' : '❌'} ${label.padEnd(22)} (${key})`)

  const rd: any[] = reviewsPlace?.reviews_data ?? place.reviews_data ?? []
  console.log(`\n=== REVIEW (${rd.length} review lấy về) ===`)
  if (rd.length) {
    const sample = rd[0]
    console.log('Các trường có trong 1 review:', Object.keys(sample).join(', '))
    const withReply = rd.filter((r) => has(r.owner_answer)).length
    console.log(`${'owner_answer' in sample ? '✅' : '❌'} Trường owner_answer ${'owner_answer' in sample ? 'CÓ' : 'KHÔNG CÓ'} — ${withReply}/${rd.length} review có phản hồi của chủ`)
    console.log(`${has(sample.review_datetime_utc) ? '✅' : '❌'} Ngày review (review_datetime_utc): ${sample.review_datetime_utc ?? 'không có'}`)
  } else {
    console.log('❌ Không có review nào')
  }

  const m = mapOutscraperToPayload(place, reviewsPlace, { claimedName: input.businessName })
  console.log('\n=== SAU KHI MAP VÀO HỆ THỐNG ===')
  console.log('Identity:', m.coverage?.identity, '| claim_signal:', m.claim_signal)
  console.log('Coverage:', JSON.stringify(m.coverage?.sections))
  console.log('Danh mục phụ (sau khi trừ danh mục chính):', m.additional_categories ?? '(không có)')
  console.log('Review stats:', JSON.stringify(m.review_stats))
  for (const w of m.coverage?.warnings ?? []) console.log('⚠', w)
  console.log('\nGửi lại kết quả này (hoặc dán 1 review ẩn tên) để tôi chỉnh mapping nếu có ❌ ở mục quan trọng.')
}
main().catch((e) => {
  console.error('Lỗi:', e?.message || e)
  process.exit(1)
})
