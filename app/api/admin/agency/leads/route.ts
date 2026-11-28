// Yêu cầu tư vấn gói Làm hộ (chỉ Super Admin).
//  GET  ?view=open|all   -> danh sách + (để tạo đơn) workspace và gói hiện tại của từng workspace
//  POST { id, status?, admin_note? } -> cập nhật trạng thái / ghi chú nội bộ
import { NextResponse } from 'next/server'
import { supabaseAdmin as admin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/autopost/secret'
import { agencyError, logAgencyAction, staffGuard } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost']

export async function GET(req: Request) {
  const g = await staffGuard()
  if ('res' in g) return g.res
  try {
    const view = new URL(req.url).searchParams.get('view') === 'all' ? 'all' : 'open'
    let q = admin
      .from('consultation_requests')
      .select('id, workspace_id, user_id, contact_name, phone, email, business_name, message, status, order_code, admin_note, handled_at, notified_at, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (view === 'open') q = q.in('status', ['new', 'contacted', 'quoted'])
    const { data, error } = await q
    if (error) throw error
    const wsIds = [...new Set((data || []).map((r: any) => r.workspace_id).filter(Boolean))]
    const names = new Map<string, { name: string; plan: string }>()
    if (wsIds.length) {
      const { data: ws } = await admin.from('workspaces').select('id, name, plan').in('id', wsIds)
      for (const w of ws || []) names.set((w as any).id, { name: (w as any).name, plan: (w as any).plan })
    }
    return NextResponse.json({ leads: (data || []).map((r: any) => ({ ...r, workspace_name: names.get(r.workspace_id)?.name ?? null, workspace_plan: names.get(r.workspace_id)?.plan ?? null })) })
  } catch (e: any) {
    return agencyError(e)
  }
}

export async function POST(req: Request) {
  const g = await staffGuard()
  if ('res' in g) return g.res
  try {
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.id)) return NextResponse.json({ error: 'Thiếu yêu cầu.' }, { status: 400 })
    const patch: Record<string, unknown> = { handled_by: g.staff.id, handled_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    if (body.status != null) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Trạng thái không hợp lệ.' }, { status: 400 })
      patch.status = body.status
    }
    if (body.admin_note != null) {
      if (typeof body.admin_note !== 'string' || body.admin_note.length > 2000) return NextResponse.json({ error: 'Ghi chú không hợp lệ (tối đa 2000 ký tự).' }, { status: 400 })
      patch.admin_note = body.admin_note.trim() || null
    }
    const { data, error } = await admin.from('consultation_requests').update(patch).eq('id', body.id).select('id, workspace_id, status').maybeSingle()
    if (error) {
      if ((error as any).code === '23505') return NextResponse.json({ error: 'Workspace này đã có một yêu cầu khác đang mở.' }, { status: 409 })
      throw error
    }
    if (!data) return NextResponse.json({ error: 'Không tìm thấy yêu cầu.' }, { status: 404 })
    await logAgencyAction(admin, { actor: g.staff.id, workspaceId: (data as any).workspace_id, kind: 'lead_update', refId: body.id, data: { status: body.status ?? null } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return agencyError(e)
  }
}
