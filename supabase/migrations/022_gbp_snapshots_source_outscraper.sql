-- ============================================================
-- Migration 022: cho phép gbp_snapshots.source = 'outscraper'.
-- Bảng gbp_snapshots trên DB thật có CHECK cũ chỉ cho ('browser','places','manual','hybrid') nên mọi lần lưu
-- snapshot từ Outscraper bị từ chối => audit báo "Không lấy được dữ liệu từ Google Maps". Idempotent.
-- ============================================================
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.gbp_snapshots'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.gbp_snapshots DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.gbp_snapshots
    ADD CONSTRAINT gbp_snapshots_source_check
    CHECK (source IN ('browser', 'places', 'manual', 'hybrid', 'outscraper'));
END $$;
