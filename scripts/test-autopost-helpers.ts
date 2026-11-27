import assert from 'node:assert/strict'
import {
  CAPTION_SIMILARITY_THRESHOLD,
  assertCaptionSafe,
  hasPhoneNumber,
  isCaptionTooSimilar,
  normalizeCaption,
  trigramSimilarity,
} from '../lib/autopost/caption'
import { hammingDistance, phashFromGray32, signed64 } from '../lib/autopost/phash'

// --- caption ---
assert.equal(
  normalizeCaption('Hải sản TƯƠI sống mỗi ngày tại Sầm Sơn! #samson 🦐'),
  'hai san tuoi song moi ngay tai sam son',
)
assert.equal(normalizeCaption(null), '')
assert.ok(hasPhoneNumber('Gọi ngay 0912 345 678 để đặt bàn'))
assert.ok(hasPhoneNumber('Liên hệ +84 912345678'))
assert.ok(!hasPhoneNumber('Ghé thăm chúng tôi trên đường Hồ Xuân Hương nhé.'))
assert.equal(assertCaptionSafe('quá ngắn').ok, false)
assert.equal(assertCaptionSafe('Gọi 0912345678 '.repeat(10) + 'đủ dài để vượt bốn mươi ký tự.').ok, false)
assert.equal(
  assertCaptionSafe(
    'Hải sản tươi sống mỗi ngày tại Sầm Sơn, không gian rộng thoáng mát nhìn ra biển. Ghé quán để giữ bàn cho gia đình bạn tối nay!',
  ).ok,
  true,
)

const similar = trigramSimilarity(
  'Hải sản tươi sống mỗi ngày tại Sầm Sơn, không gian rộng thoáng mát nhìn ra biển. Gọi ngay để giữ bàn cho gia đình bạn tối nay!',
  'Hải sản tươi sống mỗi ngày tại Sầm Sơn, không gian rộng thoáng mát nhìn ra biển. Gọi ngay giữ bàn cho gia đình tối nay!',
)
assert.ok(similar >= CAPTION_SIMILARITY_THRESHOLD, `expected similar captions, got ${similar}`)
assert.ok(
  isCaptionTooSimilar(
    'Hải sản tươi sống mỗi ngày tại Sầm Sơn, không gian rộng thoáng mát nhìn ra biển. Gọi ngay để giữ bàn cho gia đình bạn tối nay!',
    'Hải sản tươi sống mỗi ngày tại Sầm Sơn, không gian rộng thoáng mát nhìn ra biển. Gọi ngay giữ bàn cho gia đình tối nay!',
  ),
)
const different = trigramSimilarity(
  'Hải sản tươi sống mỗi ngày tại Sầm Sơn, không gian rộng thoáng mát nhìn ra biển. Gọi ngay để giữ bàn cho gia đình bạn tối nay!',
  'Mặt tiền mới sơn lại của nhà hàng, có chỗ đỗ ô tô rộng ngay trước cửa. Ghé thăm chúng tôi trên đường Hồ Xuân Hương nhé.',
)
assert.ok(different < CAPTION_SIMILARITY_THRESHOLD, `expected different captions, got ${different}`)

// --- pHash ---
const a = new Uint8Array(32 * 32)
const b = new Uint8Array(32 * 32)
for (let i = 0; i < a.length; i++) {
  const x = i % 32
  const y = Math.floor(i / 32)
  a[i] = (x * 7 + y * 13) % 256
  b[i] = a[i]
}
const ha = phashFromGray32(a)
const hb = phashFromGray32(b)
assert.equal(ha, hb)
assert.equal(hammingDistance(ha, hb), 0)
b[100] = (b[100] + 80) % 256
b[200] = (b[200] + 40) % 256
const hc = phashFromGray32(b)
const d1 = hammingDistance(ha, hc)
assert.ok(d1 < 16, `small pixel change should stay near, got ${d1}`)

const far = new Uint8Array(32 * 32)
for (let i = 0; i < far.length; i++) far[i] = 255 - a[i]
const hf = phashFromGray32(far)
assert.ok(hammingDistance(ha, hf) > 16, 'inverted image should be far')

assert.equal(signed64(BigInt(1) << BigInt(63)) < BigInt(0), true)
assert.equal(hammingDistance(BigInt(0), BigInt(7)), 3)

console.log('test-autopost-helpers: OK')
