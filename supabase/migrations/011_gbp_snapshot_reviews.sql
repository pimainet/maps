-- Thêm cột lưu review text thật (lấy qua Places API field "reviews",
-- KHÔNG phải scrape) vào gbp_snapshots — mở khoá check T06 (Review
-- Insight) trong lib/audit-engine/trust.ts.
--
-- Nullable + có default -> an toàn cho các row cũ đã tồn tại, không cần
-- backfill, không ảnh hưởng gì tới dữ liệu/route đang chạy.
alter table public.gbp_snapshots
  add column if not exists reviews jsonb not null default '[]'::jsonb;

comment on column public.gbp_snapshots.reviews is
  'Tối đa ~5 review "liên quan nhất" từ Places API (New) field "reviews" — giới hạn của chính Google API, không phải do ta thu hẹp. Không có nội dung owner reply (xem lib/gbp-snapshot-types.ts).';
