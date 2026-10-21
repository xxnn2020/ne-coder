process.env.CODER_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-user-')) // 测试隔离：不读写真实用户数据
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-hist-'))
process.chdir(TMP) // session_meta 表写入 <cwd>/.coder/db/

const { createSessionMeta, bumpSessionTurns, setSessionSummary, listSessions } = await import(
  '../src/utils/historyUtils.js'
)

beforeEach(() => {
  fs.rmSync(path.join(TMP, '.coder'), { recursive: true, force: true })
})

test('createSessionMeta：登记并出现在列表中', () => {
  const now = Date.now()
  createSessionMeta(now, { model: 'm1', firstQuestion: '第一问' })
  const list = listSessions({ limit: 10 })
  assert.equal(list.length, 1)
  assert.equal(list[0].threadId, String(now))
  assert.equal(list[0].firstQuestion, '第一问')
  assert.equal(list[0].model, 'm1')
  assert.equal(list[0].turns, 0)
})

test('createSessionMeta：重复登记不覆盖（INSERT OR IGNORE）', () => {
  createSessionMeta(123, { model: 'a', firstQuestion: 'q1' })
  createSessionMeta(123, { model: 'b', firstQuestion: 'q2' })
  const list = listSessions({ limit: 10 })
  assert.equal(list.length, 1)
  assert.equal(list[0].firstQuestion, 'q1')
})

test('bumpSessionTurns：轮数递增并返回当前值', () => {
  createSessionMeta(456, { model: 'm', firstQuestion: 'q' })
  assert.equal(bumpSessionTurns(456), 1)
  assert.equal(bumpSessionTurns(456), 2)
  const [row] = listSessions({ limit: 10 })
  assert.equal(row.turns, 2)
})

test('setSessionSummary：写入摘要', () => {
  createSessionMeta(789, { model: 'm', firstQuestion: 'q' })
  setSessionSummary(789, '对话要点')
  const [row] = listSessions({ limit: 10 })
  assert.equal(row.summary, '对话要点')
})

test('listSessions：按启动时间倒序、limit 生效', () => {
  const base = Date.now()
  for (const tid of [base + 1, base + 2, base + 3]) {
    createSessionMeta(tid, { model: 'm', firstQuestion: `q${tid}` })
  }
  const top2 = listSessions({ limit: 2 })
  assert.equal(top2.length, 2)
  assert.equal(top2[0].threadId, String(base + 3)) // 最新在前
  assert.equal(top2[1].threadId, String(base + 2))
})

test('listSessions：空库返回空数组', () => {
  assert.deepEqual(listSessions({ limit: 5 }), [])
})
