-- ============================================================
-- Migration 021: Cho phép sửa thông tin doanh nghiệp (client) một cách AN TOÀN.
-- Idempotent. Không xóa dữ liệu nghiệp vụ.
--
-- Bối cảnh: migration 019 khóa UPDATE trực tiếp lên name/gbp_link/place_id để không ai đổi "quán"
-- trên cùng 1 slot nhằm lấy thêm quota audit. Nhưng khách vẫn cần sửa khi điền nhầm / đổi thông tin.
--
-- Cách làm: mọi chỉnh sửa đi qua hàm SECURITY DEFINER public.update_client(...):
--   * Trường hồ sơ (ngành, khu vực, SĐT, liên hệ, giọng thương hiệu, website, ghi chú, tên hiển thị
--     khi KHÔNG đổi quán): sửa tự do, không giới hạn.
--   * Đổi "quán" (place_key đổi: place_id / link Maps trỏ sang doanh nghiệp khác): tối đa
--       2 lần / client / 30 ngày  và  6 lần / workspace / 30 ngày. Mọi lần đều ghi sổ append-only.
--     Quota audit tính theo place_key nên đổi sang quán khác không "reset" quota; đổi qua lại cũng không.
--   * Khi đổi quán: snapshot Google Maps cũ của slot này chuyển sang status 'superseded' (giữ lại làm lịch sử,
--     nhưng mọi chỗ đọc "snapshot mới nhất" đều bỏ qua) => không có dữ liệu quán cũ lẫn vào audit/báo cáo quán mới.
--   * Sửa lỗi chính tả link/tên nhưng vẫn cùng quán (cùng place_key) => không tính vào giới hạn.
-- ============================================================

-- 1) snapshot: thêm trạng thái 'superseded' -------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.gbp_snapshots'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%' AND pg_get_constraintdef(oid) ILIKE '%partial%'
  LOOP
    EXECUTE format('ALTER TABLE public.gbp_snapshots DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.gbp_snapshots
    ADD CONSTRAINT gbp_snapshots_status_check
    CHECK (status IN ('pending', 'running', 'ok', 'partial', 'failed', 'superseded'));
END $$;

-- 2) clients: mốc đổi quán gần nhất ----------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS identity_changed_at timestamptz;

-- 3) Sổ thay đổi (append-only, không FK để sống sót khi xóa client) -----------
CREATE TABLE IF NOT EXISTS public.client_identity_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  user_id       uuid,
  kind          text NOT NULL CHECK (kind IN ('place_change', 'cosmetic')),
  old_name      text,
  new_name      text,
  old_gbp_link  text,
  new_gbp_link  text,
  old_place_key text,
  new_place_key text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_identity_changes_client_idx
  ON public.client_identity_changes (client_id, kind, created_at);
CREATE INDEX IF NOT EXISTS client_identity_changes_ws_idx
  ON public.client_identity_changes (workspace_id, kind, created_at);
ALTER TABLE public.client_identity_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_identity_changes FROM anon, authenticated;

-- 4) Hàm sửa client ----------------------------------------------------------
-- p_patch là jsonb; chỉ khóa nào CÓ MẶT mới được sửa. Khóa hợp lệ:
--   hồ sơ:    industry, area, phone, contact_name, brand_voice, website_url, notes
--   định danh: name, gbp_link, gbp_link_normalized, place_id
-- Trả về jsonb { changed_place, superseded_snapshots, place_changes_left }.
CREATE OR REPLACE FUNCTION public.update_client(p_client_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  c           public.clients%ROWTYPE;
  v_name      text;
  v_link      text;
  v_norm      text;
  v_pid       text;
  v_old_key   text;
  v_new_key   text;
  v_place_chg boolean := false;
  v_ident_chg boolean := false;
  v_since     timestamptz := now() - interval '30 days';
  v_cl_cnt    integer;
  v_ws_cnt    integer;
  v_super     integer := 0;
  v_max_cl    constant integer := 2;
  v_max_ws    constant integer := 6;
  k           text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: cần đăng nhập' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Dữ liệu sửa không hợp lệ' USING ERRCODE = '22023';
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('industry','area','phone','contact_name','brand_voice','website_url','notes',
                 'name','gbp_link','gbp_link_normalized','place_id') THEN
      RAISE EXCEPTION 'Trường không được phép sửa: %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtextextended('client-edit:' || p_client_id::text, 0));

  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_workspace_member(c.workspace_id) THEN
    -- cùng 1 thông báo cho "không tồn tại" và "không thuộc workspace" (không lộ sự tồn tại)
    RAISE EXCEPTION 'NotFound: Không tìm thấy doanh nghiệp này' USING ERRCODE = 'P0002';
  END IF;

  v_name := CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'), '') ELSE c.name END;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Tên doanh nghiệp không được để trống' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) > 200 THEN
    RAISE EXCEPTION 'Tên doanh nghiệp quá dài (tối đa 200 ký tự)' USING ERRCODE = '22023';
  END IF;

  v_link := CASE WHEN p_patch ? 'gbp_link' THEN NULLIF(btrim(p_patch->>'gbp_link'), '') ELSE c.gbp_link END;
  v_norm := CASE WHEN p_patch ? 'gbp_link_normalized' THEN NULLIF(btrim(p_patch->>'gbp_link_normalized'), '') ELSE c.gbp_link_normalized END;
  v_pid  := CASE WHEN p_patch ? 'place_id' THEN NULLIF(btrim(p_patch->>'place_id'), '') ELSE c.place_id END;

  -- cùng công thức place_key với lib/audit-quota-key.ts và migration 019
  v_old_key := COALESCE(NULLIF(c.place_id, ''),
                        CASE WHEN NULLIF(c.gbp_link_normalized, '') IS NOT NULL THEN 'gbp:' || c.gbp_link_normalized END,
                        'client:' || c.id::text);
  v_new_key := COALESCE(NULLIF(v_pid, ''),
                        CASE WHEN NULLIF(v_norm, '') IS NOT NULL THEN 'gbp:' || v_norm END,
                        'client:' || c.id::text);
  v_place_chg := v_new_key IS DISTINCT FROM v_old_key;
  v_ident_chg := v_place_chg OR v_name IS DISTINCT FROM c.name
                 OR v_link IS DISTINCT FROM c.gbp_link OR v_norm IS DISTINCT FROM c.gbp_link_normalized
                 OR v_pid IS DISTINCT FROM c.place_id;

  IF v_place_chg THEN
    SELECT count(*) INTO v_cl_cnt FROM public.client_identity_changes
      WHERE client_id = c.id AND kind = 'place_change' AND created_at >= v_since;
    SELECT count(*) INTO v_ws_cnt FROM public.client_identity_changes
      WHERE workspace_id = c.workspace_id AND kind = 'place_change' AND created_at >= v_since;
    IF v_cl_cnt >= v_max_cl THEN
      RAISE EXCEPTION 'RateLimited: Đã đổi doanh nghiệp/link Google Maps của hồ sơ này % lần trong 30 ngày qua (tối đa % lần). Nếu cần quản lý thêm doanh nghiệp khác, hãy tạo hồ sơ mới; nếu vẫn bị nhầm, liên hệ để được hỗ trợ.',
        v_cl_cnt, v_max_cl USING ERRCODE = 'P0001';
    END IF;
    IF v_ws_cnt >= v_max_ws THEN
      RAISE EXCEPTION 'RateLimited: Workspace này đã đổi link Google Maps % lần trong 30 ngày qua (tối đa % lần). Vui lòng liên hệ để được hỗ trợ.',
        v_ws_cnt, v_max_ws USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    UPDATE public.clients SET
      name                = v_name,
      gbp_link            = v_link,
      gbp_link_normalized = v_norm,
      place_id            = v_pid,
      industry     = CASE WHEN p_patch ? 'industry'     THEN NULLIF(btrim(p_patch->>'industry'), '')     ELSE industry END,
      area         = CASE WHEN p_patch ? 'area'         THEN NULLIF(btrim(p_patch->>'area'), '')         ELSE area END,
      phone        = CASE WHEN p_patch ? 'phone'        THEN NULLIF(btrim(p_patch->>'phone'), '')        ELSE phone END,
      contact_name = CASE WHEN p_patch ? 'contact_name' THEN NULLIF(btrim(p_patch->>'contact_name'), '') ELSE contact_name END,
      brand_voice  = CASE WHEN p_patch ? 'brand_voice'  THEN NULLIF(btrim(p_patch->>'brand_voice'), '')  ELSE brand_voice END,
      website_url  = CASE WHEN p_patch ? 'website_url'  THEN NULLIF(btrim(p_patch->>'website_url'), '')  ELSE website_url END,
      notes        = CASE WHEN p_patch ? 'notes'        THEN NULLIF(btrim(p_patch->>'notes'), '')        ELSE notes END,
      identity_changed_at = CASE WHEN v_place_chg THEN now() ELSE identity_changed_at END
    WHERE id = c.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Duplicate: Doanh nghiệp này (cùng Place ID / link Google Maps) đã có trong workspace' USING ERRCODE = '23505';
  END;

  IF v_ident_chg THEN
    INSERT INTO public.client_identity_changes
      (client_id, workspace_id, user_id, kind, old_name, new_name, old_gbp_link, new_gbp_link, old_place_key, new_place_key)
    VALUES
      (c.id, c.workspace_id, v_user, CASE WHEN v_place_chg THEN 'place_change' ELSE 'cosmetic' END,
       c.name, v_name, c.gbp_link, v_link, v_old_key, v_new_key);
  END IF;

  IF v_place_chg THEN
    -- Dữ liệu Maps của quán cũ (kể cả cache đối thủ nằm trong snapshot) không được dùng cho quán mới.
    UPDATE public.gbp_snapshots SET status = 'superseded', updated_at = now()
      WHERE client_id = c.id AND status <> 'superseded';
    GET DIAGNOSTICS v_super = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'changed_place', v_place_chg,
    'superseded_snapshots', v_super,
    'place_changes_left', CASE WHEN v_place_chg THEN GREATEST(0, v_max_cl - v_cl_cnt - 1)
      ELSE GREATEST(0, v_max_cl - (SELECT count(*) FROM public.client_identity_changes
                                   WHERE client_id = c.id AND kind = 'place_change' AND created_at >= v_since)::int) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_client(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_client(uuid, jsonb) TO authenticated, service_role;
