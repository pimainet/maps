-- 034: hạn mức điểm lưới mini 5x5 chạy kèm audit (lib/rankgrid/mini-grid.ts), tách riêng khỏi hạn mức lưới thứ hạng của gói
-- (rank_usage) để audit không ăn vào lượt quét theo lịch của khách. Giữ chỗ nguyên tử theo workspace + tháng (giờ VN).
-- Chưa áp migration này thì lưới mini tự tắt an toàn (giữ chỗ lỗi -> VY04 "chưa đủ dữ liệu").

CREATE TABLE IF NOT EXISTS public.audit_minigrid_usage (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  period_start date NOT NULL,       -- ngày 1 của tháng (giờ VN)
  points_reserved int NOT NULL DEFAULT 0 CHECK (points_reserved >= 0),
  cost_usd numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_start)
);

CREATE OR REPLACE FUNCTION public.audit_minigrid_reserve(p_workspace_id uuid, p_period_start date, p_points int, p_limit int, p_cost_usd numeric DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_points <= 0 THEN RETURN false; END IF;
  INSERT INTO audit_minigrid_usage (workspace_id, period_start) VALUES (p_workspace_id, p_period_start)
  ON CONFLICT (workspace_id, period_start) DO NOTHING;
  UPDATE audit_minigrid_usage SET points_reserved = points_reserved + p_points,
                                  cost_usd = cost_usd + coalesce(p_cost_usd, 0),
                                  updated_at = now()
   WHERE workspace_id = p_workspace_id AND period_start = p_period_start
     AND points_reserved + p_points <= p_limit
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END $$;

CREATE OR REPLACE FUNCTION public.audit_minigrid_release(p_workspace_id uuid, p_period_start date, p_points int, p_cost_usd numeric DEFAULT 0)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE audit_minigrid_usage SET points_reserved = greatest(0, points_reserved - p_points),
                                  cost_usd = greatest(0, cost_usd - coalesce(p_cost_usd, 0)),
                                  updated_at = now()
   WHERE workspace_id = p_workspace_id AND period_start = p_period_start;
$$;

ALTER TABLE public.audit_minigrid_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view audit minigrid usage" ON public.audit_minigrid_usage;
CREATE POLICY "Members can view audit minigrid usage" ON public.audit_minigrid_usage
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON public.audit_minigrid_usage FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.audit_minigrid_reserve(uuid, date, int, int, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_minigrid_release(uuid, date, int, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_minigrid_reserve(uuid, date, int, int, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_minigrid_release(uuid, date, int, numeric) TO service_role;
