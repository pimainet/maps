-- ============================================================
-- Migration 005: Giới hạn số doanh nghiệp (clients) mỗi workspace
--
-- Mô hình thương mại: mỗi khách trả tiền = 1 workspace = quản lý ĐÚNG
-- 1 doanh nghiệp (mặc định). Agency/owner cần quản lý nhiều doanh
-- nghiệp thì set max_clients cao hơn cho workspace của họ. Sau này
-- bán gói multi-location chỉ cần tăng số này cho khách đó.
-- ============================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS max_clients integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.workspace_client_count(ws_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int FROM public.clients WHERE workspace_id = ws_id;
$$;

-- Cập nhật lại policy INSERT của clients: cộng thêm điều kiện chưa
-- vượt giới hạn max_clients của workspace (Super Admin không bị giới hạn)
DROP POLICY IF EXISTS "Workspace members can insert clients" ON public.clients;
CREATE POLICY "Workspace members can insert clients"
  ON public.clients FOR INSERT
  WITH CHECK (
    is_superadmin()
    OR (
      is_workspace_member(workspace_id)
      AND public.workspace_client_count(workspace_id) <
          (SELECT max_clients FROM public.workspaces WHERE id = workspace_id)
    )
  );

-- Cách nâng giới hạn cho 1 workspace (VD: workspace của bạn — agency):
-- UPDATE public.workspaces SET max_clients = 999, plan = 'agency'
-- WHERE id = '<workspace_id của bạn>';
