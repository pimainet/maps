// Khớp code app với quyền DB của migration 035 (GRANT theo cột + EXECUTE cho authenticated). Thuần đọc file, không DB/mạng.
// Mục đích: thêm cột vào chỗ app ghi bằng session người dùng mà quên GRANT -> test đỏ thay vì lỗi 42501 trên production.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const mig = read('supabase/migrations/035_security_definer_hardening.sql')

function grantedColumns(priv: 'INSERT' | 'UPDATE', table: string): Set<string> {
  const re = new RegExp(`GRANT\\s+${priv}\\s*\\(([^)]*)\\)\\s*ON\\s+public\\.${table}\\s+TO\\s+authenticated`, 'i')
  const m = mig.match(re)
  assert.ok(m, `035 thiếu GRANT ${priv}(...) ON public.${table} TO authenticated`)
  return new Set(m![1].split(',').map((c) => c.trim()).filter(Boolean))
}

function objectKeys(body: string): string[] {
  // khóa dạng `key:` hoặc `key?:` ở đầu dòng / sau dấu phẩy, hoặc shorthand `{ id, name }`
  const keys = new Set<string>()
  for (const m of body.matchAll(/(?:^|[\s,{])([a-z_][a-z0-9_]*)\??\s*:/gim)) keys.add(m[1])
  return [...keys]
}

function sliceBetween(src: string, start: string, end: string): string {
  const i = src.indexOf(start)
  assert.ok(i >= 0, `không tìm thấy: ${start}`)
  const j = src.indexOf(end, i + start.length)
  assert.ok(j > i, `không tìm thấy điểm kết thúc sau: ${start}`)
  return src.slice(i + start.length, j)
}

async function main() {
  const db = read('lib/db.ts')

  // clients: createClient(...) chèn đúng object nhận vào -> mọi field của kiểu tham số phải được GRANT INSERT
  const clientIns = grantedColumns('INSERT', 'clients')
  const clientKeys = objectKeys(sliceBetween(db, 'export async function createClient(client: {', '}) {'))
  assert.ok(clientKeys.length >= 10, 'parse kiểu tham số createClient thất bại')
  for (const k of clientKeys) assert.ok(clientIns.has(k), `clients.${k} được app chèn nhưng chưa GRANT INSERT (035)`)
  for (const k of ['autopost_enabled', 'autopost_review_mode', 'gbp_location_resource', 'autopost_upload_token', 'review_link_token'])
    assert.ok(!clientIns.has(k), `clients.${k} KHÔNG được cho người dùng tự chèn`)

  // google_connections: upsert trong saveGoogleConnection cần INSERT + UPDATE trên mọi cột gửi lên
  const gcIns = grantedColumns('INSERT', 'google_connections')
  const gcUpd = grantedColumns('UPDATE', 'google_connections')
  const upsertKeys = objectKeys(sliceBetween(db, ".from('google_connections')\n    .upsert(", "{ onConflict: 'client_id' }"))
  assert.ok(upsertKeys.includes('access_token_encrypted') && upsertKeys.includes('workspace_id'), 'parse upsert google_connections thất bại')
  for (const k of upsertKeys) {
    assert.ok(gcIns.has(k), `google_connections.${k}: thiếu GRANT INSERT`)
    assert.ok(gcUpd.has(k), `google_connections.${k}: thiếu GRANT UPDATE (upsert ON CONFLICT DO UPDATE)`)
  }
  const patchKeys = objectKeys(sliceBetween(db, 'export async function updateGoogleConnection(', ') {'))
  for (const k of patchKeys.filter((k) => k !== 'id' && k !== 'patch')) assert.ok(gcUpd.has(k), `updateGoogleConnection gửi ${k} nhưng chưa GRANT UPDATE`)
  assert.ok(gcUpd.has('updated_at'))
  for (const k of ['gbp_location_resource', 'gbp_account_resource']) {
    assert.ok(!gcIns.has(k) && !gcUpd.has(k), `google_connections.${k} chỉ service role được ghi`)
    assert.ok(!patchKeys.includes(k), `updateGoogleConnection (session người dùng) không được ghi ${k}`)
  }
  assert.match(sliceBetween(db, 'export async function setGoogleConnectionLocation(', '\n}\n'), /supabaseAdmin/, 'ghi location phải dùng service client')

  // workspaces: app chỉ chèn (id, name), không .select() ngay sau insert (RETURNING lỗi trước trigger thêm owner)
  const wsIns = grantedColumns('INSERT', 'workspaces')
  assert.deepEqual([...wsIns].sort(), ['id', 'name'])
  const wsRoute = read('app/api/workspaces/route.ts').replace(/^\s*\/\/.*$/gm, '')
  assert.match(wsRoute, /\.from\('workspaces'\)\.insert\(\{ id, name \}\)/, 'route tạo workspace phải chèn đúng { id, name }')
  assert.doesNotMatch(wsRoute, /\.insert\([^)]*\)\s*\.select\(/, 'không .insert().select() trên workspaces')

  // RPC gọi bằng session người dùng (biến `supabase`) phải nằm trong danh sách GRANT EXECUTE ... TO authenticated
  const execAuth = new Set([...mig.matchAll(/GRANT EXECUTE ON FUNCTION public\.([a-z_]+)\([^)]*\)\s+TO authenticated/gi)].map((m) => m[1]))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(join(root, dir))) {
      const p = join(dir, f)
      if (statSync(join(root, p)).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  walk('app'); walk('lib')
  const userRpcs = new Set<string>()
  for (const f of files) for (const m of read(f).matchAll(/\bsupabase\.rpc\(\s*'([a-z_]+)'/g)) userRpcs.add(m[1])
  assert.ok(userRpcs.has('update_client') && userRpcs.has('reserve_audit_quota'), 'không tìm thấy RPC phía người dùng')
  for (const fn of userRpcs) assert.ok(execAuth.has(fn), `RPC ${fn} gọi bằng session người dùng nhưng 035 không GRANT EXECUTE cho authenticated`)

  // Hàm trigger không bao giờ được gọi từ API
  for (const fn of ['handle_new_user', 'handle_new_workspace', 'guard_workspace_member_roles', 'rls_auto_enable'])
    assert.match(mig, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM PUBLIC, anon, authenticated`), `${fn}: thiếu REVOKE`)

  console.log('test-db-grants: OK')
}

main().catch((e) => { console.error(e); process.exit(1) })
