-- 035: siết quyền các hàm SECURITY DEFINER + vá các đường ghi trực tiếp qua REST (/rest/v1) bỏ qua app.
-- Idempotent, chạy lại an toàn. Không đổi chữ ký hàm, không xóa dữ liệu.
--
-- Bối cảnh: hàm SECURITY DEFINER tạo trong schema public mặc định được GRANT EXECUTE cho PUBLIC, nên anon
-- (khóa anon công khai trong trình duyệt) gọi được qua /rest/v1/rpc. "REVOKE ... FROM anon" thôi là CHƯA đủ,
-- phải REVOKE cả PUBLIC. Phân loại (theo rà soát caller trong repo + policy/trigger trên DB):
--   1) Hàm trigger / event trigger           -> thu hết quyền gọi từ API (trigger vẫn chạy bình thường:
--                                               quyền EXECUTE chỉ kiểm tra lúc CREATE TRIGGER).
--   2) Helper dùng trong RLS policy          -> giữ authenticated (policy cần), bỏ PUBLIC/anon.
--   3) RPC app gọi bằng JWT người dùng       -> giữ authenticated, tự kiểm tra auth.uid()/thành viên bên trong.
--   4) Hàm mồ côi (is_org_*, handle_new_organization: không còn bảng organizations) -> thu hết.
-- Ngoài ra vá 4 lỗ ghi trực tiếp tìm thấy khi rà (chi tiết ở từng mục E-H).

-- 1) Trigger / event-trigger / mồ côi ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_workspace()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_workspace_member_roles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_organization()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_org_member(uuid)            FROM PUBLIC, anon, authenticated;

-- 2) Helper RLS: chỉ authenticated (+ service_role) ---------------------------------------------
REVOKE ALL ON FUNCTION public.is_superadmin()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_workspace_id()           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_create_workspace()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspace_client_count(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_workspace_id()          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_create_workspace()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_client_count(uuid) TO authenticated, service_role;

-- workspace_client_count dùng trong policy INSERT clients, nhưng gọi thẳng qua RPC thì đếm được client của
-- BẤT KỲ workspace nào. Chỉ trả số cho thành viên / super admin / service_role; người ngoài nhận NULL
-- (policy vẫn đúng vì nhánh đó đã yêu cầu is_workspace_member).
CREATE OR REPLACE FUNCTION public.workspace_client_count(ws_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR public.is_superadmin() OR public.is_workspace_member(ws_id)
      THEN (SELECT count(*)::int FROM public.clients WHERE workspace_id = ws_id)
  END;
$$;

-- 3) RPC app gọi bằng JWT người dùng: giữ authenticated, bỏ PUBLIC/anon -------------------------
REVOKE ALL ON FUNCTION public.reserve_audit_quota(uuid, text, integer, integer)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_audit_quota(uuid)                                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_audit_quota(uuid)                                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_client(uuid, jsonb)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_workspace_member_emails(uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_ai_usage(uuid, uuid, text, timestamp with time zone)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_audit_quota(uuid, text, integer, integer)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_audit_quota(uuid)                                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_audit_quota(uuid)                                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_client(uuid, jsonb)                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_workspace_member_emails(uuid)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_ai_usage(uuid, uuid, text, timestamp with time zone)   TO authenticated, service_role;

-- count_ai_usage: trước đây đếm được lượt AI của workspace/user BẤT KỲ (kể cả toàn hệ thống khi cả 2 NULL).
-- Nay người dùng chỉ đếm được của chính mình hoặc workspace mình là thành viên. service_role (auth.uid() NULL)
-- và super admin không bị giới hạn. App (lib/rate-limit.ts) chỉ gọi (NULL, user hiện tại) và (workspace đang chọn, NULL).
CREATE OR REPLACE FUNCTION public.count_ai_usage(p_workspace_id uuid, p_user_id uuid, p_endpoint text, p_since timestamp with time zone)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cnt  integer;
BEGIN
  IF v_user IS NOT NULL AND NOT public.is_superadmin() THEN
    IF p_workspace_id IS NULL AND p_user_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: cần chỉ định workspace hoặc user' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> v_user THEN
      RAISE EXCEPTION 'Forbidden: không được xem lượt dùng của người khác' USING ERRCODE = '42501';
    END IF;
    IF p_workspace_id IS NOT NULL AND NOT public.is_workspace_member(p_workspace_id) THEN
      RAISE EXCEPTION 'Forbidden: không thuộc workspace này' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT count(*)::int INTO v_cnt
  FROM public.ai_usage_events
  WHERE endpoint = p_endpoint
    AND created_at >= p_since
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_user_id IS NULL OR user_id = p_user_id);
  RETURN v_cnt;
END;
$$;

-- reserve_audit_quota: p_limit/p_window_days do người gọi truyền. Gọi thẳng RPC với p_limit khổng lồ chỉ tạo được
-- giữ chỗ cho chính mình (route audit tự gọi với hằng số của server, không nhận reservation từ client), nên không
-- vượt được quota thật — nhưng vẫn chặn giá trị vô lý cho chắc. Phần còn lại giữ nguyên migration 019.
CREATE OR REPLACE FUNCTION public.reserve_audit_quota(p_workspace_id uuid, p_place_key text, p_limit integer DEFAULT 3, p_window_days integer DEFAULT 30)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_since  timestamptz;
  v_pend   timestamptz := now() - interval '10 minutes';
  v_ws_cnt integer;
  v_us_cnt integer;
  v_id     uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: cần đăng nhập' USING ERRCODE = '42501';
  END IF;
  IF p_place_key IS NULL OR btrim(p_place_key) = '' THEN
    RAISE EXCEPTION 'place_key không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 OR p_window_days IS NULL OR p_window_days < 1 OR p_window_days > 365 THEN
    RAISE EXCEPTION 'Tham số quota không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Forbidden: không thuộc workspace này' USING ERRCODE = '42501';
  END IF;

  v_since := now() - make_interval(days => p_window_days);
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-quota:' || p_place_key, 0));

  SELECT
    count(*) FILTER (WHERE workspace_id = p_workspace_id),
    count(*) FILTER (WHERE user_id = v_user)
  INTO v_ws_cnt, v_us_cnt
  FROM public.audit_quota_events
  WHERE place_key = p_place_key
    AND created_at >= v_since
    AND (status = 'done' OR (status = 'pending' AND created_at >= v_pend));

  IF v_ws_cnt >= p_limit OR v_us_cnt >= p_limit THEN
    RAISE EXCEPTION 'RateLimited: Doanh nghiệp này đã được audit % lần trong % ngày qua (giới hạn % lần/chu kỳ). Audit dùng để mở đầu và kiểm tra lại 1 chu kỳ 30 ngày, không cần chạy liên tục — hãy đợi sang chu kỳ mới hoặc liên hệ để tăng giới hạn nếu thực sự cần.',
      GREATEST(v_ws_cnt, v_us_cnt), p_window_days, p_limit
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_quota_events (workspace_id, user_id, place_key, status)
  VALUES (p_workspace_id, v_user, p_place_key, 'pending')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- E) Không cho tự hạ/xóa owner CUỐI CÙNG của workspace qua REST ------------------------------------
-- Trước đây owner duy nhất PATCH /rest/v1/workspace_members role=admin (hoặc DELETE chính mình) được, làm số
-- workspace "mình sở hữu" giảm -> can_create_workspace() cho tạo thêm vô hạn workspace (mỗi cái 1 slot client
-- + quota audit riêng) — đúng đường lách migration 019 định chặn. App (/api/workspace-members/[id]) đã chặn,
-- nay chặn luôn ở DB. service_role / SQL Editor (auth.uid() NULL), super admin và cascade xóa user/workspace
-- (đều chạy không có auth.uid()) không bị ảnh hưởng.
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
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      -- khóa workspace để 2 owner không cùng lúc hạ nhau xuống còn 0 owner
      PERFORM 1 FROM public.workspaces WHERE id = OLD.workspace_id FOR UPDATE;
      IF NOT EXISTS (SELECT 1 FROM public.workspace_members
                     WHERE workspace_id = OLD.workspace_id AND role = 'owner' AND id <> OLD.id) THEN
        RAISE EXCEPTION 'Không thể hạ vai trò owner duy nhất của workspace' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF OLD.role = 'owner' AND NOT actor_is_owner THEN
    RAISE EXCEPTION 'Chỉ owner mới được xoá owner' USING ERRCODE = '42501';
  END IF;
  IF OLD.role = 'owner' THEN
    PERFORM 1 FROM public.workspaces WHERE id = OLD.workspace_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.workspace_members
                   WHERE workspace_id = OLD.workspace_id AND role = 'owner' AND id <> OLD.id) THEN
      RAISE EXCEPTION 'Không thể xoá owner duy nhất của workspace' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workspace_member_roles() FROM PUBLIC, anon, authenticated;

-- F) workspaces INSERT ----------------------------------------------------------------------------
-- (a) Policy "Authenticated users can create workspace" (TO public, WITH CHECK true): 2 policy RESTRICTIVE
--     (plan free, giới hạn số workspace) chỉ áp cho authenticated, nên ANON tạo workspace được bằng khóa anon.
-- (b) INSERT cả bảng: người dùng tự đặt max_clients=999 lúc tạo -> vượt giới hạn số doanh nghiệp.
-- App chỉ chèn (id, name) (xem app/api/workspaces/route.ts); plan/max_clients lấy mặc định.
DROP POLICY IF EXISTS "Authenticated users can create workspace" ON public.workspaces;
REVOKE INSERT ON public.workspaces FROM anon, authenticated;
GRANT  INSERT (id, name) ON public.workspaces TO authenticated;

-- G) clients INSERT: chỉ các cột hồ sơ app thực sự gửi (lib/db.ts createClient) ---------------------
-- Trước đây chèn được cả autopost_enabled/autopost_review_mode/gbp_location_resource/autopost_upload_token/
-- review_link_token... -> tự trỏ client của mình vào location Google Business của doanh nghiệp KHÁC mà tài
-- khoản agency (Make) quản lý, bật tự đăng không duyệt => bài đăng lên hồ sơ người khác khi bật auto-post.
REVOKE INSERT ON public.clients FROM anon, authenticated;
GRANT  INSERT (workspace_id, name, industry, area, phone, contact_name, brand_voice, website_url, notes,
               gbp_link, gbp_link_normalized, place_id)
  ON public.clients TO authenticated;

-- H) google_connections: location/account Google chỉ server (service_role) ghi --------------------
-- Trước đây thành viên tự INSERT/UPDATE gbp_location_resource tùy ý (status 'connected') -> cùng đường
-- trỏ sang location người khác như mục G. Callback OAuth nay ghi location bằng service client sau khi tra
-- từ chính token Google của khách. Người dùng vẫn upsert token / refresh / đánh dấu lỗi / ngắt kết nối như cũ.
REVOKE INSERT, UPDATE ON public.google_connections FROM anon, authenticated;
GRANT  INSERT (workspace_id, client_id, google_account_email, access_token_encrypted, refresh_token_encrypted,
               scope, expires_at, status, last_error, updated_at)
  ON public.google_connections TO authenticated;
GRANT  UPDATE (workspace_id, client_id, google_account_email, access_token_encrypted, refresh_token_encrypted,
               scope, expires_at, status, last_error, updated_at)
  ON public.google_connections TO authenticated;

-- anon không bao giờ ghi các bảng lõi (app không dùng session anon để ghi).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.workspaces, public.workspace_members, public.profiles,
  public.clients, public.google_connections FROM anon;
