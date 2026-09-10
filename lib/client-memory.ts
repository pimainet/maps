/**
 * Bộ nhớ vận hành theo client: tổng hợp việc đã xong / còn mở / bài đã duyệt-đăng
 * để đưa vào Audit, Plan, sinh task — tránh đề xuất làm lại việc đã xử lý.
 */
import {
  getTasks,
  getContents,
  getLatestAuditByClient,
  getLatestPlanByClient,
  getLatestContentHistory,
} from '@/lib/db'

export type ClientProgress = {
  summary_text: string
  tasks_done: Array<{ id: string; title: string; task_type: string; status: string }>
  tasks_open: Array<{ id: string; title: string; task_type: string; status: string }>
  tasks_skipped: Array<{ id: string; title: string; task_type: string; status: string }>
  contents_done: Array<{ id: string; topic: string; status: string }>
  previous_audit_excerpt: string
  previous_plan_excerpt: string
  has_history: boolean
}

function normalizeTitle(s: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** So khớp title gần giống (tránh tạo task trùng khi sinh lịch mới). */
export function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // token overlap
  const ta = new Set(na.split(' ').filter((t) => t.length > 2))
  const tb = new Set(nb.split(' ').filter((t) => t.length > 2))
  if (ta.size === 0 || tb.size === 0) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const ratio = inter / Math.min(ta.size, tb.size)
  return ratio >= 0.75
}

function excerpt(text: string | null | undefined, max = 1200) {
  if (!text) return ''
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

export async function getClientProgress(
  clientId: string,
  workspaceId: string
): Promise<ClientProgress> {
  const [tasks, contents, prevAudit, prevPlan] = await Promise.all([
    getTasks({ clientId, workspaceId }),
    getContents(clientId, workspaceId),
    getLatestAuditByClient(clientId, workspaceId),
    getLatestPlanByClient(clientId, workspaceId),
  ])

  const taskList = tasks || []
  const contentList = contents || []

  const tasks_done = taskList
    .filter((t: any) => t.status === 'done')
    .map((t: any) => ({
      id: t.id,
      title: t.title || '',
      task_type: t.task_type || 'other',
      status: t.status,
    }))

  const tasks_skipped = taskList
    .filter((t: any) => t.status === 'skipped')
    .map((t: any) => ({
      id: t.id,
      title: t.title || '',
      task_type: t.task_type || 'other',
      status: t.status,
    }))

  const tasks_open = taskList
    .filter((t: any) => !['done', 'skipped'].includes(t.status || 'pending'))
    .map((t: any) => ({
      id: t.id,
      title: t.title || '',
      task_type: t.task_type || 'other',
      status: t.status || 'pending',
    }))

  const doneStatuses = new Set(['approved', 'published', 'waiting_approval'])
  const contents_done: Array<{ id: string; topic: string; status: string }> = []

  for (const c of contentList) {
    if (!doneStatuses.has(c.status)) continue
    let topic = c.topic || ''
    // bổ sung ai_version ngắn nếu topic trống
    if (!topic) {
      try {
        const h = await getLatestContentHistory(c.id, workspaceId)
        topic = (h?.human_edited_version || h?.ai_version || '').slice(0, 80)
      } catch {
        /* ignore */
      }
    }
    contents_done.push({
      id: c.id,
      topic: topic || '(không có chủ đề)',
      status: c.status,
    })
  }

  const previous_audit_excerpt = excerpt(prevAudit?.audit_result, 1500)
  const previous_plan_excerpt = excerpt(prevPlan?.plan_result, 1200)

  const has_history =
    tasks_done.length > 0 ||
    tasks_open.length > 0 ||
    tasks_skipped.length > 0 ||
    contents_done.length > 0 ||
    !!previous_audit_excerpt

  const lines: string[] = []
  lines.push('### Tiến độ đã ghi nhận trong hệ thống (bắt buộc tham chiếu)')
  if (!has_history) {
    lines.push('- Chưa có lịch sử task/content/audit trước đó trong hệ thống.')
  } else {
    lines.push(
      `- Task đã hoàn thành (${tasks_done.length}): ` +
        (tasks_done.length
          ? tasks_done.map((t) => `[${t.task_type}] ${t.title}`).join('; ')
          : 'không có')
    )
    lines.push(
      `- Task còn mở (${tasks_open.length}): ` +
        (tasks_open.length
          ? tasks_open.map((t) => `[${t.task_type}/${t.status}] ${t.title}`).join('; ')
          : 'không có')
    )
    lines.push(
      `- Task đã bỏ qua (${tasks_skipped.length}): ` +
        (tasks_skipped.length
          ? tasks_skipped.map((t) => t.title).join('; ')
          : 'không có')
    )
    lines.push(
      `- Bài viết đã có trong hệ thống (${contents_done.length}, chờ duyệt/đã duyệt/đã đăng): ` +
        (contents_done.length
          ? contents_done.map((c) => `[${c.status}] ${c.topic}`).join('; ')
          : 'không có')
    )
    if (previous_audit_excerpt) {
      lines.push('- Tóm tắt / đoạn audit gần nhất:')
      lines.push(previous_audit_excerpt)
    }
    if (previous_plan_excerpt) {
      lines.push('- Tóm tắt / đoạn lộ trình gần nhất:')
      lines.push(previous_plan_excerpt)
    }
  }

  lines.push('')
  lines.push('Quy tắc bắt buộc khi có lịch sử:')
  lines.push(
    '- Không đề xuất lại các việc one-shot đã status=done (ví dụ cập nhật category, thêm dịch vụ đã làm), trừ khi dữ liệu GBP hiện tại vẫn cho thấy chưa được xử lý trên hồ sơ thật.'
  )
  lines.push(
    '- Ưu tiên việc còn mở (pending) và khoảng trống mới so với audit/plan trước.'
  )
  lines.push(
    '- Với nội dung: không đề xuất chủ đề bài trùng hoặc gần trùng bài đã chờ duyệt/đã duyệt/đã đăng.'
  )
  lines.push(
    '- Phân biệt việc làm một lần (đã xong thì thôi) và việc duy trì (đăng bài định kỳ vẫn cần chủ đề mới).'
  )

  return {
    summary_text: lines.join('\n'),
    tasks_done,
    tasks_open,
    tasks_skipped,
    contents_done,
    previous_audit_excerpt,
    previous_plan_excerpt,
    has_history,
  }
}

/** Lọc danh sách task AI đề xuất, bỏ cái trùng việc đã có (mọi status). */
export function filterDuplicateTasks<
  T extends { title?: string; task_type?: string }
>(
  proposed: T[],
  existing: Array<{ title: string; task_type?: string; status?: string }>
): { kept: T[]; skipped: T[] } {
  const kept: T[] = []
  const skipped: T[] = []
  for (const p of proposed) {
    const title = (p.title || '').trim()
    if (!title) {
      skipped.push(p)
      continue
    }
    const dup = existing.some(
      (e) =>
        titlesSimilar(e.title, title) &&
        (!p.task_type || !e.task_type || p.task_type === e.task_type)
    )
    if (dup) skipped.push(p)
    else kept.push(p)
  }
  return { kept, skipped }
}
