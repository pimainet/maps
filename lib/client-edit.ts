/**
 * Kiểm tra + chuẩn hóa dữ liệu khi SỬA thông tin doanh nghiệp (client). Thuần hàm, không đụng DB.
 * Nguyên tắc: chỉ field CÓ MẶT trong body mới được sửa; field định danh (name/link/place_id) chỉ gửi
 * sang DB khi thực sự thay đổi, để không vô tình "đổi quán" (và vô hiệu snapshot) khi người dùng chỉ bấm Lưu.
 * Việc giới hạn số lần đổi quán nằm ở hàm SQL public.update_client (migration 021), không ở đây.
 */
import {
  canonicalizePlaceId,
  extractPlaceIdFromUrl,
  isSupportedGoogleMapsUrl,
  normalizeGbpLink,
} from '@/lib/place-identity'

export type ClientIdentity = {
  name: string
  gbp_link?: string | null
  gbp_link_normalized?: string | null
  place_id?: string | null
}

export type ClientEditResult =
  | { ok: true; patch: Record<string, string | null>; identityTouched: boolean }
  | { ok: false; error: string; field?: string }

const PROFILE_LIMITS: Record<string, number> = {
  industry: 200,
  area: 200,
  phone: 50,
  contact_name: 200,
  brand_voice: 2000,
  website_url: 500,
  notes: 4000,
}

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/

function str(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  return v.trim()
}

export function buildClientEdit(body: unknown, current: ClientIdentity): ClientEditResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Dữ liệu gửi lên không hợp lệ.' }
  }
  const b = body as Record<string, unknown>
  const patch: Record<string, string | null> = {}

  // ── Trường hồ sơ ──
  for (const [key, max] of Object.entries(PROFILE_LIMITS)) {
    if (!(key in b)) continue
    const raw = b[key]
    if (raw !== null && typeof raw !== 'string') return { ok: false, error: 'Dữ liệu không hợp lệ.', field: key }
    let v = str(raw) ?? null
    if (v && v.length > max) return { ok: false, error: `Quá dài (tối đa ${max} ký tự).`, field: key }
    if (key === 'website_url' && v) {
      const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`
      try {
        const u = new URL(withScheme)
        if (!u.hostname.includes('.')) throw new Error('bad host')
        v = withScheme
      } catch {
        return { ok: false, error: 'Website không hợp lệ (ví dụ: https://tenmien.vn).', field: key }
      }
    }
    patch[key] = v || null
  }

  // ── Tên ──
  let identityTouched = false
  if ('name' in b) {
    if (typeof b.name !== 'string') return { ok: false, error: 'Tên doanh nghiệp không hợp lệ.', field: 'name' }
    const name = b.name.trim()
    if (!name) return { ok: false, error: 'Tên doanh nghiệp không được để trống.', field: 'name' }
    if (name.length > 200) return { ok: false, error: 'Tên quá dài (tối đa 200 ký tự).', field: 'name' }
    if (name !== current.name) {
      patch.name = name
      identityTouched = true
    }
  }

  // ── Link Maps / Place ID ──
  const curLink = (current.gbp_link || '').trim()
  const hasLinkKey = 'gbp_link' in b
  const hasPidKey = 'place_id' in b
  if (hasLinkKey && b.gbp_link !== null && typeof b.gbp_link !== 'string') {
    return { ok: false, error: 'Link Google Maps không hợp lệ.', field: 'gbp_link' }
  }
  if (hasPidKey && b.place_id !== null && typeof b.place_id !== 'string') {
    return { ok: false, error: 'Place ID không hợp lệ.', field: 'place_id' }
  }

  let explicitPid: string | null | undefined
  if (hasPidKey) {
    explicitPid = canonicalizePlaceId(typeof b.place_id === 'string' ? b.place_id : null)
    if (explicitPid && !PLACE_ID_RE.test(explicitPid)) {
      return { ok: false, error: 'Place ID không đúng định dạng (thường bắt đầu bằng ChIJ…).', field: 'place_id' }
    }
  }

  let newLink: string | null = curLink || null
  let newNorm: string | null = current.gbp_link_normalized ?? null
  let newPid: string | null = current.place_id ?? null

  if (hasLinkKey) {
    let link = typeof b.gbp_link === 'string' ? b.gbp_link.trim() : ''
    if (link.length > 1000) return { ok: false, error: 'Link quá dài.', field: 'gbp_link' }
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`
    if (link && !isSupportedGoogleMapsUrl(link)) {
      return {
        ok: false,
        error: 'Đây không phải link Google Maps hợp lệ. Hãy mở doanh nghiệp trên Google Maps, bấm “Chia sẻ” rồi dán link (maps.app.goo.gl/… hoặc google.com/maps/…).',
        field: 'gbp_link',
      }
    }
    if (link !== curLink) {
      const norm = normalizeGbpLink(link || null)
      if (norm === (current.gbp_link_normalized ?? null) && explicitPid === undefined) {
        // Chỉ viết lại link cùng nội dung (vd thêm tham số theo dõi): không đổi quán.
        newLink = link || null
      } else {
        newLink = link || null
        newNorm = norm
        // Xóa hẳn link (không gửi place_id): giữ place_id hiện có, vì bỏ link không có nghĩa là đổi quán.
        newPid = explicitPid !== undefined ? explicitPid : link ? extractPlaceIdFromUrl(link) : (current.place_id ?? null)
      }
    } else if (explicitPid !== undefined) {
      newPid = explicitPid
    }
  } else if (explicitPid !== undefined) {
    newPid = explicitPid
  }

  if (hasLinkKey || hasPidKey) {
    const hadIdentity = !!(current.place_id || current.gbp_link_normalized)
    if (hadIdentity && !newPid && !newNorm) {
      return {
        ok: false,
        error: 'Cần giữ lại link Google Maps hoặc Place ID — thiếu cả hai thì không lấy được dữ liệu để audit.',
        field: 'gbp_link',
      }
    }
    if (newLink !== (curLink || null)) patch.gbp_link = newLink
    if (newNorm !== (current.gbp_link_normalized ?? null)) patch.gbp_link_normalized = newNorm
    if (newPid !== (current.place_id ?? null)) patch.place_id = newPid
    if ('gbp_link' in patch || 'gbp_link_normalized' in patch || 'place_id' in patch) identityTouched = true
  }

  // Bỏ các trường hồ sơ không thay đổi để RPC/ghi sổ gọn.
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Không có thay đổi nào để lưu.' }
  return { ok: true, patch, identityTouched }
}

/** place_key trước/sau khi áp patch — cùng công thức lib/audit-quota-key.ts. Dùng để báo trước "đổi quán". */
export function placeKeyAfterPatch(
  current: ClientIdentity & { id: string },
  patch: Record<string, string | null>,
): { before: string; after: string; changesPlace: boolean } {
  const key = (c: { id: string; place_id?: string | null; gbp_link_normalized?: string | null }) =>
    (c.place_id || '').trim() || ((c.gbp_link_normalized || '').trim() ? `gbp:${c.gbp_link_normalized!.trim()}` : `client:${c.id}`)
  const before = key(current)
  const after = key({ id: current.id, place_id: 'place_id' in patch ? patch.place_id : current.place_id, gbp_link_normalized: 'gbp_link_normalized' in patch ? patch.gbp_link_normalized : current.gbp_link_normalized })
  return { before, after, changesPlace: before !== after }
}
