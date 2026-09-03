import { supabase } from './supabase'

// ── Clients ─────────────────────────────────────────────────────────

export async function getClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getClientById(id: string) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

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
  website_url?: string
  notes?: string
}) {
  const { data, error } = await supabase
    .from('clients')
    .insert(client)
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Audits ──────────────────────────────────────────────────────────

export async function saveAudit(input: {
  client_id: string
  audit_result: string
  raw_input?: any
  score_overview?: number
}) {
  const { data, error } = await supabase
    .from('audits')
    .insert({
      client_id: input.client_id,
      audit_result: input.audit_result,
      raw_input: input.raw_input ?? {},
      score_overview: input.score_overview ?? null,
      module_key: 'maps_seo',
      status: 'finalized',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getLatestAuditByClient(clientId: string) {
  const { data, error } = await supabase
    .from('audits')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getAllAudits() {
  const { data, error } = await supabase
    .from('audits')
    .select('id, client_id, created_at')
    .order('created_at', { ascending: false })

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
}) {
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
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getLatestPlanByClient(clientId: string) {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getAllPlans() {
  const { data, error } = await supabase
    .from('plans')
    .select('id, client_id, created_at, status')
    .order('created_at', { ascending: false })

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
  }>
) {
  const rows = items.map((item) => ({
    client_id: item.client_id,
    plan_id: item.plan_id ?? null,
    module_key: 'maps_seo',
    title: item.title,
    description: item.description ?? null,
    task_type: item.task_type,
    priority: item.priority ?? 'Trung bình',
    status: 'pending',
  }))

  const { data, error } = await supabase.from('tasks').insert(rows).select()

  if (error) throw error
  return data
}

export async function getTasks(filters?: { clientId?: string; planId?: string }) {
  let query = supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters?.clientId) query = query.eq('client_id', filters.clientId)
  if (filters?.planId) query = query.eq('plan_id', filters.planId)

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getTaskById(id: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function updateTaskStatus(id: string, status: string) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', id)
    .select()
    .single()

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
}) {
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
}) {
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
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getContentByTaskId(taskId: string) {
  const { data, error } = await supabase
    .from('contents')
    .select('*')
    .eq('task_id', taskId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getContents(clientId?: string) {
  let query = supabase
    .from('contents')
    .select('*')
    .order('created_at', { ascending: false })

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const { data, error } = await query

  if (error) throw error
  return data
}

export async function getContentById(id: string) {
  const { data, error } = await supabase
    .from('contents')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function updateContentStatus(id: string, status: string) {
  const { data, error } = await supabase
    .from('contents')
    .update({ status })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// ── Content history ─────────────────────────────────────────────────
// Schema thật: id, created_at, content_id, client_id, ai_version,
// human_edited_version, edit_note.
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
}) {
  const { data, error } = await supabase
    .from('content_history')
    .insert({
      content_id: input.content_id,
      client_id: input.client_id,
      ai_version: input.ai_version ?? null,
      human_edited_version: input.human_edited_version ?? null,
      edit_note: input.edit_note ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getLatestContentHistory(contentId: string) {
  const { data, error } = await supabase
    .from('content_history')
    .select('*')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getContentHistoryList(contentId: string) {
  const { data, error } = await supabase
    .from('content_history')
    .select('*')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}
