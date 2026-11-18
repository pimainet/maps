// Cắt nội dung audit theo gói — THUẦN, chạy ở server trước khi trả JSON (khoá thật, không phải ẩn bằng CSS).
import type { Entitlements } from './plans'

/** Mục "### 5. Việc cần làm ngay": giữ `limit` gạch đầu dòng đầu. Trả cả số việc bị khoá. */
export function limitActionsInText(text: string, limit: number | null): { text: string; locked: number } {
  if (limit === null || !text) return { text, locked: 0 }
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^#{1,4}\s*5\./.test(l))
  if (start < 0) return { text, locked: 0 }
  let end = lines.findIndex((l, i) => i > start && /^#{1,4}\s*\d+\./.test(l))
  if (end < 0) end = lines.length
  let kept = 0
  let locked = 0
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const inSection = i > start && i < end
    if (inSection && /^\s*[-*•]\s+/.test(lines[i])) {
      if (kept < limit) { kept++; out.push(lines[i]) } else locked++
      continue
    }
    out.push(lines[i])
  }
  return { text: out.join('\n'), locked }
}

/** Bỏ phần lời khuyên nâng cao khỏi báo cáo (giữ kết luận danh mục chính để người dùng thấy giá trị). */
export function shapeReport<T extends { advice?: any }>(report: T | null | undefined, ent: Entitlements): { report: T | null; locked: { secondary: number; drafts: number } } {
  if (!report) return { report: null, locked: { secondary: 0, drafts: 0 } }
  const anyR = report as any
  const trimmed = ent.auditActionLimit !== null && Array.isArray(anyR.topOpportunities)
    ? { ...report, topOpportunities: anyR.topOpportunities.slice(0, ent.auditActionLimit) }
    : report
  if (ent.advanceAdvice || !report.advice) return { report: trimmed, locked: { secondary: 0, drafts: 0 } }
  const a = report.advice
  const locked = { secondary: a.secondary?.suggested?.length ?? 0, drafts: a.drafts?.length ?? 0 }
  return {
    report: { ...trimmed, advice: { ...a, secondary: { ...a.secondary, suggested: [] }, drafts: [] } },
    locked,
  }
}

export type LockInfo = { plan: string; locked_actions: number; locked_secondary: number; locked_drafts: number }

export function shapeAuditPayload(
  payload: { audit_result?: string; report?: any; audit?: any },
  ent: Entitlements,
  plan: string,
): { audit_result: string; report: any; locks: LockInfo } {
  const t = limitActionsInText(payload.audit_result || '', ent.auditActionLimit)
  const r = shapeReport(payload.report, ent)
  return {
    audit_result: t.text,
    report: r.report,
    locks: { plan, locked_actions: t.locked, locked_secondary: r.locked.secondary, locked_drafts: r.locked.drafts },
  }
}

/** Một dòng audit đọc từ DB (audit_result + checks_json) -> bản đã cắt theo gói. */
export function shapeAuditRow<T extends { audit_result?: string | null; checks_json?: any } | null>(row: T, ent: Entitlements, plan: string): { row: T; locks: LockInfo | null } {
  if (!row) return { row, locks: null }
  const s = shapeAuditPayload({ audit_result: row.audit_result || '', report: row.checks_json }, ent, plan)
  return { row: { ...row, audit_result: s.audit_result, checks_json: s.report } as T, locks: s.locks }
}

/** Gói miễn phí: kế hoạch 30 ngày chỉ hiện mục tiêu, trọng tâm và Tuần 1; từ Tuần 2 trở đi bị khoá. */
export function limitPlanText(text: string, ent: Entitlements): { text: string; locked: boolean } {
  if (ent.taskLimit === null || !text) return { text, locked: false }
  const lines = text.split('\n')
  const i = lines.findIndex((l) => /tuần\s*2/i.test(l))
  if (i < 0) return { text, locked: false }
  return { text: lines.slice(0, i).join('\n').trimEnd(), locked: true }
}
