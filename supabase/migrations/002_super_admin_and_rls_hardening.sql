-- ============================================================
-- Migration 002: Super Admin + RLS hardening
-- Chạy SAU migration 001. Chạy trên Supabase SQL Editor
-- (hoặc supabase db push).
--
-- Mục tiêu:
-- 1. Thêm khái niệm Super Admin (platform-wide), tách biệt với
--    role trong workspace (owner/admin/member).
-- 2. Cho phép Super Admin đọc/ghi mọi workspace qua RLS, để khi
--    code chuyển sang dùng client theo session user (thay vì
--    service role), Super Admin vẫn thấy được tất cả.
-- 3. Vá thêm 1 policy còn thiếu ở content_history (UPDATE) để
--    thống nhất với các bảng khác.
-- ============================================================

-- 1. Cột is_super_admin trong profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 2. Helper: user hiện tại có phải Super Admin không
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()),
    false
  )
$$;

-- 3. Cập nhật lại các policy để cộng thêm điều kiện "hoặc là Super Admin"
-- (DROP rồi CREATE lại cho từng policy đã có ở migration 001)

-- profiles: Super Admin xem được mọi profile (để làm trang quản trị)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_super_admin());

-- workspaces
DROP POLICY IF EXISTS "Members can view their workspace" ON public.workspaces;
CREATE POLICY "Members can view their workspace"
  ON public.workspaces FOR SELECT
  USING (id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Owners/Admins can update workspace" ON public.workspaces;
CREATE POLICY "Owners/Admins can update workspace"
  ON public.workspaces FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      id = public.user_workspace_id()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Clients
DROP POLICY IF EXISTS "Workspace members can select clients" ON public.clients;
CREATE POLICY "Workspace members can select clients"
  ON public.clients FOR SELECT
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can insert clients" ON public.clients;
CREATE POLICY "Workspace members can insert clients"
  ON public.clients FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can update clients" ON public.clients;
CREATE POLICY "Workspace members can update clients"
  ON public.clients FOR UPDATE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can delete clients" ON public.clients;
CREATE POLICY "Workspace members can delete clients"
  ON public.clients FOR DELETE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- Audits
DROP POLICY IF EXISTS "Workspace members can select audits" ON public.audits;
CREATE POLICY "Workspace members can select audits"
  ON public.audits FOR SELECT
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can insert audits" ON public.audits;
CREATE POLICY "Workspace members can insert audits"
  ON public.audits FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can update audits" ON public.audits;
CREATE POLICY "Workspace members can update audits"
  ON public.audits FOR UPDATE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- Plans
DROP POLICY IF EXISTS "Workspace members can select plans" ON public.plans;
CREATE POLICY "Workspace members can select plans"
  ON public.plans FOR SELECT
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can insert plans" ON public.plans;
CREATE POLICY "Workspace members can insert plans"
  ON public.plans FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can update plans" ON public.plans;
CREATE POLICY "Workspace members can update plans"
  ON public.plans FOR UPDATE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- Tasks
DROP POLICY IF EXISTS "Workspace members can select tasks" ON public.tasks;
CREATE POLICY "Workspace members can select tasks"
  ON public.tasks FOR SELECT
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can insert tasks" ON public.tasks;
CREATE POLICY "Workspace members can insert tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can update tasks" ON public.tasks;
CREATE POLICY "Workspace members can update tasks"
  ON public.tasks FOR UPDATE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can delete tasks" ON public.tasks;
CREATE POLICY "Workspace members can delete tasks"
  ON public.tasks FOR DELETE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- Contents
DROP POLICY IF EXISTS "Workspace members can select contents" ON public.contents;
CREATE POLICY "Workspace members can select contents"
  ON public.contents FOR SELECT
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can insert contents" ON public.contents;
CREATE POLICY "Workspace members can insert contents"
  ON public.contents FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can update contents" ON public.contents;
CREATE POLICY "Workspace members can update contents"
  ON public.contents FOR UPDATE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- Content history
DROP POLICY IF EXISTS "Workspace members can select content_history" ON public.content_history;
CREATE POLICY "Workspace members can select content_history"
  ON public.content_history FOR SELECT
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Workspace members can insert content_history" ON public.content_history;
CREATE POLICY "Workspace members can insert content_history"
  ON public.content_history FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- Policy UPDATE còn thiếu ở migration 001 (dùng khi Super Admin sửa lịch sử nội dung)
DROP POLICY IF EXISTS "Workspace members can update content_history" ON public.content_history;
CREATE POLICY "Workspace members can update content_history"
  ON public.content_history FOR UPDATE
  USING (workspace_id = public.user_workspace_id() OR public.is_super_admin());

-- 4. Cách gán 1 user làm Super Admin (chạy thủ công, thay email thật vào):
-- UPDATE public.profiles SET is_super_admin = true
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@yourdomain.com');
