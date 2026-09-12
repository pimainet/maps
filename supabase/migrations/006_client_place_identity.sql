-- ============================================================
-- Migration 006: Định danh Google Place cho clients
-- - place_id: ID ổn định từ Google Places
-- - gbp_link_normalized: link đã chuẩn hóa để so khớp khi thiếu place_id
-- Unique trong từng workspace (chỉ khi có giá trị)
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS gbp_link_normalized text;

CREATE INDEX IF NOT EXISTS idx_clients_workspace_place_id
  ON public.clients (workspace_id, place_id)
  WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_workspace_gbp_norm
  ON public.clients (workspace_id, gbp_link_normalized)
  WHERE gbp_link_normalized IS NOT NULL;

-- Một place_id chỉ gắn 1 client trong cùng workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_workspace_place_id
  ON public.clients (workspace_id, place_id)
  WHERE place_id IS NOT NULL;

-- Một link chuẩn hóa chỉ gắn 1 client trong cùng workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_workspace_gbp_norm
  ON public.clients (workspace_id, gbp_link_normalized)
  WHERE gbp_link_normalized IS NOT NULL;
