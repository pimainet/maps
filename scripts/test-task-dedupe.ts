// So trùng việc: việc mô tả cũ bị lưu 'other' vẫn phải chặn việc mô tả mới cùng tiêu đề.
import assert from 'node:assert/strict'
import { filterDuplicateTasks } from '../lib/client-memory'

const existing = [{ title: 'Viết lại phần giới thiệu doanh nghiệp', task_type: 'other', status: 'pending' }]
const a = filterDuplicateTasks([{ title: 'Viết lại phần giới thiệu doanh nghiệp', task_type: 'description_update' }], existing)
assert.equal(a.kept.length, 0)

// loại khác nhau thật sự (photo vs content) vẫn không bị coi trùng
const b = filterDuplicateTasks(
  [{ title: 'Đăng ảnh mặt tiền', task_type: 'photo' }],
  [{ title: 'Đăng ảnh mặt tiền', task_type: 'content' }]
)
assert.equal(b.kept.length, 1)

// 'other' cũ không chặn việc khác loại khác tiêu đề
const c = filterDuplicateTasks([{ title: 'Chụp ảnh sản phẩm mới', task_type: 'photo' }], existing)
assert.equal(c.kept.length, 1)

console.log('test-task-dedupe: OK')
