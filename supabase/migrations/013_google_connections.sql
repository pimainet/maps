-- ============================================================
-- Migration 013: google_connections
--
-- Lưu kết nối Google Business Profile của từng client — self-serve: CHÍNH
-- chủ doanh nghiệp (người dùng ứng dụng) cấp quyền cho ứng dụng của họ,
-- KHÔNG phải agency quản lý hộ nhiều tài khoản khách. Tách biệt hoàn toàn
-- khỏi Supabase Auth (auth.users) — đây là OAuth token riêng để GỌI
-- Business Profile API (đăng bài, đọc/trả lời review...), không phải để
-- đăng nhập vào ứng dụng.
--
-- Token mã hoá tại application layer (AES-256-GCM, xem lib/google-oauth.ts
-- encryptToken()/decryptToken()) trước khi lưu — cột chỉ chứa ciphertext.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  google_account_email text,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  scope text NOT NULL,
  expires_at timestamptz NOT NULL,
  -- accounts/{accountId}/locations/{locationId} — định danh địa điểm trên
  -- Business Profile API, cache lại sau khi kết nối để khỏi gọi accounts.list
  -- + accounts.locations.list lại mỗi lần đăng bài.
  gbp_account_resource text,
  gbp_location_resource text,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS google_connections_workspace_idx
  ON public.google_connections (workspace_id);

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view workspace google connections" ON public.google_connections;
CREATE POLICY "Members can view workspace google connections"
  ON public.google_connections FOR SELECT
  USING (is_superadmin() OR is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can create workspace google connections" ON public.google_connections;
CREATE POLICY "Members can create workspace google connections"
  ON public.google_connections FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can update workspace google connections" ON public.google_connections;
CREATE POLICY "Members can update workspace google connections"
  ON public.google_connections FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can delete workspace google connections" ON public.google_connections;
CREATE POLICY "Members can delete workspace google connections"
  ON public.google_connections FOR DELETE
  USING (is_workspace_member(workspace_id));

COMMENT ON TABLE public.google_connections IS
  'OAuth connection toi Business Profile API cua tung client, do chinh khach (chu doanh nghiep) cap quyen qua /api/google-connect. Token ma hoa tai application layer.';
