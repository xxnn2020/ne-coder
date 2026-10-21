import readline from 'node:readline'
import path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { style, COLORS, displayWidth, truncateDisplay } from './logUtils.js'
import { getCurrentTerminalDir, listDirEntries, searchDirEntries } from './fileUtils.js'
import { isProcessing, requestInterrupt } from './runtime.js'

// 列表最多显示行数，超出滚动
const MAX_LIST_ROWS = 8

// 输入历史条数上限
const MAX_HISTORY = 100

/**
 * 去掉 ANSI 转义后的显示宽度（光标定位用）
 */
function visibleWidth(s) {
  return displayWidth(String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''))
}

/**
 * 目录段 'src/utils/' → 'src/'，用于文件列表返回上级
 */
function parentDirPart(dirPart) {
  const trimmed = dirPart.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx >= 0 ? trimmed.slice(0, idx + 1) : ''
}

/**
 * 创建交互式输入框（自绘，替代 readline 的行编辑）：
 * - 词首输入 '/' 触发指令补全列表，继续输入实时过滤
 * - 词首输入 '@' 触发文件/文件夹列表，文件夹回车进入浏览，文件回车插入 @路径
 * - 列表打开时 ↑↓ 选择、Enter 选中填充（不发送）、ESC 关闭
 * - 列表关闭时 Enter 提交整行 onSubmit
 * - Ctrl+C / Ctrl+D 触发 onExit
 * 返回 { render, close }：外部输出后调用 render 重绘输入行；close 恢复终端状态
 */
export function createInteractInput({ prompt = '', commands = [], onSubmit, onExit }) {
  const stdin = process.stdin
  const stdout = process.stdout

  let buffer = [] // 输入字符
  let cursor = 0 // 光标位置（buffer 索引）
  let list = null // { mode: 'command' | 'file', items, index, tokenStart }
  let drawnLines = 0 // 上次绘制的行数（重绘清除用）
  let closed = false
  let paused = false // 暂停按键处理（askUser 等临时接管输入时）

  // 输入历史：↑↓ 浏览之前提交过的提问（historyIndex 为 -1 表示未在浏览、使用草稿）
  const inputHistory = []
  let historyIndex = -1
  let historyDraft = ''

  readline.emitKeypressEvents(stdin)
  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.resume()

  // ───────────────────────── 列表计算 ─────────────────────────

  /**
   * 光标前文本的当前词及其起始位置
   */
  function currentToken() {
    const before = buffer.slice(0, cursor).join('')
    const m = before.match(/\S+$/)
    const token = m ? m[0] : ''
    return { token, tokenStart: cursor - token.length }
  }

  /**
   * 根据当前输入计算应显示的列表，不满足触发条件返回 null
   */
  function computeList() {
    const { token, tokenStart } = currentToken()
    if (!token) return null
    // 词首触发：token 前无字符或为空白
    const prev = tokenStart > 0 ? buffer[tokenStart - 1] : null
    if (prev !== null && !/\s/.test(prev)) return null

    // 指令模式：/xxx（支持中文等指令名）
    if (/^\/[^\s/]*$/.test(token)) {
      const items = commands
        .filter((c) => c.name.startsWith(token))
        .map((c) => ({ label: c.name, desc: c.desc, insert: c.name + ' ' }))
      return items.length ? { mode: 'command', items, index: 0, tokenStart } : null
    }

    // 文件模式：@[dir/]query
    if (token.startsWith('@')) {
      const rest = token.slice(1)
      const sep = rest.lastIndexOf('/')
      const dirPart = sep >= 0 ? rest.slice(0, sep + 1) : ''
      const query = sep >= 0 ? rest.slice(sep + 1) : rest

      // 联想模式：无路径前缀且有关键词时，递归搜索子目录中名字包含关键词的文件
      if (!dirPart && query) {
        const hits = searchDirEntries(getCurrentTerminalDir(), query)
        const items = hits.map((h) => ({
          label: h.name + (h.isDir ? '/' : ''),
          isDir: h.isDir,
          insert: '@' + h.name + (h.isDir ? '/' : ' '),
        }))
        return items.length ? { mode: 'file', items, index: 0, tokenStart } : null
      }

      // 目录浏览模式：列出 dirPart 目录下前缀匹配 query 的条目
      const baseDir = path.resolve(getCurrentTerminalDir(), dirPart)
      const items = listDirEntries(baseDir)
        .filter((e) => e.name.startsWith(query))
        .map((e) => ({
          label: e.name + (e.isDir ? '/' : ''),
          isDir: e.isDir,
          // 文件夹填充 @dir/ 继续浏览；文件填充 @dir/file 后补空格
          insert: '@' + dirPart + e.name + (e.isDir ? '/' : ' '),
        }))
      // 浏览子目录时提供返回上级
      if (dirPart) {
        items.push({ label: '../', isDir: true, insert: '@' + parentDirPart(dirPart) })
      }
      return items.length ? { mode: 'file', items, index: 0, tokenStart } : null
    }

    return null
  }

  function refreshList() {
    list = computeList()
    render()
  }

  // ───────────────────────── 渲染 ─────────────────────────

  /**
   * 清除绘制区：render 结束时光标总在输入行（绘制区首行），清除该行到屏幕底即可
   * 注意不能上移，否则会误清输入行上方的对话历史
   */
  function clearDrawn() {
    stdout.write('\r\x1b[J')
    drawnLines = 0
  }

  /**
   * 滚动窗口：选中项尽量居中，始终可见
   */
  function visibleWindow() {
    const { items, index } = list
    let start = Math.max(0, index - Math.floor(MAX_LIST_ROWS / 2))
    start = Math.min(start, Math.max(0, items.length - MAX_LIST_ROWS))
    return { start, rows: items.slice(start, start + MAX_LIST_ROWS) }
  }

  function render() {
    if (closed) return
    clearDrawn()

    const lines = [prompt + buffer.join('')]
    if (list) {
      const { start, rows } = visibleWindow()
      rows.forEach((item, i) => {
        const selected = start + i === list.index
        const prefix = selected ? '  ❯ ' : '    '
        const labelColor = selected
          ? { color: COLORS.CYAN_BRIGHT, bold: true }
          : list.mode === 'file' && item.isDir
            ? { color: COLORS.CYAN }
            : {}
        let text = prefix + style(truncateDisplay(item.label, 40), labelColor)
        if (list.mode === 'command' && item.desc) {
          text += style(`  ${item.desc}`, { color: COLORS.GRAY })
        }
        lines.push(text)
      })
      if (list.items.length > rows.length) {
        lines.push(style(`    … 共 ${list.items.length} 项`, { color: COLORS.GRAY }))
      }
    }

    const lineCount = lines.length

    // 列表需要额外空间时，先用空行触发必要的滚动，避免写入途中滚屏导致错位
    if (lineCount > 1) {
      stdout.write('\n'.repeat(lineCount - 1))
      stdout.write(`\x1b[${lineCount - 1}A`)
    }

    stdout.write(lines.join('\n') + '\n')
    drawnLines = lineCount

    // 写入 n 行后光标在第 n 行行首，上移 n 行回到输入行，再定位到 buffer 光标列
    stdout.write(`\x1b[${drawnLines}A\r`)
    stdout.write(`\x1b[${visibleWidth(prompt) + visibleWidth(buffer.slice(0, cursor).join('')) + 1}G`)
  }

  // ───────────────────────── 按键处理 ─────────────────────────

  /**
   * 用 text 替换当前 token（tokenStart 到光标）
   */
  function replaceToken(start, text) {
    buffer.splice(start, cursor - start, ...text)
    cursor = start + text.length
  }

  /**
   * 用户是否已手动输入完整的指令名或文件路径（此时回车应直接提交而非选中填充）
   */
  function hasExactInput() {
    const { token } = currentToken()
    if (list.mode === 'command') {
      return commands.some((c) => c.name === token)
    }
    if (list.mode === 'file') {
      const full = path.resolve(getCurrentTerminalDir(), token.slice(1))
      return existsSync(full) && statSync(full).isFile()
    }
    return false
  }

  /**
   * 提交整行：清空输入、回显并回调；非空行记入输入历史
   */
  function submitLine() {
    const line = buffer.join('')
    buffer = []
    cursor = 0
    list = null
    if (line.trim()) {
      inputHistory.push(line)
      if (inputHistory.length > MAX_HISTORY) inputHistory.shift()
    }
    historyIndex = -1
    historyDraft = ''
    clearDrawn()
    stdout.write(prompt + line + '\n')
    if (line.trim()) {
      onSubmit(line)
    } else {
      render()
    }
  }

  /**
   * ↑ 浏览更早的输入历史（首次进入浏览时保存当前草稿）
   */
  function browseHistoryUp() {
    if (inputHistory.length === 0) return
    if (historyIndex === -1) {
      historyDraft = buffer.join('')
      historyIndex = inputHistory.length - 1
    } else if (historyIndex > 0) {
      historyIndex--
    }
    buffer = [...inputHistory[historyIndex]]
    cursor = buffer.length
    refreshList()
  }

  /**
   * ↓ 浏览更新的输入历史，到底后恢复浏览前的草稿
   */
  function browseHistoryDown() {
    if (historyIndex === -1) return
    if (historyIndex < inputHistory.length - 1) {
      historyIndex++
      buffer = [...inputHistory[historyIndex]]
    } else {
      historyIndex = -1
      buffer = [...historyDraft]
    }
    cursor = buffer.length
    refreshList()
  }

  function handleEnter() {
    // 列表打开：选中项填充到输入框，不发送
    if (list) {
      // 已手动输入完整指令/文件路径时，回车直接提交
      if (hasExactInput()) {
        submitLine()
        return
      }
      const item = list.items[list.index]
      replaceToken(list.tokenStart, item.insert)
      // 文件夹（含 ../）填充后继续浏览新目录，指令与文件填充后关闭列表
      if (item.isDir && list.mode === 'file') {
        refreshList()
      } else {
        list = null
        render()
      }
      return
    }

    submitLine()
  }

  function onKey(str, key) {
    if (closed || paused) return

    // Ctrl+D：退出程序
    if (key.ctrl && key.name === 'd') {
      close()
      onExit()
      return
    }
    // Ctrl+C 分流：有输入/列表 → 清空本次输入；AI 回复中 → 中断回复；空闲 → 退出程序
    if (key.ctrl && key.name === 'c') {
      if (buffer.length > 0 || list) {
        buffer = []
        cursor = 0
        list = null
        historyIndex = -1
        historyDraft = ''
        render()
        return
      }
      if (isProcessing()) {
        requestInterrupt()
        return
      }
      close()
      onExit()
      return
    }
    if (key.name === 'return' || key.name === 'enter') {
      handleEnter()
      return
    }
    if (key.name === 'escape') {
      if (list) {
        list = null
        render()
      }
      return
    }
    // ↑↓：列表打开时选择候选项；列表关闭时浏览输入历史
    if (key.name === 'up' || key.name === 'down') {
      if (list) {
        const n = list.items.length
        if (n) {
          const delta = key.name === 'up' ? -1 : 1
          list.index = (list.index + delta + n) % n
          render()
        }
      } else if (key.name === 'up') {
        browseHistoryUp()
      } else {
        browseHistoryDown()
      }
      return
    }
    if (key.name === 'left' && cursor > 0) {
      cursor--
      refreshList()
      return
    }
    if (key.name === 'right' && cursor < buffer.length) {
      cursor++
      refreshList()
      return
    }
    if (key.name === 'backspace') {
      if (cursor > 0) {
        buffer.splice(cursor - 1, 1)
        cursor--
        refreshList()
      }
      return
    }
    // 普通字符（含中文等多字节字符）
    if (str && !key.ctrl && !key.meta) {
      buffer.splice(cursor, 0, str)
      cursor += str.length
      refreshList()
    }
  }

  stdin.on('keypress', onKey)

  /**
   * 关闭输入组件，恢复终端状态（raw mode 等）
   */
  function close() {
    if (closed) return
    closed = true
    clearDrawn()
    stdin.removeListener('keypress', onKey)
    if (stdin.isTTY) {
      try {
        stdin.setRawMode(false)
      } catch {
        // 忽略恢复失败
      }
    }
  }

  render()

  /**
   * 重置绘制状态：外部清屏（/clear）后调用，避免下次重绘错误上移
   */
  function reset() {
    drawnLines = 0
    render()
  }

  /**
   * 暂停按键处理：其他组件（如 askUser 工具）临时接管输入时调用
   */
  function pause() {
    paused = true
  }

  /**
   * 恢复按键处理；不立即重绘输入行——
   * 由主循环在本轮处理完成后统一 redisplayPrompt，避免与模型输出交错导致界面错乱
   * 同时恢复 raw mode 与输入流：临时 readline（askUser）close 时会关闭 raw mode、
   * 暂停 stdin，不恢复的话后续按键无法到达 keypress 监听
   */
  function resume() {
    paused = false
    if (stdin.isTTY) {
      try {
        stdin.setRawMode(true)
      } catch {
        // 忽略恢复失败
      }
    }
    stdin.resume()
  }

  return { render, reset, close, pause, resume }
}
