import path from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { getUserSettingsDir, getCurrentTerminalDir, getCoderConfigDir } from './fileUtils.js'

// 六类记忆：项目级三个、用户级三个
export const MEMORY_CATEGORIES = {
  project: ['project_traits', 'project_history', 'project_pitfalls'],
  user: ['user_preferences', 'user_skills', 'user_projects'],
}

// 分类中文名（展示与注入渲染用）
const CATEGORY_LABELS = {
  project_traits: '项目特点',
  project_history: '开发历史记录',
  project_pitfalls: '项目常见出错',
  user_preferences: '用户开发偏好',
  user_skills: '用户技术情况',
  user_projects: '用户项目情况',
}

/**
 * 记忆库：项目级存 <项目>/.coder/db/coder.sqlite（随项目隔离），
 * 用户级存 <用户设置目录>/.coder/db/coder.sqlite（跨项目共享），均为 memory 表
 */
function getMemoryDb(scope) {
  const base = scope === 'user' ? getUserSettingsDir() : getCurrentTerminalDir()
  const dbDir = path.join(getCoderConfigDir(base), 'db')
  mkdirSync(dbDir, { recursive: true })
  const db = new Database(path.join(dbDir, 'coder.sqlite'))
  db.exec(
    'CREATE TABLE IF NOT EXISTS memory (category TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL)'
  )
  return db
}

/**
 * 读取某侧（project/user）的全部记忆：{ category: content }
 */
export function getMemory(scope) {
  const db = getMemoryDb(scope)
  try {
    const rows = db.prepare('SELECT category, content FROM memory').all()
    return Object.fromEntries(rows.map((r) => [r.category, r.content]))
  } catch {
    return {}
  } finally {
    db.close()
  }
}

/**
 * 写入/更新一条记忆
 */
export function upsertMemory(scope, category, content) {
  const db = getMemoryDb(scope)
  try {
    db.prepare(
      'INSERT INTO memory (category, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(category) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
    ).run(category, String(content || ''), new Date().toISOString())
  } finally {
    db.close()
  }
}

/**
 * 渲染某侧记忆为注入文本（要点列表带分类标题）；无记忆返回空字符串
 */
export function renderMemoryBlock(scope) {
  const memory = getMemory(scope)
  const categories = MEMORY_CATEGORIES[scope] || []
  const parts = []
  for (const cat of categories) {
    const content = String(memory[cat] || '').trim()
    if (content) {
      parts.push(`【${CATEGORY_LABELS[cat]}】\n${content}`)
    }
  }
  return parts.join('\n\n')
}
