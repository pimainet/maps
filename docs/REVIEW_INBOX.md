# Hộp thư review (Review Watch + phản hồi) — thiết kế & vận hành

Trạng thái: **code xong, mặc định TẮT**. Migration `029_review_inbox.sql` **chưa chạy** trên DB thật.

## 1. Luồng

```
Nguồn review                          App (Next.js + Supabase)                         Đầu ra
───────────────                       ─────────────────────────                        ──────
Bản chụp hồ sơ (audit) ── miễn phí ─┐
Outscraper reviews-v3 (newest+cutoff)├─> ingest: khớp review giữa các nguồn ─> client_reviews (1 dòng / review)
SearchApi / SerpApi (dự phòng)      ─┤   (dấu vân tay tên|sao|nội dung)        ├─ triage luật: cảm xúc + mức khẩn
Business Profile API qua Make ──────┘   phát hiện chủ đã tự phản hồi          ├─ nháp AI (Claude) theo gói
                                                                                ├─ việc (tasks) ≤3★/khẩn + "cảm ơn"
Người dùng: /clients/<id>/reviews  ─ sửa / duyệt / sao chép / bỏ qua ──────────┤
Chủ quán:   /r/<token> (không đăng nhập) ─ duyệt / sửa / soạn giúp ────────────┤
Make: /api/reviews/prepare(sync) → GET reviews → /api/reviews/sync               ├─ ghép tên review GBP
      /api/reviews/prepare(post) → PUT reviews/{r}/reply → /api/reviews/result   └─ posted / failed
Mặc định (chưa nối Make): copy & dán tay trên Google, bấm "Đã dán".
```

Vòng đời: `new → drafted → approved → posting → posted`; ngoài ra `manual_copied`, `ignored`,
`replied_elsewhere` (nguồn thấy chủ đã phản hồi ngoài hệ thống), `failed` (Make lỗi 3 lần hoặc lỗi 400/403/404).
Review xử lý xong thì việc (task) gắn với nó tự đóng.

## 2. Gói (lib/billing/plans.ts `REVIEW_LIMITS`)

| | Miễn phí | Khởi động 349k | Nâng cao 799k |
|---|---|---|---|
| Tự kiểm tra review | không (chỉ review từ lần kiểm tra hồ sơ) | hàng tuần | hàng ngày |
| Tự soạn nháp AI | không | có | có |
| Lượt nháp AI / tháng | 5 (bấm tay) | 40 | 150 |
| "Kiểm tra review ngay" / tháng | 0 | 2 | 8 |
| Link duyệt cho chủ quán | không | có | có |
| Đăng qua Make | không (copy dán) | có | có |

Ghi đè trần nháp: `REVIEW_DRAFTS_FREE|BASIC|FULL`. Trần doanh nghiệp / lượt cron: `REVIEW_WATCH_MAX_CLIENTS` (mặc định 30).
Lưu ý: trang /billing hiện chỉ ghi "Cảnh báo đánh giá thấp sao" ở gói Nâng cao — cần sửa lời giới thiệu nếu giữ mặc định trên.

## 3. Dữ liệu & chi phí nguồn

- Outscraper `reviews-v3` sort=newest + cutoff: tính **theo review** (~$3/1.000, 500 review đầu mỗi 30 ngày miễn phí cho cả
  tài khoản). Có ngày chính xác và `owner_answer` (DB thật 28/11/2026: 9/18 review có phản hồi được trả về).
- Mỗi 7 ngày quét rộng từ review còn mở cũ nhất (≤ 30 ngày) để bắt phản hồi chủ làm thẳng trên Google.
- SearchApi (~$0,004/lần) → SerpApi (~$0,015/lần) chỉ khi Outscraper lỗi; cần `place_id` (hiện chỉ 3/11 doanh nghiệp có).
- Business Profile API qua Make: chính xác nhất, miễn phí; hồ sơ đồng bộ trong 48 giờ thì cron bỏ qua nguồn trả phí.

## 4. Ghép review với Business Profile API

ID review của Outscraper/SerpApi (id Maps) **khác** `reviewId` của GBP API. Muốn đăng phản hồi qua API phải có
`accounts/{a}/locations/{l}/reviews/{r}`. Make lấy 50 review mới nhất (`GET /v4/{location}/reviews`) gửi về `/api/reviews/sync`;
app ghép chặt (`matchGbpReview`): bắt buộc cùng số sao, rồi cùng 40 ký tự đầu nội dung (bỏ phần "Translated by Google"),
hoặc cùng tên + ngày lệch ≤ 2 ngày. Nhiều ứng viên → không ghép (thà dán tay còn hơn trả lời nhầm khách).
Không ghép được (review cũ hơn 50 review mới nhất…) → nút "Sao chép" + "Đã dán".

## 5. Bật tính năng

1. Duyệt và chạy `supabase/migrations/029_review_inbox.sql` (idempotent, đã test trên Postgres nháp cả khi 018 đã/chưa chạy).
2. Vercel env: `NEXT_PUBLIC_REVIEW_INBOX_ENABLED=true` (nhúng lúc build → redeploy), `ANTHROPIC_API_KEY` (đã có),
   `NEXT_PUBLIC_APP_URL` (link trong việc). Muốn cron tự lấy review: thêm `REVIEW_WATCH_ENABLED=true` + `OUTSCRAPER_API_KEY`
   (đã có) và tuỳ chọn `SEARCHAPI_API_KEY`, `SERPAPI_API_KEY`, `REVIEW_WATCH_MAX_CLIENTS`. Cron: hàng ngày 09:00 VN.
3. Make (tuỳ chọn): xem `docs/make/reviews-blueprint.json` — mở rộng scenario autopost 8857752 thêm 2 nhánh. Dùng chung
   `AUTOPOST_SECRET` (hoặc đặt `REVIEWS_MAKE_SECRET`), `REVIEWS_GBP_SYNC_EVERY_HOURS` (mặc định 168).

## 6. Luật soạn phản hồi (lib/reviews/reply-rules.ts)

Ngắn theo số sao (5★ 20–55 từ … 1–2★ 40–95 từ), cá nhân hoá theo điều khách nêu, ngôn ngữ của review, không nêu tên/thông tin
cá nhân của khách, không ưu đãi/quà/hoàn tiền, không xin sửa/xoá review, không số điện thoại/email/link (tự xoá nếu AI lỡ viết),
không lặp câu của 5 phản hồi gần nhất, review thấp: xin lỗi + ghi nhận đúng vấn đề + mời liên hệ qua kênh trên hồ sơ.
Nội dung review được coi là dữ liệu (chống chèn lệnh). Giới hạn cứng 4096 byte (Google).
