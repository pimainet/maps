-- ============================================================
-- Migration 026: Gắn search_path cố định cho 3 hàm auto-post
-- (cảnh báo function_search_path_mutable sau khi chạy 025).
--
-- Ba hàm này không dùng pg_trgm, chỉ cần schema public.
-- Idempotent: ALTER FUNCTION ... SET search_path chạy lại an toàn.
-- ============================================================

ALTER FUNCTION public.autopost_touch_updated_at()
  SET search_path = public;

ALTER FUNCTION public.phash_distance(bigint, bigint)
  SET search_path = public;

ALTER FUNCTION public.normalize_caption(text)
  SET search_path = public;
