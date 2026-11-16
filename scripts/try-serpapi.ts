// Thử SerpApi với 1 quán thật (không lưu gì):
//   SERPAPI_API_KEY=xxx npx tsx scripts/try-serpapi.ts ChIJxxxxxxxx
import { fetchSerpApiInfo } from '../lib/gbp-serpapi'

async function main() {
  const placeId = process.argv[2]
  if (!placeId) return console.log('Cách dùng: SERPAPI_API_KEY=... npx tsx scripts/try-serpapi.ts <place_id>')
  const r = await fetchSerpApiInfo(placeId)
  if (!r.info) return console.log('Không lấy được:', r.error)
  console.log('place_id trả về :', r.info.place_id, r.info.place_id === placeId ? '(khớp)' : '(KHÔNG khớp!)')
  console.log('Mô tả           :', r.info.description ?? '(trống)')
  console.log('Danh mục (type) :', r.info.types.join(' | ') || '(trống)')
  console.log('Bài đăng        :', r.info.posts === null ? '(SerpApi không trả khóa posts)' : `${r.info.posts.length} bài`)
  for (const p of r.info.posts ?? []) console.log('  -', p.approx_date ?? '?', '|', p.text.slice(0, 100))
}
main()
