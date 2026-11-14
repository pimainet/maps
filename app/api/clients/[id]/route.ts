import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { findDuplicateClient, getClientById, updateClientViaRpc } from '@/lib/db'
import { buildClientEdit, placeKeyAfterPatch } from '@/lib/client-edit'

export const runtime = 'nodejs'

const MSG = (e: any): string => (typeof e?.message === 'string' ? e.message : '')

function failure(error: any) {
  const m = MSG(error)
  if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
  if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
  if (m.startsWith('NotFound') || m.startsWith('Không tìm thấy'))
    return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
  if (m.startsWith('Duplicate') || error?.code === '23505')
    return NextResponse.json(
      { error: 'Link/Place Google Maps này đã gắn với một doanh nghiệp khác trong workspace.', code: 'DUPLICATE_PLACE' },
      { status: 409 },
    )
  if (m.startsWith('RateLimited'))
    return NextResponse.json({ error: m.replace(/^RateLimited:\s*/, ''), code: 'IDENTITY_CHANGE_LIMIT' }, { status: 429 })
  return NextResponse.json({ error: publicError(error) }, { status: 500 })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const client = await getClientById(id, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    return NextResponse.json(client)
  } catch (error: any) {
    return failure(error)
  }
}

/**
 * PATCH { …các trường muốn sửa }  — chỉ field có mặt mới được sửa.
 * Hồ sơ (ngành, khu vực, SĐT, liên hệ, giọng thương hiệu, website, ghi chú) và tên: sửa tự do.
 * Đổi link Google Maps / Place ID sang doanh nghiệp khác = "đổi quán": cần { confirm_place_change: true },
 * giới hạn 2 lần/30 ngày, dữ liệu Maps của quán cũ bị loại khỏi audit/báo cáo (xem migration 021).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const body = await req.json().catch(() => null)

    const client = await getClientById(id, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })

    const { confirm_place_change, ...fields } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const edit = buildClientEdit(fields, client)
    if (!edit.ok) return NextResponse.json({ error: edit.error, field: edit.field }, { status: 400 })

    const { changesPlace } = placeKeyAfterPatch(client, edit.patch)
    if (changesPlace) {
      if (confirm_place_change !== true) {
        return NextResponse.json(
          {
            error: 'Đổi link Google Maps sang doanh nghiệp khác cần xác nhận.',
            code: 'PLACE_CHANGE_NEEDS_CONFIRM',
          },
          { status: 409 },
        )
      }
      const dup = await findDuplicateClient({
        workspaceId,
        placeId: 'place_id' in edit.patch ? edit.patch.place_id : client.place_id,
        gbpLinkNormalized: 'gbp_link_normalized' in edit.patch ? edit.patch.gbp_link_normalized : client.gbp_link_normalized,
        excludeClientId: id,
      })
      if (dup) {
        return NextResponse.json(
          {
            error: `Link/Place Google Maps này đã gắn với doanh nghiệp「${dup.client.name}」trong workspace.`,
            code: 'DUPLICATE_PLACE',
            match_by: dup.match_by,
            existing_client: { id: dup.client.id, name: dup.client.name },
          },
          { status: 409 },
        )
      }
    }

    const result = await updateClientViaRpc(id, edit.patch)
    const updated = await getClientById(id, workspaceId)
    return NextResponse.json({ client: updated, ...result })
  } catch (error: any) {
    return failure(error)
  }
}
