/**
 * Helpers thuần (không đụng DB/API) để chuẩn hoá caption, phát hiện SĐT,
 * và đo độ giống gần với logic pg_trgm phía Postgres (đủ để unit test).
 */

const VI_MAP =
  'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ' +
  'ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ'
const ASCII_MAP =
  'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd' +
  'AAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD'

export function normalizeCaption(input: string | null | undefined): string {
  const mapped = Array.from(input ?? '')
    .map((ch) => {
      const i = VI_MAP.indexOf(ch)
      return i >= 0 ? ASCII_MAP[i] : ch
    })
    .join('')
  return mapped
    .toLowerCase()
    .replace(/#\S+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** SĐT Việt Nam: +84 / 84 / 0, rồi 9–10 số (khoảng trắng hoặc dấu chấm/gạch xen giữa). */
const PHONE_RE =
  /(?:\+?84|0)[\s.\-]*[1-9](?:[\s.\-]*\d){8,9}\b|\b\d{10,11}\b/

export function hasPhoneNumber(text: string): boolean {
  return PHONE_RE.test(text)
}

/** Trigram similarity gần với pg_trgm (đủ để kiểm tra ngưỡng, không cần khớp tuyệt đối từng số). */
export function trigramSimilarity(a: string, b: string): number {
  const left = normalizeCaption(a)
  const right = normalizeCaption(b)
  if (!left && !right) return 1
  if (!left || !right) return 0
  const grams = (s: string) => {
    const padded = `  ${s} `
    const set = new Set<string>()
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3))
    return set
  }
  const A = grams(left)
  const B = grams(right)
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

export const CAPTION_SIMILARITY_THRESHOLD = 0.55

export function isCaptionTooSimilar(candidate: string, previous: string, threshold = CAPTION_SIMILARITY_THRESHOLD): boolean {
  return trigramSimilarity(candidate, previous) >= threshold
}

export function assertCaptionSafe(caption: string): { ok: true } | { ok: false; reason: 'length' | 'phone' } {
  const text = caption.trim()
  if (text.length < 40 || text.length > 1500) return { ok: false, reason: 'length' }
  if (hasPhoneNumber(text)) return { ok: false, reason: 'phone' }
  return { ok: true }
}
