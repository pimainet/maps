// GET /api/admin/agency/queue — hàng đợi công việc của nhân viên trên mọi khách gói Làm hộ (chỉ Super Admin).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { agencyError, loadQueue, staffGuard } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await staffGuard()
  if ('res' in g) return g.res
  try {
    const q = await loadQueue(supabaseAdmin)
    const { count: leads } = await supabaseAdmin.from('consultation_requests').select('id', { count: 'exact', head: true }).in('status', ['new', 'contacted', 'quoted'])
    return NextResponse.json({ ...q, totals: { ...q.totals, leads: leads || 0 } })
  } catch (e: any) {
    return agencyError(e)
  }
}
