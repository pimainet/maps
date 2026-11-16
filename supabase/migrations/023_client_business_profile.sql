-- Migration 023: hồ sơ doanh nghiệp do AI đoán và CHỦ QUÁN XÁC NHẬN + mô tả mẫu.
--
-- Mỗi doanh nghiệp 1 dòng. `confirmed = false` nghĩa là mới chỉ là AI đoán (chưa dùng để viết mô tả).
-- `place_key` ghi lại hồ sơ Maps lúc xác nhận: đổi sang địa điểm khác thì hồ sơ cũ không còn áp dụng (xem lib/business-profile-store.ts).
-- Thành viên workspace đọc/ghi qua RLS (cùng kiểu các bảng khác). An toàn chạy lại nhiều lần.
-- Chưa chạy migration này thì audit vẫn chạy bình thường, chỉ chưa lưu được xác nhận.

CREATE TABLE IF NOT EXISTS public.client_business_profiles (
  client_id     uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  place_key     text,
  summary       text NOT NULL,
  main_service  text NOT NULL,
  services      jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence    text NOT NULL DEFAULT 'low' CHECK (confidence IN ('high', 'medium', 'low')),
  confirmed     boolean NOT NULL DEFAULT false,
  confirmed_at  timestamptz,
  drafts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  drafts_at     timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_business_profiles_ws ON public.client_business_profiles (workspace_id);

ALTER TABLE public.client_business_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read business profiles" ON public.client_business_profiles;
CREATE POLICY "Members can read business profiles"
  ON public.client_business_profiles FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can insert business profiles" ON public.client_business_profiles;
CREATE POLICY "Members can insert business profiles"
  ON public.client_business_profiles FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can update business profiles" ON public.client_business_profiles;
CREATE POLICY "Members can update business profiles"
  ON public.client_business_profiles FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

GRANT SELECT, INSERT, UPDATE ON public.client_business_profiles TO authenticated;
