-- ============================================================
-- Migration 017: Vá bảo mật (đợt 1). Idempotent, chạy lại an toàn.
-- Chạy trên staging/backup trước. Không đổi cấu trúc bảng.
--
-- 1) profiles: user chỉ được sửa full_name/avatar_url của CHÍNH MÌNH.
--    Trước đây policy UPDATE (001) không giới hạn cột => tự đặt is_superadmin = true.
-- 2) demo_leads: bỏ quyền đọc của mọi user đăng nhập (lộ SĐT lead). Chỉ service role truy cập.
-- 3) find_user_id_by_email: không cho anon/authenticated gọi trực tiếp (dò email).
--    Route mời thành viên gọi qua service role sau khi kiểm tra quyền admin.
-- 4) workspace_members: chặn admin tự nâng owner / sửa / xoá owner trực tiếp qua DB.
-- 5) Các hàm đếm SECURITY DEFINER: bỏ quyền của anon.
-- ============================================================

-- 1) profiles -----------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT  UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

-- 2) demo_leads ---------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can read demo leads" ON public.demo_leads;
REVOKE ALL ON public.demo_leads FROM anon, authenticated;

-- 3) find_user_id_by_email ---------------------------------------------
REVOKE EXECUTE ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO service_role;

-- 4) workspace_members: bảo vệ vai trò owner ----------------------------
CREATE OR REPLACE FUNCTION public.guard_workspace_member_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_is_owner boolean;
BEGIN
  -- service_role / SQL Editor (không có auth.uid()) và super admin: không chặn.
  IF actor IS NULL OR public.is_superadmin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = COALESCE(NEW.workspace_id, OLD.workspace_id)
      AND user_id = actor AND role = 'owner'
  ) INTO actor_is_owner;

  IF TG_OP = 'INSERT' THEN
    -- Trigger on_workspace_created thêm owner đầu tiên cho người tạo workspace.
    IF NEW.role = 'owner' AND NOT actor_is_owner AND NEW.user_id <> actor THEN
      RAISE EXCEPTION 'Chỉ owner mới được thêm owner' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.role = 'owner' OR NEW.role = 'owner') AND NOT actor_is_owner THEN
      RAISE EXCEPTION 'Chỉ owner mới được thay đổi vai trò owner' USING ERRCODE = '42501';
    END IF;
    IF NEW.workspace_id <> OLD.workspace_id OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'Không được đổi workspace/user của thành viên' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF OLD.role = 'owner' AND NOT actor_is_owner THEN
    RAISE EXCEPTION 'Chỉ owner mới được xoá owner' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_workspace_member_roles ON public.workspace_members;
CREATE TRIGGER guard_workspace_member_roles
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_member_roles();

-- 5) Hàm SECURITY DEFINER không cần cho anon -----------------------------
REVOKE EXECUTE ON FUNCTION public.count_ai_usage(uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.workspace_client_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_workspace_member_emails(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.count_ai_usage(uuid, uuid, text, timestamptz) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.workspace_client_count(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.list_workspace_member_emails(uuid) TO authenticated, service_role;
