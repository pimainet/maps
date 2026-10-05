import type { CheckResult } from './types'

/**
 * VY01–VY04 — Keyword Visibility / Coverage / Competitor Benchmark /
 * Geographic Visibility: CẦN dữ liệu xếp hạng từ khoá tại nhiều vị trí, hệ
 * thống hiện KHÔNG thu thập (và cố tình không tự ý thêm cơ chế tự tìm kiếm
 * Google — rủi ro ToS/pháp lý, cần quyết định nguồn dữ liệu hợp lệ trước).
 * Giữ nhóm này như stub insufficient để Scoring Engine không bỏ sót tầng
 * này khi tính overall, và để dễ bật lên khi có nguồn dữ liệu thật.
 */
function insufficient(id: string, label: string): CheckResult {
  return {
    id,
    group: 'visibility',
    label,
    severity: 'high',
    confidence: 'insufficient',
    passed: null,
    message: 'Chưa có dữ liệu xếp hạng từ khoá — cần nguồn dữ liệu hợp lệ (xem ghi chú trong file này).',
  }
}

export function runVisibilityChecks(): CheckResult[] {
  return [
    insufficient('VY01', 'Keyword Visibility'),
    insufficient('VY02', 'Keyword Coverage'),
    insufficient('VY03', 'Competitor Benchmark'),
    insufficient('VY04', 'Geographic Visibility'),
  ]
}
