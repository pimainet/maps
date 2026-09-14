-- ============================================================
-- Migration 009: Bảng gbp_snapshots (chính thức hoá)
--
-- VẤN ĐỀ PHÁT HIỆN: lib/gbp-snapshots.ts và app/api/gbp-snapshot/route.ts
-- đã dùng bảng `gbp_snapshots` từ trước, nhưng KHÔNG có migration nào
-- tạo ra bảng này — nghĩa là bảng tồn tại ngoài Supabase dashboard,
-- không tái tạo được từ source code, và không có RLS nào được khai báo
-- ở đây (không rõ đã bật RLS thật hay chưa trên bảng sống).
--
-- Migration này tạo bảng ĐÚNG theo field đã định nghĩa ở
-- lib/gbp-snapshot-types.ts (GbpSnapshotPayload) — dùng IF NOT EXISTS
-- cho từng cột/index nên chạy an toàn dù bảng đã tồn tại sẵn trên
-- Supabase thật (không làm mất dữ liệu cũ, chỉ bổ sung cột/RLS còn
-- thiếu nếu có).
--
-- Bảng này cũng là nền tảng cho báo cáo trước/sau (before/after) theo
-- từng chu kỳ 30 ngày — mỗi lần audit/tự-điền đều tạo 1 snapshot có
-- rating + review_count + captured_at, nên so sánh được theo thời gian.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gbp_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  place_id text,
  maps_url text,
  source text NOT NULL DEFAULT 'browser',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ok', 'partial', 'failed')),
  error_message text,
  captured_at timestamptz,
  business_name text,
  description text,
  primary_category text,
  rating numeric,
  review_count integer,
  phone text,
  website_url text,
  address_text text,
  posts_signal text,
  recent_posts jsonb,
  photos_signal text,
  photos_count_est integer,
  competitors jsonb,
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- getLatestSnapshotForClient() order theo (client_id, workspace_id, captured_at desc, created_at desc)
CREATE INDEX IF NOT EXISTS gbp_snapshots_client_captured_idx
  ON public.gbp_snapshots (client_id, workspace_id, captured_at DESC NULLS LAST, created_at DESC);

ALTER TABLE public.gbp_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view workspace snapshots" ON public.gbp_snapshots;
CREATE POLICY "Members can view workspace snapshots"
  ON public.gbp_snapshots FOR SELECT
  USING (is_superadmin() OR is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can create workspace snapshots" ON public.gbp_snapshots;
CREATE POLICY "Members can create workspace snapshots"
  ON public.gbp_snapshots FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can update workspace snapshots" ON public.gbp_snapshots;
CREATE POLICY "Members can update workspace snapshots"
  ON public.gbp_snapshots FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));
