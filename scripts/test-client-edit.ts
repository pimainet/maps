import { buildClientEdit, placeKeyAfterPatch } from '../lib/client-edit'
import { auditQuotaPlaceKey } from '../lib/audit-quota-key'

let fail = 0
function t(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' -> ' + JSON.stringify(extra)}`)
  if (!ok) fail++
}

const cur = { id: 'c1', name: 'Quán A', gbp_link: 'https://maps.app.goo.gl/abc', gbp_link_normalized: 'https://maps.app.goo.gl/abc', place_id: 'ChIJ_aaaaaaaaaaaa' }
const curNoPid = { ...cur, place_id: null }

let r: any = buildClientEdit({ phone: ' 0911 ' }, cur)
t('sửa SĐT: trim, không đụng định danh', r.ok && r.patch.phone === '0911' && !r.identityTouched && Object.keys(r.patch).length === 1, r)

r = buildClientEdit({ notes: '' }, cur)
t('xóa trống ghi chú -> null', r.ok && r.patch.notes === null, r)

r = buildClientEdit({ name: 'Quán A' }, cur)
t('gửi lại tên y hệt -> không có gì để lưu', !r.ok, r)

r = buildClientEdit({ name: '   ' }, cur)
t('tên rỗng bị chặn', !r.ok && r.field === 'name', r)

r = buildClientEdit({ name: 'Quán A (sửa)' }, cur)
t('đổi tên: identityTouched nhưng cùng quán', r.ok && r.identityTouched && !placeKeyAfterPatch(cur, r.patch).changesPlace, r)

r = buildClientEdit({ website_url: 'tenmien.vn' }, cur)
t('website thiếu scheme được thêm https://', r.ok && r.patch.website_url === 'https://tenmien.vn', r)
r = buildClientEdit({ website_url: 'khong hop le' }, cur)
t('website sai bị chặn', !r.ok && r.field === 'website_url', r)
r = buildClientEdit({ notes: 'x'.repeat(4001) }, cur)
t('ghi chú quá dài bị chặn', !r.ok && r.field === 'notes', r)
r = buildClientEdit({ phone: 123 }, cur)
t('kiểu dữ liệu sai bị chặn', !r.ok, r)
r = buildClientEdit({ workspace_id: 'x', phone: '1' }, cur)
t('trường lạ bị bỏ qua (workspace_id không lọt vào patch)', r.ok && !('workspace_id' in r.patch), r)

// Link
r = buildClientEdit({ gbp_link: 'https://evil.example.com/maps/place/x' }, cur)
t('link không phải Google Maps bị chặn', !r.ok && r.field === 'gbp_link', r)
r = buildClientEdit({ gbp_link: 'http://169.254.169.254/' }, cur)
t('link nội bộ/SSRF bị chặn', !r.ok, r)
r = buildClientEdit({ gbp_link: 'https://maps.app.goo.gl/abc' }, cur)
t('link y hệt -> không có thay đổi, KHÔNG tính lại place_id', !r.ok, r)

r = buildClientEdit({ gbp_link: 'https://maps.app.goo.gl/abc?utm_source=zalo' }, cur)
t('viết lại link cùng nội dung (thêm utm) -> chỉ sửa gbp_link, place_key giữ nguyên',
  r.ok && r.patch.gbp_link?.includes('utm_source') && !('place_id' in r.patch) && !('gbp_link_normalized' in r.patch) && !placeKeyAfterPatch(cur, r.patch).changesPlace, r)

r = buildClientEdit({ gbp_link: 'https://maps.app.goo.gl/zzz' }, cur)
const pk = r.ok ? placeKeyAfterPatch(cur, r.patch) : null
t('link sang quán khác: place_id cũ bị bỏ, đổi place_key', r.ok && r.patch.place_id === null && r.patch.gbp_link_normalized === 'https://maps.app.goo.gl/zzz' && pk!.changesPlace && pk!.after === 'gbp:https://maps.app.goo.gl/zzz', r)

r = buildClientEdit({ gbp_link: 'https://www.google.com/maps/place/?q=ChIJ_newplaceid123' }, cur)
t('link chứa place_id mới -> lấy place_id mới', r.ok && r.patch.place_id === 'ChIJ_newplaceid123' && placeKeyAfterPatch(cur, r.patch).after === 'ChIJ_newplaceid123', r)

r = buildClientEdit({ gbp_link: 'maps.app.goo.gl/new1' }, cur)
t('link thiếu https:// được bổ sung', r.ok && r.patch.gbp_link === 'https://maps.app.goo.gl/new1', r)

r = buildClientEdit({ place_id: 'places/ChIJ_explicit_0001' }, cur)
t('chỉ gửi place_id: canonicalize bỏ tiền tố places/', r.ok && r.patch.place_id === 'ChIJ_explicit_0001', r)
r = buildClientEdit({ place_id: 'abc' }, cur)
t('place_id sai định dạng bị chặn', !r.ok && r.field === 'place_id', r)

r = buildClientEdit({ gbp_link: '', place_id: '' }, cur)
t('xóa cả link lẫn place_id khi đang có -> chặn', !r.ok, r)
r = buildClientEdit({ gbp_link: '' }, cur)
t('xóa link nhưng place_id còn -> được, place_key giữ nguyên', r.ok && r.patch.gbp_link === null && !placeKeyAfterPatch(cur, r.patch).changesPlace, r)
r = buildClientEdit({ gbp_link: '' }, curNoPid)
t('xóa link khi không có place_id -> chặn', !r.ok, r)

const noIdent = { id: 'c2', name: 'B', gbp_link: null, gbp_link_normalized: null, place_id: null }
r = buildClientEdit({ gbp_link: 'https://maps.app.goo.gl/first' }, noIdent)
t('hồ sơ chưa có link: thêm link lần đầu được', r.ok && r.patch.gbp_link_normalized === 'https://maps.app.goo.gl/first', r)

// khớp công thức với lib/audit-quota-key
for (const c of [cur, curNoPid, noIdent]) {
  t(`place_key khớp auditQuotaPlaceKey (${c.id})`, placeKeyAfterPatch(c, { phone: '1' }).before === auditQuotaPlaceKey(c))
}
process.exit(fail ? 1 : 0)
