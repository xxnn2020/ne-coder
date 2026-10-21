import os from 'node:os'
import path from 'node:path'
import { readdirSync } from 'node:fs'

/**
 * 获取当前终端所在目录
 */
export function getCurrentTerminalDir() {
  return process.cwd()
}

/**
 * 获取当前用户设置目录：CODER_USER_DIR 环境变量优先（隔离/自定义），
 * 默认用户主目录
 */
export function getUserSettingsDir() {
  return process.env.CODER_USER_DIR || os.homedir()
}

/**
 * 获取目录下的 .coder 配置目录路径
 */
export function getCoderConfigDir(dir) {
  return path.join(dir, '.coder')
}

/**
 * 路径缩短显示：家目录部分替换为 ~
 */
export function shortenPath(p) {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

// 目录列表默认忽略的条目
const IGNORED_ENTRIES = new Set(['node_modules', '.git'])

/**
 * 列出目录条目：过滤隐藏文件与忽略项，文件夹在前、同类型按名称排序
 * 读取失败（不存在/无权限）返回空数组
 */
export function listDirEntries(dir) {
  try {
    const items = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && !IGNORED_ENTRIES.has(e.name))
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return items
  } catch {
    return []
  }
}

/**
 * 递归搜索目录下名字包含 query 的文件/文件夹（不区分大小写，@ 补全联想用）
 * 返回相对路径（含目录层级），跳过隐藏文件与 node_modules/.git，
 * 深度（8 层，覆盖 src/mcp/local/xxx/index.js 等深层文件）与数量受限，
 * 浅层结果优先、同层按路径排序
 */
export function searchDirEntries(base, query, { maxDepth = 8, limit = 50 } = {}) {
  const q = String(query).toLowerCase()
  const results = []
  if (!q) return results

  const walk = (dir, rel, depth) => {
    if (results.length >= limit || depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_ENTRIES.has(entry.name)) continue
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.name.toLowerCase().includes(q)) {
        results.push({ name: relPath, isDir: entry.isDirectory() })
        if (results.length >= limit) return
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath, depth + 1)
      }
    }
  }

  walk(base, '', 1)
  results.sort(
    (a, b) =>
      a.name.split('/').length - b.name.split('/').length || a.name.localeCompare(b.name)
  )
  return results
}
