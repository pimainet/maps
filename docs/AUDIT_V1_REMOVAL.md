# Gỡ engine audit v1 — chỉ còn engine v2

## Đã gỡ
- Nhánh v1 trong `POST /api/audit` (1 prompt Claude chấm tự do, temperature 0.4, thang 10) và nhánh `shadow` (chạy v2 ngầm để đối chiếu).
- Công tắc `AUDIT_ENGINE_MODE` (`lib/audit-mode.ts`). Biến này nếu còn đặt trên Vercel sẽ bị bỏ qua.
- `lib/audit-prompt.ts`, `AUDIT_PROMPT` (trong `lib/prompts.ts`), `snapshotToAuditFields` / `buildGbpObservationBlock` (`lib/gbp-audit-fields.ts`; giữ `summarizeSnapshot`).
- Route nội bộ `POST/GET /api/audit/v2-preview`, bucket rate-limit `audit-v2-preview`, `saveAuditV2`, `getAuditV2History` (chỉ phục vụ so sánh v1↔v2).
- Test và tài liệu của công tắc/prompt v1.

## Giữ nguyên (vì v2 dùng chung)
- `lib/audit-engine/*` (34 mục kiểm tra), `lib/run-audit-v2.ts` (pipeline), `renderAuditText` (dựng văn bản 7 mục `### 1.…### 7.` + `### 8.` mục chưa đủ dữ liệu).
- `parseAuditResult` + `AuditResultView`: giao diện đọc văn bản đó; v2 ghi đè điểm bằng `checks_json` (`buildScoreOverride`).
- Lộ trình 30 ngày (`/api/plan`), trí nhớ khách hàng (`client-memory`), cắt theo gói (`billing/shape`) đọc văn bản `audit_result` — văn bản v2 cùng khung nên không cần đổi.
- Bộ lọc `module_key <> 'maps_seo_v2'` ở `getLatestAuditByClient` / `getPreviousComparableAudit` (DB hiện không có dòng nào như vậy; giữ cho chắc).

## Audit kiểu cũ trong DB (17 dòng, `checks_json` NULL) — chỉ đọc
- Không sửa, không xoá, không migration.
- Trang `/clients/[id]/audit` tự hiện audit gần nhất đã lưu. Dòng kiểu cũ hiện kèm ghi chú (thang 10, AI chấm tự do, không có chi tiết từng mục, không so sánh điểm với thang mới). Điểm đọc từ văn bản bằng `parseAuditResult` như trước.
- `GET /api/audit` trả thêm trường `kind`: `v2` | `legacy` (`lib/audit-legacy.ts`).
- Lộ trình 30 ngày và trí nhớ khách hàng vẫn dùng văn bản `audit_result` của chúng.
- Lần audit mới đầu tiên sau audit kiểu cũ: `comparison = { comparable: false, reason: … }`; từ lần sau so sánh từng mục.

## Khác biệt v2 so với v1
- Điểm do rule + số học (thang 100, hiển thị /10), lặp lại được; v1 dao động giữa các lần.
- Tối đa 8 lần gọi Claude/audit (v1: 1 lần). Phân loại cache theo nội dung nên audit lặp lại rẻ hơn. AI lỗi → mục đó "chưa đủ dữ liệu", lời nhận xét dựng bằng code.
- Gọi thêm nguồn dữ liệu: nhóm đối thủ (Outscraper, cache 14 ngày), kiểm tra website (HTTP), lịch sử review (DB), lưới thứ hạng (nếu bật). Thiếu khoá → mục tương ứng "chưa đủ dữ liệu", audit vẫn chạy.
- Thời gian dài hơn (nhiều bước gọi ngoài; giao diện báo 30–90 giây).
