import { NextResponse } from 'next/server'
import { getClients, createClient } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/auth'

export async function GET() {
  try {
    const workspaceId = await requireWorkspaceId()
    const data = await getClients(workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = await requireWorkspaceId()
    const body = await req.json()
    const data = await createClient({ ...body, workspace_id: workspaceId })
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
