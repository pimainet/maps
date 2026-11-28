# Gói "Làm hộ" (done_for_you) — 2.490.000đ / tháng

Gói do đội ngũ vận hành thay khách. Khách KHÔNG duyệt gì: nhân viên (Super Admin) duyệt và đăng thay.
Không có thanh toán tự phục vụ: khách bấm "Liên hệ tư vấn" → admin liên hệ → admin tạo đơn → khách chuyển khoản (SePay, SML-8) → tự kích hoạt.

## Bật / tắt
- `NEXT_PUBLIC_DONE_FOR_YOU_ENABLED=true` (mặc định TẮT). Tắt thì: thẻ trên /billing, các route admin/khách, cron, mục menu đều ẩn / trả 404.
- Phải áp dụng migration `032_done_for_you.sql` TRƯỚC khi bật cờ (cần cho đơn gói mới, bảng yêu cầu tư vấn, báo cáo, nhật ký).
- Tính năng con vẫn theo cờ riêng: bài tự đăng (`AUTO_POST_ENABLED`), hộp thư review (`NEXT_PUBLIC_REVIEW_INBOX_ENABLED`), lưới thứ hạng (`NEXT_PUBLIC_RANK_GRID_ENABLED`). Hàng đợi /agency chỉ hiện mục nào cờ đang bật.

## Quyền lợi (lib/billing/plans.ts)
- Lưới thứ hạng: 5x5/7x7/9x9 (mặc định 7x7), 10 từ khoá, quét hàng tuần, 12 lần quét tay/tháng, trần điểm 5.500/tháng.
- Review: kiểm tra hằng ngày, tự soạn nháp, 400 lượt AI/tháng, đăng qua Make. Không có link duyệt cho chủ (`ownerLink:false`).
- Entitlement mới: `staffManaged` (route khách bị chặn duyệt review: 403), `monthlyReport`.
- Hết hạn quá 3 ngày ân hạn → về Free như các gói khác. Đổi gói áp dụng từ kỳ sau (quy tắc billing cũ).

## Luồng bán hàng
1. Khách: /billing → thẻ "Gói Làm hộ" → form (tên, SĐT, email, doanh nghiệp, lời nhắn) → `POST /api/billing/consultation`.
   Lưu `consultation_requests` + email báo admin (Resend, `notifyAdmins`). Mỗi workspace chỉ 1 yêu cầu đang mở; tối đa 5 yêu cầu/người/24h.
2. Admin: /agency → "Yêu cầu tư vấn" → đã liên hệ → "Tạo đơn" (hoặc tab "Tạo đơn" cho workspace bất kỳ, kỳ 1/3/12 tháng, số tiền tuỳ chỉnh).
   `POST /api/admin/billing/orders` tạo `payments` (manual/pending, hạn 14 ngày), trả mã QR + tin nhắn mẫu để gửi khách. Khách cũng thấy đơn ở "Lịch sử thanh toán".
3. Tiền về → SePay webhook / đối soát tự khớp mã LGOS… → `_billing_settle` → gói bật (hoặc kích hoạt tay ở /billing/admin).

## Vận hành hằng ngày (/agency, chỉ Super Admin)
- Hàng đợi theo khách: bài tự đăng chờ duyệt (sửa caption, Duyệt đăng / Từ chối), review (soạn nháp AI, duyệt & đăng qua Make hoặc "đã dán tay", bỏ qua), việc hồ sơ theo audit (xong/bỏ qua), báo cáo tháng.
- Bài của khách Làm hộ luôn vào `needs_review` kể cả khi doanh nghiệp tắt "duyệt tay" (`/api/autopost/prepare`). Sau khi duyệt, bài đăng ở lượt Make 9:00/19:00.
- Mọi thao tác ghi vào `agency_actions` (chỉ thêm, không sửa/xoá).

## Báo cáo hằng tháng
- Dựng từ lưới thứ hạng (SoLV/ARP/Top10, so với mốc trước) + số việc đã làm (bài, review, việc hồ sơ). Code: `lib/agency/report.ts` (thuần, có test).
- Cron `/api/cron/agency` (02:30 UTC hằng ngày): ngày 1–7 (giờ VN) tạo BẢN NHÁP tháng vừa qua cho từng khách; không tự gửi cho khách.
- Nhân viên xem lại ở /agency/report → "Gửi cho khách": công bố trong app (`/clients/[id]/monthly-report`) + email cho chủ/quản trị workspace.
- Cron cũng gửi email tóm tắt việc đang chờ cho admin (chỉ khi có việc). Tắt: `AGENCY_DIGEST_DISABLED=true`.

## Biến môi trường
Không thêm bắt buộc nào ngoài cờ. Dùng lại: `CRON_SECRET`, `RESEND_API_KEY` (+ from), `BILLING_BANK_ID/ACCOUNT_NO/ACCOUNT_NAME`, `SEPAY_*`, `AUTOPOST_SECRET`.
Tuỳ chọn: `AGENCY_DIGEST_DISABLED`.

## Giới hạn đã biết
- Khách đang ở gói khác còn hạn: đơn Làm hộ bắt đầu sau kỳ đó (UI admin cảnh báo).
- Chưa có UI huỷ đơn riêng; đơn chờ quá hạn tự hết hạn theo cron billing.
- Hàng đợi tải tối đa 500 doanh nghiệp, 15 mục/loại/khách.
