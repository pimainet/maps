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

Hồ sơ Google Maps giờ được lấy qua [Outscraper](https://outscraper.com) thay cho trình duyệt Browserbase.

| Biến | Ý nghĩa |
| --- | --- |
| `OUTSCRAPER_API_KEY` | API key. Có biến này thì Outscraper là nguồn mặc định. |
| `GBP_PROVIDER` | Tùy chọn: `outscraper`, `browser` (nguồn Browserbase cũ, cần `BROWSERBASE_API_KEY`) hoặc `places`. Bỏ trống = tự chọn theo key có sẵn. |
| `OUTSCRAPER_LANGUAGE`, `OUTSCRAPER_REGION` | Mặc định `vi`, `VN`. |

Places API (`GOOGLE_PLACES_API_KEY`) vẫn dùng để đối chiếu số liệu và làm dự phòng khi Outscraper lỗi.

**Chưa xác minh với dữ liệu thật** (làm 1 request thử trước khi tin): trường `owner_answer` của review, trường `posts`,
và `subtypes` có đúng là danh mục phụ không. Thiếu `owner_answer` thì hệ thống ghi cảnh báo và không kết luận tỉ lệ phản hồi;
thiếu `posts` thì ghi "không kết luận là chưa đăng bài". Danh sách dịch vụ chi tiết không có từ Outscraper (coverage ghi `skipped`).

Kiểm tra mapping: `npx tsx scripts/test-outscraper-mapping.ts`.

## Review Watch (theo dõi review hàng tuần)

Mỗi thứ Hai 09:00 giờ Việt Nam (`vercel.json`), hệ thống lấy review mới của từng doanh nghiệp (chỉ phần mới từ lần trước,
rẻ), tự tạo việc **ưu tiên cao kèm bản nháp phản hồi** cho review ≤ 3★ chưa được phản hồi, và gộp review tốt chưa phản hồi
thành 1 việc mức thấp. Không tạo việc trùng.

1. Chạy migration `supabase/migrations/018_review_watch.sql`.
2. Đặt `REVIEW_WATCH_ENABLED=true` (mặc định TẮT vì tốn credit Outscraper và Claude), cùng `CRON_SECRET`, `OUTSCRAPER_API_KEY`.
3. Xem trước: `GET /api/cron/review-watch?dry=1` với header `Authorization: Bearer <CRON_SECRET>`. Thêm `&client_id=<uuid>` để thử 1 doanh nghiệp.
4. `REVIEW_WATCH_MAX_CLIENTS` (mặc định 30) giới hạn số doanh nghiệp mỗi lần chạy; doanh nghiệp kiểm tra lâu nhất được ưu tiên.

Kiểm tra logic: `npx tsx scripts/test-review-watch.ts`.

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
GBP_PROVIDER=outscraper       # tuỳ chọn, bỏ trống cũng tự chọn Outscraper khi có key
REVIEW_WATCH_ENABLED=false    # bật true sau khi thử xong
CRON_SECRET=...               # chuỗi ngẫu nhiên dài, dùng cho route cron
```

Chạy thử với dữ liệu thật: `npm run check:outscraper -- "Tên quán Quận 1"`. Chạy test logic: `npm run test:logic`.
