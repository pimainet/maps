// Supabase giả trong bộ nhớ cho test logic (không gọi mạng). Hỗ trợ đủ các lệnh hộp thư review dùng:
// select (count/head), insert, upsert (onConflict + ignoreDuplicates), update, eq/neq/in/is/not/lt/gte/or, order, limit,
// maybeSingle/single. Không phải PostgREST đầy đủ — chỉ để test.
type Row = Record<string, any>

let seq = 0
const uuid = () => {
  seq += 1
  const h = seq.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${h}`
}

function parseOr(expr: string): (r: Row) => boolean {
  const parts = expr.split(',').map((p) => p.trim())
  const preds = parts.map((p) => {
    const m = /^([a-z_]+)\.(not\.is|is|gte|lte|gt|lt|eq)\.(.*)$/.exec(p)
    if (!m) throw new Error(`fake or() không hiểu: ${p}`)
    const [, col, op, val] = m
    return (r: Row) => {
      const v = r[col]
      if (op === 'is') return val === 'null' ? v == null : v === val
      if (op === 'not.is') return val === 'null' ? v != null : v !== val
      if (op === 'eq') return String(v) === val
      if (v == null) return false
      if (op === 'gte') return v >= val
      if (op === 'lte') return v <= val
      if (op === 'gt') return v > val
      return v < val
    }
  })
  return (r) => preds.some((f) => f(r))
}

export function fakeSupabase(seed: Record<string, Row[]> = {}, opts: { uniques?: Record<string, string[][]> } = {}) {
  const db: Record<string, Row[]> = { ...seed }
  const uniques = opts.uniques || {}
  const tbl = (t: string) => (db[t] ||= [])

  const violates = (t: string, row: Row, ignoreId?: string) =>
    (uniques[t] || []).some((cols) => tbl(t).some((x) => x.id !== ignoreId && cols.every((c) => x[c] != null && x[c] === row[c])))

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'insert' | 'delete' = 'select'
    let patch: Row = {}
    let inserted: Row[] = []
    let countMode = false
    let head = false
    let orderBy: Array<{ col: string; asc: boolean }> = []
    let lim: number | null = null
    let wantRows = false
    let insertError: any = null

    const matchRows = () => tbl(table).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (mode === 'insert') {
        if (insertError) return { data: null, error: insertError }
        return { data: wantRows ? inserted : null, error: null }
      }
      if (mode === 'update') {
        const rows = matchRows()
        for (const r of rows) Object.assign(r, patch, { updated_at: new Date().toISOString() })
        return { data: wantRows ? rows.map((r) => ({ ...r })) : null, error: null }
      }
      let rows = matchRows()
      for (const o of [...orderBy].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = a[o.col]
          const y = b[o.col]
          if (x == null && y == null) return 0
          if (x == null) return 1
          if (y == null) return -1
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1)
        })
      }
      if (lim != null) rows = rows.slice(0, lim)
      if (countMode) return { data: head ? null : rows, count: matchRows().length, error: null }
      return { data: rows.map((r) => ({ ...r })), error: null }
    }

    const api: any = {
      select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
        if (mode !== 'select') wantRows = true
        if (o?.count) countMode = true
        if (o?.head) head = true
        return api
      },
      insert: (rows: Row | Row[]) => {
        mode = 'insert'
        const list = Array.isArray(rows) ? rows : [rows]
        for (const r of list) {
          const rec = { id: uuid(), created_at: new Date().toISOString(), ...r }
          if (violates(table, rec)) {
            insertError = { code: '23505', message: 'duplicate key' }
            break
          }
          tbl(table).push(rec)
          inserted.push({ ...rec })
        }
        return api
      },
      upsert: (rows: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        mode = 'insert'
        const list = Array.isArray(rows) ? rows : [rows]
        const keys = (o?.onConflict || 'id').split(',').map((s) => s.trim())
        for (const r of list) {
          const hit = tbl(table).find((x) => keys.every((k) => x[k] === r[k]))
          if (hit) {
            if (!o?.ignoreDuplicates) Object.assign(hit, r)
            continue
          }
          const rec = { id: uuid(), created_at: new Date().toISOString(), ...r }
          tbl(table).push(rec)
          inserted.push({ ...rec })
        }
        return api
      },
      update: (p: Row) => {
        mode = 'update'
        patch = p
        return api
      },
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
      neq: (k: string, v: any) => (filters.push((r) => r[k] !== v), api),
      in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), api),
      is: (k: string, v: null) => (filters.push((r) => (v === null ? r[k] == null : r[k] === v)), api),
      not: (k: string, op: string, v: any) => (filters.push((r) => (op === 'is' && v === null ? r[k] != null : r[k] !== v)), api),
      lt: (k: string, v: any) => (filters.push((r) => r[k] != null && r[k] < v), api),
      gte: (k: string, v: any) => (filters.push((r) => r[k] != null && r[k] >= v), api),
      or: (expr: string) => (filters.push(parseOr(expr)), api),
      order: (col: string, o?: { ascending?: boolean }) => (orderBy.push({ col, asc: o?.ascending !== false }), api),
      limit: (n: number) => ((lim = n), api),
      maybeSingle: async () => {
        const r = run()
        if (r.error) return r
        const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data
        return { data: d, error: null }
      },
      single: async () => {
        const r = run()
        if (r.error) return r
        const d = Array.isArray(r.data) ? r.data[0] : r.data
        return d ? { data: d, error: null } : { data: null, error: { message: 'no rows' } }
      },
      then: (res: any, rej?: any) => Promise.resolve(run()).then(res, rej),
    }
    return api
  }
  return { db, admin: { from } as any }
}
