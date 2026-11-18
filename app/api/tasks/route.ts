import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { getTasks } from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getEntitlements, unlockedTaskIds } from '@/lib/billing/server'

export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id') || undefined
    const planId = searchParams.get('plan_id') || undefined
    const data = await getTasks({ clientId, planId, workspaceId })
    const ent = await getEntitlements(workspaceId)
    const open = await unlockedTaskIds(workspaceId, planId ?? null, ent.taskLimit)
    if (!open) return NextResponse.json(data)
    const visible = (data || []).filter((t: any) => open.has(t.id))
    return NextResponse.json(visible, { headers: { 'x-locked-count': String((data || []).length - visible.length) } })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: publicError(error) }, { status })
  }
}
