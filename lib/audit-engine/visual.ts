import type { AuditInput, CheckResult } from './types'

function insufficient(id: string, label: string): CheckResult {
  return {
    id,
    group: 'visual',
    label,
    severity: 'low',
    confidence: 'insufficient',
    passed: null,
    message: 'Chưa đủ dữ liệu để kết luận — hệ thống hiện chưa thu thập trường này.',
  }
}

const DEFAULT_MIN_PHOTO_COUNT = 10

/** V01 — Photo Presence: dùng photos_count_est (ƯỚC TÍNH từ Claude đọc trang, không phải đếm chính xác). */
function checkV01(input: AuditInput): CheckResult {
  const est = input.snapshot.photos_count_est
  if (est == null) {
    return insufficient('V01', 'Photo Presence')
  }
  const enough = est >= DEFAULT_MIN_PHOTO_COUNT
  return {
    id: 'V01',
    group: 'visual',
    label: 'Photo Presence',
    severity: 'medium',
    confidence: 'estimated',
    passed: enough,
    message: `Ước tính khoảng ${est} ảnh trên hồ sơ (ngưỡng tham khảo ${DEFAULT_MIN_PHOTO_COUNT}).`,
    action: enough ? undefined : `Bổ sung ảnh để đạt tối thiểu khoảng ${DEFAULT_MIN_PHOTO_COUNT} ảnh.`,
  }
}

/**
 * V02–V04 — Recency/Diversity/Quality: CẦN ảnh thật (file) + timestamp, hệ
 * thống hiện chỉ có `photos_signal` (1 câu tóm tắt chữ) và `photos_count_est`
 * (số ước tính) — không đủ để kết luận. Đây là khoảng trống Data Collector
 * thật sự (cần tải ảnh thật + đọc metadata), không phải việc engine này
 * có thể suy ra từ dữ liệu hiện có.
 */
export function runVisualChecks(input: AuditInput): CheckResult[] {
  return [checkV01(input), insufficient('V02', 'Photo Recency'), insufficient('V03', 'Photo Diversity'), insufficient('V04', 'Photo Quality')]
}
