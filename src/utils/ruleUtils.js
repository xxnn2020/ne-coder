import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir } from './fileUtils.js'

/**
 * 解析规则 md 文件：文件头部（--- 包裹的元数据）中的 paths 列表作为匹配规则，其余为正文
 * 头部以 --- 开始和结束，paths 下每行一个 glob（如 通配符 跟 .css）
 * 无文件头部时 rules 为空数组、content 为全文
 */
function parseRuleFile(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) {
    return { rules: [], content: raw.trim() }
  }

  const [, fileHeader, body] = m

  // 提取 paths 下的列表项（- "xxx" / - xxx），遇到其他键则结束
  const rules = []
  let inPaths = false
  for (const line of fileHeader.split('\n')) {
    if (/^\s*paths\s*:/.test(line)) {
      inPaths = true
      continue
    }
    if (!inPaths) continue
    const item = line.match(/^\s+-\s*(.+)$/)
    if (item) {
      rules.push(item[1].trim().replace(/^['"]|['"]$/g, ''))
    } else if (line.trim()) {
      inPaths = false
    }
  }

  return { rules, content: body.trim() }
}

/**
 * 读取规则文件：当前项目 .coder/rules 与用户设置目录 .coder/rules 下的 md
 * 返回 Map：key 为文件绝对路径，value 为 { content: string, rules: string[] }
 * 同名文件当前项目目录优先（与 setting.json 优先级一致）
 */
export function loadRules() {
  const map = new Map()
  const seen = new Set()

  for (const base of [getCurrentTerminalDir(), getUserSettingsDir()]) {
    const dir = path.join(getCoderConfigDir(base), 'rules')
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在，跳过
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      if (seen.has(entry.name)) continue
      seen.add(entry.name)

      const file = path.join(dir, entry.name)
      try {
        const { rules, content } = parseRuleFile(readFileSync(file, 'utf8'))
        map.set(file, { content, rules })
      } catch {
        // 单个文件读取失败跳过，不影响其余规则
      }
    }
  }

  return map
}
