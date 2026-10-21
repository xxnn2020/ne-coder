import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir } from './fileUtils.js'

// 指令描述最多显示字符数
const DESC_LIMIT = 30

/**
 * 读取 md 首行（去掉 # 前缀）作为指令描述
 */
function readDesc(file) {
  try {
    const first = readFileSync(file, 'utf8').split('\n').find((l) => l.trim())
    if (!first) return ''
    return first.replace(/^#\s*/, '').trim().slice(0, DESC_LIMIT)
  } catch {
    return ''
  }
}

/**
 * 构造一个自定义指令：execute 读取 md 内容，作为 context 返回给调用方带给大模型
 */
function makeCustomCommand(name, file) {
  return {
    name: `/${name}`,
    desc: readDesc(file) || '自定义指令',
    // 非中断类型：执行后剩余内容继续发给大模型
    interrupt: false,
    // 自定义指令标记
    custom: true,
    /**
     * @returns {{ok: boolean, context?: string, error?: string}} 执行结果数据
     */
    execute() {
      try {
        const content = readFileSync(file, 'utf8')
        return { ok: true, context: `<command name="/${name}">\n${content}\n</command>` }
      } catch (err) {
        return { ok: false, error: `读取指令文件失败：${err.message}` }
      }
    },
  }
}

/**
 * 扫描自定义指令目录，查找顺序：当前目录 .coder/commands → 用户设置目录 .coder/commands
 * 命名规则：xx.md → /xx；a/b.md → /a:b（仅支持一级子目录）
 * 重名时先找到的优先
 */
export function loadCustomCommands() {
  const commands = []
  const seen = new Set()

  for (const base of [getCurrentTerminalDir(), getUserSettingsDir()]) {
    const dir = path.join(getCoderConfigDir(base), 'commands')
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在，跳过
    }

    // 根目录下的 xx.md → /xx
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const name = entry.name.slice(0, -3)
      if (!name || seen.has(name)) continue
      seen.add(name)
      commands.push(makeCustomCommand(name, path.join(dir, entry.name)))
    }

    // 一级子目录 a/b.md → /a:b
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      let subs
      try {
        subs = readdirSync(path.join(dir, entry.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const sub of subs) {
        if (!sub.isFile() || !sub.name.endsWith('.md')) continue
        const stem = sub.name.slice(0, -3)
        if (!stem) continue
        const name = `${entry.name}:${stem}`
        if (seen.has(name)) continue
        seen.add(name)
        commands.push(makeCustomCommand(name, path.join(dir, entry.name, sub.name)))
      }
    }
  }

  return commands
}
