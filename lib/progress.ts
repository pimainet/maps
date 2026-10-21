// Tính tiến bộ từ danh sách việc THẬT của khách. Không ước đoán, không bịa số:
// cái gì chưa có dữ liệu thì trả null để giao diện bỏ qua, không hiện số 0 giả.
//
// Dùng chung cho trang Việc cần làm, Trang chủ, trang Kết quả và email nhắc việc,
// để mọi nơi hiện đúng một con số.

export type ProgressTask = {
  status?: string | null
  task_type?: string | null
  completed_at?: string | null
}

export type ProgressSummary = {
  /** Tổng số việc (không tính việc đã bỏ qua). */
  total: number
  done: number
  pending: number
  percent: number
  /** Tiến độ theo loại việc, chỉ gồm loại có ít nhất 1 việc. */
  byType: { type: string; done: number; total: number }[]
  /** Số việc xong trong 7 ngày qua. null = chưa có dữ liệu ngày hoàn thành. */
  doneThisWeek: number | null
  /** Mốc tiếp theo (25/50/75/100%) và cần xong thêm bao nhiêu việc để tới đó. */
  nextMilestone: { target: number; remaining: number } | null
}

const MILESTONES = [25, 50, 75, 100]
const TYPE_ORDER = ['content', 'description_update', 'photo', 'review', 'profile_update', 'other']
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function summarizeProgress(tasks: ProgressTask[], now: Date = new Date()): ProgressSummary {
  const counted = tasks.filter((t) => (t.status || 'pending') !== 'skipped')
  const total = counted.length
  const doneTasks = counted.filter((t) => t.status === 'done')
  const done = doneTasks.length
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  const typeMap = new Map<string, { done: number; total: number }>()
  for (const t of counted) {
    const type = t.task_type || 'other'
    const entry = typeMap.get(type) || { done: 0, total: 0 }
    entry.total += 1
    if (t.status === 'done') entry.done += 1
    typeMap.set(type, entry)
  }
  const rank = (type: string) => {
    const i = TYPE_ORDER.indexOf(type)
    return i === -1 ? TYPE_ORDER.length : i
  }
  const byType = [...typeMap.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([type, v]) => ({ type, ...v }))

  // "Tuần này" chỉ đáng tin khi có ngày hoàn thành. Việc xong từ trước migration không có ngày.
  const dated = doneTasks.filter((t) => t.completed_at)
  let doneThisWeek: number | null = null
  if (done === 0) doneThisWeek = 0
  else if (dated.length > 0) {
    const cutoff = now.getTime() - WEEK_MS
    doneThisWeek = dated.filter((t) => new Date(t.completed_at as string).getTime() >= cutoff).length
  }

  let nextMilestone: ProgressSummary['nextMilestone'] = null
  if (total > 0 && percent < 100) {
    const target = MILESTONES.find((m) => m > percent) ?? 100
    const needed = Math.ceil((target / 100) * total) - done
    nextMilestone = { target, remaining: Math.max(1, needed) }
  }

  return { total, done, pending: counted.filter((t) => (t.status || 'pending') === 'pending').length, percent, byType, doneThisWeek, nextMilestone }
}

/**
 * Câu chúc mừng sau khi khách đánh dấu xong một việc.
 * Chỉ dùng số thật; mốc 25/50/75/100% chỉ hiện đúng lúc vừa vượt qua.
 */
export function completionMessage(before: ProgressSummary, after: ProgressSummary): string {
  const base = `${after.done}/${after.total} việc`
  if (after.total > 0 && after.percent === 100) return 'Bạn đã hoàn thành toàn bộ kế hoạch. Làm rất tốt!'
  if (after.done === 1) return 'Việc đầu tiên đã xong. Bạn đã bắt đầu rồi đó.'
  const crossed = [...MILESTONES].reverse().find((m) => before.percent < m && after.percent >= m)
  if (crossed === 75) return `Gần về đích rồi: đã xong ${base}.`
  if (crossed === 50) return `Một nửa chặng đường rồi: đã xong ${base}.`
  if (crossed === 25) return `Đã xong một phần tư kế hoạch (${base}). Khởi đầu tốt!`
  return `Đã đánh dấu hoàn thành. Bạn đã xong ${base}.`
}
