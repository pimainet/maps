/**
 * Chuẩn hóa định danh Google Maps / GBP để chống trùng client.
 */

const GOOGLE_MAPS_HOSTS = new Set([
  'google.com', 'www.google.com', 'maps.google.com',
  'google.com.vn', 'www.google.com.vn', 'maps.google.com.vn',
  'google.co.uk', 'www.google.co.uk', 'maps.google.co.uk',
  'google.co.id', 'www.google.co.id', 'maps.google.co.id',
  'google.co.th', 'www.google.co.th', 'maps.google.co.th',
  'google.co.jp', 'www.google.co.jp', 'maps.google.co.jp',
  'google.co.kr', 'www.google.co.kr', 'maps.google.co.kr',
  'google.com.au', 'www.google.com.au', 'maps.google.com.au',
  'google.ca', 'www.google.ca', 'maps.google.ca',
  'google.de', 'www.google.de', 'maps.google.de',
  'google.fr', 'www.google.fr', 'maps.google.fr',
  'google.es', 'www.google.es', 'maps.google.es',
  'google.it', 'www.google.it', 'maps.google.it',
  'google.co.in', 'www.google.co.in', 'maps.google.co.in',
  'google.com.sg', 'www.google.com.sg', 'maps.google.com.sg',
  'google.com.my', 'www.google.com.my', 'maps.google.com.my',
  'google.com.ph', 'www.google.com.ph', 'maps.google.com.ph',
  'google.com.tw', 'www.google.com.tw', 'maps.google.com.tw',
  'google.com.hk', 'www.google.com.hk', 'maps.google.com.hk',
  'google.com.br', 'www.google.com.br', 'maps.google.com.br',
  'google.com.mx', 'www.google.com.mx', 'maps.google.com.mx',
  'maps.app.goo.gl', 'goo.gl', 'g.page', 'share.google',
])

/** Chỉ cho phép link Google Maps HTTPS hợp lệ (chặn URL lạ trước khi gửi sang Outscraper/Places). */
export function isSupportedGoogleMapsUrl(input: string | null | undefined): boolean {
  if (!input) return false
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    const host = url.hostname.toLowerCase()
    if (!GOOGLE_MAPS_HOSTS.has(host)) return false
    if (host === 'goo.gl' && !url.pathname.toLowerCase().startsWith('/maps')) return false
    return true
  } catch {
    return false
  }
}

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
  if (q?.[1]) {
    try {
      const decoded = decodeURIComponent(q[1])
      if (/^ChIJ/.test(decoded)) return decoded
    } catch {
      return null
    }
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

/** Link Maps tìm theo tên (+ khu vực), dùng làm maps_url dự phòng khi nguồn dữ liệu không trả link. */
export function buildMapsSearchUrl(input: {
  mapsUrl?: string
  placeId?: string | null
  businessName?: string
  area?: string
}): string | null {
  if (input.mapsUrl) return input.mapsUrl
  if (input.placeId) {
    const id = canonicalizePlaceId(input.placeId)
    if (id) return `https://www.google.com/maps/place/?q=place_id:${id}`
  }
  if (input.businessName) {
    const q = [input.businessName, input.area].filter(Boolean).join(' ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }
  return null
}
