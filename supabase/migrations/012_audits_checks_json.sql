-- Lưu kết quả Audit Engine v2 (34 checks, có cấu trúc) bên cạnh audit_result
-- (text tự do, flow cũ) — mở khoá so sánh/đo cải thiện giữa các lần audit.
--
-- Nullable -> an toàn cho mọi row cũ, không cần backfill, không ảnh hưởng gì
-- tới route /api/audit (flow cũ) đang chạy thật — cột này chỉ được ghi bởi
-- /api/audit/v2-preview (xem lib/db.ts saveAuditV2).
alter table public.audits
  add column if not exists checks_json jsonb;

comment on column public.audits.checks_json is
  'Kết quả Audit Engine v2 (lib/audit-engine), dạng AuditReport (checks[], tierScores[], overallScore, topOpportunities[]). NULL với mọi audit chạy qua flow cũ (/api/audit, module_key=maps_seo). Chỉ có giá trị khi module_key=maps_seo_v2.';
