/**
 * Tín hiệu địa phương của website khách (W01–W04): NAP khớp hồ sơ, quận/thành phố trong title/H1, schema LocalBusiness,
 * HTTPS + viewport. Lấy trang bằng safeGet (chống SSRF, giới hạn thời gian/dung lượng), tôn trọng robots.txt; kết quả cache
 * 7 ngày theo URL + NAP hồ sơ. Phần phân tích là hàm thuần (test bằng fixture HTML).
 */
import { createHash } from 'node:crypto'
import { checkRobots, safeGet, type SafeGetOptions } from '@/lib/safe-fetch'
import type { WebsiteSignals } from '@/lib/audit-engine/types'

export const WEBSITE_CACHE_DAYS = 7
const CACHE_KEY = 'website_signals'

// ---------- chuẩn hoá ----------

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Chuẩn hoá số VN về dạng 0xxxxxxxxx (bỏ +84/84). Trả null nếu không giống số điện thoại. */
export function normPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2)
  if (/^1[89]00\d{4,6}$/.test(d)) return d // tổng đài 1900/1800
  if (!/^0\d{8,10}$/.test(d)) return null
  return d
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

// ---------- trích xuất HTML (thuần) ----------

export interface HtmlExtract {
  title: string | null
  h1: string[]
  hasViewport: boolean
  schemaTypes: string[]
  schemaTelephones: string[]
  schemaAddresses: string[]
  schemaNames: string[]
  telLinks: string[]
  text: string
}

function collectJsonLd(node: unknown, out: { types: string[]; tels: string[]; addrs: string[]; names: string[] }, depth = 0) {
  if (!node || depth > 8) return
  if (Array.isArray(node)) {
    for (const n of node) collectJsonLd(n, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>
  const t = o['@type']
  for (const x of Array.isArray(t) ? t : t ? [t] : []) if (typeof x === 'string') out.types.push(x.replace(/^https?:\/\/schema\.org\//, ''))
  if (typeof o.telephone === 'string') out.tels.push(o.telephone)
  if (typeof o.name === 'string' && t) out.names.push(o.name)
  const a = o.address
  if (typeof a === 'string') out.addrs.push(a)
  else if (a && typeof a === 'object' && !Array.isArray(a)) {
    const ao = a as Record<string, unknown>
    out.addrs.push(['streetAddress', 'addressLocality', 'addressRegion'].map((k) => (typeof ao[k] === 'string' ? ao[k] : '')).filter(Boolean).join(', '))
  }
  for (const [k, v] of Object.entries(o)) if (k !== 'address' && v && typeof v === 'object') collectJsonLd(v, out, depth + 1)
}

export function extractHtml(html: string): HtmlExtract {
  const doc = html.slice(0, 2_000_000)
  const title = (() => {
    const m = doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return m ? stripTags(m[1]).slice(0, 300) || null : null
  })()
  const h1 = [...doc.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]).slice(0, 300)).filter(Boolean).slice(0, 5)
  const hasViewport = /<meta[^>]+name\s*=\s*["']?viewport["']?[^>]*>/i.test(doc)
  const ld = { types: [] as string[], tels: [] as string[], addrs: [] as string[], names: [] as string[] }
  for (const m of doc.matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectJsonLd(JSON.parse(m[1].trim()), ld)
    } catch {
      /* JSON-LD hỏng: bỏ qua */
    }
  }
  // microdata
  for (const m of doc.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi)) ld.types.push(m[1])
  const telLinks = [...doc.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)].map((m) => decodeEntities(m[1]))
  const body = doc
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  return {
    title,
    h1,
    hasViewport,
    schemaTypes: [...new Set(ld.types)].slice(0, 20),
    schemaTelephones: ld.tels.slice(0, 10),
    schemaAddresses: ld.addrs.slice(0, 10),
    schemaNames: ld.names.slice(0, 10),
    telLinks: telLinks.slice(0, 20),
    text: stripTags(body).slice(0, 300_000),
  }
}

// ---------- LocalBusiness ----------

const LOCAL_BUSINESS_TYPES = new Set(
  [
    'LocalBusiness', 'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Bakery', 'BarOrPub', 'FastFoodRestaurant', 'IceCreamShop',
    'Dentist', 'MedicalBusiness', 'MedicalClinic', 'Physician', 'Optician', 'Pharmacy', 'HealthAndBeautySalon', 'BeautySalon',
    'HairSalon', 'NailSalon', 'DaySpa', 'TattooParlor', 'Store', 'ClothingStore', 'ElectronicsStore', 'FurnitureStore',
    'HardwareStore', 'GroceryStore', 'AutoRepair', 'AutoDealer', 'AutomotiveBusiness', 'Hotel', 'LodgingBusiness', 'Motel',
    'Hostel', 'ProfessionalService', 'LegalService', 'Attorney', 'AccountingService', 'RealEstateAgent', 'TravelAgency',
    'HomeAndConstructionBusiness', 'Plumber', 'Electrician', 'HVACBusiness', 'GeneralContractor', 'RoofingContractor',
    'ExerciseGym', 'SportsActivityLocation', 'ChildCare', 'DryCleaningOrLaundry', 'EntertainmentBusiness', 'EmergencyService',
    'FinancialService', 'Florist', 'PetStore', 'VeterinaryCare', 'EmploymentAgency', 'InternetCafe', 'Library', 'SelfStorage',
    'ShoppingCenter', 'GovernmentOffice', 'RadioStation', 'RecyclingCenter', 'AnimalShelter', 'ArchiveOrganization',
  ].map((x) => x.toLowerCase()),
)
export function isLocalBusinessType(t: string): boolean {
  const k = t.toLowerCase()
  return LOCAL_BUSINESS_TYPES.has(k) || /(store|shop|restaurant|salon|clinic|business)$/.test(k)
}

// ---------- địa danh (quận/huyện, tỉnh/thành) ----------

const PLACE_PREFIX = /^(thanh pho|tp|t p|tinh|quan|q|huyen|h|thi xa|tx|thi tran|tt)\s+/
const ALIASES: Record<string, string[]> = {
  'ho chi minh': ['ho chi minh', 'hcm', 'tphcm', 'sai gon', 'saigon'],
  'ha noi': ['ha noi', 'hanoi'],
  'da nang': ['da nang', 'danang'],
}

/**
 * Lấy quận/huyện và tỉnh/thành từ địa chỉ hồ sơ (dạng "12 Lý Quốc Sư, Hàng Trống, Hoàn Kiếm, Hà Nội 100000, Việt Nam").
 * Bỏ phần số nhà/đường (đầu), phường (thường đứng sau đường), quốc gia và mã bưu chính. Mỗi địa danh trả danh sách biến thể
 * đã chuẩn hoá (bỏ dấu) để so; "Quận 1" -> ["quan 1", "q1", "q 1"].
 */
export function placeTermsFromAddress(address: string | null | undefined, area?: string | null): Array<{ label: string; variants: string[] }> {
  const out: Array<{ label: string; variants: string[] }> = []
  const seen = new Set<string>()
  const push = (label: string) => {
    const n = norm(label).replace(/\b\d{5,6}\b/g, '').trim()
    if (!n || n === 'viet nam' || n === 'vietnam') return
    const core = n.replace(PLACE_PREFIX, '').trim()
    if (!core || seen.has(core)) return
    seen.add(core)
    let variants: string[]
    if (/^\d+$/.test(core)) variants = [`quan ${core}`, `q${core}`, `q ${core}`, `district ${core}`]
    else variants = ALIASES[core] ?? [core]
    out.push({ label: label.replace(/\b\d{5,6}\b/g, '').trim(), variants })
  }
  const parts = (address || '').split(',').map((p) => p.trim()).filter(Boolean)
  // phần đầu là số nhà + đường; 2 phần cuối (trước quốc gia) là quận/huyện + tỉnh/thành
  const tail = parts.filter((p) => !/^(viet nam|vietnam)$/i.test(norm(p))).slice(1)
  for (const p of tail.slice(-2)) push(p)
  for (const p of (area || '').split(',').map((x) => x.trim()).filter(Boolean)) push(p)
  return out
}

/** Số nhà + tên đường từ phần đầu địa chỉ. */
export function streetFromAddress(address: string | null | undefined): { number: string | null; street: string } | null {
  const first = (address || '').split(',')[0]?.trim()
  if (!first) return null
  const n = norm(first).replace(/^(so|so nha)\s+/, '')
  const m = n.match(/^(\d+[a-z]?(?:\s?\/\s?\d+[a-z]?)*)\s+(.+)$/)
  const street = (m ? m[2] : n).replace(/^(duong|pho|ngo|hem|kiet)\s+/, '').trim()
  if (street.length < 3) return null
  return { number: m ? m[1].replace(/\s/g, '') : null, street }
}

function containsPhrase(haystackNorm: string, phraseNorm: string): boolean {
  return phraseNorm.length > 0 && (` ${haystackNorm} `).includes(` ${phraseNorm} `)
}

// ---------- phân tích (thuần) ----------

export interface ProfileNap {
  name?: string | null
  phone?: string | null
  address?: string | null
  area?: string | null
}

export function profileKeyOf(url: string, p: ProfileNap): string {
  return createHash('sha256').update(JSON.stringify([url, p.name || '', normPhone(p.phone || '') || '', norm(p.address || ''), norm(p.area || '')])).digest('hex').slice(0, 16)
}

export function analyzeWebsite(ex: HtmlExtract, profile: ProfileNap, meta: { url: string; finalUrl: string; now?: Date }): WebsiteSignals {
  const textN = norm(ex.text)
  // điện thoại
  const profilePhone = normPhone(profile.phone || '')
  let phoneOnPage: boolean | null = null
  if (profilePhone) {
    const found = new Set<string>()
    for (const t of [...ex.telLinks, ...ex.schemaTelephones]) {
      const p = normPhone(t)
      if (p) found.add(p)
    }
    for (const m of ex.text.matchAll(/(?:\+?84|0|1[89]00)[\d\s.\-()]{7,16}\d/g)) {
      const p = normPhone(m[0])
      if (p) found.add(p)
    }
    phoneOnPage = found.has(profilePhone)
  }
  // địa chỉ: số nhà đứng ngay trước tên đường (cho phép "số", "đường", dấu phẩy chen giữa)
  let addressOnPage: boolean | null = null
  const st = streetFromAddress(profile.address)
  if (st) {
    const hay = [textN, ...ex.schemaAddresses.map(norm)]
    const esc = st.street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = st.number
      ? new RegExp(`(^| )${st.number.replace(/\//g, ' ?\\/? ?')} (?:(?:so|duong|pho|ngo|hem) )?${esc}( |$)`)
      : new RegExp(`(^| )${esc}( |$)`)
    addressOnPage = hay.some((h) => re.test(h.replace(/ \/ /g, '/')))
  }
  // tên
  let nameOnPage: boolean | null = null
  const nameN = norm(profile.name || '')
  if (nameN) nameOnPage = containsPhrase(textN, nameN) || ex.schemaNames.some((n) => norm(n) === nameN) || containsPhrase(norm(ex.title || ''), nameN)
  // địa danh trong title/H1
  const terms = placeTermsFromAddress(profile.address, profile.area)
  const headN = norm([ex.title || '', ...ex.h1].join(' | '))
  const cityInTitleOrH1 = terms.length ? terms.some((t) => t.variants.some((v) => containsPhrase(headN, v))) : null
  const schemaTypes = ex.schemaTypes
  let finalHttps = false
  try {
    finalHttps = new URL(meta.finalUrl).protocol === 'https:'
  } catch {
    /* noop */
  }
  return {
    fetchedAt: (meta.now ?? new Date()).toISOString(),
    url: meta.url,
    finalUrl: meta.finalUrl,
    status: 'ok',
    https: finalHttps,
    hasViewport: ex.hasViewport,
    title: ex.title,
    h1: ex.h1,
    schemaTypes,
    localBusinessSchema: schemaTypes.some(isLocalBusinessType),
    phoneOnPage,
    addressOnPage,
    nameOnPage,
    cityInTitleOrH1,
    placeTerms: terms.map((t) => t.label),
    profileKey: profileKeyOf(meta.url, profile),
  }
}

const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|zalo\.me|youtube\.com|linktr\.ee|shopee\.vn|lazada\.vn|m\.me|twitter\.com|x\.com|google\.com|business\.site|g\.page)$/i

/** Lấy + phân tích website, không cache (network). */
export async function fetchWebsiteSignals(rawUrl: string, profile: ProfileNap, opts: SafeGetOptions = {}, now = new Date()): Promise<WebsiteSignals> {
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  const base = { fetchedAt: now.toISOString(), url, profileKey: profileKeyOf(url, profile) }
  try {
    if (SOCIAL_HOSTS.test(new URL(url).hostname)) return { ...base, status: 'social', detail: new URL(url).hostname }
  } catch {
    return { ...base, status: 'unsafe' }
  }
  const robotsCache = new Map()
  const robots: { state: 'allowed' | 'disallowed' | 'error' } = { state: 'allowed' }
  const res = await safeGet(url, {
    timeoutMs: 10_000,
    ...opts,
    beforeEach: async (u) => {
      robots.state = await checkRobots(u, opts, robotsCache)
      return robots.state === 'allowed'
    },
  })
  if (!res.ok) {
    if (res.detail === 'beforeEach') return { ...base, finalUrl: res.finalUrl, status: robots.state === 'disallowed' ? 'robots_disallowed' : 'robots_error' }
    if (res.reason === 'unsafe' || res.reason === 'blocked_ip') return { ...base, finalUrl: res.finalUrl, status: 'unsafe', detail: res.reason }
    return { ...base, finalUrl: res.finalUrl, status: 'unreachable', detail: res.reason }
  }
  try {
    if (SOCIAL_HOSTS.test(new URL(res.finalUrl).hostname)) return { ...base, finalUrl: res.finalUrl, status: 'social', detail: new URL(res.finalUrl).hostname }
  } catch {
    /* noop */
  }
  if (res.status < 200 || res.status >= 300) return { ...base, finalUrl: res.finalUrl, status: 'http_error', detail: `HTTP ${res.status}` }
  if (!/html|xml/i.test(res.contentType) && !/^\s*</.test(res.body)) return { ...base, finalUrl: res.finalUrl, status: 'not_html', detail: res.contentType }
  return analyzeWebsite(extractHtml(res.body), profile, { url, finalUrl: res.finalUrl, now })
}

/** Dùng trong audit: cache 7 ngày (cùng URL + NAP hồ sơ), không có thì lấy mới rồi ghi cache. */
export async function collectWebsiteSignals(args: {
  url: string | null | undefined
  profile: ProfileNap
  clientId?: string | null
  workspaceId: string
}): Promise<{ signals: WebsiteSignals | undefined; from: 'cache' | 'live' | 'none' }> {
  if (!args.url) return { signals: undefined, from: 'none' }
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(args.url) ? args.url : `https://${args.url}`
  const key = profileKeyOf(url, args.profile)
  if (args.clientId) {
    const { readAuditCache } = await import('@/lib/audit-cache')
    const cached = await readAuditCache<WebsiteSignals>(args.clientId, args.workspaceId, CACHE_KEY, WEBSITE_CACHE_DAYS, (v) => v?.profileKey === key)
    // Lỗi tạm thời (không tới được, robots lỗi) không cache: lần sau thử lại.
    if (cached && cached.value.status !== 'unreachable' && cached.value.status !== 'robots_error') return { signals: cached.value, from: 'cache' }
  }
  const signals = await fetchWebsiteSignals(url, args.profile)
  if (args.clientId && signals.status !== 'unreachable' && signals.status !== 'robots_error') {
    const { writeAuditCache } = await import('@/lib/audit-cache')
    await writeAuditCache(args.clientId, args.workspaceId, CACHE_KEY, signals)
  }
  return { signals, from: 'live' }
}
