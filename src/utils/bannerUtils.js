import { log, COLORS, displayWidth, padEndDisplay, truncateDisplay } from './logUtils.js'
import { shortenPath, getCurrentTerminalDir } from './fileUtils.js'
import { SETTING_FIELDS } from './llm.js'

const APP_NAME = 'AI CLI'
const VERSION = '1.0.0'

// ASCII 字母画，按 "AI CODER" 拼出 LOGO（AI 与 CODER 之间留空格）
// 全部使用单一 █ 块字符：█ 与制表符（═ ║ ╗ ╝ 等）在部分终端字体下
// 宽度不一致（CJK 环境制表符常被渲染为双宽），混排必然错位
// 每个字母的各行必须等宽（含尾随空格），否则整体渲染会歪
const LOGO_PARTS = {
  A: ['   ██   ', '  ████  ', ' ██  ██ ', '████████', '██    ██', '██    ██'],
  I: ['████', ' ██ ', ' ██ ', ' ██ ', ' ██ ', '████'],
  C: [' ██████ ', '██    ██', '██      ', '██      ', '██    ██', ' ██████ '],
  O: ['  ████  ', ' ██  ██ ', '██    ██', '██    ██', ' ██  ██ ', '  ████  '],
  D: ['██████  ', '██    ██', '██    ██', '██    ██', '██    ██', '██████  '],
  E: ['███████', '██     ', '██████ ', '██     ', '██     ', '███████'],
  R: ['██████  ', '██    ██', '██    ██', '██████  ', '██    ██', '██    ██'],
}
const LOGO = [0, 1, 2, 3, 4, 5].map(
  (i) =>
    [LOGO_PARTS.A[i], LOGO_PARTS.I[i]].join(' ') +
    '   ' +
    [LOGO_PARTS.C[i], LOGO_PARTS.O[i], LOGO_PARTS.D[i], LOGO_PARTS.E[i], LOGO_PARTS.R[i]].join(' ')
)
// LOGO 逐行渐变：青 → 蓝 → 洋红
const LOGO_COLORS = [
  COLORS.CYAN_BRIGHT, COLORS.CYAN, COLORS.BLUE,
  COLORS.BLUE, COLORS.MAGENTA, COLORS.MAGENTA,
]

/**
 * 渲染信息面板：按内容自动对齐，过长值截断
 */
function renderInfoPanel(rows) {
  const labelWidth = Math.max(...rows.map(([label]) => displayWidth(label)))
  const valueWidth = Math.min(Math.max(...rows.map(([, value]) => displayWidth(value))), 44)
  const innerWidth = 2 + labelWidth + 2 + valueWidth + 2
  const edge = '─'.repeat(innerWidth)

  log(`  ╭${edge}╮`, { color: COLORS.GRAY })
  for (const [label, value] of rows) {
    log([
      { text: '  │  ', color: COLORS.GRAY },
      { text: padEndDisplay(label, labelWidth), color: COLORS.CYAN },
      { text: '  ' },
      { text: padEndDisplay(truncateDisplay(value, valueWidth), valueWidth), color: COLORS.GRAY },
      { text: '  │', color: COLORS.GRAY },
    ])
  }
  log(`  ╰${edge}╯`, { color: COLORS.GRAY })
}

/**
 * 从 baseURL 提取主机名，无效时回退显示完整值
 */
function hostOf(baseURL) {
  if (!baseURL) return 'api.openai.com'
  try {
    return new URL(baseURL).host
  } catch {
    return baseURL
  }
}

/**
 * 打印启动横幅
 */
export function printBanner(config) {
  log()
  LOGO.forEach((line, i) => log(line, { color: LOGO_COLORS[i] }))
  log()
  log([
    { text: '  ✨ AI 终端助手', color: COLORS.CYAN_BRIGHT, bold: true },
    { text: `  v${VERSION}`, color: COLORS.GRAY },
  ])
  log()

  if (config) {
    renderInfoPanel([
      ['模型', config[SETTING_FIELDS.model] || 'gpt-4o-mini'],
      ['端点', hostOf(config[SETTING_FIELDS.baseURL])],
      ['配置', shortenPath(config.file)],
      ['目录', shortenPath(getCurrentTerminalDir())],
    ])
    log()
  }

  log([
    { text: '  ' },
    { text: '/help', color: COLORS.CYAN, bold: true },
    { text: ' 查看命令  ·  ', color: COLORS.GRAY },
    { text: '/clear', color: COLORS.CYAN, bold: true },
    { text: ' 清屏  ·  ', color: COLORS.GRAY },
    { text: '/exit', color: COLORS.CYAN, bold: true },
    { text: ' 退出', color: COLORS.GRAY },
  ])
  log()
}
