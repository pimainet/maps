# Local Growth OS

## Thiết lập nhắc việc qua email

Mỗi sáng khoảng 8 giờ (giờ Việt Nam), hệ thống gửi email cho người có việc đến hạn hoặc quá hạn
(thứ Hai nhắc nhẹ nếu còn việc). Không có việc thì không gửi. Mỗi người tối đa một email mỗi ngày
và tắt được trong Cài đặt, mục Nhắc việc, hoặc bằng link cuối email.

1. **Chạy migration** `supabase/migrations/014_progress_and_reminders.sql` trên database
   (thêm `tasks.completed_at` và bảng `notification_prefs`). Chưa chạy thì ứng dụng vẫn hoạt động,
   chỉ chưa có dòng "tuần này bạn đã xong N việc" và chưa lưu được tùy chọn nhắc việc.
2. **Tạo tài khoản Resend** (https://resend.com), xác minh tên miền gửi thư, tạo API key.
3. **Đặt biến môi trường** (Vercel, Settings, Environment Variables):

   | Biến | Ý nghĩa |
   | --- | --- |
   | `CRON_SECRET` | Chuỗi bí mật dài, ngẫu nhiên. Vercel tự gửi nó khi gọi cron. Không đặt thì cron tắt hẳn. |
   | `RESEND_API_KEY` | API key của Resend. |
   | `REMINDER_FROM_EMAIL` | Người gửi, ví dụ `Nhắc việc <nhacviec@tenmiencuaban.vn>` (tên miền phải đã xác minh trên Resend). |
   | `NOTIFY_SECRET` | Tùy chọn. Khóa ký link hủy nhắc việc. Bỏ trống thì dùng `CRON_SECRET`. |
   | `NEXT_PUBLIC_APP_URL` | Tùy chọn. Địa chỉ ứng dụng cho link trong email, ví dụ `https://app.tenmiencuaban.vn`. Trên Vercel tự lấy từ tên miền production nếu bỏ trống. |

4. **Kiểm tra trước khi bật thật.** Vào Cài đặt, Nhắc việc, bấm "Gửi thử cho tôi" để nhận một email mẫu.
   Để xem hôm nay sẽ gửi cho ai mà chưa gửi thật, gọi
   `GET /api/cron/reminders?dry=1` với header `Authorization: Bearer <CRON_SECRET>`.

Lịch chạy nằm ở `vercel.json` (`0 1 * * *` = 08:00 giờ Việt Nam).

## Nguồn dữ liệu Google Maps: Outscraper

Mỗi lần bấm **Kiểm tra hồ sơ** (`POST /api/audit`), hệ thống tự lấy hồ sơ + tối đa 30 review mới nhất của doanh nghiệp qua
[Outscraper](https://outscraper.com), lưu vào `gbp_snapshots`, rồi mới chạy audit. Không còn nhập số liệu tay.

- Bấm lại trong vòng 30 phút thì dùng lại dữ liệu vừa lấy (không tốn thêm credit).
- Lấy mới thất bại -> dùng bản đã lưu gần nhất và báo rõ là có thể cũ. Không có dữ liệu nào -> trả lỗi 422, **không** gọi Claude.
- Link/place_id không ra kết quả -> tự thử lại theo tên + khu vực (có cảnh báo trong dữ liệu).
- Chi phí mỗi audit bị chặn bởi hạn mức sẵn có: 3 audit/khách/30 ngày và rate-limit `audit`.

| Biến | Ý nghĩa |
| --- | --- |
| `OUTSCRAPER_API_KEY` | API key. Thiếu thì chỉ dùng Places API (ít dữ liệu hơn: ~5 review, không có phản hồi của chủ). |
| `OUTSCRAPER_LANGUAGE`, `OUTSCRAPER_REGION` | Mặc định `vi`, `VN`. |
| `GOOGLE_PLACES_API_KEY` | Tuỳ chọn: đối chiếu số liệu, bù trường thiếu và làm dự phòng khi Outscraper lỗi. |
| `SEARCHAPI_API_KEY` | Tuỳ chọn (searchapi.io, ~$0,004/lần): bù mô tả, danh mục phụ, bài đăng, giờ, thuộc tính, hỏi–đáp. Gọi trước vì rẻ. |
| `SERPAPI_API_KEY` | Tuỳ chọn (serpapi.com, ~$0,015–0,025/lần): như trên, cộng review mới nhất KÈM phản hồi của chủ (tỉ lệ phản hồi T05) và bài đăng có ngày đăng chính xác (C02). |
| `GBP_ENRICH_PLACE_ORDER` | Tuỳ chọn, mặc định `searchapi,serpapi`. |

Bù dữ liệu theo từng trường (`lib/gbp-enrich.ts`): chỉ gọi nguồn phụ khi trường còn thiếu, mỗi engine tối đa 1 lần cho 1 snapshot,
nguồn của từng trường ghi ở `coverage.field_sources`. Thử với 1 quán thật: `npx tsx scripts/try-serpapi.ts <place_id>`.

Biến `GBP_PROVIDER` và nguồn Browserbase/Playwright đã bị gỡ; biến này nếu còn trên Vercel sẽ bị bỏ qua.

**Chưa xác minh với dữ liệu thật** (làm 1 request thử trước khi tin): trường `owner_answer` của review, trường `posts`,
và `subtypes` có đúng là danh mục phụ không. Thiếu `owner_answer` thì hệ thống ghi cảnh báo và không kết luận tỉ lệ phản hồi;
thiếu `posts` thì ghi "không kết luận là chưa đăng bài". Danh sách dịch vụ chi tiết không có từ Outscraper (coverage ghi `skipped`).

Kiểm tra: `npm run test:logic` (mapping Outscraper, lớp mạng với fetch giả, dựng prompt audit...).

## Hộp thư review (Review Watch + phản hồi) — mặc định TẮT

Chi tiết: `docs/REVIEW_INBOX.md`. Thay thế 018 (chưa từng chạy trên DB thật) bằng `029_review_inbox.sql`:
mỗi review 1 dòng (khớp giữa Outscraper / SearchApi / SerpApi / Business Profile API), phân loại khẩn, nháp phản hồi AI theo
số sao, vòng đời duyệt `new → drafted → approved → posted | manual_copied | ignored | replied_elsewhere | failed`,
trang `/clients/<id>/reviews`, link duyệt cho chủ quán `/r/<token>`, đăng qua Make (tuỳ chọn) hoặc copy dán tay.

1. Chạy migration `supabase/migrations/029_review_inbox.sql` (KHÔNG chạy 018).
2. `NEXT_PUBLIC_REVIEW_INBOX_ENABLED=true` rồi redeploy. Cron tự lấy review (hàng ngày 09:00 VN, tần suất thật theo gói):
   thêm `REVIEW_WATCH_ENABLED=true`, `CRON_SECRET`, `OUTSCRAPER_API_KEY` (tuỳ chọn `SEARCHAPI_API_KEY`, `SERPAPI_API_KEY`).
3. Xem trước: `GET /api/cron/review-watch?dry=1` (header `Authorization: Bearer <CRON_SECRET>`), `&client_id=<uuid>` cho 1 doanh nghiệp.
4. `REVIEW_WATCH_MAX_CLIENTS` (mặc định 30) giới hạn số doanh nghiệp mỗi lượt; `REVIEW_DRAFTS_FREE|BASIC|FULL` ghi đè trần nháp AI.

Kiểm tra logic: `npx tsx scripts/test-review-watch.ts && npx tsx scripts/test-review-inbox.ts`.

## So sánh đối thủ và thứ hạng tìm kiếm (Audit Engine v2)

`/api/audit/v2-preview` giờ tự tìm "<danh mục chính> <khu vực>" qua Outscraper (tối đa `COMPETITOR_SEARCH_LIMIT`, mặc định 20 địa điểm) để bật:

- **VY01 Keyword Visibility**: hồ sơ đứng thứ mấy khi tìm đúng truy vấn đó (đạt nếu top 3).
- **VY03 Competitor Benchmark**: so review, sao, ảnh với **trung vị** đối thủ (kèm số review còn thiếu).
- **T01, T02**: số review và điểm sao so với trung vị đối thủ (trước đây luôn "insufficient"; đã đổi từ trung bình sang trung vị).

Lưu ý: kết quả tìm kiếm không cá nhân hoá theo vị trí người tìm nên mọi kết luận này ghi **estimated**. VY02 (nhiều từ khoá) và
VY04 (lưới vị trí) vẫn "insufficient" vì tốn credit gấp nhiều lần. Cần có danh mục chính và khu vực (khai ở client hoặc suy từ địa chỉ);
thiếu thì các check này giữ "insufficient". Kết quả cache 14 ngày trong cột `gbp_snapshots.competitors`; `forceRefresh: true` để làm mới.
Tier Visibility từ nay có điểm số (trước đây toàn insufficient) nên điểm tổng của audit v2 sẽ thay đổi so với trước.

Kiểm tra: `npx tsx scripts/test-competitors.ts`.

## Biến môi trường mới (thêm vào `.env.local` và vào Vercel)

```
OUTSCRAPER_API_KEY=...        # bắt buộc, lấy ở app.outscraper.com > Profile > API
REVIEW_WATCH_ENABLED=false    # bật true sau khi thử xong
CRON_SECRET=...               # chuỗi ngẫu nhiên dài, dùng cho route cron
```

Chạy thử với dữ liệu thật: `npm run check:outscraper -- "Tên quán Quận 1"`. Chạy test logic: `npm run test:logic`.

## Tự đăng bài Google Business (kho ảnh + Make)

Mặc định **tắt** (`AUTO_POST_ENABLED` trong `lib/features.ts`). Khi bật:

- Trang kho ảnh: `/clients/[id]/photos`
- Link gửi ảnh không cần đăng nhập: `/u/<token>`
- Make gọi `POST /api/autopost/prepare` rồi báo kết quả `POST /api/autopost/result` (cũng nhận `/api/autopost/report`).

Thêm vào `.env.local` và Vercel (không commit file `.env`):

```
AUTOPOST_SECRET=...           # chuỗi ngẫu nhiên dài, header Authorization: Bearer <secret>
ANTHROPIC_API_KEY=...         # đã dùng cho audit; vision/caption cũng dùng key này
GOOGLE_PLACES_API_KEY=...     # tuỳ chọn, để lấy toạ độ doanh nghiệp khi geotag
NEXT_PUBLIC_APP_URL=...       # tuỳ chọn, URL public của app
```

Chạy test helper: `npx tsx scripts/test-autopost-helpers.ts`.
