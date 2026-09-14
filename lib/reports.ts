// Báo cáo trước/sau cho 1 client — mảnh còn thiếu để khép kín vòng lặp
// audit → plan → task → content → ĐO LƯỜNG.
//
// Dữ liệu để làm việc này đã có sẵn từ trước (mỗi lần audit / tự-điền
// từ Google Maps đều tạo 1 dòng trong gbp_snapshots có rating +
// review_count + captured_at) — chỉ là chưa có gì tổng hợp lại thành 1
// con số dễ hiểu. Hàm này làm đúng việc đó: so sánh "trước chu kỳ" với
// "hiện tại", cộng thêm tỉ lệ hoàn thành việc trong chu kỳ.
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import { getClientById, getLatestCycle, getTasks, getContents } from '@/lib/db'

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
  content_published: number
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
  if (!client) throw new Error('Không tìm thấy khách hàng')

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
        delta: !sameSnapshot && baselineRating != null && currentRating != null ? round1(currentRating - baselineRating) : null,
      },
      review_count: {
        baseline: baselineReviews,
        current: currentReviews,
        delta: !sameSnapshot && baselineReviews != null && currentReviews != null ? currentReviews - baselineReviews : null,
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
    content_published: publishedInCycle,
  }
}
