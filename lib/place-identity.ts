/**
 * Chuẩn hóa định danh Google Maps / GBP để chống trùng client.
 */

/** Rút place_id từ URL Maps phổ biến (nếu có). */
export function extractPlaceIdFromUrl(input: string | null | undefined): string | null {
  if (!input) return null
  const s = input.trim()
  if (!s) return null

  // Đã là place id dạng ChIJ... hoặc places/xxx
  if (/^ChIJ[\w-]+$/.test(s)) return s
  const placesPath = s.match(/places\/([A-Za-z0-9_-]+)/)
  if (placesPath?.[1]) return placesPath[1]

  // !1s0x...:0x... hex style — không ổn định bằng ChIJ, bỏ qua
  // data=!3m1!4b1!4m6!3m5!1s0x... — phức tạp, chỉ lấy query param
  const q = s.match(/[?&](?:q|query)=([^&]+)/i)
  if (q?.[1] && /^ChIJ/.test(decodeURIComponent(q[1]))) {
    return decodeURIComponent(q[1])
  }

  return null
}

/**
 * Chuẩn hóa link để so khớp:
 * - trim, lowercase host
 * - bỏ tracking params phổ biến
 * - bỏ trailing slash
 */
export function normalizeGbpLink(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim()
  if (!s) return null

  try {
    // Thêm scheme nếu thiếu để URL parse được
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
    const u = new URL(withScheme)
    const drop = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'g_ep',
      'g_st',
      'entry',
      'hl',
    ])
    const params = new URLSearchParams()
    u.searchParams.forEach((v, k) => {
      if (!drop.has(k.toLowerCase())) params.set(k, v)
    })
    const qs = params.toString()
    const path = u.pathname.replace(/\/+$/, '') || ''
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    return `https://${host}${path}${qs ? `?${qs}` : ''}`
  } catch {
    return s.toLowerCase().replace(/\/+$/, '')
  }
}

export function canonicalizePlaceId(
  placeId: string | null | undefined
): string | null {
  if (!placeId) return null
  let id = placeId.trim()
  if (!id) return null
  // API mới trả "places/ChIJ..."
  if (id.startsWith('places/')) id = id.slice('places/'.length)
  return id || null
}
