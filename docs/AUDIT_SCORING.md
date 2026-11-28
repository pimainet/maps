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
| Liên quan: danh mục, dịch vụ | 25 | R01 danh mục chính đúng ngành 12, R02 danh mục phụ so với đối thủ 6, R03 dịch vụ 3, R04 mô tả 3, R05 thuộc tính 1 |
| Review | 25 | T03 review mới 8, T01 số review so đối thủ 6, T02 sao so đối thủ 6, T05 tỉ lệ phản hồi 3, VY03 so trung vị đối thủ 2 |
| Hiển thị, khoảng cách | 20 | VY04 phủ quanh quán (lưới) 10, VY01 thứ hạng tìm theo khu vực 6, VY02 nhiều từ khoá 4 |
| Nền tảng | 15 | F02 3, F04 3, F07 3, F01 2, F05 2, F03 1, F06 1 |
| Ảnh và bài đăng | 5 | V01 số ảnh 2, C02 bài đăng gần đây 2, C01 có bài đăng 1 |
| Chỉ hiển thị (0) | – | CV01–CV04, T04, T06, C03, C04, V02–V04 |

## Cơ sở (giả thuyết, cần kiểm chứng trên dữ liệu Việt Nam)

- Whitespark Local Search Ranking Factors 2026: danh mục chính #1, khoảng cách #2, sao #6; số ảnh #96, bài đăng #148.
- Hướng dẫn của Google (relevance, distance, prominence): đánh giá và vị trí là tín hiệu nổi bật; bài đăng/ảnh hỗ trợ chuyển đổi.
- Trọng số là lựa chọn sản phẩm, không phải số đo của Google. Khi có đủ audit + lưới thứ hạng thật, nên hồi quy lại.
