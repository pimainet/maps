// Giữ file này để tương thích ngược với code cũ đang import từ '@/lib/supabase'
// Code mới nên dùng:
//   - '@/lib/supabase/client'  → Client Components
//   - '@/lib/supabase/server'  → Server Components / Route Handlers
//   - '@/lib/supabase/admin'   → Service role (bỏ qua RLS)

export { supabaseAdmin as supabase } from '@/lib/supabase/admin'
