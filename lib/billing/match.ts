// Tách mã đơn từ nội dung chuyển khoản (thuần, không DB). SQL ingest_bank_transaction dùng danh sách ứng viên này.
// Ngân hàng/người dùng hay: bỏ dấu, chữ thường, chèn khoảng trắng/gạch giữa các số, gõ O thay 0, bỏ tiền tố "LGOS".
export const ORDER_CODE_DIGITS = 12

export type Extracted = { candidates: number[]; confidence: 'exact' | 'tolerant' }

const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase()
const toNum = (digits: string) => (digits.length === ORDER_CODE_DIGITS ? Number(digits) : NaN)

export function extractOrderCodes(content: string | null | undefined, providerCode?: string | null): Extracted {
  const text = strip(String(content ?? '')).slice(0, 500)
  const exact: number[] = []
  const tolerant: number[] = []
  const add = (arr: number[], n: number) => { if (Number.isSafeInteger(n) && n > 0 && !exact.includes(n) && !tolerant.includes(n)) arr.push(n) }

  // 1) Chặt: LGOS + đúng 12 chữ số liền nhau
  for (const m of text.matchAll(/LGOS(\d{12})(?!\d)/g)) add(exact, toNum(m[1]))

  // 2) Mã nhà cung cấp tách sẵn (SePay `code`), nếu cũng đúng dạng
  const pc = strip(String(providerCode ?? '')).match(/^LGOS(\d{12})$/)
  if (pc) add(exact, toNum(pc[1]))

  // 3) Đoán: tiền tố biến dạng (L G/6 O/0 S, cho phép khoảng trắng) + 12 ký tự số cho phép chen " .-_" và nhầm O/I/L
  for (const m of text.matchAll(/L[\s.\-_]*[G6][\s.\-_]*[O0][\s.\-_]*S[\s.\-_:]*((?:[0-9OIL][\s.\-_]*){12})(?!\d)/g)) {
    add(tolerant, toNum(m[1].replace(/[\s.\-_]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')))
  }
  // 4) Đoán: khách bỏ tiền tố, chỉ còn 12 chữ số (có thể bị chen khoảng trắng/gạch)
  const compact = text.replace(/(?<=\d)[\s.\-_]+(?=\d)/g, '')
  for (const m of compact.matchAll(/(?<!\d)(\d{12})(?!\d)/g)) add(tolerant, toNum(m[1]))

  return exact.length ? { candidates: [...exact, ...tolerant], confidence: 'exact' } : { candidates: tolerant, confidence: 'tolerant' }
}
