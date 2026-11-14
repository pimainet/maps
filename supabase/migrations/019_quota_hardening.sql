-- ============================================================
-- Migration 019: Vá các đường lách quota. Idempotent, chạy lại an toàn.
-- Không đổi cấu trúc bảng hiện có; không xóa/ghi đè dữ liệu nghiệp vụ.
--
-- Vấn đề (xem đánh giá 14/11/2026):
--  (a) audits cho member UPDATE tự do  => sửa created_at để đẩy audit ra khỏi cửa sổ 30 ngày.
--  (b) clients bị xóa rồi tạo lại      => quota 3 audit/client reset về 0 (audit bị cascade).
--      clients cho UPDATE tự do        => đổi place_id/gbp_link sang doanh nghiệp khác trên cùng 1 slot.
--  (c) workspaces tạo không giới hạn   => mỗi workspace có max_clients=1 + 3 audit riêng => nhân quota vô hạn.
--  (d) kiểm tra quota "đếm rồi mới chạy" không atomic => bấm song song vượt quota.
--
-- Nguyên tắc: ứng dụng KHÔNG hề UPDATE/DELETE clients, audits, workspaces bằng session người dùng
-- (đã rà code: chỉ INSERT/SELECT). Nên thu quyền ở mức GRANT (kiểm tra TRƯỚC RLS, nên đúng dù policy
-- thực tế trên DB là gì). service_role, SQL Editor (postgres) và cascade nội bộ không bị ảnh hưởng.
-- ============================================================

-- 1) audits: bất biến với người dùng ------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON public.audits FROM anon, authenticated;

-- 2) clients: không xóa; chỉ sửa các cột hồ sơ, KHÔNG sửa định danh -------
--    (name, gbp_link, gbp_link_normalized, place_id, workspace_id bị khóa).
REVOKE UPDATE, DELETE, TRUNCATE ON public.clients FROM anon, authenticated;
GRANT  UPDATE (industry, area, phone, contact_name, brand_voice, website_url, notes)
  ON public.clients TO authenticated;

-- 3) workspaces: không tự đổi plan/max_clients, không xóa ----------------
REVOKE UPDATE, DELETE, TRUNCATE ON public.workspaces FROM anon, authenticated;
GRANT  UPDATE (name) ON public.workspaces TO authenticated;

-- 4) Giới hạn số workspace do 1 người sở hữu ------------------------------
--    Mặc định 3 (1 workspace tạo lúc đăng ký + 2 workspace tự tạo thêm).
--    Chỉ chặn việc TẠO MỚI; ai đang có nhiều hơn vẫn giữ nguyên. Super Admin không bị giới hạn.
--    Nâng riêng cho 1 người:  UPDATE public.profiles SET max_workspaces = 10 WHERE id = '<user id>';
--    (profiles chỉ cho user tự sửa full_name/avatar_url theo migration 017 nên họ không tự nâng được.)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS max_workspaces integer NOT NULL DEFAULT 3;

CREATE OR REPLACE FUNCTION public.can_create_workspace()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_superadmin()
    OR (
      SELECT count(*) FROM public.workspace_members m
      WHERE m.user_id = auth.uid() AND m.role = 'owner'
    ) < COALESCE((SELECT p.max_workspaces FROM public.profiles p WHERE p.id = auth.uid()), 3);
$$;

REVOKE EXECUTE ON FUNCTION public.can_create_workspace() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_create_workspace() TO authenticated, service_role;

DROP POLICY IF EXISTS "Workspace creation is capped per owner" ON public.workspaces;
CREATE POLICY "Workspace creation is capped per owner"
  ON public.workspaces
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_create_workspace());

-- 5) Sổ quota audit: sống sót qua việc xóa client/audit --------------------
--    place_key = place_id || 'gbp:'||link chuẩn hóa || 'client:'||id  (cùng công thức với lib/rate-limit.ts)
--    status: pending (đã giữ chỗ, đang chạy) -> done (audit thành công, tính 30 ngày)
--            pending quá 10 phút (request chết giữa chừng) tự hết hiệu lực; released (lỗi) không tính.
CREATE TABLE IF NOT EXISTS public.audit_quota_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,          -- cố ý KHÔNG có FK: xóa workspace/client không được reset quota
  user_id      uuid,                   -- có thể NULL nếu workspace cũ không còn owner (dòng backfill)
  place_key    text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'released')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_quota_events_ws_place_idx
  ON public.audit_quota_events (workspace_id, place_key, created_at);
CREATE INDEX IF NOT EXISTS audit_quota_events_user_place_idx
  ON public.audit_quota_events (user_id, place_key, created_at);

ALTER TABLE public.audit_quota_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_quota_events FROM anon, authenticated;
-- (không tạo policy nào: chỉ truy cập qua các hàm SECURITY DEFINER bên dưới và service_role)

-- Backfill: audit khách hàng đã chạy trong 30 ngày qua tiếp tục được tính (không "reset miễn phí" khi triển khai).
-- Dòng cũ không biết ai bấm; gán cho owner đầu tiên của workspace để hạn mức theo người cũng đúng ngay từ đầu.
INSERT INTO public.audit_quota_events (workspace_id, user_id, place_key, status, created_at)
SELECT a.workspace_id,
       (SELECT m.user_id FROM public.workspace_members m
         WHERE m.workspace_id = a.workspace_id AND m.role = 'owner'
         ORDER BY m.created_at LIMIT 1),
       COALESCE(NULLIF(c.place_id, ''), CASE WHEN NULLIF(c.gbp_link_normalized, '') IS NOT NULL THEN 'gbp:' || c.gbp_link_normalized END, 'client:' || c.id::text),
       'done', a.created_at
FROM public.audits a
JOIN public.clients c ON c.id = a.client_id
WHERE a.created_at >= now() - interval '30 days'
  AND a.workspace_id IS NOT NULL
  AND COALESCE(a.module_key, 'maps_seo') = 'maps_seo'
  AND NOT EXISTS (SELECT 1 FROM public.audit_quota_events);   -- chỉ backfill 1 lần

-- Giữ chỗ quota: ATOMIC (khóa theo place_key nên bấm song song không vượt giới hạn).
-- Đếm 2 phía: theo (workspace, place) — các thành viên chung workspace dùng chung hạn mức, giống trước đây;
--             theo (user, place) — 1 người không nhân hạn mức bằng cách mở thêm workspace.
-- Người vận hành thật (mỗi doanh nghiệp 1 workspace, vài thành viên) không bị ảnh hưởng: hạn mức vẫn là
-- p_limit lần / p_window_days ngày cho mỗi doanh nghiệp.
CREATE OR REPLACE FUNCTION public.reserve_audit_quota(
  p_workspace_id uuid,
  p_place_key    text,
  p_limit        integer DEFAULT 3,
  p_window_days  integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_since  timestamptz := now() - make_interval(days => p_window_days);
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
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Forbidden: không thuộc workspace này' USING ERRCODE = '42501';
  END IF;

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

-- Audit thành công: chuyển pending -> done (tính vào quota 30 ngày).
CREATE OR REPLACE FUNCTION public.commit_audit_quota(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.audit_quota_events SET status = 'done'
  WHERE id = p_id AND user_id = auth.uid() AND status = 'pending';
$$;

-- Audit lỗi (Claude/Outscraper lỗi, không có dữ liệu...): hoàn lại lượt, người dùng không mất quota.
CREATE OR REPLACE FUNCTION public.release_audit_quota(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.audit_quota_events SET status = 'released'
  WHERE id = p_id AND user_id = auth.uid() AND status = 'pending';
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_audit_quota(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commit_audit_quota(uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_audit_quota(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reserve_audit_quota(uuid, text, integer, integer) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.commit_audit_quota(uuid)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.release_audit_quota(uuid) TO authenticated, service_role;
