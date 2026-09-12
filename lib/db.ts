// ────────────────────────────────────────────────────────────────────
// QUAN TRỌNG (đã đổi so với bản cũ):
// Trước đây file này dùng `supabase` từ '@/lib/supabase', tức là
// supabaseAdmin (service role) — BỎ QUA RLS hoàn toàn. Việc cách ly
// dữ liệu giữa các workspace khi đó chỉ dựa vào việc code có nhớ
// truyền đúng workspace_id vào từng query hay không, không có lớp
// bảo vệ nào ở DB.
//
// Bây giờ mỗi hàm tự tạo 1 Supabase client theo session của user hiện
// tại (anon key + cookie đăng nhập, xem '@/lib/supabase/server'), nên
// RLS ở DB thực sự có tác dụng: dù code có lỡ quên filter workspace_id
// ở đâu đó, Postgres vẫn tự chặn theo policy. Việc vẫn truyền
// workspace_id vào query bên dưới là lớp phòng thủ thứ 2 (defense in
// depth) + để query nhanh hơn nhờ index, không phải lớp bảo vệ duy
// nhất nữa.
//
// supabaseAdmin (service role) chỉ nên dùng cho các tác vụ THỰC SỰ
// cần bypass RLS (vd: cron job nền, xử lý webhook không có session
// user). Không dùng lại ở đây.
// ────────────────────────────────────────────────────────────────────
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'

// ── Clients ─────────────────────────────────────────────────────────

export async function getClients(workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

// Thông tin giới hạn số doanh nghiệp (clients) của 1 workspace — dùng
// để hiện/ẩn nút "Thêm khách hàng" ở frontend trước khi bị RLS chặn.
export async function getWorkspaceClientLimit(workspaceId: string) {
  const supabase = await createSupabaseServerClient()

  const [{ data: ws, error: wsError }, { count, error: countError }] = await Promise.all([
    supabase.from('workspaces').select('max_clients').eq('id', workspaceId).single(),
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
  ])

  if (wsError) throw wsError
  if (countError) throw countError

  const maxClients = ws?.max_clients ?? 1
  const clientCount = count ?? 0

  return {
    maxClients,
    clientCount,
    canAddMore: clientCount < maxClients,
  }
}

export async function getClientById(id: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('clients').select('*').eq('id', id)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.single()
  if (error) throw error
  return data
}

export async function createClient(client: {
  name: string
  industry?: string
  area?: string
  phone?: string
  contact_name?: string
  brand_voice?: string
  gbp_link?: string
  gbp_link_normalized?: string | null
  place_id?: string | null
  website_url?: string
  notes?: string
  workspace_id: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('clients')
    .insert(client)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Tìm client trùng place_id hoặc gbp_link_normalized trong cùng workspace. */
export async function findDuplicateClient(params: {
  workspaceId: string
  placeId?: string | null
  gbpLinkNormalized?: string | null
  excludeClientId?: string
}) {
  const supabase = await createSupabaseServerClient()
  const { workspaceId, placeId, gbpLinkNormalized, excludeClientId } = params

  if (placeId) {
    let q = supabase
      .from('clients')
      .select('id, name, place_id, gbp_link, created_at')
      .eq('workspace_id', workspaceId)
      .eq('place_id', placeId)
      .limit(1)
    if (excludeClientId) q = q.neq('id', excludeClientId)
    const { data, error } = await q.maybeSingle()
    if (error) throw error
    if (data) return { match_by: 'place_id' as const, client: data }
  }

  if (gbpLinkNormalized) {
    let q = supabase
      .from('clients')
      .select('id, name, place_id, gbp_link, created_at')
      .eq('workspace_id', workspaceId)
      .eq('gbp_link_normalized', gbpLinkNormalized)
      .limit(1)
    if (excludeClientId) q = q.neq('id', excludeClientId)
    const { data, error } = await q.maybeSingle()
    if (error) throw error
    if (data) return { match_by: 'gbp_link' as const, client: data }
  }

  return null
}

// ── Audits ──────────────────────────────────────────────────────────

export async function saveAudit(input: {
  client_id: string
  audit_result: string
  raw_input?: any
  score_overview?: number
  workspace_id: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('audits')
    .insert({
      client_id: input.client_id,
      audit_result: input.audit_result,
      raw_input: input.raw_input ?? {},
      score_overview: input.score_overview ?? null,
      module_key: 'maps_seo',
      status: 'finalized',
      workspace_id: input.workspace_id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getLatestAuditByClient(clientId: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('audits')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function getAllAudits(workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('audits')
    .select('id, client_id, created_at, workspace_id')
    .order('created_at', { ascending: false })

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

// ── Plans ───────────────────────────────────────────────────────────

export async function savePlan(input: {
  client_id: string
  audit_id?: string
  plan_result: string
  start_date?: string
  end_date?: string
  workspace_id: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('plans')
    .insert({
      client_id: input.client_id,
      audit_id: input.audit_id ?? null,
      plan_result: input.plan_result,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      module_key: 'maps_seo',
      status: 'draft',
      workspace_id: input.workspace_id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getLatestPlanByClient(clientId: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('plans')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function getAllPlans(workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('plans')
    .select('id, client_id, created_at, status, workspace_id')
    .order('created_at', { ascending: false })

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

// ── Tasks ───────────────────────────────────────────────────────────
// Bảng tasks thật: id, created_at, client_id, plan_id, module_key,
// title, description, task_type, priority [+ status — cần chạy migration
// `ALTER TABLE tasks ADD COLUMN status text NOT NULL DEFAULT 'pending';`
// trước khi dùng các hàm cập nhật trạng thái bên dưới]

export async function createTasks(
  items: Array<{
    client_id: string
    plan_id?: string
    title: string
    description?: string
    task_type: string
    priority?: string
    due_date?: string
    workspace_id: string
  }>
) {
  const supabase = await createSupabaseServerClient()
  const rows = items.map((item) => ({
    client_id: item.client_id,
    plan_id: item.plan_id ?? null,
    module_key: 'maps_seo',
    title: item.title,
    description: item.description ?? null,
    task_type: item.task_type,
    priority: item.priority ?? 'medium',
    due_date: item.due_date ?? null,
    status: 'pending',
    workspace_id: item.workspace_id,
  }))

  const { data, error } = await supabase.from('tasks').insert(rows).select()

  if (error) throw error
  return data
}

export async function getTasks(filters?: {
  clientId?: string
  planId?: string
  workspaceId?: string
}) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters?.clientId) query = query.eq('client_id', filters.clientId)
  if (filters?.planId) query = query.eq('plan_id', filters.planId)
  if (filters?.workspaceId) query = query.eq('workspace_id', filters.workspaceId)

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getTaskById(id: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('tasks').select('*').eq('id', id)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.single()
  if (error) throw error
  return data
}

// SỬA: thêm workspaceId (trước đây thiếu -> có thể update task của
// workspace khác nếu biết id). Giờ có cả filter code lẫn RLS chặn.
export async function updateTaskStatus(id: string, status: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('tasks').update({ status }).eq('id', id)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.select().single()
  if (error) throw error
  return data
}

// ── Contents ────────────────────────────────────────────────────────
// Bảng contents thật: id, created_at, client_id, plan_id, task_id,
// module_key, channel, topic, status — KHÔNG có cột lưu văn bản AI.
// Toàn bộ văn bản (SERP-Aware, bản nháp, Critic, bản cuối) lưu trong
// content_history, xem các hàm bên dưới.

export async function createContentForTask(task: {
  id: string
  client_id: string
  plan_id?: string
  title: string
  workspace_id: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('contents')
    .insert({
      client_id: task.client_id,
      plan_id: task.plan_id ?? null,
      task_id: task.id,
      module_key: 'maps_seo',
      channel: 'gbp_post',
      topic: task.title,
      status: 'drafted',
      workspace_id: task.workspace_id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createAdHocContent(input: {
  client_id: string
  plan_id?: string
  topic: string
  workspace_id: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('contents')
    .insert({
      client_id: input.client_id,
      plan_id: input.plan_id ?? null,
      task_id: null,
      module_key: 'maps_seo',
      channel: 'gbp_post',
      topic: input.topic,
      status: 'drafted',
      workspace_id: input.workspace_id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// SỬA: thêm workspaceId (trước đây thiếu filter).
export async function getContentByTaskId(taskId: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('contents').select('*').eq('task_id', taskId)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export async function getContents(clientId?: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('contents')
    .select('*')
    .order('created_at', { ascending: false })

  if (clientId) {
    query = query.eq('client_id', clientId)
  }
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query

  if (error) throw error
  return data
}

export async function getContentById(id: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('contents').select('*').eq('id', id)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.single()
  if (error) throw error
  return data
}

// SỬA: thêm workspaceId (trước đây thiếu -> có thể đổi status content
// của workspace khác nếu biết id).
export async function updateContentStatus(id: string, status: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase.from('contents').update({ status }).eq('id', id)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.select().single()
  if (error) throw error
  return data
}

/** Xóa content (và history liên quan nếu có RLS/cascade; history xóa thủ công nếu cần). */
export async function deleteContentById(id: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()

  // Xóa history trước (tránh orphan)
  let hist = supabase.from('content_history').delete().eq('content_id', id)
  if (workspaceId) {
    hist = hist.eq('workspace_id', workspaceId)
  }
  const histRes = await hist
  if (histRes.error) throw histRes.error

  let query = supabase.from('contents').delete().eq('id', id)
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }
  const { error } = await query
  if (error) throw error
  return true
}

// ── Content history ─────────────────────────────────────────────────
// Schema thật: id, created_at, content_id, client_id, ai_version,
// human_edited_version, edit_note, workspace_id.
// Quy ước dùng trong hệ thống:
// - Lần AI viết xong (SERP-Aware→Writer→Critic→Refiner): ai_version =
//   bản cuối do AI tạo; edit_note = JSON.stringify({ serp_analysis,
//   ai_draft, critic_feedback }) để không mất dữ liệu trung gian mà
//   không cần thêm cột trong contents.
// - Mỗi lần người dùng lưu chỉnh sửa: thêm 1 dòng mới với
//   human_edited_version = bản đã sửa, ai_version giữ nguyên bản AI gốc
//   gần nhất, edit_note mô tả ngắn hành động.

export async function saveContentHistory(input: {
  content_id: string
  client_id: string
  ai_version?: string
  human_edited_version?: string
  edit_note?: string
  workspace_id: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('content_history')
    .insert({
      content_id: input.content_id,
      client_id: input.client_id,
      ai_version: input.ai_version ?? null,
      human_edited_version: input.human_edited_version ?? null,
      edit_note: input.edit_note ?? null,
      workspace_id: input.workspace_id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// SỬA: thêm workspaceId (trước đây thiếu filter).
export async function getLatestContentHistory(contentId: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('content_history')
    .select('*')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

// SỬA: thêm workspaceId (trước đây thiếu filter).
export async function getContentHistoryList(contentId: string, workspaceId?: string) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('content_history')
    .select('*')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false })

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}


// ── Cycles (chu kỳ 30 ngày) ─────────────────────────────────────────

export async function getActiveCycle(clientId: string, workspaceId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('cycles')
    .select('*')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getLatestCycle(clientId: string, workspaceId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('cycles')
    .select('*')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function openCycle(input: {
  client_id: string
  workspace_id: string
  opening_audit_id?: string | null
  plan_id?: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('cycles')
    .insert({
      client_id: input.client_id,
      workspace_id: input.workspace_id,
      status: 'active',
      opening_audit_id: input.opening_audit_id ?? null,
      plan_id: input.plan_id ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCycle(
  id: string,
  workspaceId: string,
  patch: Record<string, unknown>
) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('cycles')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function closeCycle(
  id: string,
  workspaceId: string,
  snapshot?: Record<string, unknown>
) {
  return updateCycle(id, workspaceId, {
    status: 'closed',
    closed_at: new Date().toISOString(),
    snapshot: snapshot ?? {},
  })
}

/** Đóng cycle active (nếu có) rồi mở cycle mới. */
export async function rotateCycle(input: {
  client_id: string
  workspace_id: string
  opening_audit_id?: string | null
  plan_id?: string | null
  close_snapshot?: Record<string, unknown>
}) {
  const active = await getActiveCycle(input.client_id, input.workspace_id)
  if (active) {
    await closeCycle(active.id, input.workspace_id, input.close_snapshot)
  }
  return openCycle({
    client_id: input.client_id,
    workspace_id: input.workspace_id,
    opening_audit_id: input.opening_audit_id,
    plan_id: input.plan_id,
  })
}
