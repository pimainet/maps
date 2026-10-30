/**
 * Đổi chuỗi thời gian tương đối của Google Maps ("2 tháng trước", "a month ago",
 * "Đã chỉnh sửa 3 tuần trước", "hôm qua") thành số ngày ước tính.
 * Không parse được -> null (không suy đoán).
 */
export function parseRelativeAgeDays(text: string | null | undefined): number | null {
  if (!text) return null
  const t = String(text).trim().toLowerCase()
  if (!t) return null
  if (/hôm nay|today|just now|vừa xong/.test(t)) return 0
  if (/hôm qua|yesterday/.test(t)) return 1

  const m = t.match(
    /(\d+|một|mot|an?|vài|vai|several)\s*(giờ|phút|ngày|tuần|tháng|năm|hours?|minutes?|days?|weeks?|months?|years?)/,
  )
  if (!m) return null

  const raw = m[1]
  let n: number
  if (/^\d+$/.test(raw)) n = parseInt(raw, 10)
  else if (/vài|vai|several/.test(raw)) n = 2
  else n = 1 // một / an / a

  const unit = m[2]
  if (/giờ|phút|hour|minute/.test(unit)) return 0
  if (/ngày|day/.test(unit)) return n
  if (/tuần|week/.test(unit)) return n * 7
  if (/tháng|month/.test(unit)) return n * 30
  if (/năm|year/.test(unit)) return n * 365
  return null
}
