import type { CheckGroup } from './types'

/**
 * Trọng số chấm điểm (scoring v3) — mỗi check có 1 trọng số; điểm tổng = tổng trọng số các check ĐẠT chia tổng trọng số
 * các check CÓ DỮ LIỆU (chuẩn hoá theo TỪNG CHECK, không theo nhóm), thang 0–100.
 *
 * Vì sao đổi (so với v2: chia đều 7 nhóm, trọng số theo mức độ nghiêm trọng):
 *  - Ở audit thật 19/11/2026, "có ≥1 bài đăng" và "≥10 ảnh" mỗi mục chiếm 14,3% điểm vì nhóm của chúng chỉ còn
 *    1 mục có dữ liệu, trong khi điểm sao chỉ 3,6%. Whitespark Local Search Ranking Factors 2026 xếp danh mục chính #1,
 *    khoảng cách #2, sao #6, số ảnh #96, bài đăng #148.
 *  - Nhóm "Chuyển đổi" chỉ suy ra từ check khác nên website hỏng bị trừ 3 lần -> nay chỉ hiển thị (trọng số 0).
 *
 * Hướng phân bổ (giả thuyết, cần kiểm chứng trên dữ liệu Việt Nam — xem docs/AUDIT_SCORING.md):
 *  Liên quan 25 · Review 25 · Hiển thị/khoảng cách 20 · Nền tảng 15 · Website địa phương 10 · Ảnh & bài đăng 5.
 * Trọng số 0 = chỉ hiển thị (không tính điểm, không vào độ phủ, không vào so sánh giữa 2 lần audit).
 */
export const SCORING_VERSION = 3

export const CHECK_WEIGHTS: Readonly<Record<string, number>> = {
  // Nền tảng (15)
  F01: 2, F02: 3, F03: 1, F04: 3, F05: 2, F06: 1, F07: 3,
  // Liên quan: danh mục, dịch vụ (25)
  R01: 5, R06: 7, R02: 6, R03: 3, R04: 3, R05: 1,
  // Review (25)
  T01: 6, T02: 6, T03: 8, T05: 3, VY03: 2,
  T04: 0, T06: 0,
  // Hiển thị, khoảng cách (20)
  VY01: 6, VY02: 4, VY04: 10,
  // Ảnh & bài đăng (5)
  V01: 2, C01: 1, C02: 2,
  C03: 0, C04: 0, V02: 0, V03: 0, V04: 0,
  // Chuyển đổi: suy ra từ check khác -> chỉ hiển thị
  CV01: 0, CV02: 0, CV03: 0, CV04: 0,
}

/** Dưới mức này (% trọng số có dữ liệu) thì không chấm điểm tổng — quá ít dữ liệu, con số sẽ gây hiểu lầm. */
export const MIN_WEIGHT_COVERAGE_PCT = 30

export const weightOf = (id: string): number => CHECK_WEIGHTS[id] ?? 0

/** Nhóm hiển thị theo bảng trọng số (để giao diện/tài liệu in đúng bảng). */
export const WEIGHT_BUCKETS: Array<{ key: string; label: string; groups: CheckGroup[]; ids: string[] }> = [
  { key: 'relevance', label: 'Liên quan: danh mục, dịch vụ', groups: ['relevance'], ids: ['R01', 'R06', 'R02', 'R03', 'R04', 'R05'] },
  { key: 'reviews', label: 'Review', groups: ['trust'], ids: ['T01', 'T02', 'T03', 'T05', 'VY03'] },
  { key: 'visibility', label: 'Hiển thị, khoảng cách', groups: ['visibility'], ids: ['VY01', 'VY02', 'VY04'] },
  { key: 'foundation', label: 'Nền tảng: đúng và đủ', groups: ['foundation'], ids: ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07'] },
  { key: 'media', label: 'Ảnh và bài đăng', groups: ['visual', 'content'], ids: ['V01', 'C01', 'C02'] },
]
