import { createHash } from 'node:crypto'
import type { AIClassifier, AIClassifyInput } from './types'

/**
 * Bộ nhớ đệm cho lớp phân loại AI. Cùng một đầu vào (system + user) => trả lại ĐÚNG kết quả đã phân loại trước đó,
 * nên 2 lần audit trên cùng dữ liệu cho cùng kết luận (temperature 0 giảm dao động nhưng không đảm bảo giống hệt;
 * cache theo nội dung mới là thứ đảm bảo). Đổi dữ liệu (review mới, mô tả mới...) => hash đổi => phân loại lại.
 *
 * Phiên bản prompt nằm trong khoá: sửa prompt phân loại thì tăng CLASSIFIER_PROMPT_VERSION để không dùng lại kết quả cũ.
 */
export const CLASSIFIER_PROMPT_VERSION = 'v1'

export interface ClassifierStore {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
}

export function classifierCacheKey(input: AIClassifyInput): string {
  return createHash('sha256')
    .update(`${CLASSIFIER_PROMPT_VERSION}\n${input.system}\n---\n${input.user}`)
    .digest('hex')
}

export function memoryClassifierStore(): ClassifierStore & { size: () => number } {
  const m = new Map<string, unknown>()
  return {
    async get(k) {
      return m.get(k)
    },
    async set(k, v) {
      m.set(k, v)
    },
    size: () => m.size,
  }
}

/**
 * Bọc 1 classifier bằng cache. Lỗi cache (bảng chưa tạo, mạng...) KHÔNG làm hỏng audit: coi như cache miss.
 * Chỉ lưu kết quả phân loại thành công (không lưu lỗi).
 */
export function createCachedClassifier(inner: AIClassifier, store: ClassifierStore): AIClassifier & { stats: { hits: number; misses: number } } {
  const stats = { hits: 0, misses: 0 }
  return {
    stats,
    async classify<T>(input: AIClassifyInput): Promise<T> {
      const key = classifierCacheKey(input)
      try {
        const hit = await store.get(key)
        if (hit !== undefined) {
          stats.hits++
          return hit as T
        }
      } catch {
        /* cache miss */
      }
      stats.misses++
      const fresh = await inner.classify<T>(input)
      try {
        await store.set(key, fresh)
      } catch {
        /* best-effort */
      }
      return fresh
    },
  }
}
