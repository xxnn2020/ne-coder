import chalk from 'chalk'
import { style, COLORS } from './logUtils.js'

// 渲染上下文行数：变更区前后各带 N 行原文
const CONTEXT_LINES = 2

/**
 * 行级 diff：公共前缀/后缀法，中间为变更区
 * 返回 [{ type: 'ctx'|'add'|'del', text }]（ctx 为上下文行）
 * 对 editFile 的局部替换足够准确；全量重写时中间块整体为变更
 */
export function makeLineDiff(before = '', after = '') {
  // 空内容按无行处理（避免 split 产生的 [''] 被当成删除行）
  const a = before ? String(before).split('\n') : []
  const b = after ? String(after).split('\n') : []

  // 公共前缀
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  // 公共后缀（不与前缀重叠）
  let suf = 0
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf++
  }

  const lines = []
  for (let i = Math.max(0, pre - CONTEXT_LINES); i < pre; i++) {
    lines.push({ type: 'ctx', text: a[i] })
  }
  for (let i = pre; i < a.length - suf; i++) {
    lines.push({ type: 'del', text: a[i] })
  }
  for (let i = pre; i < b.length - suf; i++) {
    lines.push({ type: 'add', text: b[i] })
  }
  for (let i = a.length - suf; i < Math.min(a.length, a.length - suf + CONTEXT_LINES); i++) {
    lines.push({ type: 'ctx', text: a[i] })
  }
  return lines
}

/**
 * 渲染 diff 到终端：暗色底 diff 配色，超长截断
 * maxLines 缺省按终端可视高度动态计算（确认提示需留在屏内，diff 不能顶出屏幕）
 * @returns {{added: number, removed: number}} 变更统计
 */
export function renderDiff(file, before, after, options = {}) {
  // 终端高度 - 标题/确认提示等占用（约 7 行），限制在 [8, 40]
  const rows = process.stdout.rows || 24
  const maxLines = options.maxLines ?? Math.max(8, Math.min(40, rows - 7))
  const diff = makeLineDiff(before, after)
  const isNew = before === '' && after !== ''
  const isDeleted = before !== '' && after === ''

  const label = isNew ? '新建' : isDeleted ? '删除' : '修改'
  const adds = diff.filter((l) => l.type === 'add').length
  const dels = diff.filter((l) => l.type === 'del').length

  console.log(
    style(`  📄 ${label} ${file}（+${adds} / -${dels}）`, { color: COLORS.CYAN, bold: true })
  )

  const shown = diff.slice(0, maxLines)
  for (const line of shown) {
    if (line.type === 'add') {
      // 新增：暗绿背景 + 浅绿文字（IDE/GitHub Dark 风格，truecolor 老终端自动降级）
      console.log('  ' + chalk.rgb(126, 231, 135).bgRgb(30, 58, 38)(`+ ${line.text}`))
    } else if (line.type === 'del') {
      // 删除：暗红背景 + 浅红文字
      console.log('  ' + chalk.rgb(255, 161, 152).bgRgb(66, 32, 38)(`- ${line.text}`))
    } else {
      console.log(style(`    ${line.text}`, { color: COLORS.GRAY }))
    }
  }
  if (diff.length > maxLines) {
    console.log(style(`  …（共 ${diff.length} 行，仅显示前 ${maxLines} 行）`, { color: COLORS.GRAY }))
  }
  return { added: adds, removed: dels }
}
