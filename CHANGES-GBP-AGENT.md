# Nâng cấp browser agent GBP — đọc sâu để audit & sinh việc

## Cách áp dụng
1. Chép đè các file trong gói này vào project (giữ nguyên đường dẫn).
2. Chạy `supabase/migrations/015_gbp_snapshot_deep.sql` trên Supabase. Chưa chạy thì app vẫn chạy, nhưng dữ liệu mới chưa được lưu.
3. (Tùy chọn, khuyến nghị) Thêm env: `BROWSERBASE_REGION=ap-southeast-1` để IP gần VN. `BROWSERBASE_PROXIES=true` nếu hay gặp captcha/consent (có thể tốn thêm phí). Kiểm tra tên tham số trong docs Browserbase.
4. Bấm "Lấy dữ liệu Google Maps" trên 2–3 khách thật, xem `diagnostics.coverage_sections` / cột `coverage` của `gbp_snapshots`.

## File thay đổi
- lib/gbp-browser-snapshot.ts  (viết lại phần browser)
- lib/gbp-maps-scripts.ts      (MỚI: script chạy trong trang Maps)
- lib/gbp-relative-time.ts     (MỚI: "2 tháng trước" -> số ngày)
- lib/gbp-snapshot-types.ts    (mở rộng schema + coverage)
- lib/gbp-audit-fields.ts      (MỚI: dựng dữ liệu cho audit; thuần, dùng được ở client)
- lib/gbp-snapshots.ts         (lưu cột mới, tự lùi về cột cũ nếu chưa migrate; cache cũ hết hạn)
- app/api/gbp-snapshot/route.ts
- app/api/public/demo-audit/route.ts   (dùng depth 'quick')
- app/(dashboard)/clients/[id]/audit/page.tsx
- lib/audit-engine/{foundation,relevance,trust}.ts  (F02, R03, R05, T03, T05 chuyển từ "insufficient" sang có dữ liệu)
- supabase/migrations/015_gbp_snapshot_deep.sql
- scripts/test-gbp-scripts.mjs (test jsdom; cần `npm i -D jsdom`)
