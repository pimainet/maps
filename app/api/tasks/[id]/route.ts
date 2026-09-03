import { NextResponse } from 'next/server'
import { getTaskById, updateTaskStatus } from '@/lib/db'

const ALLOWED_STATUS = ['pending', 'done', 'skipped']

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const data = await getTaskById(params.id)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    if (!ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `status không hợp lệ. Chỉ chấp nhận: ${ALLOWED_STATUS.join(', ')}` },
        { status: 400 }
      )
    }

    const updated = await updateTaskStatus(params.id, body.status)
    return NextResponse.json(updated)
  } catch (error: any) {
    // Lỗi phổ biến nhất ở đây: chưa chạy migration thêm cột `status`
    // vào bảng tasks trong Supabase.
    return NextResponse.json(
      { error: `${error.message} (kiểm tra đã chạy migration thêm cột status vào bảng tasks chưa)` },
      { status: 500 }
    )
  }
}
