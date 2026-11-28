-- Migration 029: Hộp thư review (Review Inbox) — thay thế 018_review_watch.sql.
--
-- Vì sao có file mới thay vì chạy 018:
--   - 018 chưa từng chạy trên DB thật (kiểm tra 28/11/2026: không có review_watch_state / review_alerts).
--   - 018 chỉ lưu "đã thấy review" (review_alerts) — không có bản ghi từng review để xem / sửa / duyệt / đăng phản hồi.
--   - Khoá review_key của 018 = hash(review_id của từng nguồn + tên + ngày...) nên cùng 1 review lấy từ Outscraper
--     và SerpApi/SearchApi ra 2 khoá khác nhau -> có thể tạo việc trùng.
--
-- File này:
--   1. review_watch_state  : giữ nguyên cột của 018 (CREATE IF NOT EXISTS) + thêm cột mới (ADD COLUMN IF NOT EXISTS).
--   2. client_reviews      : MỖI REVIEW 1 DÒNG, khoá (client_id, review_key) với review_key = dấu vân tay chung mọi nguồn
--                            (lib/reviews/normalize.ts). Có cảm xúc / mức khẩn, bản nháp AI, vòng đời phản hồi
--                            new -> drafted -> approved -> posting -> posted | manual_copied | ignored | replied_elsewhere | failed.
--   3. review_draft_events : đếm lượt soạn nháp AI theo tháng (chặn chi phí theo gói). Không dùng ai_usage_events vì cột
--                            user_id NOT NULL mà cron không có user.
--   4. review_reply_log    : nhật ký kết quả đăng phản hồi qua Make (giống autopost_log).
--   5. clients.review_link_token : link duyệt phản hồi không cần đăng nhập cho chủ quán (/r/<token>).
--   6. Nếu 018 đã lỡ chạy ở môi trường nào đó: chép review_alerts sang client_reviews (source 'legacy'), KHÔNG xoá bảng cũ.
--
-- Ghi bằng service role từ server (API đã kiểm tra workspace). Thành viên workspace chỉ được ĐỌC qua RLS.
-- An toàn chạy lại nhiều lần (idempotent). Chưa chạy migration này thì phần còn lại của app vẫn chạy bình thường.

-- ---------------------------------------------------------------------------
-- 1. review_watch_state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_watch_state (
  client_id         uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  last_checked_at   timestamptz,
  last_rating       numeric,
  last_review_count integer,
  last_new_reviews  integer NOT NULL DEFAULT 0,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_watch_state
  ADD COLUMN IF NOT EXISTS last_source           text,
  ADD COLUMN IF NOT EXISTS last_refresh_at       timestamptz,   -- lần quét lại cửa sổ review còn mở (bắt phản hồi làm ngoài hệ thống)
  ADD COLUMN IF NOT EXISTS gbp_synced_at         timestamptz,   -- lần Make đồng bộ danh sách review từ Business Profile API
  ADD COLUMN IF NOT EXISTS gbp_sync_error        text,
  ADD COLUMN IF NOT EXISTS checks_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_fetched_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_checks_month   text,          -- 'YYYY-MM' (giờ VN) của bộ đếm "Kiểm tra ngay"
  ADD COLUMN IF NOT EXISTS manual_checks_count   integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. client_reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  review_key         text NOT NULL,
  source             text NOT NULL,
  source_review_id   text,
  gbp_review_name    text,          -- accounts/{a}/locations/{l}/reviews/{r} — chỉ có sau khi Make đồng bộ GBP API
  author_name        text,
  rating             smallint NOT NULL,
  review_text        text,
  reviewed_at        timestamptz,
  reviewed_at_exact  boolean NOT NULL DEFAULT false,
  relative_time      text,
  owner_reply        text,          -- phản hồi ĐANG hiện trên Google (do nguồn dữ liệu thấy)
  owner_reply_at     timestamptz,
  reply_source       text,
  sentiment          text,
  urgency            text NOT NULL DEFAULT 'normal',
  topics             text[] NOT NULL DEFAULT '{}',
  ai_summary         text,
  draft_reply        text,
  draft_warnings     text[] NOT NULL DEFAULT '{}',
  drafted_at         timestamptz,
  draft_count        integer NOT NULL DEFAULT 0,
  final_reply        text,          -- nội dung đã sửa / đã duyệt để dán hoặc đăng
  approved_at        timestamptz,
  approved_by        uuid,
  approved_via       text,
  status             text NOT NULL DEFAULT 'new',
  status_changed_at  timestamptz NOT NULL DEFAULT now(),
  post_attempts      integer NOT NULL DEFAULT 0,
  posting_locked_at  timestamptz,
  posted_at          timestamptz,
  gbp_reply_state    text,          -- PENDING / APPROVED / REJECTED (kiểm duyệt của Google)
  post_error         text,
  task_id            uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Ràng buộc đặt tên riêng để chạy lại không lỗi
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_client_key_uniq') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_client_key_uniq UNIQUE (client_id, review_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_rating_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_rating_chk CHECK (rating BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_source_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_source_chk
      CHECK (source IN ('outscraper', 'serpapi', 'searchapi', 'gbp', 'snapshot', 'legacy'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_status_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_status_chk
      CHECK (status IN ('new', 'drafted', 'approved', 'posting', 'posted', 'manual_copied', 'ignored', 'replied_elsewhere', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_sentiment_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_sentiment_chk
      CHECK (sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative', 'mixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_urgency_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_urgency_chk CHECK (urgency IN ('high', 'normal', 'low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_approved_via_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_approved_via_chk
      CHECK (approved_via IS NULL OR approved_via IN ('dashboard', 'owner_link'));
  END IF;
  -- Google giới hạn phản hồi 4096 byte
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_reviews_final_reply_len_chk') THEN
    ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_final_reply_len_chk
      CHECK (final_reply IS NULL OR octet_length(final_reply) <= 4096);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_reviews_client_time   ON public.client_reviews (client_id, reviewed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_client_reviews_ws_status     ON public.client_reviews (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_client_reviews_to_post       ON public.client_reviews (approved_at) WHERE status IN ('approved', 'posting');
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_reviews_gbp_name ON public.client_reviews (gbp_review_name) WHERE gbp_review_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.review_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_reviews_touch ON public.client_reviews;
CREATE TRIGGER trg_client_reviews_touch
  BEFORE UPDATE ON public.client_reviews
  FOR EACH ROW EXECUTE FUNCTION public.review_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. review_draft_events — đếm lượt soạn nháp AI (chặn chi phí theo gói)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_draft_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  review_id     uuid REFERENCES public.client_reviews(id) ON DELETE SET NULL,
  kind          text NOT NULL DEFAULT 'auto',
  created_at    timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_draft_events_kind_chk') THEN
    ALTER TABLE public.review_draft_events ADD CONSTRAINT review_draft_events_kind_chk CHECK (kind IN ('auto', 'manual', 'owner'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_review_draft_events_ws_time ON public.review_draft_events (workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. review_reply_log — kết quả đăng phản hồi qua Make
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_reply_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  review_id         uuid REFERENCES public.client_reviews(id) ON DELETE SET NULL,
  success           boolean NOT NULL,
  http_status       integer,
  reply_state       text,
  error_code        text,
  error_message     text,
  make_execution_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_reply_log_review ON public.review_reply_log (review_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Link duyệt cho chủ quán
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS review_link_token text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_review_link_token ON public.clients (review_link_token) WHERE review_link_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Chép dữ liệu cũ của 018 (nếu có) — không xoá review_alerts
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.review_alerts') IS NOT NULL THEN
    INSERT INTO public.client_reviews (
      workspace_id, client_id, review_key, source, rating, review_text, reviewed_at, reviewed_at_exact,
      owner_reply, draft_reply, drafted_at, status, urgency, task_id, first_seen_at, last_seen_at, created_at
    )
    SELECT a.workspace_id, a.client_id, 'legacy:' || a.review_key, 'legacy',
           LEAST(GREATEST(a.rating, 1), 5), a.review_text, a.reviewed_at, a.reviewed_at IS NOT NULL,
           NULL, a.draft_reply, CASE WHEN a.draft_reply IS NOT NULL THEN a.created_at END,
           CASE WHEN a.has_reply IS TRUE THEN 'replied_elsewhere'
                WHEN a.draft_reply IS NOT NULL THEN 'drafted'
                ELSE 'new' END,
           CASE WHEN a.rating <= 2 THEN 'high' WHEN a.rating = 3 THEN 'normal' ELSE 'low' END,
           a.task_id, a.created_at, a.created_at, a.created_at
    FROM public.review_alerts a
    ON CONFLICT (client_id, review_key) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: thành viên workspace chỉ đọc; mọi ghi đi qua server (service role).
-- ---------------------------------------------------------------------------
ALTER TABLE public.review_watch_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reviews      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_draft_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_reply_log    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read review watch state" ON public.review_watch_state;
CREATE POLICY "Members can read review watch state"
  ON public.review_watch_state FOR SELECT
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can read client reviews" ON public.client_reviews;
CREATE POLICY "Members can read client reviews"
  ON public.client_reviews FOR SELECT
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can read review draft events" ON public.review_draft_events;
CREATE POLICY "Members can read review draft events"
  ON public.review_draft_events FOR SELECT
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can read review reply log" ON public.review_reply_log;
CREATE POLICY "Members can read review reply log"
  ON public.review_reply_log FOR SELECT
  USING (public.is_workspace_member(workspace_id));

-- Không cấp quyền ghi cho anon/authenticated (mặc định Supabase cấp ALL cho bảng public; RLS không có policy ghi
-- nên ghi bị chặn, nhưng thu hồi thêm cho chắc).
REVOKE INSERT, UPDATE, DELETE ON public.client_reviews, public.review_watch_state, public.review_draft_events, public.review_reply_log
  FROM anon, authenticated;
