-- ============================================================
-- Migration 014: ngày hoàn thành việc + tùy chọn nhắc việc qua email
-- Idempotent: chạy lại bao nhiêu lần cũng an toàn.
--
-- 1) tasks.completed_at — để hiện "tuần này bạn đã xong N việc" và đưa vào
--    email nhắc. Việc đã xong từ trước migration này sẽ để trống (không
--    bịa ngày), giao diện tự bỏ qua dòng "tuần này" nếu chưa có dữ liệu.
--    App vẫn chạy bình thường nếu CHƯA chạy migration này (xem
--    updateTaskStatus trong lib/db.ts).
--
-- 2) notification_prefs — mỗi người dùng 1 dòng. Không có dòng = mặc định
--    BẬT nhắc việc (người dùng tắt được trong Cài đặt hoặc bằng link trong
--    email). last_sent_at để cron không gửi 2 lần trong cùng 1 ngày.
-- ============================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_completed_at
  ON public.tasks (workspace_id, completed_at)
  WHERE completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  last_sent_at  timestamptz,
  last_test_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users can view own notification prefs"
  ON public.notification_prefs FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users can create own notification prefs"
  ON public.notification_prefs FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users can update own notification prefs"
  ON public.notification_prefs FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS last_test_at timestamptz;

-- Cron gửi email dùng service role (bỏ qua RLS) nên không cần policy riêng.
