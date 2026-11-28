// Thử SerpApi/SearchApi với 1 quán thật (không lưu gì, mỗi engine tốn 1 lượt gọi):
//   SERPAPI_API_KEY=xxx SEARCHAPI_API_KEY=yyy npx tsx scripts/try-serpapi.ts ChIJxxxxxxxx
import { fetchSerpPlace, fetchSerpPosts, fetchSerpReviews, serpapiConfigured } from '../lib/gbp-serpapi'
import { fetchSearchApiPlace, fetchSearchApiReviews, searchApiConfigured } from '../lib/gbp-searchapi'
import type { ExtraPlace, ExtraReviews } from '../lib/gbp-extra-parse'

function showPlace(label: string, placeId: string, r: { info: ExtraPlace | null; error?: string }) {
  console.log(`\n=== ${label} place ===`)
  if (!r.info) return console.log('Không lấy được:', r.error)
  const i = r.info
  console.log('place_id trả về :', i.place_id, i.place_id === placeId ? '(khớp)' : '(KHÔNG khớp!)')
  console.log('data_id         :', i.data_id ?? '(trống)')
  console.log('Mô tả           :', i.description ?? '(trống)')
  console.log('Danh mục        :', i.types.join(' | ') || '(trống)')
  console.log('Giờ             :', i.opening_hours ?? '(trống)', '| hôm nay:', i.hours_today ?? '-')
  console.log('Thuộc tính      :', i.attributes === null ? '(không trả)' : i.attributes.map((g) => `${g.group}(${g.items.length})`).join(', ') || '(rỗng)')
  console.log('Chưa xác minh   :', i.claim_signal ?? '-', '| trạng thái:', i.business_status ?? '-')
  console.log('Hỏi–đáp         :', i.questions_answers === null ? '(không trả)' : `${i.questions_answers.length} cặp`)
  console.log('Bài đăng        :', i.posts === null ? '(không trả khóa posts)' : `${i.posts.length} bài`)
  for (const p of i.posts ?? []) console.log('  -', p.posted_at ?? p.approx_date ?? '?', '|', p.text.slice(0, 100))
}

function showReviews(label: string, r: { info: ExtraReviews | null; error?: string }) {
  console.log(`\n=== ${label} reviews ===`)
  if (!r.info) return console.log('Không lấy được:', r.error)
  const replied = r.info.items.filter((x) => x.reply).length
  console.log(`${r.info.items.length} review, ${replied} có phản hồi của chủ, reply_known=${r.info.reply_known}`)
  for (const x of r.info.items.slice(0, 5)) console.log('  -', x.rating, '★', x.relative_time, '|', x.text.slice(0, 60), x.reply ? '| ↳ ' + x.reply.slice(0, 50) : '')
}

async function main() {
  const placeId = process.argv[2]
  if (!placeId) return console.log('Cách dùng: SERPAPI_API_KEY=... SEARCHAPI_API_KEY=... npx tsx scripts/try-serpapi.ts <place_id>')
  if (searchApiConfigured()) {
    showPlace('SearchApi', placeId, await fetchSearchApiPlace(placeId))
    showReviews('SearchApi', await fetchSearchApiReviews(placeId))
  }
  if (serpapiConfigured()) {
    const p = await fetchSerpPlace(placeId)
    showPlace('SerpApi', placeId, p)
    showReviews('SerpApi', await fetchSerpReviews(placeId))
    if (p.info?.data_id) {
      const posts = await fetchSerpPosts(p.info.data_id)
      console.log('\n=== SerpApi google_maps_posts ===')
      console.log(posts.posts === null ? `Không lấy được: ${posts.error}` : `${posts.posts.length} bài`)
      for (const x of posts.posts ?? []) console.log('  -', x.posted_at ?? x.approx_date ?? '?', '|', x.text.slice(0, 100))
    }
  }
  if (!searchApiConfigured() && !serpapiConfigured()) console.log('Chưa đặt SERPAPI_API_KEY / SEARCHAPI_API_KEY.')
}
main()
