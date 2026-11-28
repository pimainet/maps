# Cách tính điểm audit (scoring v3)

Áp dụng từ `ENGINE_VERSION` 3.0.0, `SCORING_VERSION` 3 (`lib/audit-engine/weights.ts`).

## Công thức

- Mỗi check có **một trọng số** (bảng dưới). Check trọng số 0 chỉ hiển thị: không tính điểm, không vào độ phủ, không vào so sánh.
- **Điểm tổng = tổng trọng số các check ĐẠT ÷ tổng trọng số các check CÓ DỮ LIỆU × 100.**
  Check "chưa đủ dữ liệu" bị bỏ ra; phần của nó chia theo tỉ lệ cho các check còn lại. Chuẩn hoá theo **từng check**, không theo
  nhóm, nên một check đơn lẻ không thể chiếm cả phần của một nhóm (ở v2: "có ≥1 bài đăng" từng chiếm 14,3% điểm).
- Nếu phần trọng số có dữ liệu **dưới 30%** thì không chấm điểm tổng (hiện "Chưa đủ dữ liệu để chấm").
- Điểm nhóm = cùng công thức nhưng chỉ trong nhóm. Nhóm "Chuyển đổi" (CV01–CV04) chỉ suy ra từ check khác nên trọng số 0
  (trước đây website hỏng bị trừ 3 lần: F06, CV01, CV04).
- Báo cáo lưu `scoringVersion` và `weighting` (trọng số gốc, phần có dữ liệu, trọng số thực tế từng check). Giao diện có bảng
  "Cách tính điểm"; văn bản audit có dòng "Cách tính".
- Mức ưu tiên trong văn bản và thứ tự "việc nên làm" xếp theo trọng số (≥6 Cao, 3–5 Trung bình, còn lại Thấp; hồ sơ đóng cửa /
  chưa nhận quyền luôn Cao).

## So sánh giữa các lần audit

Chỉ so khi cùng major `ENGINE_VERSION` **và** cùng `scoringVersion`. Báo cáo cũ không có `scoringVersion` coi là v2 (chia đều
7 nhóm) nên lần audit v3 đầu tiên báo "Lần kiểm tra trước dùng cách tính điểm khác (trọng số cũ)…". Đổi trọng số thì tăng
`SCORING_VERSION`.

## Bảng trọng số

| Nhóm | Tổng | Check (trọng số) |
|---|---|---|
| Liên quan: danh mục, dịch vụ | 25 | R06 danh mục chính so với 3–5 quán top 7, R02 danh mục phụ so với đối thủ 6, R03 dịch vụ 3, R04 mô tả 3, R01 danh mục chính đúng ngành (AI) 5, R05 thuộc tính 1 |
| Review | 25 | T02 sao so đối thủ 6, T01 số review so đối thủ 5, T07 tốc độ review mới so với 3 đối thủ đứng đầu 5, T03 review mới nhất ≤ 21 ngày 4, T05 tỉ lệ phản hồi 3, VY03 so trung vị đối thủ 2 |
| Hiển thị, khoảng cách | 20 | VY04 phủ quanh quán (lưới) 10, VY01 thứ hạng tìm theo khu vực 6, VY02 nhiều từ khoá 4 |
| Nền tảng | 15 | F02 3, F04 3, F07 3, F01 2, F05 2, F03 1, F06 1 |
| Website địa phương | 10 | W01 tên/địa chỉ/SĐT trên website khớp hồ sơ 4, W02 quận/thành phố trong title hoặc H1 3, W03 schema LocalBusiness 2, W04 HTTPS + viewport điện thoại 1 |
| Ảnh và bài đăng | 5 | V01 số ảnh 2, C02 bài đăng gần đây 2, C01 có bài đăng 1 |
| Chỉ hiển thị (0) | – | CV01–CV04, T04, T06, C03, C04, V02–V04 |

## Cơ sở (giả thuyết, cần kiểm chứng trên dữ liệu Việt Nam)

- Whitespark Local Search Ranking Factors 2026: danh mục chính #1, khoảng cách #2, sao #6; số ảnh #96, bài đăng #148.
- Hướng dẫn của Google (relevance, distance, prominence): đánh giá và vị trí là tín hiệu nổi bật; bài đăng/ảnh hỗ trợ chuyển đổi.
- Trọng số là lựa chọn sản phẩm, không phải số đo của Google. Khi có đủ audit + lưới thứ hạng thật, nên hồi quy lại.

## Website địa phương (W01–W04)

`lib/website-signals.ts` lấy trang chủ website trên hồ sơ (`lib/safe-fetch.ts`):
- Chống SSRF: chỉ http/https cổng 80/443, không user:pass; phân giải DNS ngay lúc kết nối và từ chối IP nội bộ / loopback /
  link-local (169.254.169.254) / CGNAT / IPv6 nội bộ / IPv4-mapped; kiểm tra lại ở mỗi lần chuyển hướng (tối đa 4).
- Giới hạn 10 giây, 1,5 MB (cả sau giải nén). User-Agent `LocalGrowthOS-AuditBot/1.0`.
- Tôn trọng robots.txt (RFC 9309); robots.txt lỗi 5xx hoặc không tải được thì không lấy trang.
- Link là Facebook/Zalo/Instagram/sàn… thì không chấm (chưa đủ dữ liệu). Website chết đã tính ở F06, không trừ lần nữa.
- Cache 7 ngày trong `gbp_snapshots.raw_json.audit_cache.website_signals` (theo URL + tên/SĐT/địa chỉ hồ sơ). Không cần migration.

## Review gần đây so với đối thủ (T07) và T03

- T03: review mới nhất phải trong **21 ngày** (trước đây 45). Sterling Sky ghi nhận thứ hạng tụt khi ~18 ngày không có review mới.
- T07: số review 90 ngày của hồ sơ ≥ 50% trung vị của 3 đối thủ đứng đầu (cả hai bên đếm tối đa `COMPETITOR_REVIEW_LIMIT`
  review để so công bằng). Hiện kèm số 30 ngày và tuổi review mới nhất của đối thủ.
- Dữ liệu đối thủ: Outscraper `reviews-v3`, sort newest, `cutoff` = 90 ngày trước (chỉ trả/tính tiền review trong 90 ngày).
  `COMPETITOR_REVIEW_SAMPLE` (mặc định 3, tối đa 5, 0 = tắt), `COMPETITOR_REVIEW_LIMIT` (mặc định 20, tối đa 30).
  Cache 14 ngày trong `raw_json.audit_cache.competitor_velocity` theo tập đối thủ.

## Lưới mini 5×5 kèm audit (VY04)

- Chỉ chạy khi `AUDIT_MINI_GRID_ENABLED=true`, có `DATAFORSEO_LOGIN/PASSWORD`, và khách **chưa** có lần quét lưới ≤ 14 ngày
  (có thì dùng lần quét đó).
- 1 từ khoá: từ khoá chính đã cấu hình ở Lưới thứ hạng, không có thì danh mục chính (không kèm địa danh). 25 điểm quanh toạ độ
  của quán (cấu hình lưới -> toạ độ đã lưu, toạ độ Places quá 30 ngày bỏ qua -> tra cứu tạm, không lưu). DataForSEO live.
- Chốt chi phí: trần hệ thống `RANKGRID_MONTHLY_BUDGET_USD` (gộp cả lưới đầy đủ và lưới mini); hạn mức mỗi workspace
  `AUDIT_MINI_GRID_WORKSPACE_POINTS` điểm/tháng (mặc định 125) giữ chỗ nguyên tử bằng RPC `audit_minigrid_reserve`
  (**migration 034, chưa áp**); điểm lỗi được trả lại; cache 14 ngày. Thiếu bất kỳ điều kiện nào: VY04 "chưa đủ dữ liệu".
- VY02 (nhiều từ khoá) cần ≥ 3 từ khoá nên vẫn chỉ có dữ liệu khi khách dùng lưới đầy đủ.

## Chi phí mỗi audit (VND, tỉ giá 26.030đ/USD)

| Phần | Khi nào tốn | Chi phí |
|---|---|---|
| Claude Sonnet 4.5 (phân loại + lời nhận xét + lời khuyên, tối đa 8 lần) | Mỗi audit; phân loại trùng nội dung lấy từ cache | ≤ ~3.400đ |
| Outscraper hồ sơ + review + nhóm đối thủ | Snapshot mới; nhóm đối thủ cache 14 ngày | ≤ ~4.000đ |
| SearchApi / SerpApi bù trường | Khi thiếu trường | ~100đ |
| **Mới** T07: review 90 ngày của 3 đối thủ (≤ 3 × 20 review, $3/1.000) | Lần đầu hoặc sau 14 ngày / đổi nhóm đối thủ | ≤ ~4.700đ (thường ~2.000đ vì chỉ tính review trong 90 ngày; 0đ trong 500 review miễn phí/tháng) |
| **Mới** Website W01–W04 | Mỗi 7 ngày | 0đ |
| **Mới** R06 danh mục so với quán top | Dùng dữ liệu đã có | 0đ |
| **Mới** Lưới mini 5×5 (25 × $0,002) | Chỉ khi bật cờ, chưa có lưới đầy đủ ≤ 14 ngày, không có cache | ~1.300đ |
| **Tổng** | | ~7.500đ khi có cache; tối đa ~13.500đ lần đầu (bật đủ) |
