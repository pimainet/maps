import type { CheckResult } from './types'

function findCheck(checks: CheckResult[], id: string): CheckResult | undefined {
  return checks.find((c) => c.id === id)
}

function checkCV01(checks: CheckResult[]): CheckResult {
  const deps = ['F04', 'F05', 'F06', 'F07'].map((id) => findCheck(checks, id))
  if (deps.some((c) => !c || c.passed === null)) {
    return {
      id: 'CV01',
      group: 'conversion',
      label: 'Information Completeness',
      severity: 'medium',
      confidence: 'insufficient',
      passed: null,
      message: 'Chưa đủ dữ liệu từ nhóm Foundation để kết luận.',
    }
  }
  const missing = deps.filter((c) => c!.passed === false).map((c) => c!.label)
  const ok = missing.length === 0
  return {
    id: 'CV01',
    group: 'conversion',
    label: 'Information Completeness',
    severity: 'medium',
    confidence: 'estimated',
    passed: ok,
    message: ok ? 'Đủ thông tin cơ bản để khách quyết định liên hệ.' : `Còn thiếu: ${missing.join(', ')}.`,
    action: ok ? undefined : `Bổ sung: ${missing.join(', ')}.`,
  }
}

function checkCV02(checks: CheckResult[]): CheckResult {
  const deps = ['T02', 'V01'].map((id) => findCheck(checks, id))
  if (deps.some((c) => !c || c.passed === null)) {
    return {
      id: 'CV02',
      group: 'conversion',
      label: 'Trust Presentation',
      severity: 'medium',
      confidence: 'insufficient',
      passed: null,
      message: 'Chưa đủ dữ liệu từ nhóm Trust/Visual (rating, số ảnh) để kết luận.',
    }
  }
  const missing = deps.filter((c) => c!.passed === false).map((c) => c!.label)
  const ok = missing.length === 0
  return {
    id: 'CV02',
    group: 'conversion',
    label: 'Trust Presentation',
    severity: 'medium',
    confidence: 'estimated',
    passed: ok,
    message: ok ? 'Hồ sơ có đủ bằng chứng cơ bản để khách tin tưởng.' : `Thiếu bằng chứng tin cậy ở: ${missing.join(', ')}.`,
    action: ok ? undefined : `Cải thiện: ${missing.join(', ')}.`,
  }
}

function checkCV03(checks: CheckResult[]): CheckResult {
  const deps = ['R01', 'R04'].map((id) => findCheck(checks, id))
  if (deps.some((c) => !c || c.passed === null)) {
    return {
      id: 'CV03',
      group: 'conversion',
      label: 'Service Clarity',
      severity: 'medium',
      confidence: 'insufficient',
      passed: null,
      message: 'Chưa đủ dữ liệu từ nhóm Relevance để kết luận.',
    }
  }
  const missing = deps.filter((c) => c!.passed === false).map((c) => c!.label)
  const ok = missing.length === 0
  return {
    id: 'CV03',
    group: 'conversion',
    label: 'Service Clarity',
    severity: 'medium',
    confidence: 'estimated',
    passed: ok,
    message: ok ? 'Khách có thể hiểu rõ doanh nghiệp bán gì từ hồ sơ hiện tại.' : `Chưa rõ ràng ở: ${missing.join(', ')}.`,
    action: ok ? undefined : `Làm rõ: ${missing.join(', ')}.`,
  }
}

function checkCV04(checks: CheckResult[]): CheckResult {
  const phone = findCheck(checks, 'F05')
  const website = findCheck(checks, 'F06')
  if (!phone || phone.passed === null) {
    return {
      id: 'CV04',
      group: 'conversion',
      label: 'Contact Friction',
      severity: 'high',
      confidence: 'insufficient',
      passed: null,
      message: 'Chưa đủ dữ liệu về số điện thoại để kết luận.',
    }
  }
  const channels: string[] = []
  if (!phone.passed) channels.push('số điện thoại')
  if (website && website.passed === false) channels.push('website')
  const ok = channels.length === 0
  return {
    id: 'CV04',
    group: 'conversion',
    label: 'Contact Friction',
    severity: 'high',
    confidence: 'estimated',
    passed: ok,
    message: ok ? 'Khách có kênh liên hệ cơ bản (gọi điện) rõ ràng.' : `Đang thiếu/lỗi kênh liên hệ: ${channels.join(', ')}.`,
    action: ok ? undefined : `Khắc phục: ${channels.join(', ')}.`,
  }
}

export function runConversionChecks(checksSoFar: CheckResult[]): CheckResult[] {
  return [checkCV01(checksSoFar), checkCV02(checksSoFar), checkCV03(checksSoFar), checkCV04(checksSoFar)]
}
