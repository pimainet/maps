import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getPlanState } from '@/lib/billing/server'
import { ENTITLEMENTS, MONTHLY_PRICE_VND, PERIODS, PLAN_LABEL, priceFor } from '@/lib/billing/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Gói hiện tại + bảng giá (giá luôn lấy từ code server). */
export async function GET() {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const state = await getPlanState(workspaceId)
    return NextResponse.json({
      plan: state.plan,
      label: PLAN_LABEL[state.plan],
      period_end: state.periodEnd,
      scheduled: state.scheduled,
      entitlements: state.entitlements,
      catalog: (['basic', 'full'] as const).map((p) => ({
        plan: p,
        label: PLAN_LABEL[p],
        monthly: MONTHLY_PRICE_VND[p],
        entitlements: ENTITLEMENTS[p],
        prices: PERIODS.map((m) => ({ months: m, amount: priceFor(p, m) })),
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}
