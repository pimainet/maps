import type { DemoAudit } from '@/lib/demo-audit'

function numFrom(line: string | undefined): number | null {
  if (!line) return null
  const m = line.match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function bulletsAfter(text: string, heading: RegExp, stop: RegExp): string[] {
  const start = text.search(heading)
  if (start < 0) return []
  const rest = text.slice(start)
  const endMatch = rest.slice(1).search(stop)
  const block = endMatch >= 0 ? rest.slice(0, endMatch + 1) : rest
  return block
    .split('\n')
    .map((l) =>
        l
          .replace(/^\s*[-*•]\s*/, '')
          .replace(/\*\*/g, '')
          .replace(/^\d+\.\s*/, '')
          .trim(),
      )
    .filter((l) => l && !heading.test(l) && !/^#{1,4}\s/.test(l) && l.length > 8)
    .slice(0, 6)
}

export function parseAuditResult(raw: string, meta?: { name?: string; industry?: string; area?: string; mapsUrl?: string }): DemoAudit {
  const overallLine = raw.split('\n').find((l) => /Điểm\s*:/.test(l) || /Score\s*:/i.test(l))
  let overall = numFrom(overallLine) ?? 5
  if (overall > 10) overall = Math.round((overall / 10) * 10) / 10

  const pickGroup = (label: string, fallback: number) => {
    const line = raw.split('\n').find((l) => l.includes(label))
    return numFrom(line) ?? fallback
  }

  const groups = [
    { key: 'basic', label: 'Thông tin cơ bản', score: pickGroup('Thông tin cơ bản', Math.max(1, overall - 0.2)) },
    { key: 'complete', label: 'Mức độ hoàn thiện hồ sơ', score: pickGroup('hoàn thiện', Math.max(1, overall - 0.4)) },
    { key: 'media', label: 'Hình ảnh & Media', score: pickGroup('Hình ảnh', Math.max(1, overall - 0.6)) },
    { key: 'activity', label: 'Hoạt động & Tương tác', score: pickGroup('Hoạt động', Math.max(1, overall - 0.8)) },
    { key: 'risk', label: 'Dấu hiệu rủi ro / cảnh báo', score: pickGroup('rủi ro', 7) },
  ]

  const strengths = bulletsAfter(raw, /#{1,4}\s*3\.\s*Điểm mạnh/i, /#{1,4}\s*4\./)
  const high = bulletsAfter(raw, /Ưu tiên Cao/i, /Ưu tiên Trung|#{1,4}\s*5\./)
  const actions = bulletsAfter(raw, /#{1,4}\s*5\./, /#{1,4}\s*6\./)
  const noteLine = raw.split('\n').find((l) => /Giải thích/i.test(l))

  let difficulty: DemoAudit['difficulty'] = 'Trung bình'
  if (/Độ khó[\s\S]{0,80}Cao/i.test(raw)) difficulty = 'Cao'
  else if (/Độ khó[\s\S]{0,80}Thấp/i.test(raw)) difficulty = 'Thấp'

  return {
    businessName: meta?.name || 'Doanh nghiệp',
    industryLabel: meta?.industry || '',
    area: meta?.area || '',
    mapsUrl: meta?.mapsUrl || '',
    overall,
    overallNote: noteLine?.replace(/^[^:]*:\s*/, '') || 'Kết quả audit đã lưu trong hệ thống.',
    groups,
    strengths: strengths.slice(0, 3),
    weaknesses: [
      ...high.slice(0, 2).map((text) => ({ priority: 'high' as const, text })),
      ...bulletsAfter(raw, /Ưu tiên Trung/i, /Ưu tiên Thấp|#{1,4}\s*5\./)
        .slice(0, 1)
        .map((text) => ({ priority: 'medium' as const, text })),
    ],
    actions: actions.slice(0, 5),
    difficulty,
    lockedHints: [],
  }
}
