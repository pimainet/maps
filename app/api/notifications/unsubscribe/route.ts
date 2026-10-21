// Link "Tắt email nhắc việc" trong email. Không cần đăng nhập: được bảo vệ bằng chữ ký HMAC riêng cho từng người.
//
// Mở link (GET) CHỈ hiện trang xác nhận, chưa tắt gì: nhiều phần mềm quét link của email công ty
// và trình xem trước tự mở mọi đường link, nếu GET tắt luôn thì người nhận bị tắt nhắc việc mà không hề bấm.
// Việc tắt thật chỉ xảy ra khi POST: bấm nút xác nhận trên trang, hoặc nút "Hủy đăng ký" một chạm
// của ứng dụng email (List-Unsubscribe-Post).
import { NextResponse } from 'next/server'
import { appUrl, escapeHtml, verifyUnsubscribeToken } from '@/lib/notifications'

export const runtime = 'nodejs'

async function unsubscribe(userId: string) {
  const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
  const { error } = await admin
    .from('notification_prefs')
    .upsert({ user_id: userId, email_enabled: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return error
}

function page(title: string, body: string, status = 200, confirmAction?: string) {
  const action = confirmAction
    ? `<form method="post" action="${escapeHtml(confirmAction)}" style="margin:0 0 16px;">
<input type="hidden" name="confirm" value="1">
<button type="submit" style="font:inherit;cursor:pointer;border:0;background:#7c8cff;color:#0b0f1a;font-weight:600;padding:12px 24px;border-radius:12px;">Tắt email nhắc việc</button>
</form>`
    : ''
  const settingsLink = `<a href="${escapeHtml(appUrl())}/settings" style="display:inline-block;${
    confirmAction ? 'color:#9aa3c2;' : 'background:#7c8cff;color:#0b0f1a;font-weight:600;padding:12px 24px;border-radius:12px;'
  }text-decoration:none;">${confirmAction ? 'Giữ nguyên, mở Cài đặt' : 'Mở Cài đặt'}</a>`
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f1a;color:#e8ecf8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px;">
<main style="max-width:420px;text-align:center;line-height:1.6;">
<h1 style="font-size:24px;font-weight:600;margin:0 0 12px;">${escapeHtml(title)}</h1>
<p style="color:#9aa3c2;margin:0 0 24px;">${escapeHtml(body)}</p>
${action}${settingsLink}
</main></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const userId = url.searchParams.get('u') || ''
  if (!userId || !verifyUnsubscribeToken(userId, url.searchParams.get('t'))) {
    return page('Link không hợp lệ', 'Link tắt nhắc việc này không đúng hoặc đã hết hiệu lực. Bạn có thể tắt trong Cài đặt.', 400)
  }
  // Chưa tắt gì ở đây. Nút xác nhận gửi POST tới chính đường link này.
  return page('Tắt email nhắc việc?', 'Bạn sẽ không nhận email nhắc việc mỗi sáng nữa. Bật lại bất cứ lúc nào trong Cài đặt.', 200, `${url.pathname}${url.search}`)
}

export async function POST(req: Request) {
  const params = new URL(req.url).searchParams
  const userId = params.get('u') || ''

  // Nút xác nhận trên trang gửi biểu mẫu có confirm=1 và cần trang HTML trả lời;
  // ứng dụng email gửi "List-Unsubscribe=One-Click" và chỉ cần JSON.
  let fromPage = false
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      fromPage = (await req.formData()).get('confirm') === '1'
    } catch {
      fromPage = false
    }
  }

  if (!userId || !verifyUnsubscribeToken(userId, params.get('t'))) {
    return fromPage
      ? page('Link không hợp lệ', 'Link tắt nhắc việc này không đúng hoặc đã hết hiệu lực. Bạn có thể tắt trong Cài đặt.', 400)
      : NextResponse.json({ error: 'Link không hợp lệ' }, { status: 400 })
  }

  const error = await unsubscribe(userId)
  if (error) {
    return fromPage
      ? page('Chưa tắt được', 'Có lỗi khi lưu. Bạn thử lại sau hoặc tắt trong Cài đặt nhé.', 500)
      : NextResponse.json({ error: 'Không lưu được' }, { status: 500 })
  }
  return fromPage
    ? page('Đã tắt email nhắc việc', 'Bạn sẽ không nhận email nhắc việc nữa. Muốn bật lại, vào Cài đặt, mục Nhắc việc.')
    : NextResponse.json({ ok: true })
}
