-- ============================================================
-- Migration 008: Rate limit cho các API gọi AI (Claude)
--
-- VẤN ĐỀ: /api/audit, /api/content, /api/plan,
-- /api/tasks/generate-from-plan, /api/gbp-snapshot đều gọi Claude API
-- (tốn tiền thật mỗi lần gọi) nhưng trước đây không có gì chặn số lần
-- gọi. Một user đăng nhập (vô tình double-click, hoặc cố ý viết script)
-- có thể spam các endpoint này và làm phát sinh chi phí AI không kiểm
-- soát được.
--
-- GIẢI PHÁP: ghi lại mỗi lần gọi AI vào bảng ai_usage_events, sau đó
-- app code (lib/rate-limit.ts) đếm số lần gọi trong 1 khoảng thời gian
-- gần đây (theo user VÀ theo workspace) trước khi cho phép gọi tiếp.
-- Đếm bằng 1 SECURITY DEFINER function để nhanh và nhất quán, theo
-- đúng pattern đã dùng ở migration 005 (workspace_client_count).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_workspace_window_idx
  ON public.ai_usage_events (workspace_id, endpoint, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_window_idx
  ON public.ai_usage_events (user_id, endpoint, created_at);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Thành viên workspace ghi nhận lượt gọi của chính mình
DROP POLICY IF EXISTS "Members can log their own AI usage" ON public.ai_usage_events;
CREATE POLICY "Members can log their own AI usage"
  ON public.ai_usage_events FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND is_workspace_member(workspace_id)
  );

-- Thành viên workspace xem được lượt gọi trong workspace của mình (để
-- đếm rate limit phía app; Super Admin xem được tất cả)
DROP POLICY IF EXISTS "Members can view their workspace AI usage" ON public.ai_usage_events;
CREATE POLICY "Members can view their workspace AI usage"
  ON public.ai_usage_events FOR SELECT
  USING (is_superadmin() OR is_workspace_member(workspace_id));

-- Đếm số lượt gọi 1 endpoint, trong N phút gần nhất, theo workspace
-- hoặc theo user (tuỳ tham số nào được truyền — truyền NULL cho tham
-- số không cần lọc).
CREATE OR REPLACE FUNCTION public.count_ai_usage(
  p_workspace_id uuid,
  p_user_id uuid,
  p_endpoint text,
  p_since timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int
  FROM public.ai_usage_events
  WHERE endpoint = p_endpoint
    AND created_at >= p_since
    AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    AND (p_user_id IS NULL OR user_id = p_user_id);
$$;
