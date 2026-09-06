import { NextResponse } from 'next/server'
import { getTasks } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/auth'

export async function GET(req: Request) {
  try {
    const workspaceId = await requireWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id') || undefined
    const planId = searchParams.get('plan_id') || undefined
    const data = await getTasks({ clientId, planId, workspaceId })
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
