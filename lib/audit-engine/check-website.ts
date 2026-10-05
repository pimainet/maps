/**
 * Kiểm tra website có truy cập được không — HTTP request thật tới chính
 * website của khách (không phải scrape Google), hợp lệ để tự động hoá.
 * Tách riêng khỏi foundation.ts để `runAudit` giữ nguyên là hàm thuần,
 * dễ test; caller tự gọi hàm này trước rồi truyền kết quả vào AuditInput.
 */
export async function checkWebsiteReachable(url: string | null | undefined, timeoutMs = 8000): Promise<boolean | undefined> {
  if (!url) return undefined
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal })
      return res.ok || (res.status >= 300 && res.status < 400)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}
