// Chuẩn hoá thông báo lỗi trả ra client: chỉ cho qua các lỗi nghiệp vụ đã biết,
// còn lại (PostgREST, Postgres, Google, Anthropic, thiếu env...) ghi log phía server
// và trả thông báo chung để không lộ chi tiết nội bộ.
const PASS_THROUGH = /^(Unauthorized|NoWorkspace|Forbidden|RateLimited|Không tìm thấy)/

export function publicError(error: unknown, fallback = 'Đã có lỗi xảy ra. Vui lòng thử lại sau.'): string {
  const message = typeof (error as any)?.message === 'string' ? ((error as any).message as string) : ''
  if (PASS_THROUGH.test(message)) return message
  if (/^Claude API/.test(message)) {
    console.error('AI provider error:', message.slice(0, 300))
    return 'Dịch vụ AI đang gặp sự cố. Vui lòng thử lại sau ít phút.'
  }
  if (message) console.error('API error:', message.slice(0, 300))
  return fallback
}
