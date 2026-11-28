/**
 * Hợp đồng dữ liệu với Make (scenario đăng phản hồi review qua Business Profile API, module "Make an API Call").
 * Thuần để test. App dựng sẵn ĐƯỜNG DẪN và BODY JSON (đã escape) để Make chỉ việc chuyển tiếp — tránh lỗi khi phản hồi có
 * dấu ngoặc kép / xuống dòng (blueprint autopost cũ chèn {{summary}} thẳng vào JSON nên dễ vỡ).
 */
import { isV4LocationResource } from './sources'

export const GBP_DOMAIN = 'https://mybusiness.googleapis.com'

export function isV4ReviewName(s: unknown): s is string {
  return typeof s === 'string' && /^accounts\/[^/\s]+\/locations\/[^/\s]+\/reviews\/[^/\s]+$/.test(s)
}

export function listReviewsPath(location: string, pageSize = 50): string | null {
  if (!isV4LocationResource(location)) return null
  return `/v4/${location}/reviews?pageSize=${Math.min(Math.max(pageSize, 1), 50)}&orderBy=updateTime%20desc`
}

export function replyItem(r: { id: string; gbp_review_name: string | null; final_reply: string | null }, clientName: string) {
  if (!isV4ReviewName(r.gbp_review_name) || !r.final_reply) return null
  return {
    reply_id: r.id,
    client_name: clientName,
    review_name: r.gbp_review_name,
    method: 'PUT',
    path: `/v4/${r.gbp_review_name}/reply`,
    body_json: JSON.stringify({ comment: r.final_reply }),
  }
}

/** Make gửi lại response của GBP: object, chuỗi JSON, hoặc bọc trong { body: ... }. */
export function coerceGbpPayload(v: unknown): any | null {
  let x: any = v
  if (typeof x === 'string') {
    try {
      x = JSON.parse(x)
    } catch {
      return null
    }
  }
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    if (Array.isArray(x.reviews) || 'totalReviewCount' in x || 'averageRating' in x) return x
    if (x.body !== undefined) return coerceGbpPayload(x.body)
    if (x.data !== undefined) return coerceGbpPayload(x.data)
    return x // response rỗng của GBP (location chưa có review) là {}
  }
  return null
}
