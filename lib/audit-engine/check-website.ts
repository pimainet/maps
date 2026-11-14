/**
 * Kiểm tra website có truy cập được không — HTTP request thật tới chính website của khách (không phải scrape Google).
 * Tách riêng khỏi foundation.ts để `runAudit` giữ nguyên là hàm thuần; caller tự gọi trước rồi truyền kết quả vào AuditInput.
 *
 * website_url đến từ hồ sơ Google công khai (bên thứ ba kiểm soát), nên KHÔNG được để server đi gọi địa chỉ nội bộ
 * (SSRF): chỉ http/https, từ chối localhost / IP riêng / link-local (169.254.x.x là metadata cloud) / tên miền nội bộ,
 * và kiểm tra lại ở MỖI lần chuyển hướng (không để redirect dẫn vào mạng nội bộ).
 */
const MAX_REDIRECTS = 4

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true
  // IPv6 literal: chặn loopback, unique-local, link-local, IPv4-mapped
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:')
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  )
}

export function isSafePublicUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && !isPrivateHost(u.hostname)
  } catch {
    return false
  }
}

export async function checkWebsiteReachable(url: string | null | undefined, timeoutMs = 8000): Promise<boolean | undefined> {
  if (!url) return undefined
  const first = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`
  if (!isSafePublicUrl(first)) return undefined // không kiểm tra được an toàn -> không kết luận (không phải "website chết")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let current = first
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const res = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return true
        const next = new URL(loc, current).toString()
        if (!isSafePublicUrl(next)) return undefined
        current = next
        continue
      }
      return res.ok
    }
    return false // chuyển hướng quá nhiều
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
