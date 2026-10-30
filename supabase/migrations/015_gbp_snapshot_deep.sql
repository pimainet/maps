-- Migration 015: cột cho agent đọc sâu GBP.
--
-- Sửa luôn 1 lỗi cũ: opening_hours và additional_categories được thu thập nhưng KHÔNG có cột để lưu
-- (chỉ còn trong raw_json), nên khi audit dùng snapshot từ cache thì F07 (Giờ mở cửa) luôn "insufficient".
--
-- An toàn chạy lại nhiều lần (IF NOT EXISTS). Chưa chạy migration này thì app vẫn hoạt động:
-- lib/gbp-snapshots.ts tự lưu phần cột cũ, chỉ chưa lưu được dữ liệu mới.

alter table public.gbp_snapshots
  add column if not exists opening_hours text,
  add column if not exists additional_categories text,
  add column if not exists services jsonb not null default '[]'::jsonb,
  add column if not exists attributes jsonb not null default '[]'::jsonb,
  add column if not exists action_links jsonb not null default '[]'::jsonb,
  add column if not exists photo_categories jsonb not null default '[]'::jsonb,
  add column if not exists business_status text,
  add column if not exists claim_signal text,
  add column if not exists rating_distribution jsonb,
  add column if not exists review_stats jsonb,
  add column if not exists coverage jsonb;

comment on column public.gbp_snapshots.coverage is
  'Bản đồ những phần agent đã/không đọc được (overview, hours, about, services, reviews, updates, photos) + cảnh báo. Dùng để audit không nhầm "không đọc được" với "hồ sơ thiếu".';
comment on column public.gbp_snapshots.reviews is
  'Review đọc từ tab Bài đánh giá (tối đa ~30, có ngày + phản hồi chủ) hoặc, nếu browser không lấy được, ~5 review từ Places API (không có phản hồi chủ).';
