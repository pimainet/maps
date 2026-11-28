-- 036: tối ưu hiệu năng theo Supabase performance advisor. Không đổi quyền truy cập thực tế.
-- Idempotent, chạy lại an toàn. Bảng còn nhỏ nên CREATE INDEX thường (không CONCURRENTLY) khóa rất ngắn.

-- 1) Index cho 24 khóa ngoại chưa có index (xóa/cascade bảng cha khỏi phải quét cả bảng con) ----------
CREATE INDEX IF NOT EXISTS idx_autopost_log_photo_id                ON public.autopost_log (photo_id);
CREATE INDEX IF NOT EXISTS idx_autopost_log_queue_id                ON public.autopost_log (queue_id);
CREATE INDEX IF NOT EXISTS idx_autopost_log_workspace_id            ON public.autopost_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_autopost_queue_content_id            ON public.autopost_queue (content_id);
CREATE INDEX IF NOT EXISTS idx_autopost_queue_photo_id              ON public.autopost_queue (photo_id);
CREATE INDEX IF NOT EXISTS idx_client_photos_duplicate_of           ON public.client_photos (duplicate_of);
CREATE INDEX IF NOT EXISTS idx_client_photos_uploaded_by            ON public.client_photos (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_client_reviews_task_id               ON public.client_reviews (task_id);
CREATE INDEX IF NOT EXISTS idx_content_history_client_id            ON public.content_history (client_id);
CREATE INDEX IF NOT EXISTS idx_content_history_workspace_id         ON public.content_history (workspace_id);
CREATE INDEX IF NOT EXISTS idx_contents_task_id                     ON public.contents (task_id);
CREATE INDEX IF NOT EXISTS idx_cycles_client_id                     ON public.cycles (client_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id                     ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS idx_plans_audit_id                       ON public.plans (audit_id);
CREATE INDEX IF NOT EXISTS idx_rank_scan_competitors_workspace_id   ON public.rank_scan_competitors (workspace_id);
CREATE INDEX IF NOT EXISTS idx_rank_scan_points_client_id           ON public.rank_scan_points (client_id);
CREATE INDEX IF NOT EXISTS idx_rank_scan_points_workspace_id        ON public.rank_scan_points (workspace_id);
CREATE INDEX IF NOT EXISTS idx_rank_scans_keyword_id                ON public.rank_scans (keyword_id);
CREATE INDEX IF NOT EXISTS idx_rank_scans_requested_by              ON public.rank_scans (requested_by);
CREATE INDEX IF NOT EXISTS idx_review_draft_events_client_id        ON public.review_draft_events (client_id);
CREATE INDEX IF NOT EXISTS idx_review_draft_events_review_id        ON public.review_draft_events (review_id);
CREATE INDEX IF NOT EXISTS idx_review_reply_log_client_id           ON public.review_reply_log (client_id);
CREATE INDEX IF NOT EXISTS idx_review_reply_log_workspace_id        ON public.review_reply_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_review_watch_state_workspace_id      ON public.review_watch_state (workspace_id);

-- 2) Index trùng trên workspace_members (giữ idx_workspace_members_user / _ws và unique gốc của bảng) -------
DROP INDEX IF EXISTS public.idx_workspace_members_user_id;
DROP INDEX IF EXISTS public.idx_workspace_members_workspace_id;
ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_workspace_user_unique;

-- 3) auth.uid() -> (select auth.uid()) để Postgres tính 1 lần/truy vấn thay vì mỗi dòng (auth_rls_initplan) ------
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO public
  USING (
    id = (select auth.uid())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members me
      JOIN public.workspace_members them ON them.workspace_id = me.workspace_id
      WHERE me.user_id = (select auth.uid()) AND them.user_id = profiles.id
    )
  );

DROP POLICY IF EXISTS "Members can log their own AI usage" ON public.ai_usage_events;
CREATE POLICY "Members can log their own AI usage" ON public.ai_usage_events
  FOR INSERT TO public
  WITH CHECK (user_id = (select auth.uid()) AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can view own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users can view own notification prefs" ON public.notification_prefs
  FOR SELECT TO public USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "Users can create own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users can create own notification prefs" ON public.notification_prefs
  FOR INSERT TO public WITH CHECK (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "Users can update own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users can update own notification prefs" ON public.notification_prefs
  FOR UPDATE TO public USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- Policy DELETE cũ so sánh nhầm workspace_members.workspace_id = workspace_members.id (luôn sai). Người dùng
-- vốn không có quyền DELETE trên workspaces (migration 019) nên sửa điều kiện không đổi hành vi thực tế.
DROP POLICY IF EXISTS "Workspace owners can delete" ON public.workspaces;
CREATE POLICY "Workspace owners can delete" ON public.workspaces
  FOR DELETE TO public
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = workspaces.id AND m.user_id = (select auth.uid()) AND m.role = 'owner'
    )
  );

-- 4) clients UPDATE có 2 policy permissive; "admins" nằm gọn trong "members" (admin cũng là member) -> bỏ bản thừa.
--    Cột được sửa vẫn bị giới hạn bằng GRANT UPDATE theo cột (migration 019).
DROP POLICY IF EXISTS "Workspace admins can update clients" ON public.clients;
