// Form "Liên hệ tư vấn" gói Làm hộ: kiểm tra + chuẩn hoá đầu vào (thuần, test được).

export type LeadInput = {
  contact_name: string
  phone: string
  email: string | null
  business_name: string | null
  message: string | null
}

export type LeadParse = { ok: true; value: LeadInput } | { ok: false; error: string }

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Số điện thoại VN: bỏ khoảng trắng/dấu chấm/gạch; +84/84 -> 0. Hợp lệ khi 9–11 chữ số bắt đầu bằng 0. Trả null nếu không hợp lệ. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let d = raw.replace(/[\s.\-()]/g, '')
  if (d.startsWith('+84')) d = '0' + d.slice(3)
  else if (/^84\d{8,10}$/.test(d)) d = '0' + d.slice(2)
  return /^0\d{8,10}$/.test(d) ? d : null
}

export function parseLead(body: unknown): LeadParse {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const contact_name = clean(b.contact_name, 120)
  if (!contact_name) return { ok: false, error: 'Vui lòng nhập tên người liên hệ.' }
  const phone = normalizePhone(b.phone)
  if (!phone) return { ok: false, error: 'Số điện thoại chưa đúng (ví dụ 0901234567).' }
  const emailRaw = clean(b.email, 200)
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return { ok: false, error: 'Email chưa đúng.' }
  const message = typeof b.message === 'string' ? b.message.replace(/\r/g, '').trim().slice(0, 2000) : ''
  return {
    ok: true,
    value: {
      contact_name,
      phone,
      email: emailRaw || null,
      business_name: clean(b.business_name, 200) || null,
      message: message || null,
    },
  }
}
