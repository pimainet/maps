/**
 * Chuyển snapshot GBP (payload hoặc dòng DB) thành các trường form Audit.
 * File THUẦN (không import server) để dùng được cả ở client component lẫn server route.
 */

export const GBP_BLOCK_START = '[[DỮ LIỆU QUAN SÁT TỪ GOOGLE MAPS]]'
export const GBP_BLOCK_END = '[[HẾT DỮ LIỆU GOOGLE MAPS]]'

const SECTION_LABEL: Record<string, string> = {
  overview: 'Tổng quan',
  hours: 'Giờ mở cửa',
  about: 'Giới thiệu',
  services: 'Dịch vụ/Menu',
  reviews: 'Bài đánh giá',
  updates: 'Cập nhật/bài đăng',
  photos: 'Ảnh',
}

const STATUS_LABEL: Record<string, string> = {
  operational: 'Đang hoạt động',
  temporarily_closed: 'TẠM THỜI ĐÓNG CỬA',
  permanently_closed: 'ĐÓNG CỬA VĨNH VIỄN',
}

function clip(s: unknown, n: number): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
}

/** Khối text đưa vào additional_info: mọi thứ agent quan sát được ngoài các trường form riêng. */
export function buildGbpObservationBlock(s: any): string {
  if (!s) return ''
  const lines: string[] = []

  if (s.address_text) lines.push(`Địa chỉ: ${clip(s.address_text, 160)}`)
  if (s.phone) lines.push(`SĐT: ${clip(s.phone, 40)}`)
  if (s.website_url) lines.push(`Website: ${clip(s.website_url, 160)}`)
  if (s.business_status && STATUS_LABEL[s.business_status]) {
    lines.push(`Trạng thái hoạt động: ${STATUS_LABEL[s.business_status]}`)
  }
  if (s.claim_signal === 'unclaimed') {
    lines.push('Quyền sở hữu: thấy nút "Nhận quyền sở hữu doanh nghiệp này" -> hồ sơ có thể CHƯA được xác nhận/quản lý')
  }
  if (s.opening_hours) lines.push(`Giờ mở cửa: ${clip(s.opening_hours, 400)}`)
  else if (s.hours_today) {
    lines.push(
      `Giờ mở cửa: hồ sơ CÓ khai giờ (đọc được trạng thái hôm nay: ${clip(s.hours_today, 100)}), chưa đọc được bảng 7 ngày — không kết luận là thiếu giờ.`,
    )
  }

  const links = Array.isArray(s.action_links) ? s.action_links : []
  if (links.length) {
    lines.push(
      'Nút hành động trên hồ sơ: ' +
        links.map((l: any) => clip(l.label || l.kind, 40)).filter(Boolean).join('; '),
    )
  }

  const services = Array.isArray(s.services) ? s.services : []
  if (services.length) {
    lines.push(`Dịch vụ/sản phẩm đang liệt kê (${services.length}): ${services.slice(0, 20).map((x: any) => clip(x, 50)).join(', ')}`)
  }

  const attrs = Array.isArray(s.attributes) ? s.attributes : []
  if (attrs.length) {
    lines.push(
      'Thuộc tính/tiện ích: ' +
        attrs
          .slice(0, 8)
          .map((g: any) => `${clip(g.group, 30)}: ${(g.items || []).slice(0, 8).map((i: any) => clip(i, 40)).join(', ')}`)
          .join(' | '),
    )
  }

  const dist = s.rating_distribution
  if (dist && typeof dist === 'object') {
    const parts = ['5', '4', '3', '2', '1'].filter((k) => dist[k] != null).map((k) => `${k}★ ${dist[k]}`)
    if (parts.length) lines.push(`Phân bố sao: ${parts.join(', ')}`)
  }

  const st = s.review_stats
  if (st && st.loaded) {
    const bits = [`đã đọc ${st.loaded} review mới nhất`]
    if (st.newest_age_days != null) bits.push(`mới nhất cách đây ~${st.newest_age_days} ngày`)
    if (st.last_30d != null) bits.push(`${st.window_complete ? '' : '≥'}${st.last_30d} trong 30 ngày`)
    if (st.last_90d != null) bits.push(`${st.window_complete ? '' : '≥'}${st.last_90d} trong 90 ngày`)
    if (st.reply_rate != null) bits.push(`chủ phản hồi ${st.replied}/${st.loaded} (${Math.round(st.reply_rate * 100)}%)`)
    lines.push('Review: ' + bits.join('; '))
  }

  const reviews = Array.isArray(s.reviews) ? s.reviews : []
  const low = reviews.filter((r: any) => typeof r.rating === 'number' && r.rating <= 3).slice(0, 3)
  if (low.length) {
    lines.push(
      'Review thấp sao gần đây:\n' +
        low
          .map(
            (r: any) =>
              `- ${r.rating}★${r.relative_time ? ` (${clip(r.relative_time, 24)})` : ''}: "${clip(r.text, 140)}" — ${
                r.reply ? 'chủ ĐÃ phản hồi' : 'chưa thấy phản hồi'
              }`,
          )
          .join('\n'),
    )
  }

  const posts = Array.isArray(s.recent_posts) ? s.recent_posts : []
  if (posts.length) {
    lines.push(
      'Bài đăng thấy trên hồ sơ:\n' +
        posts
          .slice(0, 4)
          .map((p: any, i: number) => `${i + 1}. ${p.approx_date ? `[${clip(p.approx_date, 20)}] ` : ''}${clip(p.text, 120)}`)
          .join('\n'),
    )
  }

  const cats = Array.isArray(s.photo_categories) ? s.photo_categories : []
  if (cats.length) lines.push(`Nhóm ảnh trên hồ sơ: ${cats.slice(0, 8).join(', ')}`)

  const cov = s.coverage
  if (cov && cov.sections) {
    const failed = Object.keys(cov.sections).filter((k) => cov.sections[k] === 'error' || cov.sections[k] === 'skipped')
    const noTab = Object.keys(cov.sections).filter((k) => cov.sections[k] === 'not_found')
    if (failed.length) {
      lines.push(
        `LƯU Ý — agent KHÔNG đọc được: ${failed.map((k) => SECTION_LABEL[k] || k).join(', ')}. Không kết luận các mục này là "thiếu" khi chưa có dữ liệu.`,
      )
    }
    if (noTab.length) {
      lines.push(`Không thấy tab/mục: ${noTab.map((k) => SECTION_LABEL[k] || k).join(', ')} (có thể hồ sơ không có, hoặc Maps ẩn).`)
    }
    if (cov.identity === 'ambiguous') {
      lines.push('CẢNH BÁO: tên trên Maps không khớp rõ với doanh nghiệp khai báo — kiểm tra lại link Maps.')
    }
    if (Array.isArray(cov.warnings) && cov.warnings.length) {
      lines.push('Cảnh báo dữ liệu: ' + cov.warnings.slice(0, 3).map((w: any) => clip(w, 140)).join(' / '))
    }
  }

  if (!lines.length) return ''
  return `${GBP_BLOCK_START}\n${lines.join('\n')}\n${GBP_BLOCK_END}`
}

/** Thay khối cũ (nếu có) bằng khối mới, giữ nguyên phần người dùng tự gõ. */
export function mergeGbpBlock(prevInfo: string | undefined, block: string): string {
  const prev = String(prevInfo || '')
  const re = new RegExp(`${escapeRe(GBP_BLOCK_START)}[\\s\\S]*?${escapeRe(GBP_BLOCK_END)}`, 'g')
  const stripped = prev.replace(re, '').trim()
  return [stripped, block].filter(Boolean).join('\n\n')
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function snapshotToAuditFields(snapshot: any): {
  description?: string
  primary_category?: string
  additional_categories?: string
  review_count?: string
  rating?: string
  opening_hours?: string
  recent_posts?: string
  photos_status?: string
  additional_info?: string
} {
  if (!snapshot) return {}
  const block = buildGbpObservationBlock(snapshot)
  const posts = Array.isArray(snapshot.recent_posts)
    ? snapshot.recent_posts
        .filter((post: any) => post?.text)
        .slice(0, 8)
        .map((post: any, index: number) => `${index + 1}. ${post.approx_date ? `[${clip(post.approx_date, 30)}] ` : ''}${clip(post.text, 500)}`)
    : []
  return {
    description: snapshot.description || undefined,
    primary_category: snapshot.primary_category || undefined,
    additional_categories: snapshot.additional_categories || undefined,
    review_count: snapshot.review_count != null ? String(snapshot.review_count) : undefined,
    rating: snapshot.rating != null ? String(snapshot.rating) : undefined,
    opening_hours: snapshot.opening_hours || snapshot.hours_today || undefined,
    recent_posts: posts.length ? posts.join('\n') : snapshot.posts_signal || 'Chưa đọc thấy bài đăng trong lần quan sát này.',
    photos_status: snapshot.photos_signal || undefined,
    additional_info: block || undefined,
  }
}
