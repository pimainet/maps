/**
 * GET an toàn tới website do bên thứ ba khai trên hồ sơ Google (chống SSRF), dùng cho kiểm tra tín hiệu địa phương của website.
 *
 *  - Chỉ http/https, không user:pass, không cổng lạ (chỉ 80/443 hoặc cổng mặc định).
 *  - Phân giải DNS TRƯỚC KHI kết nối (lookup tuỳ biến của node:http) và từ chối mọi IP nội bộ / loopback / link-local
 *    (169.254.x.x là metadata cloud) / CGNAT / multicast / tài liệu, kể cả IPv6 và IPv4-mapped. Vì kiểm tra ngay lúc kết
 *    nối nên chặn được DNS rebinding (tên miền công khai trỏ vào IP nội bộ), điều mà kiểm tra theo tên miền không làm được.
 *  - Chuyển hướng xử lý thủ công (tối đa 4), mỗi bước kiểm tra lại như trên.
 *  - Giới hạn thời gian tổng và dung lượng (cả sau giải nén).
 *  - Tôn trọng robots.txt (xem robotsAllows) — do caller gọi trước khi lấy trang.
 */
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'

export const AUDIT_BOT_UA = 'LocalGrowthOS-AuditBot/1.0 (+kiem tra ho so Google Maps theo yeu cau chu doanh nghiep)'
export const AUDIT_BOT_TOKEN = 'localgrowthos-auditbot'

// ---------- IP policy ----------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0
}
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip)
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (n & mask) === (ipv4ToInt(base) & mask)
  })
}

/** Mở rộng IPv6 thành 8 nhóm 16 bit. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  // đuôi IPv4 (::ffff:1.2.3.4)
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (m) {
    const n = ipv4ToInt(m[1])
    s = s.slice(0, -m[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16)
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  if (tail === undefined && h.length !== 8) return null
  const fill = 8 - h.length - t.length
  if (fill < 0) return null
  const parts = [...h, ...Array(tail !== undefined ? fill : 0).fill('0'), ...t].map((x) => parseInt(x || '0', 16))
  return parts.length === 8 && parts.every((x) => Number.isFinite(x) && x >= 0 && x <= 0xffff) ? parts : null
}

/** true = KHÔNG được kết nối tới IP này. */
export function isBlockedIp(ip: string): boolean {
  const fam = net.isIP(ip)
  if (fam === 4) return v4Blocked(ip)
  if (fam !== 6) return true
  const p = expandV6(ip)
  if (!p) return true
  const allZeroPrefix = p.slice(0, 5).every((x) => x === 0)
  if (allZeroPrefix && p[5] === 0xffff) return v4Blocked(`${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`) // IPv4-mapped
  if (p.slice(0, 6).every((x) => x === 0)) return true // ::, ::1, IPv4-compatible (cũ)
  if (p[0] === 0x64 && p[1] === 0xff9b) return true // NAT64
  if ((p[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((p[0] & 0xffc0) === 0xfe80) return true // link-local
  if ((p[0] & 0xff00) === 0xff00) return true // multicast
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true // tài liệu
  if (p[0] === 0x2002) return true // 6to4 (có thể bọc IPv4 nội bộ)
  if (p[0] === 0x2001 && p[1] === 0) return true // Teredo
  return false
}

export type IpPolicy = (ip: string) => boolean // true = cho phép
export const publicOnly: IpPolicy = (ip) => !isBlockedIp(ip)

type LookupFn = (hostname: string, cb: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void) => void
const systemLookup: LookupFn = (hostname, cb) => dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => cb(err, addrs as any))

class BlockedError extends Error {
  code = 'EBLOCKED'
}

/** lookup cho node:http: phân giải rồi chỉ trả IP được phép; có IP bị chặn => từ chối cả tên miền. */
function guardedLookup(policy: IpPolicy, resolver: LookupFn) {
  return (hostname: string, options: any, cb: (...a: any[]) => void) => {
    resolver(hostname, (err, addrs) => {
      if (err) return cb(err)
      if (!addrs.length) return cb(new Error('ENOTFOUND'))
      if (addrs.some((a) => !policy(a.address))) return cb(new BlockedError(`blocked address for ${hostname}`))
      if (options?.all) return cb(null, addrs)
      cb(null, addrs[0].address, addrs[0].family)
    })
  }
}

function urlAllowed(u: URL, policy: IpPolicy): boolean {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  if (u.port && u.port !== '80' && u.port !== '443') return false
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (net.isIP(host)) return policy(host)
  return host.includes('.')
}

// ---------- GET ----------

export type SafeGetResult =
  | { ok: true; status: number; finalUrl: string; contentType: string; body: string; truncated: boolean; redirects: number }
  | { ok: false; reason: 'unsafe' | 'timeout' | 'too_many_redirects' | 'network' | 'blocked_ip'; finalUrl: string; detail?: string }

export interface SafeGetOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Chỉ dùng trong test (server cục bộ). Mặc định: chỉ IP công khai. */
  ipPolicy?: IpPolicy
  /** Chỉ dùng trong test. */
  resolver?: LookupFn
  /** Cho test bỏ qua giới hạn cổng 80/443 (server cục bộ chạy cổng ngẫu nhiên). */
  allowAnyPort?: boolean
  /** Gọi trước mỗi URL (kể cả sau chuyển hướng) — ví dụ để kiểm robots.txt; trả false = dừng. */
  beforeEach?: (url: URL) => Promise<boolean>
}

function decodeBody(buf: Buffer, contentType: string): string {
  const cs = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase()
  try {
    return new TextDecoder(cs && cs !== 'utf8' ? cs : 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

function requestOnce(u: URL, opts: Required<Pick<SafeGetOptions, 'maxBytes'>> & SafeGetOptions, signal: AbortSignal) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      u,
      {
        method: 'GET',
        agent: false,
        lookup: guardedLookup(opts.ipPolicy ?? publicOnly, opts.resolver ?? systemLookup) as any,
        headers: {
          'user-agent': AUDIT_BOT_UA,
          accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'vi,en;q=0.8',
        },
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false })
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        let stream: Readable = res
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        stream.on('data', (c: Buffer) => {
          if (truncated) return
          size += c.length
          if (size > opts.maxBytes) {
            truncated = true
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - opts.maxBytes))))
            res.destroy()
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated })
            return
          }
          chunks.push(c)
        })
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated }))
        stream.on('error', (e) => (truncated ? undefined : reject(e)))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

export async function safeGet(rawUrl: string, options: SafeGetOptions = {}): Promise<SafeGetResult> {
  const opts = { timeoutMs: 8000, maxBytes: 1_500_000, maxRedirects: 4, ...options }
  const policy = opts.ipPolicy ?? publicOnly
  let current: URL
  try {
    current = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { ok: false, reason: 'unsafe', finalUrl: rawUrl }
  }
  const allowed = (u: URL) => {
    if (opts.allowAnyPort && u.port) {
      const copy = new URL(u.toString())
      copy.port = ''
      return urlAllowed(copy, policy)
    }
    return urlAllowed(u, policy)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    for (let i = 0; i <= opts.maxRedirects; i++) {
      if (!allowed(current)) return { ok: false, reason: 'unsafe', finalUrl: current.toString() }
      if (opts.beforeEach && !(await opts.beforeEach(current))) return { ok: false, reason: 'unsafe', finalUrl: current.toString(), detail: 'beforeEach' }
      const res = await requestOnce(current, opts, controller.signal)
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.location
        if (!loc) return { ok: false, reason: 'network', finalUrl: current.toString(), detail: 'redirect without location' }
        current = new URL(String(loc), current)
        continue
      }
      const contentType = String(res.headers['content-type'] || '')
      return { ok: true, status: res.status, finalUrl: current.toString(), contentType, body: decodeBody(res.body, contentType), truncated: res.truncated, redirects: i }
    }
    return { ok: false, reason: 'too_many_redirects', finalUrl: current.toString() }
  } catch (e: any) {
    if (e instanceof BlockedError || e?.code === 'EBLOCKED') return { ok: false, reason: 'blocked_ip', finalUrl: current.toString() }
    if (controller.signal.aborted || e?.name === 'AbortError') return { ok: false, reason: 'timeout', finalUrl: current.toString() }
    return { ok: false, reason: 'network', finalUrl: current.toString(), detail: String(e?.message || e).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- robots.txt ----------

interface RobotsRule { allow: boolean; path: string }

/** Phân tích robots.txt (RFC 9309): chọn nhóm khớp token của bot, không có thì nhóm "*". */
export function parseRobots(txt: string, token = AUDIT_BOT_TOKEN): RobotsRule[] {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = []
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur) continue
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && !val) continue // "Disallow:" rỗng = cho phép tất cả
      cur.rules.push({ allow: key === 'allow', path: val })
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)))
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''))
  return re.test(path)
}

/** Luật khớp dài nhất thắng; bằng nhau thì Allow thắng (RFC 9309). */
export function robotsAllows(rules: RobotsRule[], pathWithQuery: string): boolean {
  let best: RobotsRule | null = null
  for (const r of rules) {
    if (!ruleMatches(r.path, pathWithQuery)) continue
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r
  }
  return best ? best.allow : true
}

/**
 * Kiểm tra robots.txt cho 1 URL. 2xx: theo luật; 4xx: cho phép (theo RFC 9309); 5xx / lỗi mạng: KHÔNG lấy trang
 * (coi như chưa được phép) — audit sẽ ghi "chưa đủ dữ liệu", không đoán.
 */
export async function checkRobots(
  u: URL,
  options: SafeGetOptions = {},
  cache = new Map<string, RobotsRule[] | 'error'>(),
): Promise<'allowed' | 'disallowed' | 'error'> {
  const origin = u.origin
  let rules = cache.get(origin)
  if (!rules) {
    const r = await safeGet(`${origin}/robots.txt`, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 4000, 4000), maxBytes: 500_000, maxRedirects: 2, beforeEach: undefined })
    if (!r.ok) rules = 'error'
    else if (r.status >= 200 && r.status < 300) rules = parseRobots(r.body)
    else if (r.status >= 400 && r.status < 500) rules = []
    else rules = 'error'
    cache.set(origin, rules)
  }
  if (rules === 'error') return 'error'
  return robotsAllows(rules, u.pathname + u.search) ? 'allowed' : 'disallowed'
}
