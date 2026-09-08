import { NextResponse } from 'next/server'
import { getClients, createClient } from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'

export async function GET() {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const data = await getClients(workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()
    const data = await createClient({ ...body, workspace_id: workspaceId })
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
