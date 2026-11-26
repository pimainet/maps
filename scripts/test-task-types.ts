// Danh mục task_type: AI trả về loại nào thì giữ đúng loại đó; danh mục khớp giao diện, hướng dẫn và prompt.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TASK_TYPES, isContentTaskType, isTaskType, normalizeTaskType } from '../lib/task-types'
import { TASK_TYPE_LABEL } from '../lib/ui-constants'
import { getTaskGuidance } from '../lib/task-action'

// lỗi gốc: description_update bị đổi thành 'other'
assert.equal(normalizeTaskType('description_update'), 'description_update')
for (const t of TASK_TYPES) assert.equal(normalizeTaskType(t), t)

// chịu được hoa/thường, khoảng trắng; giá trị lạ hoặc sai kiểu -> other
assert.equal(normalizeTaskType('  Description_Update '), 'description_update')
assert.equal(normalizeTaskType('CONTENT'), 'content')
for (const bad of ['bai_viet', '', undefined, null, 42, {}]) assert.equal(normalizeTaskType(bad), 'other')
assert.ok(isTaskType('photo') && !isTaskType('x') && !isTaskType(undefined))

// loại cần AI soạn nội dung
assert.ok(isContentTaskType('content') && isContentTaskType('description_update'))
assert.ok(!isContentTaskType('photo') && !isContentTaskType('other') && !isContentTaskType(undefined))

// không lệch giữa các module: nhãn giao diện khớp danh mục
assert.deepEqual([...Object.keys(TASK_TYPE_LABEL)].sort(), [...TASK_TYPES].sort())

// mỗi loại có hướng dẫn riêng (không rơi về mặc định 'other' trừ chính 'other')
const other = getTaskGuidance('other')
for (const t of TASK_TYPES) {
  if (t !== 'other') assert.notEqual(getTaskGuidance(t), other, `thiếu hướng dẫn cho ${t}`)
}

// prompt tạo việc nhắc đủ mọi loại
const prompt = readFileSync(new URL('../lib/prompts.ts', import.meta.url), 'utf8')
for (const t of TASK_TYPES) assert.ok(prompt.includes(`"${t}"`), `prompt thiếu loại ${t}`)

console.log('test-task-types: OK')
