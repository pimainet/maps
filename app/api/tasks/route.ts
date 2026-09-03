import { NextResponse } from 'next/server'
import { getTasks } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id') || undefined
    const planId = searchParams.get('plan_id') || undefined
    const data = await getTasks({ clientId, planId })
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
