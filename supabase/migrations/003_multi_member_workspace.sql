-- ============================================================
-- Migration 003: Hoàn thiện mô hình multi-member workspace
-- Chạy SAU 001 và 002 (idempotent — chạy lại bao nhiêu lần cũng an
-- toàn, dùng IF NOT EXISTS / OR REPLACE / DROP rồi CREATE khắp nơi).
--
-- BỐI CẢNH QUAN TRỌNG (đọc trước khi chạy):
-- Khi rà soát DB thật, phát hiện đã tồn tại sẵn 1 hệ thống multi-member
-- đúng chuẩn (bảng workspace_members, hàm is_workspace_member(),
-- is_workspace_admin(), is_superadmin(), cùng 1 bộ RLS policy riêng)
-- — nhưng KHÔNG có file migration nào trong repo tạo ra chúng. Tức là
-- ai đó đã chạy tay qua SQL Editor, không lưu lại thành migration.
-- Phần 1 của file này ghi lại baseline đó (an toàn nếu đã có sẵn —
-- IF NOT EXISTS / CREATE OR REPLACE), để nếu sau này deploy lên môi
-- trường mới (staging, máy khác), chạy đủ 001→002→003 vẫn ra đúng kết
-- quả, không bị thiếu.
--
-- Phần 2 dọn dẹp phần dư thừa migration 002 lỡ tạo ra (cột/hàm
-- is_super_admin trùng is_superadmin đã có sẵn).
--
-- Phần 3: XOÁ các policy kiểu cũ (dựa trên profiles.workspace_id đơn,
-- từ migration 001/002) đang chồng lấn với hệ multi-member — RLS ghép
-- nhiều policy cùng lệnh bằng OR nên tồn tại song song sẽ làm phạm vi
-- truy cập rộng hơn dự định.
--
-- Phần 4: bổ sung — hệ multi-member mới đang THIẾU policy INSERT và
-- UPDATE-cho-member ở audits/plans/tasks/contents/content_history/
-- clients (chỉ có SELECT cho member và DELETE cho admin) — nghĩa là
-- hiện tại KHÔNG AI insert được các bảng này. Bổ sung cho đủ.
--
-- Phần 5: trigger tự động thêm người tạo workspace vào
-- workspace_members với role 'owner' — giải quyết vấn đề "con gà quả
-- trứng" (policy insert workspace_members yêu cầu đã là admin của
-- workspace đó, nhưng workspace vừa tạo thì chưa ai là admin cả).
--
-- Phần 6: hàm phụ trợ để mời thành viên bằng email.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PHẦN 1: Baseline cho hệ workspace_members (an toàn nếu đã có)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON public.workspace_members(workspace_id);

-- Tránh 1 user có 2 dòng member trong cùng 1 workspace (bỏ qua êm nếu
-- data hiện tại đã vi phạm — kiểm tra thủ công nếu lỗi khi chạy dòng này)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_workspace_user_unique'
  ) THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_workspace_user_unique UNIQUE (workspace_id, user_id);
  END IF;
END $$;

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(
    (select is_superadmin from public.profiles where id = auth.uid()),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
  );
$function$;

DROP POLICY IF EXISTS "Admins can add members" ON public.workspace_members;
CREATE POLICY "Admins can add members"
  ON public.workspace_members FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Admins can remove members" ON public.workspace_members;
CREATE POLICY "Admins can remove members"
  ON public.workspace_members FOR DELETE
  USING (is_superadmin() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Admins can update members" ON public.workspace_members;
CREATE POLICY "Admins can update members"
  ON public.workspace_members FOR UPDATE
  USING (is_superadmin() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Members can view workspace members" ON public.workspace_members;
CREATE POLICY "Members can view workspace members"
  ON public.workspace_members FOR SELECT
  USING (is_superadmin() OR is_workspace_member(workspace_id));

-- ─────────────────────────────────────────────────────────────
-- PHẦN 2: Dọn dẹp phần dư thừa từ migration 002 (phần policy)
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- ─────────────────────────────────────────────────────────────
-- PHẦN 3: Xoá các policy kiểu cũ (single-workspace, user_workspace_id())
-- đang chồng lấn với hệ multi-member — làm việc này TRƯỚC khi xoá hàm
-- is_super_admin() vì các policy này đang phụ thuộc vào nó (báo lỗi
-- 2BP01 nếu xoá hàm trước).
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Workspace members can select clients" ON public.clients;
DROP POLICY IF EXISTS "Workspace members can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Workspace members can update clients" ON public.clients;
DROP POLICY IF EXISTS "Workspace members can delete clients" ON public.clients;

DROP POLICY IF EXISTS "Workspace members can select audits" ON public.audits;
DROP POLICY IF EXISTS "Workspace members can insert audits" ON public.audits;
DROP POLICY IF EXISTS "Workspace members can update audits" ON public.audits;

DROP POLICY IF EXISTS "Workspace members can select plans" ON public.plans;
DROP POLICY IF EXISTS "Workspace members can insert plans" ON public.plans;
DROP POLICY IF EXISTS "Workspace members can update plans" ON public.plans;

DROP POLICY IF EXISTS "Workspace members can select tasks" ON public.tasks;
DROP POLICY IF EXISTS "Workspace members can insert tasks" ON public.tasks;
DROP POLICY IF EXISTS "Workspace members can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Workspace members can delete tasks" ON public.tasks;

DROP POLICY IF EXISTS "Workspace members can select contents" ON public.contents;
DROP POLICY IF EXISTS "Workspace members can insert contents" ON public.contents;
DROP POLICY IF EXISTS "Workspace members can update contents" ON public.contents;

DROP POLICY IF EXISTS "Workspace members can select content_history" ON public.content_history;
DROP POLICY IF EXISTS "Workspace members can insert content_history" ON public.content_history;
DROP POLICY IF EXISTS "Workspace members can update content_history" ON public.content_history;

DROP POLICY IF EXISTS "Members can view their workspace" ON public.workspaces;
DROP POLICY IF EXISTS "Owners/Admins can update workspace" ON public.workspaces;

-- Giờ mới an toàn để xoá hàm/cột dư thừa (không còn policy nào phụ thuộc)
DROP FUNCTION IF EXISTS public.is_super_admin();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_super_admin;

-- Tạo lại "Users can view own profile" đúng, dùng is_superadmin() có
-- sẵn — CỘNG THÊM: cho phép xem hồ sơ cơ bản của người CÙNG workspace
-- (cần để trang quản lý thành viên hiển thị được tên/avatar người khác)
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members me
      JOIN public.workspace_members them
        ON them.workspace_id = me.workspace_id
      WHERE me.user_id = auth.uid()
        AND them.user_id = profiles.id
    )
  );

-- ─────────────────────────────────────────────────────────────
-- PHẦN 4: Bổ sung policy INSERT + UPDATE-cho-member còn thiếu, dùng
-- đúng hàm is_workspace_member()/is_workspace_admin() của hệ mới.
-- (DELETE và SELECT/"view" đã có sẵn, giữ nguyên không đụng vào)
-- ─────────────────────────────────────────────────────────────

CREATE POLICY "Workspace members can insert clients"
  ON public.clients FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_member(workspace_id));
CREATE POLICY "Workspace members can update clients"
  ON public.clients FOR UPDATE
  USING (is_superadmin() OR is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert audits"
  ON public.audits FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_member(workspace_id));
CREATE POLICY "Workspace members can update audits"
  ON public.audits FOR UPDATE
  USING (is_superadmin() OR is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert plans"
  ON public.plans FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_member(workspace_id));
CREATE POLICY "Workspace members can update plans"
  ON public.plans FOR UPDATE
  USING (is_superadmin() OR is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_member(workspace_id));
CREATE POLICY "Workspace members can update tasks"
  ON public.tasks FOR UPDATE
  USING (is_superadmin() OR is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert contents"
  ON public.contents FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_member(workspace_id));
CREATE POLICY "Workspace members can update contents"
  ON public.contents FOR UPDATE
  USING (is_superadmin() OR is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can insert content_history"
  ON public.content_history FOR INSERT
  WITH CHECK (is_superadmin() OR is_workspace_member(workspace_id));
CREATE POLICY "Workspace members can update content_history"
  ON public.content_history FOR UPDATE
  USING (is_superadmin() OR is_workspace_member(workspace_id));

-- ─────────────────────────────────────────────────────────────
-- PHẦN 5: Trigger tự động thêm người tạo workspace làm owner
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, auth.uid(), 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_created ON public.workspaces;
CREATE TRIGGER on_workspace_created
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_workspace();

-- ─────────────────────────────────────────────────────────────
-- PHẦN 6: Hàm phụ trợ để mời thành viên bằng email
-- (SECURITY DEFINER vì client dùng anon key không được phép đọc
-- auth.users trực tiếp; app code kiểm tra quyền admin ở tầng
-- route trước khi gọi hàm này)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

-- 4. Cách gán 1 user làm Super Admin (không đổi so với 002, để tiện tra cứu):
-- UPDATE public.profiles SET is_superadmin = true
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@yourdomain.com');
