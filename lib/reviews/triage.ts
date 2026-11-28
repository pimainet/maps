/**
 * Phân loại nhanh bằng luật (không tốn AI) — chạy cho MỌI review mới, kể cả khi hết lượt nháp AI.
 * AI (lib/reviews/draft.ts) có thể chỉnh sentiment/topics, nhưng urgency luôn lấy mức CAO hơn giữa luật và AI
 * để không bao giờ hạ mức một review nghiêm trọng.
 */
import { normText, stripGoogleTranslation } from './normalize'
import type { Sentiment, Urgency } from './types'

/** Từ khoá rủi ro cao (an toàn thực phẩm, sức khoẻ, pháp lý, lừa đảo, phân biệt đối xử...) — so sau khi bỏ dấu. */
const SEVERE = [
  // sức khoẻ / an toàn thực phẩm
  'ngo doc', 'dau bung', 'tieu chay', 'non mua', 'di ung', 'nhiem trung', 'bi bong', 'chay mau', 'bi thuong', 'nhap vien',
  'con gian', 'con chuot', 'con ruoi', 'con giun', 'toc trong', 'hoi thoi', 'oi thiu', 'bi thiu', 'moc meo', 'bi moc',
  // tiền bạc / lừa đảo / pháp lý
  'lua dao', 'an cap', 'mat do', 'chat chem', 'chem gia', 'tinh sai tien', 'tinh tien sai', 'gian lan',
  'khoi kien', 'se kien', 'kien ra toa', 'bao cong an', 'cong an', 'boc phot',
  // con người
  'phan biet doi xu', 'quay roi', 'danh nguoi', 'chui khach', 'chui boi', 'xuc pham', 'de doa',
  // tiếng Anh
  'food poisoning', 'got sick', 'scam', 'stolen', 'lawsuit', 'police', 'harass', 'cockroach', 'allergic reaction', 'injured',
]

/** Dấu hiệu chê trong review 3–5★ (chỉ đổi sentiment sang 'mixed', không đổi mức khẩn). Cụm từ để tránh trùng nghĩa (đồ/dở, kem...). */
const NEG_HINTS = ['that vong', 'hoi cham', 'cham qua', 'qua lau', 'cho lau', 'khong nen', 'thai do', 'do te', 'qua te', 'hoi te', 'chua hai long', 'khong hai long', 'hoi dat', 'bad', 'worst', 'rude', 'dirty', 'slow', 'disappoint']

/** So theo RANH GIỚI TỪ (chuỗi đã bỏ dấu) để "rất" không khớp "rat", "không gian" không khớp "gián"... */
function hasAny(hay: string, needles: string[]): boolean {
  const h = ` ${hay} `
  return needles.some((n) => h.includes(` ${n.trim()} `))
}

export function severeHit(text: string | null | undefined): boolean {
  return hasAny(normText(stripGoogleTranslation(text || '')), SEVERE)
}

export function baseTriage(rating: number, text: string | null | undefined): { sentiment: Sentiment; urgency: Urgency } {
  const t = normText(stripGoogleTranslation(text || ''))
  const severe = hasAny(t, SEVERE)
  let sentiment: Sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative'
  if (rating >= 4 && t && hasAny(t, NEG_HINTS)) sentiment = 'mixed'
  if (rating === 3 && t && hasAny(t, NEG_HINTS)) sentiment = 'mixed'
  let urgency: Urgency = rating <= 2 ? 'high' : rating === 3 ? 'normal' : 'low'
  if (severe) urgency = 'high'
  return { sentiment, urgency }
}

const RANK: Record<Urgency, number> = { low: 0, normal: 1, high: 2 }
export function maxUrgency(a: Urgency, b: Urgency | null | undefined): Urgency {
  if (!b || !(b in RANK)) return a
  return RANK[b] > RANK[a] ? b : a
}
