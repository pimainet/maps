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

# Tùy chọn
CRON_SECRET=
REVIEW_WATCH_ENABLED=false
AUDIT_ENGINE_MODE=v1            # v1 (mặc định) | shadow | v2 — xem mục "Điểm audit lặp lại được" bên dưới
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

## Điểm audit lặp lại được (Audit Engine v2)

Vấn đề: ở chế độ `v1`, điểm do Claude tự chấm trong một prompt (temperature 0.4) nên cùng một hồ sơ có thể ra điểm khác nhau
giữa hai lần. Engine v2 (`lib/audit-engine/`) sửa tận gốc: **rule quyết đạt/không đạt, điểm là số học thuần**; AI chỉ phân loại
4 mục (temperature 0, kết quả được cache theo nội dung đầu vào) và viết lời giải thích — lời không ảnh hưởng điểm.

Công tắc `AUDIT_ENGINE_MODE` (đổi env rồi redeploy, lùi về `v1` bất cứ lúc nào):

| Giá trị | Khách thấy | Ghi chú |
|---|---|---|
| `v1` (mặc định) | Kết quả cũ | Không đổi gì |
| `shadow` | Kết quả cũ | v2 chạy ngầm sau khi đã trả lời, lưu vào `audits` (`module_key='maps_seo_v2'`, `raw_input.shadow_of`) để đối chiếu |
| `v2` | Kết quả v2 | Có độ phủ dữ liệu, so sánh với lần trước theo từng mục |

Lộ trình khuyến nghị: chạy migration 019 + 020 → `shadow` 1–2 tuần → xem đối chiếu → `v2`.

Đối chiếu v1 ↔ v2 trên khách thật (SQL Editor):

```sql
select c.name, count(*) as lan,
       round(stddev_pop((a.raw_input->>'v1_overall_10')::numeric), 2) as v1_dao_dong_tren_10,
       round(stddev_pop(a.score_overview / 10.0), 2)                  as v2_dao_dong_tren_10
from audits a join clients c on c.id = a.client_id
where a.module_key = 'maps_seo_v2' and a.raw_input ? 'shadow_of'
group by c.name having count(*) >= 2 order by 1;
```

Đo nhiễu thật trên một doanh nghiệp (tốn lượt Claude / credit Outscraper):
`npx tsx --env-file=.env.local scripts/measure-audit-noise.ts --url "<link Maps>" --area "<khu vực>" --runs 5`
Kết quả cho biết check nào nên thêm vào `VOLATILE_CHECK_IDS` (`lib/audit-engine/stability.ts`).

Quy ước so sánh: điểm chỉ so được giữa các lần cùng **major version** của `ENGINE_VERSION` (`lib/audit-engine/types.ts`).
Đổi tập check / ngưỡng / trọng số thì tăng MAJOR; sửa lỗi không đổi thang điểm thì tăng PATCH. Sửa prompt phân loại thì
tăng `CLASSIFIER_PROMPT_VERSION` (`classifier-cache.ts`) để không dùng lại kết quả cache cũ.

## Ghi chú

- Cache snapshot 30 phút cho audit.
- Places API tính phí sau free tier (Enterprise + Atmosphere ~1.000 free/tháng).
- Outscraper ~$3/1.000 records.
