-- ============================================================
-- Migration 001: Authentication + Multi-tenant (Workspace)
-- Chạy file này trên Supabase SQL Editor (hoặc supabase db push)
-- ============================================================

-- 1. Bảng workspaces
CREATE TABLE IF NOT EXISTS public.workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Bảng profiles (1-1 với auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  full_name     text,
  role          text NOT NULL DEFAULT 'member', -- owner | admin | member
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. Thêm workspace_id vào các bảng hiện có
-- (Chạy từng lệnh, nếu cột đã tồn tại sẽ báo lỗi — bỏ qua được)

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.contents
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.content_history
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- 4. Index để query theo workspace nhanh
CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON public.clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audits_workspace_id ON public.audits(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plans_workspace_id ON public.plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON public.tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contents_workspace_id ON public.contents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_profiles_workspace_id ON public.profiles(workspace_id);

-- 5. Enable RLS
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_history ENABLE ROW LEVEL SECURITY;

-- 6. Helper function: lấy workspace_id của user hiện tại
CREATE OR REPLACE FUNCTION public.user_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
$$;

-- 7. Policies cho profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- 8. Policies cho workspaces
CREATE POLICY "Members can view their workspace"
  ON public.workspaces FOR SELECT
  USING (id = public.user_workspace_id());

CREATE POLICY "Owners/Admins can update workspace"
  ON public.workspaces FOR UPDATE
  USING (
    id = public.user_workspace_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- 9. Policies chung cho data tables (clients, audits, plans, tasks, contents, content_history)
-- Clients
CREATE POLICY "Workspace members can select clients"
  ON public.clients FOR SELECT
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can insert clients"
  ON public.clients FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can update clients"
  ON public.clients FOR UPDATE
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can delete clients"
  ON public.clients FOR DELETE
  USING (workspace_id = public.user_workspace_id());

-- Audits
CREATE POLICY "Workspace members can select audits"
  ON public.audits FOR SELECT
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can insert audits"
  ON public.audits FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can update audits"
  ON public.audits FOR UPDATE
  USING (workspace_id = public.user_workspace_id());

-- Plans
CREATE POLICY "Workspace members can select plans"
  ON public.plans FOR SELECT
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can insert plans"
  ON public.plans FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can update plans"
  ON public.plans FOR UPDATE
  USING (workspace_id = public.user_workspace_id());

-- Tasks
CREATE POLICY "Workspace members can select tasks"
  ON public.tasks FOR SELECT
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can insert tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can update tasks"
  ON public.tasks FOR UPDATE
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can delete tasks"
  ON public.tasks FOR DELETE
  USING (workspace_id = public.user_workspace_id());

-- Contents
CREATE POLICY "Workspace members can select contents"
  ON public.contents FOR SELECT
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can insert contents"
  ON public.contents FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can update contents"
  ON public.contents FOR UPDATE
  USING (workspace_id = public.user_workspace_id());

-- Content history
CREATE POLICY "Workspace members can select content_history"
  ON public.content_history FOR SELECT
  USING (workspace_id = public.user_workspace_id());

CREATE POLICY "Workspace members can insert content_history"
  ON public.content_history FOR INSERT
  WITH CHECK (workspace_id = public.user_workspace_id());

-- 10. Trigger: khi user đăng ký → tạo workspace + profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace_id uuid;
  user_name text;
BEGIN
  user_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  -- Tạo workspace mới cho user
  INSERT INTO public.workspaces (name, plan)
  VALUES (user_name || '''s Workspace', 'free')
  RETURNING id INTO new_workspace_id;

  -- Tạo profile
  INSERT INTO public.profiles (id, workspace_id, full_name, role)
  VALUES (NEW.id, new_workspace_id, user_name, 'owner');

  RETURN NEW;
END;
$$;

-- Xóa trigger cũ nếu có rồi tạo lại
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 11. (Tùy chọn) Backfill dữ liệu cũ vào 1 workspace mặc định
-- Chỉ chạy 1 lần nếu bạn đã có data thật. Bỏ comment khi cần.
/*
DO $$
DECLARE
  default_ws uuid;
BEGIN
  INSERT INTO public.workspaces (name, plan)
  VALUES ('Legacy Workspace', 'free')
  RETURNING id INTO default_ws;

  UPDATE public.clients SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE public.audits SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE public.plans SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE public.tasks SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE public.contents SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE public.content_history SET workspace_id = default_ws WHERE workspace_id IS NULL;
END $$;
*/
