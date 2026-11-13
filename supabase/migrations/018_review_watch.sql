-- Migration 018: Review Watch — theo dõi review mới hàng tuần và tự tạo việc phản hồi.
--
-- - review_watch_state: mỗi doanh nghiệp 1 dòng, nhớ lần kiểm tra gần nhất (làm mốc `cutoff` cho Outscraper)
--   và sao/số review lúc đó (để vẽ xu hướng sau này).
-- - review_alerts: mỗi review đã được xử lý 1 dòng (khóa review_key) để không tạo việc trùng.
--
-- Cron ghi bằng service role (bỏ qua RLS). Thành viên workspace chỉ được ĐỌC.
-- An toàn chạy lại nhiều lần. Chưa chạy migration này thì app khác vẫn hoạt động, chỉ Review Watch không chạy.

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

CREATE TABLE IF NOT EXISTS public.review_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  review_key    text NOT NULL,
  rating        integer NOT NULL,
  review_text   text,
  reviewed_at   timestamptz,
  has_reply     boolean,
  draft_reply   text,
  task_id       uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, review_key)
);

CREATE INDEX IF NOT EXISTS idx_review_alerts_workspace ON public.review_alerts (workspace_id, created_at DESC);

ALTER TABLE public.review_watch_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read review watch state" ON public.review_watch_state;
CREATE POLICY "Members can read review watch state"
  ON public.review_watch_state FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can read review alerts" ON public.review_alerts;
CREATE POLICY "Members can read review alerts"
  ON public.review_alerts FOR SELECT
  USING (is_workspace_member(workspace_id));
