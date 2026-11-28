/** Kỳ quét và kỳ hạn mức tính theo giờ Việt Nam (UTC+7). Thuần, có test. */

const VN_OFFSET_MS = 7 * 3_600_000

function vnDate(now: Date): Date {
  return new Date(now.getTime() + VN_OFFSET_MS)
}

/** Tuần ISO (năm ISO, số tuần) theo giờ VN. */
export function isoWeekVN(now: Date): { year: number; week: number } {
  const d = vnDate(now)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return { year: t.getUTCFullYear(), week }
}

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'manual'

/**
 * Khoá kỳ cho lần quét định kỳ (idempotency: cùng từ khoá + cùng kỳ chỉ quét 1 lần).
 * biweekly gộp 2 tuần ISO liên tiếp theo số tuần tuyệt đối (không bị lệch khi qua năm).
 */
export function periodKey(freq: Frequency, now: Date): string | null {
  const d = vnDate(now)
  if (freq === 'monthly') return `m:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  if (freq === 'weekly') {
    const { year, week } = isoWeekVN(now)
    return `w:${year}-W${String(week).padStart(2, '0')}`
  }
  if (freq === 'biweekly') {
    // Số tuần tuyệt đối tính từ thứ Hai 29/12/1969 (giờ VN).
    const mondayEpoch = Date.UTC(1969, 11, 29)
    const dayIdx = Math.floor((d.getTime() - mondayEpoch) / 86_400_000)
    return `b:${Math.floor(dayIdx / 14)}`
  }
  return null
}

/** Ngày 1 của tháng hiện tại theo giờ VN, dạng YYYY-MM-01 (kỳ hạn mức điểm). */
export function usagePeriodStart(now: Date): string {
  const d = vnDate(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Mốc UTC của 00:00 ngày 1 tháng hiện tại theo giờ VN. */
export function vnMonthStartUtc(now: Date): Date {
  const d = vnDate(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - VN_OFFSET_MS)
}

/** Lần chạy kế tiếp: 07:00 giờ VN của ngày sau `days` ngày. */
export function nextRunAt(freq: Frequency, now: Date): Date | null {
  const days = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : freq === 'monthly' ? 30 : null
  if (!days) return null
  const d = vnDate(now)
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 7, 0, 0) - VN_OFFSET_MS
  return new Date(base)
}
