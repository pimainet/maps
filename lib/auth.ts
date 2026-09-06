// Helpers lấy thông tin user + workspace hiện tại
import { createClient } from '@/lib/supabase/server'

export type Profile = {
  id: string
  workspace_id: string
  full_name: string | null
  role: string
  avatar_url: string | null
}

export type Workspace = {
  id: string
  name: string
  plan: string
}

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
    .select('id, workspace_id, full_name, role, avatar_url')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as Profile
}

export async function getCurrentWorkspace(): Promise<Workspace | null> {
  const profile = await getCurrentProfile()
  if (!profile?.workspace_id) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, plan')
    .eq('id', profile.workspace_id)
    .single()

  if (error || !data) return null
  return data as Workspace
}

/** Lấy workspace_id của user đang đăng nhập. Throw nếu chưa login. */
export async function requireWorkspaceId(): Promise<string> {
  const profile = await getCurrentProfile()
  if (!profile?.workspace_id) {
    throw new Error('Unauthorized: chưa đăng nhập hoặc chưa có workspace')
  }
  return profile.workspace_id
}
