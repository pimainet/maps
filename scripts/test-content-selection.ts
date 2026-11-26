// Chọn việc cần soạn nội dung: không lấy nhầm việc của kế hoạch khác.
import assert from 'node:assert/strict'
import { pickUnwrittenContentTasks } from '../lib/content-selection'

const mk = (id: string, plan_id: string | null, task_type = 'content', day = 1) => ({
  id, plan_id, task_type, created_at: `2026-01-0${day}T00:00:00Z`,
})
const tasks = [
  mk('old-1', 'plan-old', 'content', 1),   // tồn đọng từ kế hoạch cũ, tạo sớm nhất
  mk('new-1', 'plan-new', 'content', 3),
  mk('new-2', 'plan-new', 'description_update', 2),
  mk('new-photo', 'plan-new', 'photo', 2),
  mk('legacy', null, 'content', 1),
]

// lỗi gốc: kế hoạch mới KHÔNG được lấy việc của kế hoạch cũ hay việc không gắn kế hoạch
const forNew = pickUnwrittenContentTasks(tasks, new Set(), 'plan-new').map((t) => t.id)
assert.deepEqual(forNew, ['new-2', 'new-1'])          // chỉ plan-new, chỉ loại cần nội dung, hiện còn xếp theo ngày tạo
assert.ok(!forNew.includes('old-1') && !forNew.includes('legacy'))

// kế hoạch cũ chỉ ra việc của nó
assert.deepEqual(pickUnwrittenContentTasks(tasks, new Set(), 'plan-old').map((t) => t.id), ['old-1'])

// null = chỉ việc cũ chưa gắn kế hoạch
assert.deepEqual(pickUnwrittenContentTasks(tasks, new Set(), null).map((t) => t.id), ['legacy'])

// việc đã có bài thì bỏ; kế hoạch không tồn tại thì rỗng; plan_id undefined coi như null
assert.deepEqual(pickUnwrittenContentTasks(tasks, new Set(['new-2']), 'plan-new').map((t) => t.id), ['new-1'])
assert.deepEqual(pickUnwrittenContentTasks(tasks, new Set(), 'plan-x'), [])
assert.deepEqual(
  pickUnwrittenContentTasks([{ id: 'u', task_type: 'content', created_at: '2026-01-01T00:00:00Z' }], new Set(), null).map((t) => t.id),
  ['u']
)

// onlyTaskIds: chỉ các việc vừa tạo, kể cả khi plan_id trống (tránh viết nhầm việc cũ không gắn kế hoạch)
const justCreated = [mk('c1', null, 'content', 5), mk('c2', null, 'content', 6)]
const mixed = [...justCreated, mk('stale', null, 'content', 1)]
assert.deepEqual(pickUnwrittenContentTasks(mixed, new Set(), null).map((t) => t.id), ['stale', 'c1', 'c2'])
assert.deepEqual(pickUnwrittenContentTasks(mixed, new Set(), null, new Set(['c1', 'c2'])).map((t) => t.id), ['c1', 'c2'])

console.log('test-content-selection: OK')
