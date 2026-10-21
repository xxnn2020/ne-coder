import { test } from 'node:test'
import assert from 'node:assert/strict'

const { makeLineDiff } = await import('../src/utils/diffUtils.js')

test('makeLineDiff：局部替换', () => {
  const d = makeLineDiff('a\nb\nc\nd', 'a\nX\nc\nd')
  assert.deepEqual(
    d.map((l) => `${l.type}:${l.text}`),
    ['ctx:a', 'del:b', 'add:X', 'ctx:c', 'ctx:d']
  )
})

test('makeLineDiff：新文件全为 add', () => {
  const d = makeLineDiff('', 'new\nfile')
  assert.deepEqual(d.map((l) => l.type), ['add', 'add'])
})

test('makeLineDiff：删除文件全为 del', () => {
  const d = makeLineDiff('old\nlines', '')
  assert.deepEqual(d.map((l) => l.type), ['del', 'del'])
})

test('makeLineDiff：无变化只有上下文', () => {
  const d = makeLineDiff('same', 'same')
  assert.deepEqual(d.map((l) => `${l.type}:${l.text}`), ['ctx:same'])
})

test('makeLineDiff：多处变更（前后缀法将中间整体作为变更区）', () => {
  const d = makeLineDiff('a\nb1\nc\nb2\nd', 'a\nB1\nc\nB2\nd')
  // 公共前缀 a、公共后缀 d，中间 3 行 del + 3 行 add
  assert.equal(d.filter((l) => l.type === 'del').length, 3)
  assert.equal(d.filter((l) => l.type === 'add').length, 3)
})
