-- ============================================================
-- Migration 032: Gói "Làm hộ" (done_for_you) — agency làm hộ khách, khách không phải duyệt.
-- Idempotent (chạy lại an toàn). Phụ thuộc: 024/030 (payments, subscriptions, _billing_grant_period),
-- 025/026 (autopost_queue, client_photos), 029 (client_reviews), is_workspace_member(), is_superadmin().
--
-- Gồm:
--  1) Cho phép plan 'done_for_you' ở payments / subscriptions (workspaces.plan không có CHECK).
--  2) _billing_grant_period: workspace đang 'done_for_you' vẫn được đổi gói theo kỳ như gói thường
--     (trước đây chỉ đổi khi plan IN free/basic/full; gói đặt tay như 'agency' vẫn được giữ nguyên).
--  3) client_reviews.approved_via nhận thêm 'agency' (nhân viên duyệt thay khách).
--  4) autopost_queue: ghi ai/khi nào duyệt; hàm agency_approve_autopost / agency_reject_autopost (chỉ service_role).
--  5) SỬA release_stale_autopost: bài ĐÃ DUYỆT ('captioned') không bị huỷ sau 120 phút (Make chỉ chạy 2 lần/ngày);
--     bài chờ duyệt ('needs_review') không bao giờ bị coi là "kẹt" (nhân viên duyệt khi rảnh).
--  6) consultation_requests: khách bấm "Liên hệ tư vấn" -> 1 dòng yêu cầu (chỉ service_role ghi).
--  7) agency_monthly_reports: báo cáo tháng (nháp -> đã gửi); khách chỉ thấy báo cáo ĐÃ GỬI.
--  8) agency_actions: nhật ký thao tác của nhân viên (chỉ ghi thêm).
-- ============================================================

-- 1) plan 'done_for_you' ---------------------------------------------------------------------
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('basic', 'full', 'done_for_you'));
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_plan_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_plan_check CHECK (plan IN ('basic', 'full', 'done_for_you'));

-- 2) _billing_grant_period (giữ nguyên logic 030, chỉ thêm 'done_for_you' vào danh sách plan được tự đổi) -----------
CREATE OR REPLACE FUNCTION public._billing_grant_period(p_ws uuid, p_plan text, p_months integer)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE last_sub public.subscriptions%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.subscriptions WHERE workspace_id = p_ws FOR UPDATE;
  SELECT * INTO last_sub FROM public.subscriptions
   WHERE workspace_id = p_ws AND status IN ('active', 'scheduled')
   ORDER BY current_period_end DESC LIMIT 1;

  IF NOT FOUND OR last_sub.current_period_end <= now() THEN
    UPDATE public.subscriptions SET status = 'expired' WHERE workspace_id = p_ws AND status IN ('active', 'scheduled');
    INSERT INTO public.subscriptions (workspace_id, plan, status, current_period_start, current_period_end)
    VALUES (p_ws, p_plan, 'active', now(), now() + make_interval(months => p_months));
    UPDATE public.workspaces SET plan = p_plan WHERE id = p_ws AND plan IN ('free', 'basic', 'full', 'done_for_you');
    RETURN 'activated';
  ELSIF last_sub.plan = p_plan THEN
    UPDATE public.subscriptions
       SET current_period_end = last_sub.current_period_end + make_interval(months => p_months)
     WHERE id = last_sub.id;
    RETURN 'extended';
  ELSE
    INSERT INTO public.subscriptions (workspace_id, plan, status, current_period_start, current_period_end)
    VALUES (p_ws, p_plan, 'scheduled', last_sub.current_period_end,
            last_sub.current_period_end + make_interval(months => p_months));
    RETURN 'scheduled';
  END IF;
END $$;

-- 3) approved_via + 'agency' ---------------------------------------------------------------------
ALTER TABLE public.client_reviews DROP CONSTRAINT IF EXISTS client_reviews_approved_via_chk;
ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_approved_via_chk
  CHECK (approved_via IS NULL OR approved_via IN ('dashboard', 'owner_link', 'agency'));

-- 4) Duyệt bài tự đăng thay khách ------------------------------------------------------------------
ALTER TABLE public.autopost_queue ADD COLUMN IF NOT EXISTS approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.autopost_queue ADD COLUMN IF NOT EXISTS approved_at  timestamptz;
ALTER TABLE public.autopost_queue ADD COLUMN IF NOT EXISTS approved_via text;
ALTER TABLE public.autopost_queue DROP CONSTRAINT IF EXISTS autopost_queue_approved_via_chk;
ALTER TABLE public.autopost_queue ADD CONSTRAINT autopost_queue_approved_via_chk
  CHECK (approved_via IS NULL OR approved_via IN ('agency', 'dashboard'));
CREATE INDEX IF NOT EXISTS idx_autopost_queue_approved_by ON public.autopost_queue (approved_by) WHERE approved_by IS NOT NULL;

-- needs_review -> captioned; có thể sửa caption. Trả {ok, reason?}. Không kiểm độ giống caption: caption đang sửa chính là
-- dòng đang chờ duyệt nên luôn "giống" bản gốc của nó. Quyền gói do route TS kiểm tra trước khi gọi.
CREATE OR REPLACE FUNCTION public.agency_approve_autopost(p_queue_id uuid, p_caption text DEFAULT NULL, p_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q   public.autopost_queue%ROWTYPE;
  cap text;
BEGIN
  SELECT * INTO q FROM public.autopost_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF q.status <> 'needs_review' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', q.status);
  END IF;
  cap := COALESCE(NULLIF(btrim(p_caption), ''), q.caption);
  IF length(COALESCE(cap, '')) < 40 OR length(cap) > 1500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'length');
  END IF;
  UPDATE public.autopost_queue
     SET status = 'captioned', locked_at = now(), caption = cap, caption_norm = public.normalize_caption(cap),
         approved_by = p_by, approved_at = now(), approved_via = 'agency'
   WHERE id = q.id;
  RETURN jsonb_build_object('ok', true, 'client_id', q.client_id, 'workspace_id', q.workspace_id);
END $$;

-- Bỏ 1 bài (đang chờ duyệt hoặc đã duyệt nhưng chưa đăng). Ảnh về kho ('ready'), hoặc ẩn hẳn nếu p_archive_photo.
CREATE OR REPLACE FUNCTION public.agency_reject_autopost(p_queue_id uuid, p_by uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_archive_photo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q public.autopost_queue%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.autopost_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF q.status NOT IN ('needs_review', 'captioned') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', q.status);
  END IF;
  UPDATE public.autopost_queue
     SET status = 'cancelled', last_error = left('agency_rejected' || COALESCE(': ' || p_reason, ''), 500),
         approved_by = p_by, approved_at = now(), approved_via = 'agency'
   WHERE id = q.id;
  UPDATE public.client_photos
     SET status = CASE WHEN p_archive_photo THEN 'archived' ELSE 'ready' END
   WHERE id = q.photo_id AND status = 'reserved';
  RETURN jsonb_build_object('ok', true, 'client_id', q.client_id, 'workspace_id', q.workspace_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.agency_approve_autopost(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agency_reject_autopost(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agency_approve_autopost(uuid, text, uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.agency_reject_autopost(uuid, uuid, text, boolean) TO service_role;

-- 5) release_stale_autopost: 'picked'/'posting' kẹt > p_minutes -> huỷ như cũ; 'captioned' (đã duyệt, chờ Make) tới 36 giờ;
--    'needs_review' không bao giờ bị huỷ tự động. (Cùng nội dung với bản sửa nháp ở 028; chạy 028 sau cũng không xung đột.)
CREATE OR REPLACE FUNCTION public.release_stale_autopost(p_minutes int DEFAULT 120)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH stale AS (
    UPDATE public.autopost_queue SET status = 'cancelled', last_error = 'timeout'
     WHERE (status IN ('picked', 'posting') AND locked_at < now() - make_interval(mins => p_minutes))
        OR (status = 'captioned' AND locked_at < now() - interval '36 hours')
    RETURNING photo_id
  )
  UPDATE public.client_photos p SET status = 'ready'
    FROM stale WHERE p.id = stale.photo_id AND p.status = 'reserved';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 6) Yêu cầu tư vấn ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultation_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_interest text NOT NULL DEFAULT 'done_for_you' CHECK (plan_interest IN ('done_for_you')),
  contact_name  text NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 120),
  phone         text NOT NULL CHECK (char_length(phone) BETWEEN 6 AND 30),
  email         text CHECK (email IS NULL OR char_length(email) <= 200),
  business_name text CHECK (business_name IS NULL OR char_length(business_name) <= 200),
  message       text CHECK (message IS NULL OR char_length(message) <= 2000),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'won', 'lost')),
  order_code    bigint,                       -- đơn đã tạo cho yêu cầu này (nếu có)
  admin_note    text CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000),
  handled_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at    timestamptz,
  notified_at   timestamptz,                  -- đã gửi email báo admin (null = chưa gửi được: chưa cấu hình Resend...)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Mỗi workspace chỉ có 1 yêu cầu đang mở: bấm lại thì báo "đã nhận", không sinh đơn rác
CREATE UNIQUE INDEX IF NOT EXISTS consultation_one_open_per_ws
  ON public.consultation_requests (workspace_id) WHERE workspace_id IS NOT NULL AND status IN ('new', 'contacted', 'quoted');
CREATE INDEX IF NOT EXISTS consultation_status_idx   ON public.consultation_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS consultation_user_idx     ON public.consultation_requests (user_id);
CREATE INDEX IF NOT EXISTS consultation_handled_idx  ON public.consultation_requests (handled_by);
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consultation_requests FROM anon, authenticated;
-- Thành viên chỉ đọc yêu cầu của workspace mình, và không thấy ghi chú nội bộ
GRANT SELECT (id, workspace_id, user_id, plan_interest, contact_name, phone, email, business_name, message, status, created_at)
  ON public.consultation_requests TO authenticated;
DROP POLICY IF EXISTS "Members read own consultation requests" ON public.consultation_requests;
CREATE POLICY "Members read own consultation requests" ON public.consultation_requests
  FOR SELECT TO authenticated USING (is_superadmin() OR is_workspace_member(workspace_id));

-- 7) Báo cáo tháng -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_monthly_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),   -- ngày 1 của tháng báo cáo (giờ VN)
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  summary      jsonb NOT NULL,                  -- xem lib/agency/report.ts (MonthlyReport)
  generated_by uuid,                            -- null = cron; không FK để giữ báo cáo khi xoá user
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  sent_by      uuid,
  sent_to      text[] NOT NULL DEFAULT '{}',
  UNIQUE (client_id, period_month)
);
CREATE INDEX IF NOT EXISTS agency_reports_ws_idx ON public.agency_monthly_reports (workspace_id, period_month DESC);
ALTER TABLE public.agency_monthly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_monthly_reports FROM anon, authenticated;
GRANT SELECT (id, workspace_id, client_id, period_month, status, summary, sent_at) ON public.agency_monthly_reports TO authenticated;
DROP POLICY IF EXISTS "Members read sent monthly reports" ON public.agency_monthly_reports;
CREATE POLICY "Members read sent monthly reports" ON public.agency_monthly_reports
  FOR SELECT TO authenticated
  USING (is_superadmin() OR (status = 'sent' AND is_workspace_member(workspace_id)));

-- 8) Nhật ký thao tác nhân viên (chỉ ghi thêm) ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_actions (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor        uuid,                 -- nhân viên (null = hệ thống/cron); không FK để giữ nhật ký
  workspace_id uuid,
  client_id    uuid,
  kind         text NOT NULL,        -- post_approve | post_reject | review_<action> | task_done | task_skip | report_generate | report_send | order_create | lead_update ...
  ref_id       text,
  data         jsonb
);
CREATE INDEX IF NOT EXISTS agency_actions_ws_idx ON public.agency_actions (workspace_id, at DESC);
CREATE INDEX IF NOT EXISTS agency_actions_client_idx ON public.agency_actions (client_id, at DESC);
ALTER TABLE public.agency_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_actions FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.agency_actions_id_seq FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agency_actions_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'agency_actions là nhật ký chỉ ghi thêm (append-only)';
END $$;
REVOKE EXECUTE ON FUNCTION public.agency_actions_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS agency_actions_no_update ON public.agency_actions;
CREATE TRIGGER agency_actions_no_update BEFORE UPDATE OR DELETE ON public.agency_actions
  FOR EACH ROW EXECUTE FUNCTION public.agency_actions_immutable();

COMMENT ON TABLE public.consultation_requests IS 'Yêu cầu tư vấn gói Làm hộ (khách bấm "Liên hệ tư vấn"). Chỉ service_role ghi.';
COMMENT ON TABLE public.agency_monthly_reports IS 'Báo cáo tháng của gói Làm hộ: nháp do hệ thống/nhân viên tạo, khách chỉ thấy bản đã gửi.';
COMMENT ON TABLE public.agency_actions IS 'Nhật ký thao tác của nhân viên agency (duyệt bài/phản hồi/việc, gửi báo cáo, tạo đơn).';
