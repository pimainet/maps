-- ============================================================
-- Migration 027: Lưới thứ hạng (geo-grid rank tracker) + bản đồ nhiệt  (CHƯA CHẠY LÊN PROD)
--
-- Hạn mức theo gói nằm ở lib/billing/plans.ts (ENTITLEMENTS.*.rankGrid), không nằm trong DB:
--   Miễn phí: 1 lần quét thử (5x5, 1 từ khoá), không quét định kỳ.
--   Khởi động: 5x5, 5 từ khoá, 2 tuần/lần, 2 lần quét tay/tháng.
--   Nâng cao: 7x7 (cho chọn 9x9), 10 từ khoá, hàng tuần, 8 lần quét tay/tháng.
--
-- Luồng: rank_grid_configs (1 cấu hình lưới / khách) + rank_keywords (từ khoá theo dõi)
--   -> cron/“Quét ngay” tạo rank_scans (1 lần quét = 1 từ khoá x 1 lưới)
--   -> mỗi điểm lưới = 1 hàng rank_scan_points = 1 task DataForSEO Google Maps (location_coordinate)
--   -> pingback -> app lấy kết quả, ghi rank + top_places của điểm, upsert rank_scan_competitors
--   -> rankgrid_finalize_scan() tính ARP/ATRP/SoLV cho chính khách và cho mọi đối thủ.
--
-- Nguyên tắc giống 025:
--   * Mọi bảng có workspace_id + client_id; RLS SELECT = is_superadmin() OR is_workspace_member(workspace_id).
--   * authenticated chỉ ĐỌC. Mọi GHI đi qua route server (service_role) vì phải kiểm hạn mức theo gói.
--   * Hàm SECURITY DEFINER: SET search_path = public, REVOKE khỏi PUBLIC/anon/authenticated, GRANT service_role.
--   * Khớp doanh nghiệp bằng place_id / CID, KHÔNG bằng tên.
-- Idempotent, chạy lại an toàn.
-- ============================================================

-- 0) clients: thêm CID (place_id đã có từ 006) ---------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gbp_cid text;

-- 1) Cấu hình lưới, 1 hàng / khách ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.rank_grid_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  center_lat double precision NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng double precision NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  grid_size smallint NOT NULL DEFAULT 7 CHECK (grid_size IN (3,5,7,9)),
  spacing_m int NOT NULL DEFAULT 700 CHECK (spacing_m BETWEEN 200 AND 5000),  -- khoảng cách 2 điểm kề nhau
  shape text NOT NULL DEFAULT 'circle' CHECK (shape IN ('square','circle')),   -- circle: bỏ các góc ngoài bán kính
  zoom smallint NOT NULL DEFAULT 15 CHECK (zoom BETWEEN 11 AND 18),           -- giữ cố định để so sánh theo thời gian
  device text NOT NULL DEFAULT 'mobile' CHECK (device IN ('mobile','desktop')),
  language_code text NOT NULL DEFAULT 'vi',
  disabled_points smallint[] NOT NULL DEFAULT '{}',  -- chỉ số điểm (row*grid_size+col) trên biển / ngoài vùng phục vụ: không quét, không tốn tiền
  land_mask jsonb NOT NULL DEFAULT '{}'::jsonb,       -- kết quả kiểm tra điểm trên biển: {geom, checked:[idx], water:[idx]}; đổi hình học lưới thì kiểm lại
  frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly','biweekly','monthly','manual')),
  next_run_at timestamptz,
  target_place_id text,   -- chụp từ clients.place_id lúc tạo; khớp kết quả bằng place_id trước, CID sau
  target_cid text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rank_grid_configs_due ON public.rank_grid_configs (next_run_at) WHERE active;
CREATE INDEX IF NOT EXISTS idx_rank_grid_configs_ws ON public.rank_grid_configs (workspace_id);

-- 2) Từ khoá theo dõi ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rank_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  keyword text NOT NULL CHECK (char_length(keyword) BETWEEN 2 AND 80),
  keyword_norm text NOT NULL,      -- bỏ dấu, viết thường, gộp khoảng trắng (app tính) -> chống trùng
  is_primary boolean NOT NULL DEFAULT false,   -- từ khoá chính, dùng cho VY01/VY04
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','suggested','audit')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, keyword_norm)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rank_keywords_primary ON public.rank_keywords (client_id) WHERE is_primary AND active;
CREATE INDEX IF NOT EXISTS idx_rank_keywords_ws ON public.rank_keywords (workspace_id);

-- 3) Lần quét ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rank_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  keyword_id uuid REFERENCES public.rank_keywords(id) ON DELETE SET NULL,
  keyword text NOT NULL,                 -- chụp lại, không phụ thuộc keyword bị sửa/xoá
  config jsonb NOT NULL,                 -- chụp hình học lưới + zoom/device/lang + target lúc quét
  period_key text NOT NULL,              -- 'w:2026-W48' | 'b:2026-W48' | 'm:2026-11' | 'manual:<uuid>' -> idempotency
  trigger text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule','manual','onboarding','recheck')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'dataforseo' CHECK (provider IN ('dataforseo','serper','serpapi')),
  provider_mode text NOT NULL DEFAULT 'standard' CHECK (provider_mode IN ('standard','priority','live')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','partial','failed','cancelled')),
  points_total smallint NOT NULL DEFAULT 0,
  points_done smallint NOT NULL DEFAULT 0,
  points_failed smallint NOT NULL DEFAULT 0,
  cost_usd numeric(10,5) NOT NULL DEFAULT 0,
  -- Chỉ số của chính khách (null khi chưa xong)
  arp numeric(5,2),        -- hạng TB ở các điểm có mặt trong top 20
  atrp numeric(5,2),       -- hạng TB trên mọi điểm, ngoài top 20 = 21
  solv numeric(5,2),       -- % điểm nằm trong top 3
  top10_pct numeric(5,2),
  found_pct numeric(5,2),  -- % điểm có mặt trong top 20
  center_rank smallint,    -- hạng tại điểm giữa (gần quán nhất)
  competitors_found int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (client_id, keyword, period_key)
);
CREATE INDEX IF NOT EXISTS idx_rank_scans_client_kw ON public.rank_scans (client_id, keyword_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_scans_active ON public.rank_scans (status, created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_rank_scans_ws ON public.rank_scans (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_scans_ws_trigger ON public.rank_scans (workspace_id, trigger, created_at DESC);

-- 4) Điểm lưới -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rank_scan_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.rank_scans(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  idx smallint NOT NULL,            -- row*grid_size+col
  row_i smallint NOT NULL,
  col_i smallint NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','done','failed')),
  provider_task_id text UNIQUE,
  rank smallint CHECK (rank BETWEEN 1 AND 100),   -- null = không có trong top_places
  result_count smallint,
  top_places text[] NOT NULL DEFAULT '{}',        -- place_key theo thứ tự hạng, tối đa 20 (đã bỏ quảng cáo)
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  posted_at timestamptz,
  fetched_at timestamptz,
  UNIQUE (scan_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_rank_scan_points_pending ON public.rank_scan_points (status, posted_at) WHERE status IN ('pending','posted');

-- 5) Đối thủ theo từng lần quét (gồm cả chính khách, is_target) ---------------
-- place_key = place_id, hoặc 'cid:<cid>' nếu nguồn không trả place_id.
CREATE TABLE IF NOT EXISTS public.rank_scan_competitors (
  scan_id uuid NOT NULL REFERENCES public.rank_scans(id) ON DELETE CASCADE,
  place_key text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  place_id text,
  cid text,
  title text,
  category text,
  rating numeric(2,1),
  reviews_count int,
  lat double precision,
  lng double precision,
  is_target boolean NOT NULL DEFAULT false,
  appearances smallint NOT NULL DEFAULT 0,
  top3_count smallint NOT NULL DEFAULT 0,
  best_rank smallint,
  arp numeric(5,2),
  atrp numeric(5,2),
  solv numeric(5,2),
  PRIMARY KEY (scan_id, place_key)
);
CREATE INDEX IF NOT EXISTS idx_rank_scan_competitors_solv ON public.rank_scan_competitors (scan_id, solv DESC);
CREATE INDEX IF NOT EXISTS idx_rank_scan_competitors_client_place ON public.rank_scan_competitors (client_id, place_key);

-- 6) Sổ hạn mức điểm quét theo workspace / kỳ (credit guard) --------------------
CREATE TABLE IF NOT EXISTS public.rank_usage (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  period_start date NOT NULL,       -- ngày 1 của tháng (giờ VN)
  points_reserved int NOT NULL DEFAULT 0 CHECK (points_reserved >= 0),
  cost_usd numeric(10,5) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_start)
);

-- 7) Hàm --------------------------------------------------------------------------
-- Giữ chỗ p_points điểm nếu còn hạn mức (p_limit do server tính từ gói). Atomic, chống 2 request song song vượt hạn mức.
CREATE OR REPLACE FUNCTION public.rankgrid_reserve_points(p_workspace_id uuid, p_period_start date, p_points int, p_limit int, p_cost_usd numeric DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_points <= 0 THEN RETURN true; END IF;
  INSERT INTO rank_usage (workspace_id, period_start) VALUES (p_workspace_id, p_period_start)
  ON CONFLICT (workspace_id, period_start) DO NOTHING;
  UPDATE rank_usage SET points_reserved = points_reserved + p_points,
                        cost_usd = cost_usd + coalesce(p_cost_usd, 0),
                        updated_at = now()
   WHERE workspace_id = p_workspace_id AND period_start = p_period_start
     AND points_reserved + p_points <= p_limit
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END $$;

-- Trả lại điểm (và chi phí ước tính) khi task lỗi hẳn / huỷ quét.
CREATE OR REPLACE FUNCTION public.rankgrid_release_points(p_workspace_id uuid, p_period_start date, p_points int, p_cost_usd numeric DEFAULT 0)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE rank_usage SET points_reserved = greatest(0, points_reserved - p_points),
                        cost_usd = greatest(0, cost_usd - coalesce(p_cost_usd, 0)),
                        updated_at = now()
   WHERE workspace_id = p_workspace_id AND period_start = p_period_start;
$$;

-- Tính chỉ số khi mọi điểm đã xong/lỗi hẳn. Idempotent: gọi lại chỉ tính lại.
-- p_force = true: chốt luôn dù còn điểm treo (sweeper sau 2 giờ) — điểm treo tính là failed.
CREATE OR REPLACE FUNCTION public.rankgrid_finalize_scan(p_scan_id uuid, p_force boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_done int; v_failed int; v_open int; v_center int; v_status text; v_size int;
BEGIN
  SELECT points_total, (config->>'grid_size')::int INTO v_total, v_size FROM rank_scans WHERE id = p_scan_id FOR UPDATE;
  IF v_total IS NULL THEN RETURN 'not_found'; END IF;

  SELECT count(*) FILTER (WHERE status = 'done'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status IN ('pending','posted'))
    INTO v_done, v_failed, v_open
    FROM rank_scan_points WHERE scan_id = p_scan_id;

  IF v_open > 0 AND NOT p_force THEN
    UPDATE rank_scans SET points_done = v_done, points_failed = v_failed WHERE id = p_scan_id;
    RETURN 'running';
  END IF;
  IF p_force AND v_open > 0 THEN
    UPDATE rank_scan_points SET status = 'failed', last_error = coalesce(last_error, 'timeout')
     WHERE scan_id = p_scan_id AND status IN ('pending','posted');
    v_failed := v_failed + v_open;
  END IF;

  v_status := CASE WHEN v_done = 0 THEN 'failed'
                   WHEN v_failed = 0 THEN 'done'
                   WHEN v_done >= ceil(v_total * 0.8) THEN 'partial'
                   ELSE 'failed' END;

  v_center := (v_size * v_size) / 2;  -- chỉ số điểm giữa

  -- Chỉ số của chính khách (chỉ trên điểm đã xong). rank null hoặc > 20 => 21.
  UPDATE rank_scans s SET
    status = v_status,
    points_done = v_done,
    points_failed = v_failed,
    completed_at = now(),
    arp = m.arp, atrp = m.atrp, solv = m.solv, top10_pct = m.top10, found_pct = m.found,
    center_rank = (SELECT rank FROM rank_scan_points WHERE scan_id = p_scan_id AND idx = v_center AND status = 'done'),
    competitors_found = (SELECT count(*) FROM rank_scan_competitors c WHERE c.scan_id = p_scan_id AND NOT c.is_target)
  FROM (
    SELECT
      round(avg(rank) FILTER (WHERE rank <= 20), 2) AS arp,
      round(avg(CASE WHEN rank <= 20 THEN rank ELSE 21 END), 2) AS atrp,
      round(100.0 * count(*) FILTER (WHERE rank <= 3) / nullif(count(*), 0), 2) AS solv,
      round(100.0 * count(*) FILTER (WHERE rank <= 10) / nullif(count(*), 0), 2) AS top10,
      round(100.0 * count(*) FILTER (WHERE rank <= 20) / nullif(count(*), 0), 2) AS found
    FROM rank_scan_points WHERE scan_id = p_scan_id AND status = 'done'
  ) m
  WHERE s.id = p_scan_id;

  -- Chỉ số cho từng địa điểm xuất hiện trong lưới (đối thủ + chính khách).
  WITH pts AS (
    SELECT top_places FROM rank_scan_points WHERE scan_id = p_scan_id AND status = 'done'
  ), n AS (SELECT count(*)::numeric AS c FROM pts),
  pos AS (
    SELECT u.place_key, u.ord::int AS ord
    FROM pts, unnest(pts.top_places) WITH ORDINALITY AS u(place_key, ord)
    WHERE u.ord <= 20
  ), agg AS (
    SELECT place_key, count(*) AS app, count(*) FILTER (WHERE ord <= 3) AS t3, min(ord) AS best, avg(ord) AS arp, sum(ord) AS s
    FROM pos GROUP BY place_key
  )
  UPDATE rank_scan_competitors c SET
    appearances = a.app,
    top3_count = a.t3,
    best_rank = a.best,
    arp = round(a.arp, 2),
    atrp = round((a.s + 21 * (n.c - a.app)) / nullif(n.c, 0), 2),
    solv = round(100.0 * a.t3 / nullif(n.c, 0), 2)
  FROM agg a, n
  WHERE c.scan_id = p_scan_id AND c.place_key = a.place_key;

  RETURN v_status;
END $$;

-- 8) RLS: thành viên workspace chỉ đọc; ghi qua service_role -----------------------
ALTER TABLE public.rank_grid_configs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_keywords         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_scans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_scan_points      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_scan_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_usage            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view rank grid configs" ON public.rank_grid_configs;
CREATE POLICY "Members can view rank grid configs" ON public.rank_grid_configs
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can view rank keywords" ON public.rank_keywords;
CREATE POLICY "Members can view rank keywords" ON public.rank_keywords
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can view rank scans" ON public.rank_scans;
CREATE POLICY "Members can view rank scans" ON public.rank_scans
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can view rank scan points" ON public.rank_scan_points;
CREATE POLICY "Members can view rank scan points" ON public.rank_scan_points
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can view rank scan competitors" ON public.rank_scan_competitors;
CREATE POLICY "Members can view rank scan competitors" ON public.rank_scan_competitors
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can view rank usage" ON public.rank_usage;
CREATE POLICY "Members can view rank usage" ON public.rank_usage
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));

REVOKE INSERT, UPDATE, DELETE ON
  public.rank_grid_configs, public.rank_keywords, public.rank_scans,
  public.rank_scan_points, public.rank_scan_competitors, public.rank_usage
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rankgrid_reserve_points(uuid, date, int, int, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rankgrid_release_points(uuid, date, int, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rankgrid_finalize_scan(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rankgrid_reserve_points(uuid, date, int, int, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.rankgrid_release_points(uuid, date, int, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.rankgrid_finalize_scan(uuid, boolean) TO service_role;

-- Dọn dữ liệu nặng: giữ top_places 180 ngày (chỉ số + đối thủ tổng hợp giữ lâu dài). Chạy từ cron:
--   UPDATE public.rank_scan_points SET top_places = '{}' WHERE fetched_at < now() - interval '180 days' AND top_places <> '{}';
