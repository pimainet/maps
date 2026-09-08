// Helpers lấy thông tin user + workspace hiện tại.
//
// MÔ HÌNH: 1 user có thể là thành viên của NHIỀU workspace (bảng
// workspace_members, role 'owner' | 'admin' | 'member'), khác với mô
// hình cũ "1 user = 1 workspace" dựa trên profiles.workspace_id (cột
// đó vẫn còn trong DB vì lý do lịch sử, nhưng KHÔNG dùng nữa ở đây).
//
// Vì 1 user có thể thuộc nhiều workspace, mỗi request cần biết đang
// "làm việc trong workspace nào" — lưu trong cookie `active_workspace_id`.
// Nếu cookie trống hoặc trỏ tới workspace mà user không còn là thành
// viên, tự động rơi về workspace đầu tiên trong danh sách của họ.
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export type Profile = {
  id: string
  full_name: string | null
  avatar_url: string | null
  is_superadmin: boolean
}

export type Workspace = {
  id: string
  name: string
  plan: string
}

export type WorkspaceMembership = {
  workspace_id: string
  role: string
  workspace: Workspace
}

const ACTIVE_WORKSPACE_COOKIE = 'active_workspace_id'

export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, is_superadmin')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as Profile
}

/** Toàn bộ workspace mà user hiện tại là thành viên, kèm role của họ
 * trong từng workspace. Sắp xếp theo thời gian tham gia (cũ nhất trước
 * — thường là workspace "chính" của họ). */
export async function getUserWorkspaces(): Promise<WorkspaceMembership[]> {
  const user = await getCurrentUser()
  if (!user) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, created_at, workspace:workspaces(id, name, plan)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error || !data) return []

  return data
    .filter((row: any) => row.workspace)
    .map((row: any) => ({
      workspace_id: row.workspace_id,
      role: row.role,
      workspace: row.workspace,
    }))
}

/** workspace_id đang được chọn làm việc cho request này, hoặc null
 * nếu user chưa thuộc workspace nào. Không throw. */
export async function getActiveWorkspaceId(): Promise<string | null> {
  const memberships = await getUserWorkspaces()
  if (memberships.length === 0) return null

  const cookieStore = await cookies()
  const cookieVal = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value

  if (cookieVal && memberships.some((m) => m.workspace_id === cookieVal)) {
    return cookieVal
  }

  // Cookie trống hoặc trỏ tới workspace không còn là thành viên —
  // dùng workspace đầu tiên (cũ nhất) làm mặc định.
  return memberships[0].workspace_id
}

/** Giống getActiveWorkspaceId nhưng throw nếu user chưa thuộc workspace
 * nào — dùng ở đầu các route API cần dữ liệu theo workspace. Message
 * bắt đầu bằng "NoWorkspace:" để route phân biệt với lỗi chưa login
 * (401) và trả về mã lỗi phù hợp (409, kèm gợi ý tạo/tham gia workspace). */
export async function requireActiveWorkspaceId(): Promise<string> {
  const id = await getActiveWorkspaceId()
  if (!id) {
    throw new Error('NoWorkspace: user chưa thuộc workspace nào')
  }
  return id
}

/** Role của user trong workspace đang chọn ('owner' | 'admin' | 'member'),
 * hoặc null nếu chưa có workspace active. */
export async function getActiveWorkspaceRole(): Promise<string | null> {
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId) return null

  const memberships = await getUserWorkspaces()
  return memberships.find((m) => m.workspace_id === workspaceId)?.role ?? null
}

/** true nếu role hiện tại trong workspace đang chọn là owner/admin. */
export async function isActiveWorkspaceAdmin(): Promise<boolean> {
  const role = await getActiveWorkspaceRole()
  return role === 'owner' || role === 'admin'
}

/** Throw nếu user không phải owner/admin của workspace đang chọn (Super
 * Admin platform-wide luôn được coi là đủ quyền). */
export async function requireActiveWorkspaceAdmin(): Promise<string> {
  const workspaceId = await requireActiveWorkspaceId()
  const admin = await isActiveWorkspaceAdmin()
  if (!admin) {
    const superadmin = await isSuperAdmin()
    if (!superadmin) {
      throw new Error('Forbidden: cần quyền admin/owner trong workspace này')
    }
  }
  return workspaceId
}

/**
 * true nếu user hiện tại là Super Admin (platform-wide, khác với
 * role owner/admin trong 1 workspace cụ thể). Super Admin thấy được
 * mọi workspace nhờ RLS (xem migration 003, hàm is_superadmin()).
 */
export async function isSuperAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile()
  return !!profile?.is_superadmin
}

/** Throw nếu user hiện tại không phải Super Admin. Dùng ở đầu các
 * route/trang quản trị (vd: /admin/*, /api/admin/*). */
export async function requireSuperAdmin(): Promise<void> {
  const ok = await isSuperAdmin()
  if (!ok) {
    throw new Error('Unauthorized: yêu cầu quyền Super Admin')
  }
}

/** Đặt cookie workspace đang làm việc, sau khi xác nhận user thực sự
 * là thành viên của workspace đó. Trả về false nếu không phải thành
 * viên (route gọi hàm này nên trả 403 trong trường hợp đó). */
export async function setActiveWorkspaceId(workspaceId: string): Promise<boolean> {
  const memberships = await getUserWorkspaces()
  const isMember = memberships.some((m) => m.workspace_id === workspaceId)
  if (!isMember) return false

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return true
}
