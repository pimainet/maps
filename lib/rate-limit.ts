// Chặn spam các endpoint gọi Claude API (tốn tiền thật mỗi lần gọi).
//
// Cách dùng trong 1 route handler, TRƯỚC khi gọi askClaude(...):
//
//   const workspaceId = await requireActiveWorkspaceId()
//   await enforceAiRateLimit(workspaceId, 'audit')
//   ... (gọi askClaude, lưu kết quả như bình thường)
//
// Có 2 lớp giới hạn cộng lại, để vừa chặn 1 user spam, vừa chặn cả
// workspace (nhiều user trong cùng workspace) spam:
//   - Theo USER: chặn spam nhanh (double-click, script vòng lặp)
//   - Theo WORKSPACE: chặn tổng chi phí của 1 workspace trong 1 giờ
//
// Nếu vượt giới hạn, throw Error với message bắt đầu bằng
// "RateLimited:" — các route nên bắt message này và trả HTTP 429,
// giống cách "NoWorkspace:" đang được xử lý ở lib/auth.ts.
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'

type EndpointLimit = {
  /** Số lượt gọi tối đa mỗi USER được phép trong userWindowMinutes. */
  perUserMax: number
  perUserWindowMinutes: number
  /** Số lượt gọi tối đa cả WORKSPACE được phép trong workspaceWindowMinutes. */
  perWorkspaceMax: number
  perWorkspaceWindowMinutes: number
}

// Giới hạn mặc định cho từng endpoint gọi AI. Chỉnh ở đây nếu cần nới/
// siết — không cần sửa logic trong route.
const LIMITS: Record<string, EndpointLimit> = {
  audit: { perUserMax: 5, perUserWindowMinutes: 10, perWorkspaceMax: 20, perWorkspaceWindowMinutes: 60 },
  plan: { perUserMax: 5, perUserWindowMinutes: 10, perWorkspaceMax: 20, perWorkspaceWindowMinutes: 60 },
  content: { perUserMax: 10, perUserWindowMinutes: 10, perWorkspaceMax: 40, perWorkspaceWindowMinutes: 60 },
  'tasks-generate-from-plan': { perUserMax: 5, perUserWindowMinutes: 10, perWorkspaceMax: 15, perWorkspaceWindowMinutes: 60 },
  'gbp-snapshot': { perUserMax: 10, perUserWindowMinutes: 10, perWorkspaceMax: 30, perWorkspaceWindowMinutes: 60 },
}

// Audit không phải việc làm liên tục — nó đánh dấu điểm bắt đầu (và
// thỉnh thoảng kiểm tra lại) của 1 chu kỳ 30 ngày cho 1 doanh nghiệp cụ
// thể. Giới hạn ở trên (LIMITS.audit) chỉ chặn SPAM KỸ THUẬT trong vài
// phút/giờ — không phản ánh đúng ý nghĩa nghiệp vụ. Giới hạn dưới đây
// mới là giới hạn "thật": mỗi CLIENT chỉ được audit tối đa
// AUDIT_QUOTA_PER_CLIENT lần trong AUDIT_QUOTA_WINDOW_DAYS ngày gần
// nhất (rolling window, không cần chờ đúng ngày đầu tháng).
export const AUDIT_QUOTA_PER_CLIENT = 3
export const AUDIT_QUOTA_WINDOW_DAYS = 30

/**
 * Kiểm tra rate limit cho 1 endpoint gọi AI. Throw nếu vượt giới hạn,
 * ngược lại ghi nhận lượt gọi này rồi return bình thường.
 *
 * `endpoint` phải là 1 key có trong LIMITS ở trên.
 */
export async function enforceAiRateLimit(workspaceId: string, endpoint: keyof typeof LIMITS): Promise<void> {
  const limit = LIMITS[endpoint]
  if (!limit) {
    throw new Error(`Config lỗi: chưa khai báo rate limit cho endpoint "${endpoint}"`)
  }

  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Unauthorized: cần đăng nhập')
  }

  const supabase = await createSupabaseServerClient()

  const userSince = new Date(Date.now() - limit.perUserWindowMinutes * 60_000).toISOString()
  const workspaceSince = new Date(Date.now() - limit.perWorkspaceWindowMinutes * 60_000).toISOString()

  const [userCountRes, workspaceCountRes] = await Promise.all([
    supabase.rpc('count_ai_usage', {
      p_workspace_id: null,
      p_user_id: user.id,
      p_endpoint: endpoint,
      p_since: userSince,
    }),
    supabase.rpc('count_ai_usage', {
      p_workspace_id: workspaceId,
      p_user_id: null,
      p_endpoint: endpoint,
      p_since: workspaceSince,
    }),
  ])

  if (userCountRes.error) throw userCountRes.error
  if (workspaceCountRes.error) throw workspaceCountRes.error

  const userCount = (userCountRes.data as number) ?? 0
  const workspaceCount = (workspaceCountRes.data as number) ?? 0

  if (userCount >= limit.perUserMax) {
    throw new Error(
      `RateLimited: Bạn đã gọi tính năng này ${userCount} lần trong ${limit.perUserWindowMinutes} phút qua. ` +
        `Vui lòng đợi vài phút rồi thử lại.`
    )
  }
  if (workspaceCount >= limit.perWorkspaceMax) {
    throw new Error(
      `RateLimited: Workspace đã gọi tính năng này ${workspaceCount} lần trong ${limit.perWorkspaceWindowMinutes} phút qua. ` +
        `Vui lòng đợi rồi thử lại, hoặc liên hệ để tăng giới hạn.`
    )
  }

  // Chưa vượt giới hạn — ghi nhận lượt gọi này rồi cho qua.
  const { error: insertError } = await supabase.from('ai_usage_events').insert({
    workspace_id: workspaceId,
    user_id: user.id,
    endpoint,
  })
  if (insertError) throw insertError
}

/**
 * Giới hạn nghiệp vụ riêng cho audit: 1 client chỉ được audit tối đa
 * AUDIT_QUOTA_PER_CLIENT lần trong AUDIT_QUOTA_WINDOW_DAYS ngày gần
 * nhất. Khác với enforceAiRateLimit (chặn spam kỹ thuật theo user/
 * workspace trong vài phút/giờ), hàm này chặn theo đúng bản chất công
 * việc: audit mở đầu 1 chu kỳ 30 ngày, không phải việc làm liên tục.
 *
 * Đếm trực tiếp trên bảng `audits` (không cần bảng ai_usage_events)
 * vì bảng audits đã có sẵn client_id + created_at cho đúng mục đích
 * này.
 */
export async function enforceClientAuditQuota(clientId: string, workspaceId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()

  const since = new Date(Date.now() - AUDIT_QUOTA_WINDOW_DAYS * 24 * 60 * 60_000).toISOString()

  const { count, error } = await supabase
    .from('audits')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)

  if (error) throw error

  if ((count ?? 0) >= AUDIT_QUOTA_PER_CLIENT) {
    throw new Error(
      `RateLimited: Doanh nghiệp này đã được audit ${count} lần trong ${AUDIT_QUOTA_WINDOW_DAYS} ngày qua ` +
        `(giới hạn ${AUDIT_QUOTA_PER_CLIENT} lần/chu kỳ). Audit dùng để mở đầu và kiểm tra lại 1 chu kỳ 30 ngày, ` +
        `không cần chạy liên tục — hãy đợi sang chu kỳ mới hoặc liên hệ để tăng giới hạn nếu thực sự cần.`
    )
  }
}
