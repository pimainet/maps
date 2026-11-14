// Báo cáo trước/sau cho 1 client — mảnh còn thiếu để khép kín vòng lặp
// audit → plan → task → content → ĐO LƯỜNG.
//
// Dữ liệu để làm việc này đã có sẵn từ trước (mỗi lần audit / tự-điền
// từ Google Maps đều tạo 1 dòng trong gbp_snapshots có rating +
// review_count + captured_at) — chỉ là chưa có gì tổng hợp lại thành 1
// con số dễ hiểu. Hàm này làm đúng việc đó: so sánh "trước chu kỳ" với
// "hiện tại", cộng thêm tỉ lệ hoàn thành việc trong chu kỳ.
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import { getClientById, getLatestCycle, getTasks, getContents, getCycleHistory } from '@/lib/db'
import { summarizeProgress, type ProgressSummary } from '@/lib/progress'

export type CycleSummary = {
  /** 2–3 việc nổi bật đã làm tốt trong chu kỳ (lấy từ task done, ưu tiên high/medium). */
  bestThings: string[]
  /** 1–2 câu về thay đổi số liệu (rating, review). */
  metricsHighlights: string[]
  /** 1 vấn đề còn lại hoặc mới (từ task còn mở hoặc gợi ý chung). */
  newIssue: string | null
  /** Hướng tập trung chu kỳ tiếp theo (dựa trên giai đoạn). */
  nextFocus: string
  /** true nếu nên gợi ý mở chu kỳ mới. */
  suggestNewCycle: boolean
  suggestReason: string | null
}

export type ClientCycleReport = {
  client: { id: string; name: string }
  cycle: {
    id: string | null
    status: 'active' | 'closed' | null
    started_at: string | null
    closed_at: string | null
  }
  metrics: {
    rating: { baseline: number | null; current: number | null; delta: number | null }
    review_count: { baseline: number | null; current: number | null; delta: number | null }
  }
  baseline_captured_at: string | null
  current_captured_at: string | null
  has_enough_data: boolean
  tasks: { total: number; done: number; percent: number }
  /** Tiến bộ chi tiết (theo loại việc, tuần này, mốc tiếp theo) tính từ cùng danh sách việc. */
  progress: ProgressSummary
  content_published: number
  /** Tóm tắt kiểu “bác sĩ tái khám” + gợi ý mở chu kỳ mới. */
  summary: CycleSummary
}

async function getSnapshotAtOrBefore(clientId: string, workspaceId: string, cutoff: string | null) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('gbp_snapshots')
    .select('rating, review_count, captured_at')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .in('status', ['ok', 'partial'])
    .not('captured_at', 'is', null)
    .order('captured_at', { ascending: true })
    .limit(1)

  if (cutoff) query = query.lte('captured_at', cutoff)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function getLatestUsableSnapshot(clientId: string, workspaceId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('gbp_snapshots')
    .select('rating, review_count, captured_at')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .in('status', ['ok', 'partial'])
    .not('captured_at', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

function round1(n: number | null | undefined): number | null {
  if (n == null) return null
  return Math.round(n * 10) / 10
}

export async function getClientCycleReport(clientId: string, workspaceId: string): Promise<ClientCycleReport> {
  const client = await getClientById(clientId, workspaceId)
  if (!client) throw new Error('Không tìm thấy doanh nghiệp này')

  const cycle = await getLatestCycle(clientId, workspaceId)
  const cycleStart = cycle?.started_at || null

  // "Trước": snapshot gần nhất TẠI HOẶC TRƯỚC lúc chu kỳ bắt đầu — đúng
  // là ảnh chụp tình trạng lúc bắt đầu làm việc. Nếu chưa từng có
  // snapshot nào trước đó (vd audit đầu tiên chưa dùng auto-fill), lấy
  // tạm snapshot sớm nhất từng có, còn hơn không có gì để so sánh.
  let baseline = cycleStart ? await getSnapshotAtOrBefore(clientId, workspaceId, cycleStart) : null
  if (!baseline) {
    baseline = await getSnapshotAtOrBefore(clientId, workspaceId, null)
  }

  const current = await getLatestUsableSnapshot(clientId, workspaceId)

  const baselineRating = baseline?.rating != null ? Number(baseline.rating) : null
  const currentRating = current?.rating != null ? Number(current.rating) : null
  const baselineReviews = baseline?.review_count != null ? Number(baseline.review_count) : null
  const currentReviews = current?.review_count != null ? Number(current.review_count) : null

  // Coi là "cùng 1 điểm dữ liệu" (không tính delta) nếu baseline và
  // current trùng nhau (chỉ có đúng 1 snapshot từ trước đến giờ) — vì
  // khi đó "trước/sau" không có ý nghĩa, tránh hiện "delta = 0" gây
  // hiểu lầm là không có thay đổi.
  const sameSnapshot = baseline && current && baseline.captured_at === current.captured_at

  const tasksAll = (await getTasks({ clientId, workspaceId })) || []
  const tasksInCycle = cycleStart
    ? tasksAll.filter((t: any) => new Date(t.created_at).getTime() >= new Date(cycleStart).getTime())
    : tasksAll
  const doneCount = tasksInCycle.filter((t: any) => t.status === 'done').length

  const contentsAll = (await getContents(clientId, workspaceId)) || []
  const publishedInCycle = contentsAll.filter((c: any) => {
    if (c.status !== 'published') return false
    if (!cycleStart) return true
    return new Date(c.created_at).getTime() >= new Date(cycleStart).getTime()
  }).length

  // ── Tóm tắt tái khám + gợi ý chu kỳ mới ──────────────────────────
  const doneTasks = tasksInCycle.filter((t: any) => t.status === 'done')
  const openTasks = tasksInCycle.filter((t: any) => !['done', 'skipped'].includes(t.status || 'pending'))

  const bestThings: string[] = doneTasks
    .filter((t: any) => ['high', 'medium'].includes(t.priority || ''))
    .slice(0, 3)
    .map((t: any) => t.title || 'Việc đã hoàn thành')

  if (bestThings.length === 0 && doneTasks.length > 0) {
    bestThings.push(...doneTasks.slice(0, 2).map((t: any) => t.title || 'Việc đã hoàn thành'))
  }
  if (bestThings.length === 0) bestThings.push('Chưa có việc nổi bật nào được đánh dấu hoàn thành trong chu kỳ này.')

  const metricsHighlights: string[] = []
  const ratingDelta = !sameSnapshot && baselineRating != null && currentRating != null ? round1(currentRating - baselineRating) : null
  const reviewDelta = !sameSnapshot && baselineReviews != null && currentReviews != null ? currentReviews - baselineReviews : null
  if (ratingDelta != null && ratingDelta !== 0) {
    metricsHighlights.push(`Điểm đánh giá ${ratingDelta > 0 ? 'tăng' : 'giảm'} ${Math.abs(ratingDelta)} điểm.`)
  }
  if (reviewDelta != null && reviewDelta !== 0) {
    metricsHighlights.push(`Số lượt đánh giá ${reviewDelta > 0 ? 'tăng' : 'giảm'} ${Math.abs(reviewDelta)}.`)
  }
  if (metricsHighlights.length === 0) {
    metricsHighlights.push(sameSnapshot ? 'Chưa có đủ dữ liệu trước/sau để so sánh số liệu.' : 'Số liệu đánh giá chưa thay đổi rõ trong chu kỳ này.')
  }

  const newIssue = openTasks.length > 0
    ? `Còn ${openTasks.length} việc chưa xong${openTasks[0]?.title ? ` (ví dụ: “${openTasks[0].title}”)` : ''}.`
    : (tasksInCycle.length === 0 ? 'Chưa có việc nào trong chu kỳ này.' : null)

  // Gợi ý giai đoạn tiếp theo dựa trên số chu kỳ đã có
  const history = await getCycleHistory(clientId, workspaceId).catch(() => [])
  const cycleCount = (history || []).length || (cycle ? 1 : 0)
  let nextFocus = 'Tiếp tục hoàn thiện những việc còn lại và duy trì đăng bài đều.'
  if (cycleCount <= 1) nextFocus = 'Chu kỳ tiếp theo nên chuyển sang làm rõ dịch vụ, nhu cầu tìm kiếm thật và các chủ đề bài viết hữu ích, khác nhau.'
  else if (cycleCount === 2) nextFocus = 'Chu kỳ tiếp theo tập trung củng cố độ tin cậy: ảnh/case thực tế, phản hồi đánh giá trung thực, và theo dõi tín hiệu gọi/chỉ đường.'
  else nextFocus = 'Chu kỳ tiếp theo tối ưu theo dữ liệu: tìm điểm nghẽn còn lại và thử từng cải tiến có thể đo được.'

  const daysRunning = cycleStart ? Math.floor((Date.now() - new Date(cycleStart).getTime()) / 86400000) : 0
  const donePercent = tasksInCycle.length > 0 ? (doneCount / tasksInCycle.length) * 100 : 0
  const suggestNewCycle = !!(cycle?.status === 'active' && (daysRunning >= 28 || donePercent >= 70))
  const suggestReason = suggestNewCycle
    ? (daysRunning >= 28
        ? `Chu kỳ đã chạy ${daysRunning} ngày. Nên xem xét mở chu kỳ mới để cập nhật lộ trình theo tình hình hiện tại.`
        : `Đã hoàn thành khoảng ${Math.round(donePercent)}% việc trong chu kỳ. Có thể mở chu kỳ mới để đẩy lên giai đoạn tiếp theo.`)
    : null

  const summary: CycleSummary = {
    bestThings,
    metricsHighlights,
    newIssue,
    nextFocus,
    suggestNewCycle,
    suggestReason,
  }

  return {
    client: { id: client.id, name: client.name },
    cycle: {
      id: cycle?.id || null,
      status: cycle?.status || null,
      started_at: cycle?.started_at || null,
      closed_at: cycle?.closed_at || null,
    },
    metrics: {
      rating: {
        baseline: round1(baselineRating),
        current: round1(currentRating),
        delta: ratingDelta,
      },
      review_count: {
        baseline: baselineReviews,
        current: currentReviews,
        delta: reviewDelta,
      },
    },
    baseline_captured_at: baseline?.captured_at || null,
    current_captured_at: current?.captured_at || null,
    has_enough_data: Boolean(baseline && current && !sameSnapshot),
    tasks: {
      total: tasksInCycle.length,
      done: doneCount,
      percent: tasksInCycle.length > 0 ? Math.round((doneCount / tasksInCycle.length) * 100) : 0,
    },
    progress: summarizeProgress(tasksInCycle),
    content_published: publishedInCycle,
    summary,
  }
}
