// Nhiều thành phần cùng gọi 1 GET trong cùng lúc (sidebar + trang đều gọi /api/me, /api/clients...) thì chỉ gửi 1 request.
// KHÔNG lưu kết quả sau khi xong: dữ liệu luôn mới, chỉ gộp các lệnh gọi đang chạy song song.
const inflight = new Map<string, Promise<Response>>()

export function dedupeFetch(url: string): Promise<Response> {
  let p = inflight.get(url)
  if (!p) {
    p = fetch(url).finally(() => inflight.delete(url))
    inflight.set(url, p)
  }
  return p.then((r) => r.clone())
}
