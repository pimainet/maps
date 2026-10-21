# Local Growth OS

## Thiết lập nhắc việc qua email

Mỗi sáng khoảng 8 giờ (giờ Việt Nam), hệ thống gửi email cho người có việc đến hạn hoặc quá hạn
(thứ Hai nhắc nhẹ nếu còn việc). Không có việc thì không gửi. Mỗi người tối đa một email mỗi ngày
và tắt được trong Cài đặt, mục Nhắc việc, hoặc bằng link cuối email.

1. **Chạy migration** `supabase/migrations/014_progress_and_reminders.sql` trên database
   (thêm `tasks.completed_at` và bảng `notification_prefs`). Chưa chạy thì ứng dụng vẫn hoạt động,
   chỉ chưa có dòng "tuần này bạn đã xong N việc" và chưa lưu được tùy chọn nhắc việc.
2. **Tạo tài khoản Resend** (https://resend.com), xác minh tên miền gửi thư, tạo API key.
3. **Đặt biến môi trường** (Vercel, Settings, Environment Variables):

   | Biến | Ý nghĩa |
   | --- | --- |
   | `CRON_SECRET` | Chuỗi bí mật dài, ngẫu nhiên. Vercel tự gửi nó khi gọi cron. Không đặt thì cron tắt hẳn. |
   | `RESEND_API_KEY` | API key của Resend. |
   | `REMINDER_FROM_EMAIL` | Người gửi, ví dụ `Nhắc việc <nhacviec@tenmiencuaban.vn>` (tên miền phải đã xác minh trên Resend). |
   | `NOTIFY_SECRET` | Tùy chọn. Khóa ký link hủy nhắc việc. Bỏ trống thì dùng `CRON_SECRET`. |
   | `NEXT_PUBLIC_APP_URL` | Tùy chọn. Địa chỉ ứng dụng cho link trong email, ví dụ `https://app.tenmiencuaban.vn`. Trên Vercel tự lấy từ tên miền production nếu bỏ trống. |

4. **Kiểm tra trước khi bật thật.** Vào Cài đặt, Nhắc việc, bấm "Gửi thử cho tôi" để nhận một email mẫu.
   Để xem hôm nay sẽ gửi cho ai mà chưa gửi thật, gọi
   `GET /api/cron/reminders?dry=1` với header `Authorization: Bearer <CRON_SECRET>`.

Lịch chạy nằm ở `vercel.json` (`0 1 * * *` = 08:00 giờ Việt Nam).
