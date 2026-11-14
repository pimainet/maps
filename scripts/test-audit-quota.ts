// Khóa quota phải khớp công thức backfill SQL (migration 019):
//   COALESCE(NULLIF(place_id,''), CASE WHEN NULLIF(gbp_link_normalized,'') IS NOT NULL THEN 'gbp:'||gbp_link_normalized END, 'client:'||id)
import assert from 'node:assert/strict'
import { auditQuotaPlaceKey } from '../lib/audit-quota-key'

const id = '22222222-0000-0000-0000-000000000001'
assert.equal(auditQuotaPlaceKey({ id, place_id: 'ChIJabc', gbp_link_normalized: 'x' }), 'ChIJabc')
assert.equal(auditQuotaPlaceKey({ id, place_id: '  ChIJabc ' }), 'ChIJabc')
assert.equal(auditQuotaPlaceKey({ id, place_id: '', gbp_link_normalized: 'maps/place/abc' }), 'gbp:maps/place/abc')
assert.equal(auditQuotaPlaceKey({ id, place_id: null, gbp_link_normalized: null }), `client:${id}`)
assert.equal(auditQuotaPlaceKey({ id }), `client:${id}`)
// Xóa/tạo lại client (id mới) KHÔNG đổi khóa khi còn place_id hoặc link
assert.equal(
  auditQuotaPlaceKey({ id: 'a', place_id: 'ChIJ1' }),
  auditQuotaPlaceKey({ id: 'b', place_id: 'ChIJ1' }),
)
console.log('OK: khóa quota audit khớp công thức SQL')
