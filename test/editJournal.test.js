import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-journal-'))
process.chdir(TMP)

const journal = await import('../src/utils/editJournal.js')

beforeEach(() => {
  journal.clearJournal()
  journal.beginTurn()
})

test('recordEdit + undoLastTurn：恢复原内容', () => {
  fs.writeFileSync('a.txt', 'AAA')
  journal.recordEdit('a.txt', 'AAA', true)
  fs.writeFileSync('a.txt', 'CHANGED')

  const r = journal.undoLastTurn()
  assert.equal(r.restored, 1)
  assert.equal(fs.readFileSync('a.txt', 'utf8'), 'AAA')
})

test('undoLastTurn：本轮新建文件回滚即删除', () => {
  journal.recordEdit('new.txt', '', false)
  fs.writeFileSync('new.txt', 'created')

  const r = journal.undoLastTurn()
  assert.equal(r.restored, 1)
  assert.equal(fs.existsSync('new.txt'), false)
})

test('undoLastTurn：只回滚最近一轮', () => {
  fs.writeFileSync('x.txt', 'X1')
  journal.recordEdit('x.txt', 'X1', true)
  fs.writeFileSync('x.txt', 'X2')

  journal.beginTurn() // 第 2 轮
  journal.recordEdit('y.txt', '', false)
  fs.writeFileSync('y.txt', 'Y')

  const r = journal.undoLastTurn()
  assert.equal(r.restored, 1)
  assert.equal(r.files[0], 'y.txt')
  // 第 1 轮的修改不受影响
  assert.equal(fs.readFileSync('x.txt', 'utf8'), 'X2')
})

test('undoLastTurn：无记录返回 null', () => {
  assert.equal(journal.undoLastTurn(), null)
})

test('beginTurn：重置全部放行信号', () => {
  journal.setApproveAll()
  assert.equal(journal.isApproveAll(), true)
  journal.beginTurn()
  assert.equal(journal.isApproveAll(), false)
})
