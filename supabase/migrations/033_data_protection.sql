-- ============================================================
-- Migration 033: Bảo vệ dữ liệu cá nhân (Luật 91/2025/QH15, NĐ 356/2025/NĐ-CP) + giới hạn lưu trữ của Google.
-- Idempotent (chạy lại an toàn). Phụ thuộc: 009/015 (gbp_snapshots), 029 (client_reviews), 032 (consultation_requests),
-- 020 (ai_classification_cache), 025 (autopost_log), 019 (audit_quota_events), demo_leads, clients.
--
-- Gồm:
--  1) consent_records   — bằng chứng đồng ý theo từng mục đích (phiên bản chính sách, thời điểm, IP, trình duyệt).
--                         Không FK tới auth.users để còn chứng minh được sau khi xoá tài khoản (NĐ 356 Điều 6: bên kiểm soát
--                         chịu trách nhiệm chứng minh). Chỉ service_role ghi; người dùng chỉ đọc bản ghi của mình.
--  2) data_requests     — yêu cầu của chủ thể dữ liệu (xuất dữ liệu, xoá tài khoản, rút đồng ý...) + hạn xử lý (NĐ 356 Điều 5).
--  3) clients.latlng_source / latlng_cached_at — biết toạ độ lấy từ Places API để xoá sau 30 ngày (GMP Service Specific Terms).
--  4) privacy_retention_runs + run_privacy_retention() — dọn dữ liệu quá hạn, gọi từ cron hằng ngày (/api/cron/billing).
--  5) privacy_scrub_user(uuid) — ẩn danh dữ liệu liên hệ còn lại của 1 user khi xoá tài khoản (giữ chứng từ thanh toán).
-- KHÔNG xoá payments / bank_transactions / billing_events / subscriptions: chứng từ kế toán lưu ≥ 10 năm
-- (Luật Kế toán 2015 Điều 41; NĐ 174/2016/NĐ-CP Điều 13).
-- ============================================================

-- 1) consent_records --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,                 -- không FK: giữ làm bằng chứng sau khi xoá tài khoản
  policy_version     text NOT NULL CHECK (policy_version ~ '^\d{4}-\d{2}-\d{2}$'),
  purposes           jsonb NOT NULL CHECK (jsonb_typeof(purposes) = 'object'),   -- {"service":true,"cross_border":true,"marketing":false}
  action             text NOT NULL CHECK (action IN ('grant', 'withdraw', 'update')),
  source             text NOT NULL CHECK (source IN ('signup', 'consent_gate', 'settings', 'admin')),
  consented_at       timestamptz NOT NULL DEFAULT now(),  -- lúc người dùng tick (đăng ký: thời điểm trên trang đăng ký)
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  ip                 text CHECK (ip IS NULL OR char_length(ip) <= 45),
  user_agent         text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  subject_deleted_at timestamptz                          -- tài khoản đã xoá: bỏ IP/UA, giữ phiên bản + thời điểm
);
CREATE INDEX IF NOT EXISTS consent_records_user_idx ON public.consent_records (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS consent_records_deleted_idx ON public.consent_records (subject_deleted_at) WHERE subject_deleted_at IS NOT NULL;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consent_records FROM anon, authenticated;
GRANT SELECT (id, user_id, policy_version, purposes, action, source, consented_at, recorded_at) ON public.consent_records TO authenticated;
DROP POLICY IF EXISTS "Users read own consent records" ON public.consent_records;
CREATE POLICY "Users read own consent records" ON public.consent_records
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR is_superadmin());

-- Bản ghi đồng ý không được sửa nội dung (chỉ được bỏ IP/UA khi xoá tài khoản, và xoá hẳn khi hết hạn lưu bằng chứng).
CREATE OR REPLACE FUNCTION public.consent_records_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.purposes IS DISTINCT FROM OLD.purposes
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.consented_at IS DISTINCT FROM OLD.consented_at
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR (NEW.ip IS NOT NULL AND NEW.ip IS DISTINCT FROM OLD.ip)
     OR (NEW.user_agent IS NOT NULL AND NEW.user_agent IS DISTINCT FROM OLD.user_agent) THEN
    RAISE EXCEPTION 'consent_records: chỉ được bỏ IP/UA hoặc đánh dấu đã xoá tài khoản';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.consent_records_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS consent_records_guard ON public.consent_records;
CREATE TRIGGER consent_records_guard BEFORE UPDATE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_guard();

-- 2) data_requests ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,                  -- không FK: giữ hồ sơ xử lý yêu cầu sau khi xoá tài khoản
  kind            text NOT NULL CHECK (kind IN ('export', 'delete_account', 'withdraw_consent', 'correct', 'restrict', 'object')),
  status          text NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received', 'scheduled', 'processing', 'done', 'cancelled', 'rejected', 'needs_attention')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,                    -- NĐ 356 Điều 5: xác nhận đã nhận trong 02 ngày làm việc
  due_at          timestamptz NOT NULL,           -- hạn xử lý (chưa gia hạn)
  scheduled_for   timestamptz,                    -- xoá tài khoản: thời điểm thực hiện (sau thời gian huỷ)
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  handled_by      uuid,
  admin_note      text CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000),
  result          jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_one_open_delete
  ON public.data_requests (user_id) WHERE kind = 'delete_account' AND status IN ('received', 'scheduled', 'processing', 'needs_attention');
CREATE INDEX IF NOT EXISTS data_requests_user_idx ON public.data_requests (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS data_requests_due_idx ON public.data_requests (status, scheduled_for) WHERE status IN ('scheduled', 'needs_attention');
ALTER TABLE public.data_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_requests FROM anon, authenticated;
GRANT SELECT (id, user_id, kind, status, received_at, acknowledged_at, due_at, scheduled_for, completed_at, cancelled_at)
  ON public.data_requests TO authenticated;
DROP POLICY IF EXISTS "Users read own data requests" ON public.data_requests;
CREATE POLICY "Users read own data requests" ON public.data_requests
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR is_superadmin());

-- 3) Nguồn gốc toạ độ doanh nghiệp ------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS latlng_source text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS latlng_cached_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_latlng_source_check' AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_latlng_source_check
      CHECK (latlng_source IS NULL OR latlng_source IN ('places', 'outscraper', 'manual', 'saved'));
  END IF;
END $$;
COMMENT ON COLUMN public.clients.latlng_source IS 'Nguồn toạ độ: places = Google Places API (chỉ được lưu tối đa 30 ngày, run_privacy_retention tự xoá).';

-- 4) Dọn dữ liệu quá hạn ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.privacy_retention_runs (
  id     bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL
);
ALTER TABLE public.privacy_retention_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_retention_runs FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.privacy_retention_runs_id_seq FROM anon, authenticated;

-- Thời hạn khớp lib/privacy/policy.ts (RETENTION_DAYS). Mỗi bước độc lập, trả về số dòng đã xử lý.
CREATE OR REPLACE FUNCTION public.run_privacy_retention() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
  out jsonb := '{}'::jsonb;
BEGIN
  -- a) gbp_snapshots.raw_json: bỏ payload thô của nhà cung cấp (tên/ảnh/link người viết review, nội dung Google)
  UPDATE public.gbp_snapshots s
     SET raw_json = COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(s.raw_json) e
                               WHERE e.key IN ('source', 'source_used', 'coverage', 'reply_field_present', 'raw_review_count', 'deep')),
                             '{}'::jsonb) || '{"minimized": true}'::jsonb
   WHERE s.raw_json IS NOT NULL AND jsonb_typeof(s.raw_json) = 'object'
     AND NOT (s.raw_json ? 'minimized');
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('snapshot_raw_minimized', n);

  -- b) Review trong snapshot > 30 ngày: bỏ nội dung (giữ thống kê review_stats / rating_distribution)
  UPDATE public.gbp_snapshots
     SET reviews = '[]'::jsonb
   WHERE COALESCE(captured_at, created_at) < now() - interval '30 days'
     AND reviews IS NOT NULL AND jsonb_typeof(reviews) = 'array' AND jsonb_array_length(reviews) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('snapshot_reviews_cleared', n);

  -- c) Snapshot cũ > 90 ngày: xoá, trừ bản ok/partial mới nhất của mỗi doanh nghiệp
  DELETE FROM public.gbp_snapshots s
   WHERE COALESCE(s.captured_at, s.created_at) < now() - interval '90 days'
     AND (s.status NOT IN ('ok', 'partial')
          OR EXISTS (SELECT 1 FROM public.gbp_snapshots t
                      WHERE t.client_id = s.client_id AND t.status IN ('ok', 'partial') AND t.id <> s.id
                        AND COALESCE(t.captured_at, t.created_at) > COALESCE(s.captured_at, s.created_at)));
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('snapshots_deleted', n);

  -- d) Toạ độ lấy từ Places API > 30 ngày: xoá (lần sau cần sẽ tự lấy lại)
  UPDATE public.clients
     SET latitude = NULL, longitude = NULL, latlng_source = NULL, latlng_cached_at = NULL
   WHERE latlng_source = 'places' AND latlng_cached_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('places_latlng_cleared', n);

  -- e) Tên người viết review: bỏ sau 90 ngày khi đã xử lý xong, hoặc sau 365 ngày trong mọi trường hợp
  UPDATE public.client_reviews
     SET author_name = NULL
   WHERE author_name IS NOT NULL
     AND ((status IN ('posted', 'manual_copied', 'ignored', 'replied_elsewhere')
           AND COALESCE(status_changed_at, updated_at, created_at) < now() - interval '90 days')
          OR COALESCE(first_seen_at, created_at) < now() - interval '365 days');
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('review_authors_cleared', n);

  -- f) Lead demo: bỏ IP thô sau 30 ngày (giữ ip_hash chống spam); xoá lead > 730 ngày
  UPDATE public.demo_leads SET raw = raw - 'ip'
   WHERE raw ? 'ip' AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('lead_ip_cleared', n);
  DELETE FROM public.demo_leads WHERE created_at < now() - interval '730 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('leads_deleted', n);

  -- g) Yêu cầu tư vấn đã đóng > 730 ngày: ẩn danh thông tin liên hệ
  UPDATE public.consultation_requests
     SET contact_name = '[đã ẩn danh]', phone = '[ẩn danh]', email = NULL, message = NULL, updated_at = now()
   WHERE status IN ('won', 'lost') AND created_at < now() - interval '730 days' AND contact_name <> '[đã ẩn danh]';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('consultations_anonymized', n);

  -- h) Cache AI > 30 ngày
  DELETE FROM public.ai_classification_cache WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('ai_cache_deleted', n);

  -- i) Nhật ký kỹ thuật > 365 ngày
  DELETE FROM public.autopost_log WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('autopost_log_deleted', n);
  DELETE FROM public.review_reply_log WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('review_reply_log_deleted', n);
  DELETE FROM public.review_draft_events WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('review_draft_events_deleted', n);
  DELETE FROM public.ai_usage_events WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('ai_usage_events_deleted', n);
  DELETE FROM public.audit_quota_events WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('audit_quota_events_deleted', n);

  -- j) Bằng chứng đồng ý / hồ sơ yêu cầu của tài khoản đã xoá > 5 năm
  DELETE FROM public.consent_records WHERE subject_deleted_at < now() - interval '5 years';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('consent_records_deleted', n);
  DELETE FROM public.data_requests
   WHERE status IN ('done', 'cancelled', 'rejected') AND COALESCE(completed_at, cancelled_at, received_at) < now() - interval '5 years';
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('data_requests_deleted', n);

  DELETE FROM public.privacy_retention_runs WHERE ran_at < now() - interval '365 days';
  INSERT INTO public.privacy_retention_runs (result) VALUES (out);
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION public.run_privacy_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_privacy_retention() TO service_role;

-- 5) Ẩn danh phần còn lại khi xoá tài khoản (gọi TRƯỚC auth.admin.deleteUser) ---------------------------
CREATE OR REPLACE FUNCTION public.privacy_scrub_user(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a integer; b integer;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'privacy_scrub_user: thiếu user'; END IF;
  UPDATE public.consultation_requests
     SET contact_name = '[đã ẩn danh]', phone = '[ẩn danh]', email = NULL, message = NULL, updated_at = now()
   WHERE user_id = p_user AND contact_name <> '[đã ẩn danh]';
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE public.consent_records SET ip = NULL, user_agent = NULL, subject_deleted_at = now()
   WHERE user_id = p_user AND subject_deleted_at IS NULL;
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN jsonb_build_object('consultations_anonymized', a, 'consent_records_marked', b);
END $$;
REVOKE EXECUTE ON FUNCTION public.privacy_scrub_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.privacy_scrub_user(uuid) TO service_role;

COMMENT ON TABLE public.consent_records IS 'Bằng chứng đồng ý xử lý DLCN theo từng mục đích (Luật 91/2025 Điều 9; NĐ 356/2025 Điều 6). Chỉ service_role ghi.';
COMMENT ON TABLE public.data_requests IS 'Yêu cầu của chủ thể dữ liệu và hạn xử lý theo NĐ 356/2025 Điều 5.';
COMMENT ON TABLE public.privacy_retention_runs IS 'Nhật ký mỗi lần chạy run_privacy_retention() (cron hằng ngày).';
