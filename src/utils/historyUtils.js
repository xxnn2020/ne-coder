import path from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { getUserSettingsDir, getCurrentTerminalDir, getCoderConfigDir } from './fileUtils.js'

/**
 * 会话元数据库：与 checkpoint 同一 sqlite 文件（.coder/db/coder.sqlite）中的 session_meta 表
 * 消息状态由 SqliteSaver（checkpoint）托管；本表只存列表所需的轻量元数据：
 * 首问、轮数、摘要、模型，避免列表时反序列化 checkpoint 状态
 */
function getMetaDb() {
  const dbDir = path.join(getCoderConfigDir(getCurrentTerminalDir()), 'db')
  mkdirSync(dbDir, { recursive: true })
  const db = new Database(path.join(dbDir, 'coder.sqlite'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_meta (
      thread_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      model TEXT DEFAULT '',
      first_question TEXT DEFAULT '',
      turns INTEGER DEFAULT 0,
      summary TEXT DEFAULT ''
    )
  `)
  return db
}

/**
 * 会话首轮对话时登记元数据（已存在则忽略）
 */
export function createSessionMeta(threadId, { model = '', firstQuestion = '' } = {}) {
  const db = getMetaDb()
  try {
    db.prepare(
      'INSERT OR IGNORE INTO session_meta (thread_id, created_at, model, first_question, turns, summary) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(String(threadId), new Date(Number(threadId) || Date.now()).toISOString(), model, firstQuestion.slice(0, 200), '')
  } finally {
    db.close()
  }
}

/**
 * 会话完成一轮对话后轮数 +1，返回更新后的轮数（供自动记忆等按轮触发）
 */
export function bumpSessionTurns(threadId) {
  const db = getMetaDb()
  try {
    const row = db
      .prepare('UPDATE session_meta SET turns = turns + 1 WHERE thread_id = ? RETURNING turns')
      .get(String(threadId))
    return row?.turns ?? 0
  } finally {
    db.close()
  }
}

/**
 * 写入会话摘要（/summary 完成后调用）
 */
export function setSessionSummary(threadId, summary) {
  const db = getMetaDb()
  try {
    db.prepare('UPDATE session_meta SET summary = ? WHERE thread_id = ?').run(String(summary || ''), String(threadId))
  } finally {
    db.close()
  }
}

/**
 * 列出最近的会话（按 thread_id 即启动时间倒序）
 * 返回 [{ threadId, startedAt, createdAt, model, firstQuestion, turns, summary }]
 */
export function listSessions({ limit = 20 } = {}) {
  const db = getMetaDb()
  try {
    const rows = db
      .prepare(
        'SELECT thread_id, created_at, model, first_question, turns, summary FROM session_meta ORDER BY CAST(thread_id AS INTEGER) DESC LIMIT ?'
      )
      .all(limit)
    return rows.map((r) => ({
      threadId: r.thread_id,
      startedAt: Number(r.thread_id),
      createdAt: r.created_at,
      model: r.model || '',
      firstQuestion: r.first_question || '',
      turns: r.turns || 0,
      summary: r.summary || '',
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}
