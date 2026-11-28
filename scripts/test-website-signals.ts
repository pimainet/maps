// Chạy: npx tsx scripts/test-website-signals.ts
// Tín hiệu địa phương của website (W01–W04): chống SSRF (IP nội bộ, DNS trỏ vào nội bộ, chuyển hướng), robots.txt, giới hạn
// thời gian/dung lượng, phân tích NAP/khu vực/schema bằng fixture HTML, và cache.
import assert from 'node:assert/strict'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { isBlockedIp, parseRobots, robotsAllows, safeGet, type SafeGetOptions } from '../lib/safe-fetch'
import { analyzeWebsite, extractHtml, fetchWebsiteSignals, normPhone, placeTermsFromAddress, streetFromAddress } from '../lib/website-signals'
import { runWebsiteChecks } from '../lib/audit-engine/website'
import { pickCacheEntry } from '../lib/audit-cache'
import type { AuditInput, WebsiteSignals } from '../lib/audit-engine/types'

const PROFILE = { name: 'Phở Gia Truyền', phone: '+84 24 3826 0000', address: '12 Lý Quốc Sư, Hàng Trống, Hoàn Kiếm, Hà Nội 100000, Việt Nam', area: null }

const GOOD_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phở Gia Truyền – Phở bò ngon Hoàn Kiếm, Hà Nội</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Restaurant","name":"Phở Gia Truyền","telephone":"024 3826 0000","address":{"@type":"PostalAddress","streetAddress":"12 Lý Quốc Sư","addressLocality":"Hoàn Kiếm"}}]}</script>
</head><body><h1>Phở Gia Truyền</h1><p>Phở bò truyền thống từ 1960.</p>
<footer>Địa chỉ: Số 12, đường Lý Quốc Sư, Hoàn Kiếm &amp; Hotline: <a href="tel:02438260000">024.3826.0000</a></footer></body></html>`

const BAD_HTML = `<html><head><title>Trang chủ</title><script type="application/ld+json">{"@type":"WebSite","name":"x"}</script></head>
<body><h1>Chào mừng</h1><p>Gọi 0912 345 678. Địa chỉ 45 Hàng Bông.</p></body></html>`

async function withServer(handler: http.RequestListener, fn: (port: number) => Promise<void>) {
  const server = http.createServer(handler)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port
  try {
    await fn(port)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((r) => server.close(() => r()))
  }
}

async function main() {
  // 1) Chính sách IP.
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'ff02::1', 'not-an-ip'])
    assert.equal(isBlockedIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.113.1.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isBlockedIp(ip), false, ip)

  // 2) robots.txt (RFC 9309): nhóm riêng của bot thắng nhóm *, luật dài nhất thắng, Allow thắng khi bằng nhau, wildcard.
  const rb = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: LocalGrowthOS-AuditBot\nDisallow: /admin\nAllow: /admin/public\n')
  assert.equal(robotsAllows(rb, '/'), true)
  assert.equal(robotsAllows(rb, '/admin/x'), false)
  assert.equal(robotsAllows(rb, '/admin/public/a'), true)
  const star = parseRobots('User-agent: *\nDisallow: /*.php$\nDisallow: /private\nDisallow:\n')
  assert.equal(robotsAllows(star, '/index.php'), false)
  assert.equal(robotsAllows(star, '/index.php?x=1'), true)
  assert.equal(robotsAllows(star, '/private/a'), false)
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /\n'), '/'), false)
  assert.equal(robotsAllows(parseRobots(''), '/'), true)

  // 3) Chuẩn hoá.
  assert.equal(normPhone('+84 24 3826 0000'), '02438260000')
  assert.equal(normPhone('(024) 3826-0000'), '02438260000')
  assert.equal(normPhone('1900 1234'), '19001234')
  assert.equal(normPhone('12345'), null)
  assert.deepEqual(streetFromAddress(PROFILE.address), { number: '12', street: 'ly quoc su' })
  assert.deepEqual(placeTermsFromAddress(PROFILE.address).map((t) => t.label), ['Hoàn Kiếm', 'Hà Nội'])
  const q1 = placeTermsFromAddress('45 Lê Lợi, Bến Nghé, Quận 1, Thành phố Hồ Chí Minh, Việt Nam')
  assert.deepEqual(q1.map((t) => t.variants[0]), ['quan 1', 'ho chi minh'])

  // 4) Phân tích fixture HTML.
  const now = new Date('2026-11-28T00:00:00Z')
  const good = analyzeWebsite(extractHtml(GOOD_HTML), PROFILE, { url: 'https://pho.vn', finalUrl: 'https://pho.vn/', now })
  assert.equal(good.phoneOnPage, true)
  assert.equal(good.addressOnPage, true, '"Số 12, đường Lý Quốc Sư" khớp "12 Lý Quốc Sư"')
  assert.equal(good.nameOnPage, true)
  assert.equal(good.cityInTitleOrH1, true)
  assert.equal(good.localBusinessSchema, true)
  assert.equal(good.https, true)
  assert.equal(good.hasViewport, true)
  const bad = analyzeWebsite(extractHtml(BAD_HTML), PROFILE, { url: 'http://x.vn', finalUrl: 'http://x.vn/', now })
  assert.equal(bad.phoneOnPage, false)
  assert.equal(bad.addressOnPage, false)
  assert.equal(bad.cityInTitleOrH1, false)
  assert.equal(bad.localBusinessSchema, false)
  assert.deepEqual(bad.schemaTypes, ['WebSite'])
  assert.equal(bad.https, false)
  // Số nhà phải đứng ngay trước tên đường (không khớp "112 Lý Quốc Sư").
  const near = analyzeWebsite(extractHtml('<p>112 Lý Quốc Sư</p>'), PROFILE, { url: 'https://a.vn', finalUrl: 'https://a.vn', now })
  assert.equal(near.addressOnPage, false)
  // Hồ sơ không có SĐT/địa chỉ -> null (không kết luận).
  const noNap = analyzeWebsite(extractHtml(GOOD_HTML), { name: null, phone: null, address: null }, { url: 'https://a.vn', finalUrl: 'https://a.vn', now })
  assert.equal(noNap.phoneOnPage, null)
  assert.equal(noNap.addressOnPage, null)
  assert.equal(noNap.cityInTitleOrH1, null)

  // 5) Check W01–W04.
  const snap = { website_url: 'https://pho.vn', primary_category: 'Nhà hàng phở' } as unknown as AuditInput['snapshot']
  const byId = (sig: WebsiteSignals | undefined, s = snap) => Object.fromEntries(runWebsiteChecks({ snapshot: s, website: sig }).map((c) => [c.id, c]))
  let w = byId(good)
  assert.deepEqual(['W01', 'W02', 'W03', 'W04'].map((id) => w[id].passed), [true, true, true, true])
  assert.ok(Object.values(w).every((c) => c.group === 'website'))
  w = byId(bad)
  assert.deepEqual(['W01', 'W02', 'W03', 'W04'].map((id) => w[id].passed), [false, false, false, false])
  assert.ok(w.W01.action && w.W02.action && w.W03.action)
  for (const status of ['robots_disallowed', 'social', 'unreachable', 'unsafe', 'http_error'] as const) {
    w = byId({ fetchedAt: '', url: 'x', status })
    assert.ok(Object.values(w).every((c) => c.passed === null), status)
  }
  w = byId(undefined, { website_url: null } as unknown as AuditInput['snapshot'])
  assert.ok(Object.values(w).every((c) => c.passed === null))
  assert.equal(byId(noNap).W01.passed, null)

  // 6) safeGet: chặn IP nội bộ trực tiếp, DNS trỏ vào nội bộ, chuyển hướng vào nội bộ; giới hạn thời gian, dung lượng.
  assert.equal((await safeGet('http://127.0.0.1/')).ok, false)
  assert.equal((await safeGet('http://169.254.169.254/latest/meta-data/')).ok, false)
  assert.equal((await safeGet('http://localhost/')).ok, false)
  assert.equal((await safeGet('ftp://example.com/')).ok, false)
  assert.equal((await safeGet('http://user:pw@example.com/')).ok, false)
  assert.equal((await safeGet('http://example.com:8080/')).ok, false, 'cổng lạ')
  const rebinding = await safeGet('http://rebind.test/', { allowAnyPort: true, resolver: (_h, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]) })
  assert.equal(rebinding.ok, false)
  assert.equal(!rebinding.ok && rebinding.reason, 'blocked_ip', 'tên miền công khai trỏ vào IP nội bộ bị chặn lúc kết nối')

  const big = 'x'.repeat(50_000)
  await withServer((req, res) => {
    const u = req.url || '/'
    if (u === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /private\n') }
    if (u === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(GOOD_HTML) }
    if (u === '/gz') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync(GOOD_HTML)) }
    if (u === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(big) }
    if (u === '/to-meta') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end() }
    if (u === '/to-evil') { res.writeHead(301, { location: 'http://evil.test/' }); return res.end() }
    if (u === '/to-home') { res.writeHead(301, { location: '/' }); return res.end() }
    if (u === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end() }
    if (u === '/slow') return // không trả lời
    res.writeHead(404); res.end()
  }, async (port) => {
    const map: Record<string, string> = { 'shop.test': '127.0.0.1', 'evil.test': '10.0.0.1' }
    // Chính sách test: chỉ cho phép đúng 127.0.0.1 của server test; mọi IP nội bộ khác vẫn bị chặn.
    const T: SafeGetOptions = { allowAnyPort: true, ipPolicy: (ip) => ip === '127.0.0.1', resolver: (h, cb) => (map[h] ? cb(null, [{ address: map[h], family: 4 }]) : cb(new Error('ENOTFOUND'), [])) }
    const base = `http://shop.test:${port}`
    // Mặc định (không nới chính sách) thì server cục bộ cũng bị chặn.
    const dflt = await safeGet(`${base}/`, { allowAnyPort: true, resolver: T.resolver })
    assert.equal(!dflt.ok && dflt.reason, 'blocked_ip')

    const ok = await safeGet(`${base}/`, T)
    assert.ok(ok.ok && ok.body.includes('Phở Gia Truyền'))
    const gz = await safeGet(`${base}/gz`, T)
    assert.ok(gz.ok && gz.body.includes('Lý Quốc Sư'), 'giải nén gzip')
    const trunc = await safeGet(`${base}/big`, { ...T, maxBytes: 10_000 })
    assert.ok(trunc.ok && trunc.truncated && trunc.body.length === 10_000, 'cắt theo dung lượng')
    const meta = await safeGet(`${base}/to-meta`, T)
    assert.equal(!meta.ok && meta.reason, 'unsafe', 'chuyển hướng tới 169.254.169.254 bị chặn')
    const evil = await safeGet(`${base}/to-evil`, T)
    assert.equal(!evil.ok && evil.reason, 'blocked_ip', 'chuyển hướng tới tên miền trỏ vào 10.x bị chặn')
    const home = await safeGet(`${base}/to-home`, T)
    assert.ok(home.ok && home.redirects === 1)
    const loop = await safeGet(`${base}/loop`, T)
    assert.equal(!loop.ok && loop.reason, 'too_many_redirects')
    const t0 = Date.now()
    const slow = await safeGet(`${base}/slow`, { ...T, timeoutMs: 300 })
    assert.equal(!slow.ok && slow.reason, 'timeout')
    assert.ok(Date.now() - t0 < 3000)

    // fetchWebsiteSignals: đọc trang + robots.txt.
    const sig = await fetchWebsiteSignals(`${base}/`, PROFILE, T, now)
    assert.equal(sig.status, 'ok')
    assert.equal(sig.phoneOnPage, true)
    assert.equal(sig.localBusinessSchema, true)
    assert.equal(sig.https, false)
    const blocked = await fetchWebsiteSignals(`${base}/private/page`, PROFILE, T, now)
    assert.equal(blocked.status, 'robots_disallowed', 'tôn trọng robots.txt')
    const notFound = await fetchWebsiteSignals(`${base}/nope`, PROFILE, T, now)
    assert.equal(notFound.status, 'http_error')
    assert.equal((await fetchWebsiteSignals('https://www.facebook.com/phogiatruyen', PROFILE, T, now)).status, 'social')
  })

  // robots.txt lỗi 5xx -> không lấy trang.
  let pageHits = 0
  await withServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(503); return res.end() }
    pageHits++
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(GOOD_HTML)
  }, async (port) => {
    const T: SafeGetOptions = { allowAnyPort: true, ipPolicy: (ip) => ip === '127.0.0.1', resolver: (_h, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) }
    const r = await fetchWebsiteSignals(`http://shop.test:${port}/`, PROFILE, T, now)
    assert.equal(r.status, 'robots_error')
    assert.equal(pageHits, 0)
  })

  // 7) Cache: lấy mục mới nhất còn hạn và đúng dấu vân tay hồ sơ.
  const rows = [
    { audit_cache: { website_signals: { savedAt: '2026-11-27T00:00:00Z', value: { profileKey: 'b' } } } },
    { audit_cache: { website_signals: { savedAt: '2026-11-25T00:00:00Z', value: { profileKey: 'a' } } } },
    { audit_cache: { website_signals: { savedAt: '2026-11-01T00:00:00Z', value: { profileKey: 'a' } } } },
    { audit_cache: null },
  ]
  assert.equal(pickCacheEntry<any>(rows, 'website_signals', 7, now, (v) => v.profileKey === 'a')!.savedAt, '2026-11-25T00:00:00Z')
  assert.equal(pickCacheEntry<any>(rows, 'website_signals', 7, now)!.savedAt, '2026-11-27T00:00:00Z')
  assert.equal(pickCacheEntry<any>(rows, 'website_signals', 0.5, now), null)
  assert.equal(pickCacheEntry<any>(rows, 'other', 7, now), null)

  console.log('OK: tín hiệu website (W01–W04) + chống SSRF + robots.txt + cache — tất cả kiểm tra đều qua')
}

main().catch((e) => { console.error(e); process.exit(1) })
