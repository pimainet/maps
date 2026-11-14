import type { ClassifierStore } from '@/lib/audit-engine'

/**
 * Cache kết quả phân loại AI lưu trong Supabase (bảng ai_classification_cache, migration 020), truy cập bằng service role.
 * Mọi lỗi (bảng chưa tạo, mạng) đều được nuốt ở lớp createCachedClassifier => thành cache miss, audit vẫn chạy.
 */
export function createSupabaseClassifierStore(): ClassifierStore {
  // import động: lib/supabase/admin ném lỗi khi thiếu env lúc import; ở đây lỗi đó chỉ thành cache miss.
  async function admin() {
    return (await import('@/lib/supabase/admin')).supabaseAdmin
  }
  return {
    async get(key) {
      const db = await admin()
      const { data, error } = await db.from('ai_classification_cache').select('result').eq('cache_key', key).maybeSingle()
      if (error) throw error
      return data?.result ?? undefined
    },
    async set(key, value) {
      const db = await admin()
      const { error } = await db.from('ai_classification_cache').upsert({ cache_key: key, result: value as any }, { onConflict: 'cache_key', ignoreDuplicates: true })
      if (error) throw error
    },
  }
}
