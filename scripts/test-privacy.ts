// Bảo vệ dữ liệu cá nhân: đồng ý theo mục đích, cookie đăng ký, thời hạn yêu cầu (NĐ 356 Điều 5), tối thiểu hoá snapshot,
// kế hoạch xoá tài khoản + thực thi (Supabase giả), không điền lại tên người viết review đã xoá. Thuần logic, không DB/mạng.
import assert from 'node:assert/strict'
import {
  CONSENT_PURPOSES, CONSENT_VERSION, DELETE_CONFIRM_PHRASE, DELETION_GRACE_DAYS, RETENTION_DAYS, clientIpFromHeaders,
  deletionScheduledFor, encodeConsentCookie, legalEntityIncomplete, minimizeSnapshotRaw, missingRequiredPurposes,
  normalizeConfirmPhrase, normalizeConsentChoice, parseConsentCookie, planAccountDeletion, requestDueAt, truncateUserAgent,
} from '../lib/privacy/policy'
import { consentState } from '../lib/privacy/consent-state'
import { PROCESSORS } from '../lib/privacy/processors'
import { isMissingColumnError, isMissingRelationError } from '../lib/privacy/db-compat'
import { executeDueDeletions, runRetention } from '../lib/privacy/server'
import { planIngest } from '../lib/reviews/ingest'
import { reviewFingerprint } from '../lib/reviews/normalize'
import { fakeSupabase } from './fake-supabase'

async function main() {
  // ── Mục đích đồng ý ──────────────────────────────────────────────────────
  assert.deepEqual(CONSENT_PURPOSES.filter((p) => p.required).map((p) => p.key), ['service', 'cross_border'])
  assert.equal(CONSENT_PURPOSES.find((p) => p.key === 'marketing')!.required, false, 'marketing không được bắt buộc (Luật 91 Điều 9.4.b)')
  assert.deepEqual(missingRequiredPurposes({}), ['service', 'cross_border'], 'im lặng ≠ đồng ý')
  assert.deepEqual(missingRequiredPurposes({ service: true }), ['cross_border'])
  assert.deepEqual(missingRequiredPurposes({ service: true, cross_border: true }), [])
  assert.deepEqual(normalizeConsentChoice({ service: 'true', cross_border: 1, marketing: false, evil: true }), { marketing: false }, 'chỉ nhận boolean tường minh')
  assert.deepEqual(normalizeConsentChoice(null), {})
  assert.match(CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}$/)

  // ── Cookie đăng ký ───────────────────────────────────────────────────────
  const at = new Date('2026-11-28T03:00:00Z')
  const ck = encodeConsentCookie({ service: true, cross_border: true, marketing: false }, at)
  assert.equal(ck, `${CONSENT_VERSION}.110.${at.getTime()}`)
  const parsed = parseConsentCookie(ck, new Date(at.getTime() + 3600_000))!
  assert.deepEqual(parsed.choice, { service: true, cross_border: true, marketing: false })
  assert.equal(parsed.at.getTime(), at.getTime())
  assert.equal(parseConsentCookie(ck, new Date(at.getTime() + 3 * 86_400_000)), null, 'cookie quá 2 ngày bị bỏ')
  assert.equal(parseConsentCookie(ck, new Date(at.getTime() - 3600_000)), null, 'thời điểm ở tương lai bị bỏ')
  assert.equal(parseConsentCookie('2026-11-28.11.123'), null)
  assert.equal(parseConsentCookie('<script>'), null)
  assert.equal(parseConsentCookie(undefined), null)

  // ── Trạng thái đồng ý ────────────────────────────────────────────────────
  assert.deepEqual(consentState([]), { current: null, needsConsent: true, reason: 'none' })
  const ok = { policy_version: CONSENT_VERSION, purposes: { service: true, cross_border: true, marketing: true }, action: 'grant' as const, recorded_at: '2026-11-28T01:00:00Z' }
  assert.equal(consentState([ok]).needsConsent, false)
  assert.equal(consentState([ok]).current!.purposes.marketing, true)
  assert.equal(consentState([{ ...ok, policy_version: '2025-01-01' }]).reason, 'outdated')
  assert.equal(consentState([ok, { ...ok, action: 'withdraw', recorded_at: '2026-11-28T02:00:00Z' }]).reason, 'withdrawn', 'bản mới nhất quyết định')
  assert.equal(consentState([{ ...ok, recorded_at: '2026-11-28T00:00:00Z', purposes: { service: true } }, ok]).needsConsent, false)
  assert.equal(consentState([{ ...ok, purposes: { service: true, cross_border: false } }]).reason, 'missing_required')

  // ── Thời hạn yêu cầu (NĐ 356/2025 Điều 5) ───────────────────────────────
  const t0 = new Date('2026-12-01T00:00:00Z')
  const days = (d: Date) => Math.round((d.getTime() - t0.getTime()) / 86_400_000)
  assert.equal(days(requestDueAt('export', t0)), 10)
  assert.equal(days(requestDueAt('correct', t0)), 10)
  assert.equal(days(requestDueAt('delete_account', t0)), 20)
  assert.equal(days(requestDueAt('withdraw_consent', t0)), 15)
  assert.equal(days(requestDueAt('restrict', t0)), 15)
  assert.equal(days(requestDueAt('object', t0)), 15)
  assert.equal(days(deletionScheduledFor(t0)), DELETION_GRACE_DAYS)
  assert.ok(DELETION_GRACE_DAYS < 20, 'xoá thật phải trước hạn 20 ngày')

  // ── Câu xác nhận xoá ─────────────────────────────────────────────────────
  assert.equal(normalizeConfirmPhrase('  xoá   tài khoản '), DELETE_CONFIRM_PHRASE)
  assert.equal(normalizeConfirmPhrase('XÓA TÀI KHOẢN'), DELETE_CONFIRM_PHRASE)
  assert.notEqual(normalizeConfirmPhrase('xoa'), DELETE_CONFIRM_PHRASE)
  assert.equal(normalizeConfirmPhrase(42), '')

  // ── IP / UA ──────────────────────────────────────────────────────────────
  assert.equal(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9')
  assert.equal(clientIpFromHeaders(new Headers({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1')
  assert.equal(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '<b>x</b>' })), null)
  assert.equal(clientIpFromHeaders(new Headers()), null)
  assert.equal(truncateUserAgent('a'.repeat(1000))!.length, 400)

  // ── Tối thiểu hoá snapshot ───────────────────────────────────────────────
  const raw = {
    source: 'hybrid',
    coverage: { reviews: 'outscraper' },
    reply_field_present: true,
    raw_review_count: 20,
    outscraper: { reviews_data: [{ author_title: 'Nguyễn A', author_link: 'https://maps/contrib/1', author_image: 'x' }] },
    places: { reviews: [{ authorAttribution: { displayName: 'B', photoUri: 'y' } }] },
  }
  const min = minimizeSnapshotRaw(raw)
  assert.deepEqual(Object.keys(min).sort(), ['coverage', 'minimized', 'raw_review_count', 'reply_field_present', 'source'])
  assert.ok(!JSON.stringify(min).includes('Nguyễn A') && !JSON.stringify(min).includes('photoUri'))
  assert.deepEqual(minimizeSnapshotRaw(null), { minimized: true })
  assert.deepEqual(minimizeSnapshotRaw([1, 2]), { minimized: true })
  assert.deepEqual(minimizeSnapshotRaw({ deep: { opening_hours: 'x' }, minimized: true }), { deep: { opening_hours: 'x' }, minimized: true })

  // ── Hạn lưu trữ khớp điều khoản Google / luật kế toán ────────────────────
  assert.equal(RETENTION_DAYS.placesLatLng, 30)
  assert.ok(RETENTION_DAYS.snapshotReviews <= 30)
  assert.ok(RETENTION_DAYS.accounting >= 3650)

  // ── Danh sách bên xử lý ──────────────────────────────────────────────────
  const names = PROCESSORS.map((p) => p.name).join('|')
  for (const n of ['Supabase', 'Vercel', 'Anthropic', 'Resend', 'Google', 'Outscraper', 'SerpApi', 'SearchApi', 'DataForSEO', 'SePay', 'Make']) assert.ok(names.includes(n), n)
  assert.ok(PROCESSORS.every((p) => p.country && p.purpose && p.data && p.retention))
  assert.equal(legalEntityIncomplete({ name: 'A', taxId: '[CHƯA ĐIỀN: x]' } as any), true)
  assert.equal(legalEntityIncomplete({ name: 'A', taxId: '0101' } as any), false)

  // ── Lỗi do chưa chạy migration ───────────────────────────────────────────
  assert.ok(isMissingRelationError({ code: '42P01' }) && isMissingRelationError({ code: 'PGRST202' }) && isMissingRelationError({ message: 'Could not find the function public.run_privacy_retention' }))
  assert.ok(!isMissingRelationError({ code: '23505' }) && !isMissingRelationError(null))
  assert.ok(isMissingColumnError({ code: 'PGRST204' }) && isMissingColumnError({ message: "Could not find the 'latlng_source' column of 'clients'" }) && !isMissingColumnError({ code: '42P01' }))

  // ── Kế hoạch xoá tài khoản ───────────────────────────────────────────────
  const plan = planAccountDeletion([
    { workspace_id: 'solo', role: 'owner', member_count: 1, owner_count: 1 },
    { workspace_id: 'shared-owner', role: 'owner', member_count: 3, owner_count: 1 },
    { workspace_id: 'co-owner', role: 'owner', member_count: 2, owner_count: 2 },
    { workspace_id: 'member', role: 'member', member_count: 4, owner_count: 1 },
  ])
  assert.deepEqual(plan, { deleteWorkspaces: ['solo'], blockers: ['shared-owner'], leaveWorkspaces: ['co-owner', 'member'] })

  // ── Thực thi xoá (Supabase giả) ──────────────────────────────────────────
  const now = new Date('2026-12-10T00:00:00Z')
  const U = 'user-1', U2 = 'user-2', U3 = 'user-3'
  const { db, admin } = fakeSupabase({
    data_requests: [
      { id: 'd1', user_id: U, kind: 'delete_account', status: 'scheduled', scheduled_for: '2026-12-08T00:00:00Z' },
      { id: 'd2', user_id: U2, kind: 'delete_account', status: 'scheduled', scheduled_for: '2026-12-20T00:00:00Z' }, // chưa đến hạn
      { id: 'd3', user_id: U3, kind: 'delete_account', status: 'scheduled', scheduled_for: '2026-12-01T00:00:00Z' },
    ],
    workspace_members: [
      { workspace_id: 'w-solo', user_id: U, role: 'owner' },
      { workspace_id: 'w-team', user_id: U, role: 'member' },
      { workspace_id: 'w-team', user_id: 'boss', role: 'owner' },
      { workspace_id: 'w-blk', user_id: U3, role: 'owner' },
      { workspace_id: 'w-blk', user_id: 'staff', role: 'member' },
    ],
    workspaces: [{ id: 'w-solo' }, { id: 'w-team' }, { id: 'w-blk' }],
    client_photos: [{ workspace_id: 'w-solo', storage_bucket: 'client-photos', storage_path: 'w-solo/c/1.jpg', original_path: 'w-solo/c/orig.heic' }],
    payments: [{ id: 'p1', workspace_id: 'w-solo', user_id: U, amount_vnd: 349000 }],
  })
  const removed: string[] = []
  const rpcCalls: any[] = []
  const deletedUsers: string[] = []
  admin.storage = { from: () => ({ remove: async (paths: string[]) => (removed.push(...paths), { error: null }) }) }
  admin.rpc = async (fn: string, args: any) => (rpcCalls.push([fn, args]), { data: { ok: true }, error: null })
  admin.auth = { admin: { deleteUser: async (id: string) => (deletedUsers.push(id), { error: null }) } }

  const run = await executeDueDeletions(admin, now)
  assert.deepEqual(run, { processed: 2, done: 1, needs_attention: 1 })
  const req = (id: string): any => db.data_requests.find((r: any) => r.id === id)
  assert.equal(req('d1').status, 'done')
  assert.ok(req('d1').completed_at)
  assert.equal(req('d2').status, 'scheduled', 'chưa đến hạn thì không xoá')
  assert.equal(req('d3').status, 'needs_attention', 'chủ sở hữu duy nhất của workspace còn người khác -> chờ nhân viên')
  assert.deepEqual(db.workspaces.map((w: any) => w.id).sort(), ['w-blk', 'w-team'], 'chỉ xoá workspace riêng')
  assert.ok(!db.workspace_members.some((m: any) => m.user_id === U && m.workspace_id === 'w-team'), 'rời workspace dùng chung (w-solo: DB xoá theo cascade)')
  assert.ok(db.workspace_members.some((m: any) => m.user_id === 'boss'))
  assert.deepEqual(removed.sort(), ['w-solo/c/1.jpg', 'w-solo/c/orig.heic'], 'xoá file ảnh trong Storage')
  assert.deepEqual(rpcCalls, [['privacy_scrub_user', { p_user: U }]])
  assert.deepEqual(deletedUsers, [U])
  assert.equal(db.payments.length, 1, 'giữ chứng từ thanh toán (Luật Kế toán)')

  // Chưa chạy migration 033: bỏ qua, không làm cron lỗi
  const missing = fakeSupabase().admin
  const origFrom = missing.from
  missing.from = (t: string) => {
    const q = origFrom(t)
    q.then = (res: any) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "data_requests" does not exist' } }).then(res)
    return q
  }
  missing.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.run_privacy_retention' } })
  assert.equal((await executeDueDeletions(missing, now)).skipped, 'migration 033 chưa chạy')
  assert.equal((await runRetention(missing)).skipped, 'migration 033 chưa chạy')
  const broken: any = { rpc: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) }
  await assert.rejects(runRetention(broken), /timeout/)

  // ── Tên người viết review đã xoá không bị điền lại ───────────────────────
  const inc = { source: 'outscraper' as const, source_review_id: 'os-1', author_name: 'Trần B', rating: 5, text: 'Rất tốt', reviewed_at: '2026-01-01T00:00:00Z', reviewed_at_exact: true }
  const base = {
    review_key: reviewFingerprint(inc), source: 'outscraper', source_review_id: 'os-1', gbp_review_name: null, author_name: null, rating: 5,
    review_text: 'Rất tốt', reviewed_at: '2026-01-01T00:00:00Z', reviewed_at_exact: true, owner_reply: 'Cảm ơn', draft_reply: null, final_reply: null, draft_warnings: [],
  }
  const closed = planIngest([{ ...base, id: 'x1', status: 'posted' } as any], [{ ...inc, owner_reply: 'Cảm ơn' }], { replyKnown: true, now })
  assert.ok(!closed.updates.some((u) => 'author_name' in u.patch), 'review đã xử lý: không điền lại tên')
  const open = planIngest([{ ...base, id: 'x2', status: 'new', owner_reply: null } as any], [inc], { replyKnown: true, now })
  assert.equal(open.updates.find((u) => u.id === 'x2')?.patch.author_name, 'Trần B', 'review đang mở: vẫn điền tên để soạn trả lời')

  console.log('test-privacy: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
