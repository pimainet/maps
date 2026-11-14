/**
 * Khóa định danh doanh nghiệp dùng để tính quota audit. KHÔNG phụ thuộc vào việc client có bị xóa/tạo lại
 * hay nằm ở workspace nào: ưu tiên place_id Google, rồi link Maps đã chuẩn hóa, cuối cùng mới là id client.
 * Phải khớp công thức backfill trong supabase/migrations/019_quota_hardening.sql.
 */
export function auditQuotaPlaceKey(client: { id: string; place_id?: string | null; gbp_link_normalized?: string | null }): string {
  const placeId = (client.place_id || '').trim()
  if (placeId) return placeId
  const link = (client.gbp_link_normalized || '').trim()
  if (link) return `gbp:${link}`
  return `client:${client.id}`
}
