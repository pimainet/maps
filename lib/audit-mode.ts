/**
 * Công tắc chọn engine chấm điểm cho /api/audit (biến môi trường AUDIT_ENGINE_MODE):
 *  - 'v1'     (mặc định) : 1 prompt Claude chấm điểm tự do — hành vi cũ, không đổi gì.
 *  - 'shadow'            : khách vẫn thấy kết quả v1; engine v2 chạy ngầm SAU khi đã trả lời và lưu vào audits
 *                          (module_key='maps_seo_v2') để đối chiếu điểm v1 ↔ v2 trên khách thật.
 *  - 'v2'                : khách thấy kết quả engine v2 (điểm do rule quyết, AI chỉ phân loại + viết lời, lặp lại được).
 * Giá trị lạ -> 'v1' (an toàn). Đổi bằng cách sửa env rồi redeploy; lùi về 'v1' bất cứ lúc nào.
 */
export type AuditEngineMode = 'v1' | 'shadow' | 'v2'

export function getAuditEngineMode(raw: string | undefined = process.env.AUDIT_ENGINE_MODE): AuditEngineMode {
  const v = (raw || '').trim().toLowerCase()
  return v === 'v2' || v === 'shadow' ? v : 'v1'
}
