// CẢNH BÁO: export này trỏ tới supabaseAdmin (service role, BỎ QUA RLS).
// KHÔNG dùng cho các thao tác CRUD bình thường theo workspace — dùng
// '@/lib/supabase/server' (client theo session user, tôn trọng RLS)
// như lib/db.ts đang làm. Chỉ dùng '@/lib/supabase' / supabaseAdmin cho
// các tác vụ nền THỰC SỰ cần bypass RLS (cron job, webhook không có
// session user, v.v.).
//
// Giữ file này để tương thích ngược với code cũ còn import từ đây:
//   - '@/lib/supabase/client'  → Client Components
//   - '@/lib/supabase/server'  → Server Components / Route Handlers (có RLS)
//   - '@/lib/supabase/admin'   → Service role (bỏ qua RLS, dùng hạn chế)

export { supabaseAdmin as supabase } from '@/lib/supabase/admin'
