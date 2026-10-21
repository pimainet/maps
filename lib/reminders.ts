// Gom dữ liệu thật (việc, doanh nghiệp, bài chờ duyệt) và dựng email nhắc cho từng người.
// Chỉ chạy ở server, dùng admin client nên KHÔNG bao giờ gọi từ code chạy trên trình duyệt.
import type { SupabaseClient } from '@supabase/supabase-js'
import { summarizeProgress } from '@/lib/progress'
import {
  appUrl,
  buildReminderEmail,
  unsubscribeUrl,
  vnTodayISO,
  vnWeekday,
  type ReminderEmail,
  type ReminderTask,
} from '@/lib/notifications'

export type WorkspaceData = {
  tasks: any[]
  clientNames: Map<string, string>
  waitingApproval: number
}

/** Tải việc, tên doanh nghiệp và số bài chờ duyệt của các workspace. */
export async function loadWorkspaceData(admin: SupabaseClient, workspaceIds: string[]): Promise<Map<string, WorkspaceData>> {
  const result = new Map<string, WorkspaceData>()
  for (const id of workspaceIds) result.set(id, { tasks: [], clientNames: new Map(), waitingApproval: 0 })
  if (workspaceIds.length === 0) return result

  const [tasks, clients, contents] = await Promise.all([
    admin
      .from('tasks')
      .select('id, workspace_id, client_id, title, status, task_type, due_date, completed_at')
      .in('workspace_id', workspaceIds)
      .limit(5000),
    admin.from('clients').select('id, workspace_id, name').in('workspace_id', workspaceIds).limit(2000),
    admin.from('contents').select('id, workspace_id, status').in('workspace_id', workspaceIds).eq('status', 'waiting_approval').limit(5000),
  ])

  // Cột completed_at chỉ có sau migration 014: nếu chưa chạy, tải lại không có cột đó.
  let taskRows: any[] | null = tasks.data
  if (tasks.error) {
    const retry = await admin
      .from('tasks')
      .select('id, workspace_id, client_id, title, status, task_type, due_date')
      .in('workspace_id', workspaceIds)
      .limit(5000)
    if (retry.error) throw retry.error
    taskRows = retry.data
  }
  if (clients.error) throw clients.error
  if (contents.error) throw contents.error

  for (const t of taskRows || []) result.get(t.workspace_id)?.tasks.push(t)
  for (const c of clients.data || []) result.get(c.workspace_id)?.clientNames.set(c.id, c.name)
  for (const c of contents.data || []) {
    const ws = result.get(c.workspace_id)
    if (ws) ws.waitingApproval += 1
  }
  return result
}

/** Dựng email cho 1 người dựa trên các workspace họ thuộc về. null = hôm nay không cần nhắc. */
export function buildEmailForUser(opts: {
  userId: string
  fullName?: string | null
  workspaceIds: string[]
  data: Map<string, WorkspaceData>
  now?: Date
  force?: boolean
}): ReminderEmail | null {
  const now = opts.now || new Date()
  const allTasks: any[] = []
  const pending: ReminderTask[] = []
  let waiting = 0

  for (const wsId of opts.workspaceIds) {
    const ws = opts.data.get(wsId)
    if (!ws) continue
    waiting += ws.waitingApproval
    for (const t of ws.tasks) {
      allTasks.push(t)
      if ((t.status || 'pending') === 'pending') {
        pending.push({ id: t.id, title: t.title, due_date: t.due_date, client_name: ws.clientNames.get(t.client_id) || null })
      }
    }
  }

  return buildReminderEmail({
    name: opts.fullName,
    today: vnTodayISO(now),
    isMonday: vnWeekday(now) === 1,
    pendingTasks: pending,
    waitingApproval: waiting,
    progress: summarizeProgress(allTasks, now),
    appUrl: appUrl(),
    unsubscribeUrl: unsubscribeUrl(opts.userId),
    force: opts.force,
  })
}
