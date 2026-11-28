/** Lỗi do migration 033 chưa chạy (thiếu bảng / cột / hàm) — để code mới chạy được cả trước khi áp migration. */
export function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === '42703' || err.code === 'PGRST204' || /column .* does not exist|Could not find the '.*' column/i.test(err.message || '')
}

export function isMissingRelationError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    err.code === 'PGRST202' ||
    err.code === '42883' ||
    /relation .* does not exist|Could not find the (table|function)/i.test(err.message || '')
  )
}
