import chalk from 'chalk'

/**
 * 支持的颜色，取值与 chalk 颜色方法名一致，导出给调用方使用
 */
export const COLORS = {
  BLACK: 'black',
  RED: 'red',
  GREEN: 'green',
  YELLOW: 'yellow',
  BLUE: 'blue',
  MAGENTA: 'magenta',
  CYAN: 'cyan',
  WHITE: 'white',
  GRAY: 'gray',
  RED_BRIGHT: 'redBright',
  GREEN_BRIGHT: 'greenBright',
  YELLOW_BRIGHT: 'yellowBright',
  CYAN_BRIGHT: 'cyanBright',
}

/**
 * 渲染文本样式：应用颜色（默认黑色）与加粗，返回带 ANSI 转义的字符串
 * 传入不支持的颜色名时回退为黑色
 */
export function style(text = '', { color = 'black', bold = false } = {}) {
  let painter = typeof chalk[color] === 'function' ? chalk[color] : chalk.black
  if (bold) painter = painter.bold
  return painter(text)
}

/**
 * 公共日志输出
 * 单段：log('文本', { color: 'red', bold: true })
 * 多段（一行内多种样式）：log([{ text: 'a', color: 'gray' }, { text: 'b', bold: true }])
 */
export function log(content, styleOptions) {
  const segments = Array.isArray(content) ? content : [{ text: content, ...(styleOptions || {}) }]
  console.log(segments.map(({ text, ...opts }) => style(text, opts)).join(''))
}

// spinner 动画帧（盲文点阵）
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * 启动单行加载动画，返回 { stop(), restart() }
 * restart 用于工具执行期间暂停动画（如 askUser 等待用户输入，避免刷屏覆盖提示行）
 */
export function startSpinner(text, { color = 'gray', indent = 0 } = {}) {
  // 非 TTY（管道/重定向）下不做动画，避免帧序列堆积在输出里
  if (!process.stdout.isTTY) {
    return { stop() {}, restart() {} }
  }
  const pad = ' '.repeat(indent)
  let frame = 0
  let timer = null

  const show = () => {
    process.stdout.write('\x1b[?25l') // 隐藏光标
    timer = setInterval(() => {
      process.stdout.write(`\r${pad}${SPINNER_FRAMES[frame]} ${style(text, { color })}`)
      frame = (frame + 1) % SPINNER_FRAMES.length
    }, 80)
  }
  const hide = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    process.stdout.write('\r\x1b[K\x1b[?25h') // 清除动画行，恢复光标
  }

  show()
  return {
    stop: hide,
    restart() {
      if (timer === null) show()
    },
  }
}

// 东亚双宽字符（汉字、全角符号等），终端中占 2 列
const WIDE_RE = /[⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/

/**
 * 计算字符串在终端的显示宽度（双宽字符按 2 列计算）
 */
export function displayWidth(text = '') {
  let width = 0
  for (const ch of text) width += WIDE_RE.test(ch) ? 2 : 1
  return width
}

/**
 * 按显示宽度右侧补空格，保证中英文混排对齐
 */
export function padEndDisplay(text = '', width) {
  const pad = width - displayWidth(text)
  return pad > 0 ? text + ' '.repeat(pad) : text
}

/**
 * 按显示宽度左侧补空格（右对齐用）
 */
export function padStartDisplay(text = '', width) {
  const pad = width - displayWidth(text)
  return pad > 0 ? ' '.repeat(pad) + text : text
}

/**
 * 按显示宽度截断字符串，超长时尾部以 … 结尾
 */
export function truncateDisplay(text = '', width) {
  if (displayWidth(text) <= width) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = WIDE_RE.test(ch) ? 2 : 1
    if (used + w > width - 1) return out + '…'
    out += ch
    used += w
  }
  return out
}

// ───────────────────────── Markdown 渲染 ─────────────────────────

// 各级标题样式：层级越深颜色越暗
const HEADING_STYLES = [
  { color: COLORS.CYAN_BRIGHT, bold: true },
  { color: COLORS.CYAN, bold: true },
  { color: COLORS.BLUE, bold: true },
  { color: COLORS.MAGENTA, bold: true },
  { color: COLORS.GRAY, bold: true },
  { color: COLORS.GRAY, bold: true },
]

/**
 * 行内替换规则：图片、链接、粗体、删除线、斜体、行内公式
 * 行内代码不在这里处理（由 renderInlineMD 分段保护）
 */
function replaceInlineRules(text) {
  let out = text

  // 图片 ![alt](url) → 🖼 alt (url)，需在链接规则之前处理
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
    style(`🖼 ${alt || '图片'} (${url})`, { color: COLORS.GRAY })
  )
  // 链接 [text](url) → text (url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
    `${label} ${style(`(${url})`, { color: COLORS.GRAY })}`
  )
  // 粗体 **text** / __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, t) => style(t, { bold: true }))
  out = out.replace(/__([^_]+)__/g, (_, t) => style(t, { bold: true }))
  // 删除线 ~~text~~
  out = out.replace(/~~([^~]+)~~/g, (_, t) => chalk.strikethrough(t))
  // 斜体 *text* / _text_（_ 需避开单词内部的下划线）
  out = out.replace(/\*([^*\n]+)\*/g, (_, t) => chalk.italic(t))
  out = out.replace(/(?<![a-zA-Z0-9_])_([^_\n]+)_(?![a-zA-Z0-9_])/g, (_, t) => chalk.italic(t))
  // 行内公式 $...$
  out = out.replace(/\$([^$\n]+)\$/g, (_, t) => chalk.italic.yellow(t))

  return out
}

/**
 * 渲染行内 Markdown：行内代码直接上色，其余文本应用行内规则
 * 用 split 分段天然保护代码内容，不受粗体等规则误伤
 */
function renderInlineMD(text) {
  return text
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`')
        ? style(part.slice(1, -1), { color: COLORS.CYAN })
        : replaceInlineRules(part)
    )
    .join('')
}

/**
 * 解析围栏行（``` 或 ~~~，含 4 个以上反引号的嵌套外层围栏）
 * 不是围栏行返回 null
 */
function parseFence(line) {
  const m = line.match(/^\s*(`{3,}|~{3,})\s*(\S*)\s*$/)
  return m ? { marker: m[1][0], len: m[1].length, lang: m[2].toLowerCase() } : null
}

// 视为 Markdown 外壳的语言（围栏内容继续按 Markdown 渲染而非代码）
const SHELL_LANGS = ['markdown', 'md']

/**
 * 判断是否为表格行 | a | b |
 */
function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line)
}

/**
 * 按对齐方式填充单元格宽度
 */
function padCell(text, width, align) {
  if (align === 'right') return padStartDisplay(text, width)
  if (align === 'center') {
    const pad = width - displayWidth(text)
    if (pad <= 0) return text
    const left = Math.floor(pad / 2)
    return ' '.repeat(left) + text + ' '.repeat(pad - left)
  }
  return padEndDisplay(text, width)
}

/**
 * 渲染表格：按各列最长内容对齐，表头加粗着色，隐藏分隔行
 */
function renderTableMD(rows, indent) {
  const splitCells = (line) =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

  // 分隔行（| :--- | :---: | ---: |）决定对齐方式
  const dividerIdx = rows.findIndex((r) => {
    const cells = splitCells(r)
    return cells.length > 0 && cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))
  })
  const aligns =
    dividerIdx >= 0
      ? splitCells(rows[dividerIdx]).map((c) =>
          c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'
        )
      : []
  const header = dividerIdx > 0 ? rows.slice(0, dividerIdx) : []
  const body = dividerIdx >= 0 ? rows.slice(dividerIdx + 1) : rows

  // 列宽取所有行中最长
  const matrix = rows.map(splitCells)
  const colCount = Math.max(...matrix.map((r) => r.length))
  const widths = Array.from({ length: colCount }, (_, i) =>
    Math.max(...matrix.map((r) => displayWidth(r[i] ?? '')))
  )

  const renderRow = (line, isHeader) => {
    const cells = splitCells(line).map((c, i) => padCell(c, widths[i] ?? 0, aligns[i]))
    const joined = cells.join('  ')
    return isHeader ? indent + style(joined, { color: COLORS.CYAN, bold: true }) : indent + joined
  }

  const lines = []
  for (const h of header) lines.push(renderRow(h, true))
  for (const b of body) lines.push(renderRow(b, false))
  return lines
}

/**
 * 渲染普通内容行（不在代码块内）：标题、分隔线、引用、任务列表、有序/无序列表、段落
 */
function renderContentMD(line, state, indent) {
  // 嵌套围栏开始（markdown 外壳内遇到代码块等）
  const fence = parseFence(line)
  if (fence) {
    const isShell = SHELL_LANGS.includes(fence.lang)
    state.fenceStack.push({ ...fence, isShell })
    return isShell
      ? null
      : style(`${indent}┄┄${fence.lang ? ` ${fence.lang} ` : ' code '}┄┄`, { color: COLORS.GRAY })
  }

  // 块级公式开始 $$
  if (/^\s*\$\$\s*$/.test(line)) {
    state.formula = true
    return style(`${indent}┄┄ 公式 ┄┄`, { color: COLORS.GRAY })
  }

  // 空行原样保留，作为段落分隔
  if (!line.trim()) return ''

  // 标题 # ~ ######，去掉行尾成对 #
  const heading = line.match(/^(#{1,6})\s+(.*)$/)
  if (heading) {
    return indent + style(heading[2].replace(/\s*#+\s*$/, ''), HEADING_STYLES[heading[1].length - 1])
  }

  // 分隔线 --- / *** / ___
  if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
    return style(indent + '─'.repeat(44), { color: COLORS.GRAY })
  }

  // 引用 > text
  const quote = line.match(/^\s*>\s?(.*)$/)
  if (quote) {
    return (
      style(`${indent}│ `, { color: COLORS.GRAY }) +
      style(renderInlineMD(quote[1]), { color: COLORS.GRAY })
    )
  }

  // 任务列表 - [ ] / - [x]
  const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)
  if (task) {
    const done = task[2].toLowerCase() === 'x'
    const mark = style(done ? '☑ ' : '☐ ', { color: done ? COLORS.GREEN : COLORS.GRAY })
    const text = done ? style(renderInlineMD(task[3]), { color: COLORS.GRAY }) : renderInlineMD(task[3])
    return `${indent}${task[1]}${mark}${text}`
  }

  // 无序列表 - / * / +
  const ul = line.match(/^(\s*)[-*+]\s+(.*)$/)
  if (ul) {
    return `${indent}${ul[1]}${style('• ', { color: COLORS.CYAN })}${renderInlineMD(ul[2])}`
  }

  // 有序列表 1. / 1)
  const ol = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/)
  if (ol) {
    return `${indent}${ol[1]}${style(`${ol[2]}. `, { color: COLORS.CYAN })}${renderInlineMD(ol[3])}`
  }

  // 普通段落
  return indent + renderInlineMD(line)
}

/**
 * 渲染单行 Markdown，返回带 ANSI 样式的整行内容；返回 null 表示该行跳过不输出
 * state 维护围栏栈（支持嵌套外壳）与块级公式状态
 */
function renderLineMD(line, state, indent) {
  const fence = parseFence(line)
  const stack = state.fenceStack

  // 块级公式内部
  if (state.formula) {
    if (/^\s*\$\$\s*$/.test(line)) {
      state.formula = false
      return style(`${indent}┄┄┄┄┄`, { color: COLORS.GRAY })
    }
    return style(indent + line, { color: COLORS.YELLOW })
  }

  // 围栏内部
  if (stack.length > 0) {
    const top = stack[stack.length - 1]
    // 围栏结束：同字符、数量不少于开始、无语言标注
    if (fence && !fence.lang && fence.marker === top.marker && fence.len >= top.len) {
      stack.pop()
      return top.isShell ? null : style(`${indent}┄┄┄┄┄`, { color: COLORS.GRAY })
    }
    // markdown 外壳：内容继续按 Markdown 渲染（可开启嵌套代码块）
    if (top.isShell) return renderContentMD(line, state, indent)
    // 代码块内容原样输出
    return style(indent + line, { color: COLORS.GRAY })
  }

  return renderContentMD(line, state, indent)
}

/**
 * 创建按行渲染 Markdown 的输出器
 * 内部维护围栏栈、公式状态与表格行缓冲（表格需整块处理）
 */
function createMDRenderer({ indent = '  ' } = {}) {
  const state = { fenceStack: [], formula: false }
  let tableRows = []

  function flushTable() {
    if (!tableRows.length) return
    const lines = renderTableMD(tableRows, indent)
    tableRows = []
    for (const line of lines) console.log(line)
  }

  return {
    pushLine(line) {
      // 代码块/公式块内的 | 行属于内容，不进表格缓冲
      const inRaw = state.formula || state.fenceStack.some((f) => !f.isShell)
      if (!inRaw && isTableRow(line)) {
        tableRows.push(line)
        return
      }
      flushTable()
      const out = renderLineMD(line, state, indent)
      if (out === null) return
      console.log(out)
    },
    end() {
      flushTable()
      console.log()
    },
  }
}

/**
 * 解析 Markdown 文本并渲染输出（用于整段文本）
 */
export function logMD(text = '', { indent = '  ' } = {}) {
  const renderer = createMDRenderer({ indent })
  for (const line of String(text).split('\n')) renderer.pushLine(line)
  renderer.end()
}

/**
 * 流式 Markdown 打印机：喂入增量文本，凑够完整行后渲染输出
 */
export function createMDStreamPrinter({ indent = '  ' } = {}) {
  const renderer = createMDRenderer({ indent })
  let buffer = ''
  return {
    push(delta) {
      buffer += delta
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        renderer.pushLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    },
    end() {
      if (buffer) {
        renderer.pushLine(buffer)
        buffer = ''
      }
      renderer.end()
    },
  }
}

/**
 * 通用流式输出：标题行 + 加载动画 + Markdown 流式渲染
 * @param {Function} streamFactory 返回异步迭代器（每次产出增量文本）
 * @param {object} [options] title 标题、spinnerText 动画文案、titleColor 标题颜色、emptyText 空回复文案
 * @returns {Promise<{ok: boolean, received: boolean, error?: string}>} 执行结果数据
 */
export async function streamToTerminal(streamFactory, { title, spinnerText, titleColor, emptyText = '（模型没有返回内容）' } = {}) {
  if (title) log(`  ● ${title}`, { color: titleColor || COLORS.GREEN, bold: true })

  const spinner = startSpinner(spinnerText || '思考中…', { indent: 2 })
  const printer = createMDStreamPrinter({ indent: '  ' })
  let received = false

  try {
    // 工具执行期间暂停加载动画（askUser 等待输入时避免刷屏覆盖提示）。
    // toolEnd 不恢复 spinner：避免并行工具/确认期间 spinner 重绘压到确认提示下方。
    const stream = streamFactory({
      toolStart: () => spinner.stop(),
      toolEnd: () => {
        // 暂不恢复；若整个对话无文本增量，结束时统一 stop（见 catch 后逻辑）
      },
    })
    for await (const delta of stream) {
      // 收到第一个增量时停掉加载动画，开始输出正文
      if (!received) {
        spinner.stop()
        received = true
      }
      printer.push(delta)
    }

    if (received) {
      printer.end()
    } else {
      spinner.stop()
      log(`  ${emptyText}\n`, { color: COLORS.GRAY })
    }
    return { ok: true, received }
  } catch (err) {
    spinner.stop()
    if (received) printer.end()
    return { ok: false, received, error: err.message }
  }
}
