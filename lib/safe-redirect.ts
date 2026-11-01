/** Return only same-origin relative paths for post-authentication redirects. */
export function safeInternalPath(candidate: string | null | undefined, origin: string): string {
  try {
    const base = new URL(origin)
    const target = new URL(candidate || '/', base)
    if (target.origin !== base.origin || target.pathname.startsWith('//')) return '/'
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return '/'
  }
}
