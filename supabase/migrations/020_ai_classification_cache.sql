-- ============================================================
-- Migration 020: Bộ nhớ đệm kết quả phân loại AI của Audit Engine.
-- Khoá = sha256(phiên bản prompt + nội dung đầu vào) nên cùng dữ liệu => cùng kết luận (điểm audit lặp lại được).
-- Chỉ lưu KẾT QUẢ phân loại (JSON ngắn), không lưu đầu vào. Truy cập chỉ qua service_role (server). Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_classification_cache (
  cache_key  text PRIMARY KEY,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_classification_cache_created_idx ON public.ai_classification_cache (created_at);

ALTER TABLE public.ai_classification_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_classification_cache FROM anon, authenticated;
-- Không tạo policy: người dùng không đọc/ghi trực tiếp; service_role bỏ qua RLS.

-- Dọn định kỳ nếu muốn (không bắt buộc, mỗi dòng rất nhỏ):
--   DELETE FROM public.ai_classification_cache WHERE created_at < now() - interval '180 days';
