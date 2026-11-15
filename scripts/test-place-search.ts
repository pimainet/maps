import { mapOutscraperResults, mapPlacesResults } from '../lib/place-search'
import { isSupportedGoogleMapsUrl } from '../lib/place-identity'

let fail = 0
const t = (n: string, ok: boolean, x?: unknown) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' -> ' + JSON.stringify(x)}`); if (!ok) fail++ }

const g = mapPlacesResults({ places: [
  { id: 'ChIJabcdefghij1', displayName: { text: 'Nha khoa Tâm An' }, formattedAddress: '1 Lê Lợi, Q3', rating: 4.8, userRatingCount: 120, primaryTypeDisplayName: { text: 'Nha khoa' }, googleMapsUri: 'https://maps.google.com/?cid=123' },
  { id: 'ChIJabcdefghij1', displayName: { text: 'Trùng id' } },
  { id: 'x', displayName: { text: 'id hỏng' } },
  { id: 'ChIJabcdefghij2', displayName: { text: 'Không link' }, googleMapsUri: 'https://evil.example.com/x' },
  { id: 'places/ChIJabcdefghij3', displayName: {} },
] })
t('Places: giữ 2 kết quả hợp lệ, bỏ trùng/id hỏng/thiếu tên', g.length === 2, g)
t('Places: link nguồn hợp lệ được giữ', g[0].maps_url === 'https://maps.google.com/?cid=123', g[0])
t('Places: link lạ bị thay bằng link dựng từ place_id', g[1].maps_url.includes('ChIJabcdefghij2') && isSupportedGoogleMapsUrl(g[1].maps_url), g[1])
t('Places: số liệu', g[0].rating === 4.8 && g[0].review_count === 120 && g[0].category === 'Nha khoa')

const o = mapOutscraperResults([
  { place_id: 'ChIJoutscraper01', name: 'Quán A', full_address: 'HN', rating: '4.5', reviews: 10, type: 'Cafe', location_link: 'https://www.google.com/maps/place/A' },
  { name: 'thiếu place_id' }, null, 'rác',
])
t('Outscraper: 1 kết quả hợp lệ, ép kiểu số', o.length === 1 && o[0].rating === 4.5 && o[0].review_count === 10, o)
t('Chịu được đầu vào rỗng/sai kiểu', mapPlacesResults(null).length === 0 && mapOutscraperResults(undefined as any).length === 0)
const many = mapPlacesResults({ places: Array.from({ length: 9 }, (_, i) => ({ id: `ChIJmany000000${i}`, displayName: { text: `N${i}` } })) })
t('Tối đa 5 kết quả', many.length === 5, many.length)
process.exit(fail ? 1 : 0)
