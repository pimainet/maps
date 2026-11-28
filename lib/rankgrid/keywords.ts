/** Từ khoá theo dõi: chuẩn hoá chống trùng + gợi ý từ dữ liệu hồ sơ (thuần, có test). */

export const MAX_KEYWORD_LEN = 80

export function normalizeKeyword(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanKeyword(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const k = s.replace(/\s+/g, ' ').trim()
  if (k.length < 2 || k.length > MAX_KEYWORD_LEN) return null
  if (!normalizeKeyword(k)) return null
  return k
}

/** Tên thành phố ngắn từ "Phường Hàm Rồng, tỉnh Thanh Hóa" -> "thanh hóa". */
export function cityFromArea(area: string | null | undefined): string | null {
  if (!area) return null
  const parts = area.split(',').map((p) => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1] || ''
  const city = last.replace(/^(tỉnh|thành phố|tp\.?|tp|quận|huyện|thị xã)\s+/i, '').trim()
  return city ? city.toLowerCase() : null
}

/**
 * Gợi ý: danh mục chính (không kèm địa danh), danh mục chính + thành phố, rồi các danh mục phụ.
 * Không trùng (theo bản chuẩn hoá), tối đa `limit`.
 */
export function suggestKeywords(input: {
  primaryCategory?: string | null
  additionalCategories?: string[] | string | null
  industry?: string | null
  area?: string | null
  limit?: number
}): string[] {
  const city = cityFromArea(input.area)
  const extra = Array.isArray(input.additionalCategories)
    ? input.additionalCategories
    : typeof input.additionalCategories === 'string'
      ? input.additionalCategories.split(/[,;|]/)
      : []
  const base = (input.primaryCategory || input.industry || '').trim().toLowerCase()
  const raw = [base, base && city ? `${base} ${city}` : '', ...extra.map((x) => x.trim().toLowerCase())]
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const k = cleanKeyword(r)
    if (!k) continue
    const n = normalizeKeyword(k)
    if (seen.has(n)) continue
    seen.add(n)
    out.push(k)
    if (out.length >= (input.limit ?? 5)) break
  }
  return out
}
