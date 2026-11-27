-- ============================================================
-- Migration 025: Auto-post ảnh + bài lên Google Business Profile (BẢN NHÁP)
--
-- Luồng: khách gửi ảnh -> Storage bucket `client-photos` (private) ->
--   app xử lý (chuẩn hoá JPEG, sha256, pHash, geotag, AI gắn tag/chấm điểm) ->
--   pick_next_post() chọn ảnh phù hợp + chưa dùng gần đây -> Make đăng lên GBP ->
--   report_post_result() ghi log + cập nhật used_count.
--
-- Nguyên tắc giống các migration cũ:
--   * Mọi bảng có workspace_id + client_id, RLS dùng is_workspace_member().
--   * Người dùng (authenticated) chỉ ĐỌC hàng đợi/log; GHI hàng đợi/log chỉ
--     service_role (route /api/autopost/* hoặc Make qua service key).
--   * Hàm SECURITY DEFINER: REVOKE khỏi PUBLIC/anon (như 017).
-- Idempotent, chạy lại an toàn. Chạy trên staging/backup trước.
--
-- Đối chiếu với DB production (project maps / lidskbqcqelaazsaoocs, 26/11/2026):
--   * Không có schema supabase_migrations (list_migrations rỗng) — các migration
--     trước đây được chạy tay trên SQL Editor, không ghi lịch sử CLI.
--   * 001–017, 019–022, 024 đã có trên DB (suy từ bảng/cột).
--   * 018_review_watch.sql có trong repo nhưng CHƯA chạy (thiếu review_watch_state,
--     review_alerts). 025 không phụ thuộc 018.
--   * 023_client_business_profile.sql đã chạy (còn bảng client_business_profiles),
--     sau đó file bị xoá khỏi repo (commit 33b01bd, 17/11/2026). 025 không đụng bảng này.
--   * Bảng phụ thuộc đã có đủ cột: workspaces, workspace_members, clients,
--     contents, google_connections, profiles + hàm is_workspace_member(ws_id uuid),
--     is_superadmin(), storage.foldername(text).
--   * clients CHƯA có latitude/longitude/gbp_location_resource/autopost_* — phần
--     ALTER bên dưới sẽ thêm.
--   * Bucket client-photos chưa có; storage.objects chưa có policy trùng tên.
--   * pg_trgm đang có trong catalog (1.6) nhưng CHƯA bật — tạo vào schema extensions
--     (chuẩn Supabase). Hàm dùng similarity() phải có search_path gồm extensions
--     vì các hàm SECURITY DEFINER đang SET search_path = public.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 0) Bổ sung cột cho clients ------------------------------------------------
-- Toạ độ doanh nghiệp (để geotag) + cấu hình auto-post theo từng khách.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  -- Chế độ "agency": tài khoản Google của bạn là Manager hồ sơ khách, Make dùng
  -- 1 connection chung -> cần biết location resource của từng khách.
  ADD COLUMN IF NOT EXISTS gbp_location_resource text,      -- accounts/{a}/locations/{l}
  ADD COLUMN IF NOT EXISTS autopost_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopost_every_days int NOT NULL DEFAULT 3
    CHECK (autopost_every_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS autopost_cta text NOT NULL DEFAULT 'CALL'
    CHECK (autopost_cta IN ('NONE','CALL','LEARN_MORE','BOOK','ORDER','SHOP','SIGN_UP')),
  ADD COLUMN IF NOT EXISTS autopost_cta_url text,
  ADD COLUMN IF NOT EXISTS autopost_review_mode boolean NOT NULL DEFAULT true, -- bài chờ duyệt tay trước khi đăng
  ADD COLUMN IF NOT EXISTS autopost_upload_token text UNIQUE; -- link upload công khai cho nhân viên khách

-- 1) Ảnh khách gửi ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Storage: bucket client-photos, path {workspace_id}/{client_id}/{photo_id}.jpg
  storage_bucket text NOT NULL DEFAULT 'client-photos',
  original_path text,              -- file gốc khách gửi (giữ để đối chiếu, có thể xoá sau 30 ngày)
  storage_path text,               -- file đã chuẩn hoá (JPEG, <=5MB, đã geotag) -> file dùng để đăng
  source text NOT NULL DEFAULT 'web'
    CHECK (source IN ('web','upload_link','zalo','drive','admin')),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  original_filename text,
  mime_type text,
  file_size_bytes int,

  -- Chống trùng
  sha256 text,                     -- hash file gốc: trùng tuyệt đối
  phash bigint,                    -- perceptual hash 64-bit: gần trùng (Hamming)
  width int,
  height int,

  -- Geotag
  geotagged boolean NOT NULL DEFAULT false,
  lat double precision,
  lng double precision,
  exif_had_gps boolean,            -- ảnh gốc đã có GPS từ điện thoại chưa
  taken_at timestamptz,            -- DateTimeOriginal nếu có

  -- AI vision (Claude)
  ai_description text,             -- mô tả ngắn tiếng Việt
  ai_tags text[] NOT NULL DEFAULT '{}',   -- vd {mon_an,hai_san,khong_gian,mat_tien,nhan_vien}
  gbp_category text NOT NULL DEFAULT 'ADDITIONAL'
    CHECK (gbp_category IN ('COVER','PROFILE','LOGO','EXTERIOR','INTERIOR','PRODUCT','AT_WORK',
                            'FOOD_AND_DRINK','MENU','COMMON_AREA','ROOMS','TEAMS','ADDITIONAL')),
  quality_score numeric(3,2) CHECK (quality_score BETWEEN 0 AND 1),
  reject_reason text,              -- mờ, có chữ/số ĐT, ảnh mạng, người lạ rõ mặt...

  -- Vòng đời
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','processing','ready','reserved','rejected','duplicate','archived','error')),
  duplicate_of uuid REFERENCES public.client_photos(id) ON DELETE SET NULL,
  used_count int NOT NULL DEFAULT 0,
  last_posted_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trùng tuyệt đối: 1 file chỉ được nhận 1 lần mỗi khách.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_photos_client_sha
  ON public.client_photos (client_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_photos_pick
  ON public.client_photos (client_id, status, used_count, last_posted_at);
CREATE INDEX IF NOT EXISTS idx_client_photos_workspace ON public.client_photos (workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_photos_tags ON public.client_photos USING gin (ai_tags);

-- 2) Hàng đợi bài đăng -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.autopost_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  photo_id uuid REFERENCES public.client_photos(id) ON DELETE SET NULL,
  content_id uuid REFERENCES public.contents(id) ON DELETE SET NULL, -- nối với hệ nội dung sẵn có (channel gbp_post)
  topic text,                      -- chủ đề bài (từ plan/task hoặc lịch chủ đề)
  topic_tags text[] NOT NULL DEFAULT '{}',
  caption text,                    -- summary sẽ đăng (<= 1500 ký tự)
  caption_norm text,               -- caption đã bỏ dấu/viết thường để so trùng
  cta_type text,
  cta_url text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'picked'
    CHECK (status IN ('picked','captioned','needs_review','posting','posted','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mỗi khách chỉ 1 bài đang chạy dở cùng lúc.
CREATE UNIQUE INDEX IF NOT EXISTS uq_autopost_queue_active
  ON public.autopost_queue (client_id)
  WHERE status IN ('picked','captioned','needs_review','posting');
CREATE INDEX IF NOT EXISTS idx_autopost_queue_ws ON public.autopost_queue (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autopost_queue_caption_trgm
  ON public.autopost_queue USING gin (caption_norm extensions.gin_trgm_ops);

-- 3) Nhật ký đăng (bất biến, 1 dòng / 1 lần gọi GBP) ----------------------
CREATE TABLE IF NOT EXISTS public.autopost_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  queue_id uuid REFERENCES public.autopost_queue(id) ON DELETE SET NULL,
  photo_id uuid REFERENCES public.client_photos(id) ON DELETE SET NULL,
  success boolean NOT NULL,
  gbp_post_name text,              -- accounts/{a}/locations/{l}/localPosts/{id}
  gbp_search_url text,
  gbp_state text,                  -- LIVE / PROCESSING / REJECTED (đọc lại sau)
  http_status int,
  error_code text,                 -- token_revoked | not_verified | quota | policy | api_error
  error_message text,
  make_execution_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autopost_log_client ON public.autopost_log (client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_autopost_log_gbp_post
  ON public.autopost_log (gbp_post_name) WHERE gbp_post_name IS NOT NULL;

-- updated_at tự cập nhật
CREATE OR REPLACE FUNCTION public.autopost_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_client_photos_touch ON public.client_photos;
CREATE TRIGGER trg_client_photos_touch BEFORE UPDATE ON public.client_photos
  FOR EACH ROW EXECUTE FUNCTION public.autopost_touch_updated_at();
DROP TRIGGER IF EXISTS trg_autopost_queue_touch ON public.autopost_queue;
CREATE TRIGGER trg_autopost_queue_touch BEFORE UPDATE ON public.autopost_queue
  FOR EACH ROW EXECUTE FUNCTION public.autopost_touch_updated_at();

-- 4) Hàm tiện ích chống trùng ---------------------------------------------
-- Khoảng cách Hamming giữa 2 pHash 64-bit (bit_count có từ PG14; Supabase đang PG17).
CREATE OR REPLACE FUNCTION public.phash_distance(a bigint, b bigint)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT bit_count((a # b)::bit(64))::int
$$;

-- Ảnh gần trùng với ảnh khác của CÙNG khách (đã nhận trước đó)?
CREATE OR REPLACE FUNCTION public.find_near_duplicate_photo(
  p_client_id uuid, p_phash bigint, p_exclude uuid DEFAULT NULL, p_threshold int DEFAULT 6
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.client_photos
  WHERE client_id = p_client_id
    AND phash IS NOT NULL AND p_phash IS NOT NULL
    AND (p_exclude IS NULL OR id <> p_exclude)
    AND status NOT IN ('rejected','duplicate','error')
    AND public.phash_distance(phash, p_phash) <= p_threshold
  ORDER BY public.phash_distance(phash, p_phash), created_at
  LIMIT 1
$$;

-- Chuẩn hoá caption để so trùng: bỏ dấu tiếng Việt, viết thường, bỏ hashtag/emoji/ký tự lạ.
CREATE OR REPLACE FUNCTION public.normalize_caption(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(translate(coalesce(p,''),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydAAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD')),
    '#\S+|[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Caption mới có quá giống 1 trong N caption gần nhất của khách không?
-- Trả về điểm giống cao nhất (0..1). App/Make từ chối nếu >= 0.55 và bắt AI viết lại.
CREATE OR REPLACE FUNCTION public.caption_max_similarity(
  p_client_id uuid, p_caption text, p_lookback int DEFAULT 30
) RETURNS real LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT coalesce(max(similarity(q.caption_norm, public.normalize_caption(p_caption))), 0)::real
  FROM (
    SELECT caption_norm FROM public.autopost_queue
    WHERE client_id = p_client_id AND status IN ('posted','posting','captioned','needs_review')
      AND caption_norm IS NOT NULL
    ORDER BY created_at DESC
    LIMIT p_lookback
  ) q
$$;

-- 5) Chọn bài kế tiếp -------------------------------------------------------
-- Gọi bởi service_role (route /api/autopost/prepare hoặc Make). Với mỗi khách
-- đến lượt đăng: chọn 1 ảnh 'ready' tốt nhất, chưa dùng trong p_cooldown_days,
-- không gần trùng ảnh đã đăng trong cửa sổ cooldown, ưu tiên khớp topic_tags.
-- Tạo dòng autopost_queue (status 'picked') + giữ chỗ ảnh ('reserved').
-- SKIP LOCKED để 2 lần chạy song song không chọn trùng.
CREATE OR REPLACE FUNCTION public.pick_next_post(
  p_client_id uuid DEFAULT NULL,       -- NULL = mọi khách đến lượt
  p_limit int DEFAULT 20,
  p_topic text DEFAULT NULL,
  p_topic_tags text[] DEFAULT '{}',
  p_cooldown_days int DEFAULT 90,
  p_phash_threshold int DEFAULT 8,
  p_min_quality numeric DEFAULT 0.5
) RETURNS TABLE (
  queue_id uuid, client_id uuid, workspace_id uuid, client_name text,
  location_resource text, photo_id uuid, storage_bucket text, storage_path text,
  ai_description text, ai_tags text[], cta_type text, cta_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  ph record;
  q_id uuid;
  loc text;
BEGIN
  FOR c IN
    SELECT cl.id, cl.workspace_id, cl.name, cl.autopost_cta, cl.autopost_cta_url,
           cl.gbp_location_resource AS agency_loc
    FROM public.clients cl
    WHERE cl.autopost_enabled
      AND (p_client_id IS NULL OR cl.id = p_client_id)
      -- chưa có bài đang chạy dở
      AND NOT EXISTS (SELECT 1 FROM public.autopost_queue aq
                      WHERE aq.client_id = cl.id
                        AND aq.status IN ('picked','captioned','needs_review','posting'))
      -- đến hạn theo tần suất (tính từ lần đăng thành công gần nhất)
      AND NOT EXISTS (SELECT 1 FROM public.autopost_log al
                      WHERE al.client_id = cl.id AND al.success
                        AND al.created_at > now() - make_interval(days => cl.autopost_every_days))
    ORDER BY cl.id
    LIMIT greatest(p_limit, 1)
    FOR UPDATE OF cl SKIP LOCKED
  LOOP
    -- location: ưu tiên chế độ agency (clients.gbp_location_resource), sau đó
    -- connection self-serve của chính khách (google_connections, migration 013).
    loc := c.agency_loc;
    IF loc IS NULL THEN
      SELECT gc.gbp_location_resource INTO loc
      FROM public.google_connections gc
      WHERE gc.client_id = c.id AND gc.status = 'connected';
    END IF;
    CONTINUE WHEN loc IS NULL;

    SELECT p.* INTO ph
    FROM public.client_photos p
    WHERE p.client_id = c.id
      AND p.status = 'ready'
      AND p.storage_path IS NOT NULL
      AND coalesce(p.quality_score, 0) >= p_min_quality
      AND (p.last_posted_at IS NULL OR p.last_posted_at < now() - make_interval(days => p_cooldown_days))
      -- không gần trùng ảnh nào đã đăng trong cửa sổ cooldown
      AND NOT EXISTS (
        SELECT 1 FROM public.client_photos used
        WHERE used.client_id = c.id AND used.id <> p.id
          AND used.last_posted_at > now() - make_interval(days => p_cooldown_days)
          AND used.phash IS NOT NULL AND p.phash IS NOT NULL
          AND public.phash_distance(used.phash, p.phash) <= p_phash_threshold)
    ORDER BY
      p.used_count ASC,                                                   -- ảnh chưa dùng trước
      cardinality(ARRAY(SELECT unnest(p.ai_tags) INTERSECT SELECT unnest(p_topic_tags))) DESC, -- khớp chủ đề
      p.quality_score DESC NULLS LAST,
      random()
    LIMIT 1
    FOR UPDATE OF p SKIP LOCKED;

    CONTINUE WHEN ph.id IS NULL;

    INSERT INTO public.autopost_queue (workspace_id, client_id, photo_id, topic, topic_tags, cta_type, cta_url, status, locked_at)
    VALUES (c.workspace_id, c.id, ph.id, p_topic, coalesce(p_topic_tags,'{}'),
            c.autopost_cta, c.autopost_cta_url, 'picked', now())
    RETURNING id INTO q_id;

    UPDATE public.client_photos SET status = 'reserved' WHERE id = ph.id;

    queue_id := q_id; client_id := c.id; workspace_id := c.workspace_id; client_name := c.name;
    location_resource := loc; photo_id := ph.id; storage_bucket := ph.storage_bucket;
    storage_path := ph.storage_path; ai_description := ph.ai_description; ai_tags := ph.ai_tags;
    cta_type := c.autopost_cta; cta_url := c.autopost_cta_url;
    RETURN NEXT;
    ph := NULL;
  END LOOP;
END $$;

-- 6) Lưu caption (có chặn trùng) --------------------------------------------
CREATE OR REPLACE FUNCTION public.set_post_caption(
  p_queue_id uuid, p_caption text, p_max_similarity real DEFAULT 0.55, p_needs_review boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.autopost_queue;
  sim real;
BEGIN
  SELECT * INTO q FROM public.autopost_queue WHERE id = p_queue_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'queue % không tồn tại', p_queue_id; END IF;
  IF length(coalesce(p_caption,'')) < 40 OR length(p_caption) > 1500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'length', 'similarity', null);
  END IF;
  sim := public.caption_max_similarity(q.client_id, p_caption);
  IF sim >= p_max_similarity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_similar', 'similarity', sim);
  END IF;
  UPDATE public.autopost_queue
     SET caption = p_caption, caption_norm = public.normalize_caption(p_caption),
         status = CASE WHEN p_needs_review THEN 'needs_review' ELSE 'captioned' END
   WHERE id = p_queue_id;
  RETURN jsonb_build_object('ok', true, 'similarity', sim);
END $$;

-- Duyệt tay: chuyển needs_review -> captioned (gọi từ API sau khi kiểm tra quyền thành viên).
CREATE OR REPLACE FUNCTION public.approve_autopost(p_queue_id uuid, p_caption text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.autopost_queue
     SET status = 'captioned', locked_at = now(),
         caption = coalesce(p_caption, caption),
         caption_norm = public.normalize_caption(coalesce(p_caption, caption))
   WHERE id = p_queue_id AND status = 'needs_review';
END $$;
REVOKE EXECUTE ON FUNCTION public.approve_autopost(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_autopost(uuid, text) TO service_role;

-- 7) Ghi kết quả đăng ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_post_result(
  p_queue_id uuid, p_success boolean, p_gbp_post_name text DEFAULT NULL,
  p_search_url text DEFAULT NULL, p_http_status int DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL,
  p_make_execution_id text DEFAULT NULL, p_max_attempts int DEFAULT 3
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.autopost_queue;
BEGIN
  SELECT * INTO q FROM public.autopost_queue WHERE id = p_queue_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'queue % không tồn tại', p_queue_id; END IF;

  INSERT INTO public.autopost_log (workspace_id, client_id, queue_id, photo_id, success, gbp_post_name,
    gbp_search_url, http_status, error_code, error_message, make_execution_id)
  VALUES (q.workspace_id, q.client_id, q.id, q.photo_id, p_success, p_gbp_post_name,
    p_search_url, p_http_status, p_error_code, left(p_error_message, 1000), p_make_execution_id);

  IF p_success THEN
    UPDATE public.autopost_queue SET status = 'posted', attempts = attempts + 1, last_error = NULL WHERE id = q.id;
    UPDATE public.client_photos
       SET status = 'ready', used_count = used_count + 1, last_posted_at = now()
     WHERE id = q.photo_id;
  ELSE
    UPDATE public.autopost_queue
       SET attempts = attempts + 1,
           last_error = left(p_error_message, 1000),
           -- lỗi không thử lại được (token thu hồi, chưa verify, vi phạm chính sách) -> failed ngay
           status = CASE WHEN p_error_code IN ('token_revoked','not_verified','policy')
                           OR attempts + 1 >= p_max_attempts THEN 'failed' ELSE 'captioned' END
     WHERE id = q.id;
    -- trả ảnh về kho nếu bài đã failed hẳn
    UPDATE public.client_photos SET status = 'ready'
     WHERE id = q.photo_id
       AND EXISTS (SELECT 1 FROM public.autopost_queue WHERE id = q.id AND status = 'failed');
    -- token hỏng -> tắt auto-post khách đó để không spam lỗi
    IF p_error_code = 'token_revoked' THEN
      UPDATE public.google_connections SET status = 'revoked', last_error = left(p_error_message, 500)
       WHERE client_id = q.client_id;
    END IF;
  END IF;
END $$;

-- Giải phóng bài kẹt (Make chết giữa chừng): chạy mỗi lần prepare hoặc pg_cron mỗi giờ.
CREATE OR REPLACE FUNCTION public.release_stale_autopost(p_minutes int DEFAULT 120)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH stale AS (
    UPDATE public.autopost_queue SET status = 'cancelled', last_error = 'timeout'
     WHERE status IN ('picked','captioned','posting')
       AND locked_at < now() - make_interval(mins => p_minutes)
    RETURNING photo_id
  )
  UPDATE public.client_photos p SET status = 'ready'
    FROM stale WHERE p.id = stale.photo_id AND p.status = 'reserved';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 8) RLS -------------------------------------------------------------------------
ALTER TABLE public.client_photos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopost_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopost_log   ENABLE ROW LEVEL SECURITY;

-- client_photos: thành viên workspace xem/thêm/sửa nhãn/xoá ảnh của workspace mình.
DROP POLICY IF EXISTS "Members can view client photos" ON public.client_photos;
CREATE POLICY "Members can view client photos" ON public.client_photos
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can insert client photos" ON public.client_photos;
CREATE POLICY "Members can insert client photos" ON public.client_photos
  FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id)
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.workspace_id = client_photos.workspace_id));
DROP POLICY IF EXISTS "Members can update client photos" ON public.client_photos;
CREATE POLICY "Members can update client photos" ON public.client_photos
  FOR UPDATE USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can delete client photos" ON public.client_photos;
CREATE POLICY "Members can delete client photos" ON public.client_photos
  FOR DELETE USING (is_workspace_member(workspace_id));

-- Người dùng chỉ được sửa vài cột "do người" quyết (ẩn ảnh, đổi danh mục, nhãn);
-- hash/điểm/used_count/last_posted_at chỉ service_role ghi (giống cách 017 khoá profiles).
REVOKE INSERT, UPDATE ON public.client_photos FROM anon, authenticated;
GRANT INSERT (workspace_id, client_id, original_path, source, uploaded_by, original_filename, mime_type, file_size_bytes)
  ON public.client_photos TO authenticated;
GRANT UPDATE (status, gbp_category, ai_tags) ON public.client_photos TO authenticated;
-- (status do người dùng đặt nên giới hạn thêm bằng CHECK ở API: chỉ 'archived' <-> 'ready')

-- queue/log: chỉ đọc.
DROP POLICY IF EXISTS "Members can view autopost queue" ON public.autopost_queue;
CREATE POLICY "Members can view autopost queue" ON public.autopost_queue
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members can view autopost log" ON public.autopost_log;
CREATE POLICY "Members can view autopost log" ON public.autopost_log
  FOR SELECT USING (is_superadmin() OR is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON public.autopost_queue, public.autopost_log FROM anon, authenticated;

-- Hàm nghiệp vụ: chỉ service_role.
REVOKE EXECUTE ON FUNCTION public.pick_next_post(uuid, int, text, text[], int, int, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_post_caption(uuid, text, real, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_post_result(uuid, boolean, text, text, int, text, text, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_stale_autopost(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_near_duplicate_photo(uuid, bigint, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.caption_max_similarity(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_next_post(uuid, int, text, text[], int, int, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_post_caption(uuid, text, real, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_post_result(uuid, boolean, text, text, int, text, text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stale_autopost(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_near_duplicate_photo(uuid, bigint, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.caption_max_similarity(uuid, text, int) TO service_role;

-- 9) Storage bucket private + policy theo thư mục {workspace_id}/{client_id}/... -------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('client-photos', 'client-photos', false, 20971520,  -- 20MB ảnh gốc; bản đăng sẽ nén <=5MB
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Members read client-photos" ON storage.objects;
CREATE POLICY "Members read client-photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'client-photos'
         AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS "Members upload client-photos" ON storage.objects;
CREATE POLICY "Members upload client-photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-photos'
              AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS "Members delete client-photos" ON storage.objects;
CREATE POLICY "Members delete client-photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'client-photos'
         AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));

COMMENT ON TABLE public.client_photos IS 'Ảnh khách gửi để auto-post GBP. sha256 chặn trùng tuyệt đối, phash chặn gần trùng.';
COMMENT ON TABLE public.autopost_queue IS 'Hàng đợi bài auto-post: pick_next_post -> set_post_caption -> Make đăng -> report_post_result.';
COMMENT ON TABLE public.autopost_log IS 'Nhật ký mỗi lần gọi GBP localPosts.create, kèm gbp_post_name.';
