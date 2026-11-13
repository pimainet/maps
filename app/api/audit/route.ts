import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { askClaude } from '@/lib/claude'
import { saveAudit, getLatestAuditByClient, getAllAudits, getClientById } from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientProgress } from '@/lib/client-memory'
import { checkAiRateLimit, recordAiUsage, enforceClientAuditQuota } from '@/lib/rate-limit'
import { getClientSnapshot } from '@/lib/gbp-snapshot-service'
import { hasProfileData } from '@/lib/gbp-snapshot'
import { summarizeSnapshot } from '@/lib/gbp-audit-fields'
import { buildAuditPrompt } from '@/lib/audit-prompt'

export const maxDuration = 300
export const runtime = 'nodejs'

/**
 * Bấm kiểm tra lại liên tiếp (vd Claude lỗi tạm thời rồi thử lại) thì dùng lại dữ liệu Maps vừa lấy,
 * không gọi Outscraper thêm lần nữa. Quá khung này thì luôn lấy mới — audit phải dựa trên dữ liệu hiện tại.
 */
const SNAPSHOT_REUSE_MS = 30 * 60_000

const MAX_NOTE_CHARS = 2000

export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const clientId = new URL(req.url).searchParams.get('client_id')
    const data = clientId ? await getLatestAuditByClient(clientId, workspaceId) : await getAllAudits(workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

/**
 * POST { client_id, output_language?, additional_info? }
 * Tự lấy hồ sơ Google Maps của doanh nghiệp qua Outscraper (xem lib/gbp-snapshot-service.ts), rồi mới chạy audit.
 * additional_info chỉ là ghi chú thêm của người dùng (điều Maps không cho thấy), không còn là số liệu nhập tay.
 */
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { userId } = await checkAiRateLimit(workspaceId, 'audit')
    const body = await req.json().catch(() => null)

    const clientId = typeof body?.client_id === 'string' ? body.client_id : ''
    if (!clientId) {
      return NextResponse.json({ error: 'Thiếu client_id.' }, { status: 400 })
    }
    const client = await getClientById(clientId, workspaceId)
    if (!client) {
      return NextResponse.json({ error: 'Không tìm thấy khách hàng trong workspace hiện tại.' }, { status: 404 })
    }
    await enforceClientAuditQuota(clientId, workspaceId)

    // 1) Dữ liệu thật từ Google Maps. Không có dữ liệu thì KHÔNG gọi Claude (tránh audit "đoán mò" và tốn quota).
    const { snapshot, origin, error: sourceError } = await getClientSnapshot(client, workspaceId, {
      maxAgeMs: SNAPSHOT_REUSE_MS,
    })
    if (!snapshot || !hasProfileData(snapshot)) {
      return NextResponse.json(
        {
          error:
            'Không lấy được dữ liệu từ Google Maps cho doanh nghiệp này. Kiểm tra lại link Google Maps / Place ID của khách rồi thử lại.',
          data: { origin, source_error: sourceError },
        },
        { status: 422 },
      )
    }

    // 2) Ngữ cảnh tiến độ (lỗi ở đây không được làm hỏng audit).
    let progressContext: string
    try {
      progressContext = (await getClientProgress(clientId, workspaceId)).summary_text
    } catch (e: any) {
      console.error('getClientProgress audit:', e?.message)
      progressContext = '### Tiến độ đã ghi nhận trong hệ thống\n- Không lấy được tiến độ (bỏ qua).'
    }

    // 3) Audit.
    const userNote = typeof body.additional_info === 'string' ? body.additional_info.slice(0, MAX_NOTE_CHARS) : ''
    const staleNote =
      origin === 'stored_after_failure'
        ? `LƯU Ý: lần lấy dữ liệu mới từ Google Maps thất bại; dữ liệu dưới đây là bản đã lưu ngày ${String(snapshot.captured_at || '').slice(0, 10)}, có thể đã cũ.`
        : ''
    const prompt = buildAuditPrompt({
      snapshot,
      declared: client,
      progressContext,
      outputLanguage: typeof body.output_language === 'string' ? body.output_language.slice(0, 40) : undefined,
      note: [staleNote, userNote].filter(Boolean).join('\n'),
    })
    const audit_result = await askClaude(prompt, { maxTokens: 3000, temperature: 0.4 })
    await recordAiUsage(workspaceId, 'audit', userId)

    const saved = await saveAudit({
      client_id: clientId,
      audit_result,
      raw_input: {
        data_origin: origin,
        snapshot_id: snapshot.id ?? null,
        captured_at: snapshot.captured_at ?? null,
        note: userNote || null,
      },
      workspace_id: workspaceId,
    })

    return NextResponse.json({
      audit: saved,
      audit_result,
      used_progress: true,
      data: {
        origin,
        source: snapshot.source ?? null,
        captured_at: snapshot.captured_at ?? null,
        source_error: sourceError,
        summary: summarizeSnapshot(snapshot),
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}
