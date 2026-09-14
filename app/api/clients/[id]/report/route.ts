import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientCycleReport } from '@/lib/reports'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const report = await getClientCycleReport(id, workspaceId)
    return NextResponse.json(report)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : error.message?.includes('Không tìm thấy')
          ? 404
          : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
