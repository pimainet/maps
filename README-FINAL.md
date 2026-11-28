# Local Growth OS — Gói hoàn thiện (14/11/2026)

Hệ thống audit hồ sơ Google Business Profile → lộ trình 30 ngày → sinh việc + nội dung để copy.

## Trạng thái hiện tại

- Đã có luồng đầy đủ: đăng ký → lấy dữ liệu (Outscraper + Places API) → audit (34 checks) → lộ trình 30 ngày → sinh việc + nội dung.
- Nguồn dữ liệu: **Outscraper** (chính) + **Google Places API** (bù mô tả, giờ, danh mục chính, đối chiếu rating).
- Có Review Watch, nhắc việc email, báo cáo tái khám cơ bản.
- Level 2 (làm hộ) chưa có luồng thật — chỉ giải thích trên UI.

## Dữ liệu có thể lấy được

| Nhóm | Trường | Nguồn ưu tiên |
|------|--------|---------------|
| Định danh | Tên, Place ID, địa chỉ, SĐT, website | Outscraper + Places bù |
| Danh mục | Danh mục chính | Outscraper + Places bù |
| | Danh mục phụ | Outscraper (subtypes, không chuẩn) |
| Nội dung | Mô tả, giờ mở cửa | Outscraper + Places bù |
| | Thuộc tính / tiện ích | Outscraper |
| Đánh giá | Rating, số review, ~30 review mới nhất | Outscraper |
| Hoạt động | Posts gần đây | Outscraper (không ổn định) |
| Đối thủ | Thứ hạng ước lượng + so sánh trung vị | Outscraper search |

**Hạn chế còn lại:** posts và phản hồi chủ không ổn định; không có danh sách dịch vụ chi tiết; không có tín hiệu gọi/chỉ đường (cần Business Profile API).

## Biến môi trường cần thiết

```bash
# Bắt buộc
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=

# Nguồn dữ liệu
OUTSCRAPER_API_KEY=
GOOGLE_PLACES_API_KEY=          # tùy chọn, dùng để bù dữ liệu
SEARCHAPI_API_KEY=              # tùy chọn: bù mô tả, bài đăng, giờ, thuộc tính, hỏi–đáp (rẻ, gọi trước)
SERPAPI_API_KEY=                # tùy chọn: như trên + review kèm phản hồi của chủ + bài đăng có ngày chính xác
GBP_ENRICH_PLACE_ORDER=         # tùy chọn, mặc định "searchapi,serpapi"

# Tùy chọn
CRON_SECRET=
REVIEW_WATCH_ENABLED=false
# AUDIT_ENGINE_MODE đã bị gỡ: chỉ còn một engine chấm điểm (v2). Có đặt biến này trong Vercel cũng bị bỏ qua — nên xoá cho gọn.
```

## Cài đặt nhanh

```bash
cd map
npm install
# tạo .env.local với các biến trên
npm run dev
```

Chạy migration trong thư mục `supabase/migrations/` theo thứ tự số.

## Kiểm tra logic

```bash
npm run test:logic
```

## Audit: một engine duy nhất, điểm lặp lại được

Engine cũ (v1: một prompt Claude tự chấm, temperature 0.4, thang 10) **đã bị gỡ khỏi code**; công tắc `AUDIT_ENGINE_MODE` cũng bỏ.
`POST /api/audit` luôn chạy engine trong `lib/audit-engine/` (qua `lib/run-audit-v2.ts`): **rule quyết đạt/không đạt, điểm là số học
thuần (thang 100)**; AI chỉ phân loại một số mục (temperature 0, kết quả cache theo nội dung trong bảng `ai_classification_cache`) và
viết lời giải thích — lời không ảnh hưởng điểm.

Mỗi audit gọi Claude tối đa 8 lần (phân loại danh mục, mô tả, review, đa dạng + chất lượng bài đăng; 2 lần cho lời khuyên danh mục/mô tả mẫu;
1 lần viết nhận xét). Các lần phân loại trùng nội dung được lấy từ cache nên audit lặp lại rẻ hơn. Nếu AI lỗi: mục đó thành
"chưa đủ dữ liệu", lời nhận xét dựng bằng code — điểm vẫn ra, audit không hỏng.

Biến môi trường cho audit:

| Biến | Vai trò | Thiếu thì |
|---|---|---|
| `ANTHROPIC_API_KEY` | Phân loại + viết lời | Các mục cần AI "chưa đủ dữ liệu", lời nhận xét dựng bằng code |
| `OUTSCRAPER_API_KEY` | Lấy hồ sơ Maps, review, **nhóm đối thủ** | Không có hồ sơ thì audit không chạy (422); không có nhóm đối thủ thì VY01/VY03/T01/T02 "chưa đủ dữ liệu" |
| `SEARCHAPI_API_KEY`, `SERPAPI_API_KEY` | Bù từng trường (mô tả, bài đăng có ngày, review kèm phản hồi chủ, giờ, thuộc tính, hỏi–đáp) | Một số mục đọc chưa đủ, không kết luận là thiếu |
| `GOOGLE_PLACES_API_KEY` | Bù dữ liệu cơ bản | Như trên |
| `DATAFORSEO_LOGIN/PASSWORD` + cờ lưới thứ hạng | VY02/VY04 (độ phủ theo vị trí) | Hai mục này "chưa đủ dữ liệu" |

Kiểm tra website của khách (F-nhóm) là HTTP GET trực tiếp, không cần khoá. Lịch sử số review (T04) lấy từ snapshot đã lưu.

Audit **kiểu cũ** đã lưu (cột `checks_json` rỗng) vẫn xem được, chỉ đọc: trang Kiểm tra hồ sơ tự hiện audit gần nhất kèm ghi chú "kiểu cũ";
lộ trình 30 ngày và trí nhớ khách hàng vẫn đọc văn bản `audit_result` của chúng. Điểm cũ (thang 10) không so sánh trực tiếp với điểm mới;
lần audit mới đầu tiên sẽ báo rõ điều đó. Không có dòng nào bị sửa hay xoá.

Đo nhiễu thật trên một doanh nghiệp (tốn lượt Claude / credit Outscraper):
`npx tsx --env-file=.env.local scripts/measure-audit-noise.ts --url "<link Maps>" --area "<khu vực>" --runs 5`
Kết quả cho biết check nào nên thêm vào `VOLATILE_CHECK_IDS` (`lib/audit-engine/stability.ts`).

Cách tính điểm (scoring v3: trọng số theo từng check, chuẩn hoá minh bạch, ngưỡng độ phủ 30%): xem `docs/AUDIT_SCORING.md`.

Quy ước so sánh: điểm chỉ so được giữa các lần cùng **major version** của `ENGINE_VERSION` (`lib/audit-engine/types.ts`)
**và** cùng `SCORING_VERSION` (`lib/audit-engine/weights.ts`).
Đổi tập check / ngưỡng / trọng số thì tăng MAJOR; sửa lỗi không đổi thang điểm thì tăng PATCH. Sửa prompt phân loại thì
tăng `CLASSIFIER_PROMPT_VERSION` (`classifier-cache.ts`) để không dùng lại kết quả cache cũ.

## Ghi chú

- Cache snapshot 30 phút cho audit.
- Places API tính phí sau free tier (Enterprise + Atmosphere ~1.000 free/tháng).
- Outscraper ~$3/1.000 records.
