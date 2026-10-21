import { listSessions } from '../utils/historyUtils.js'
import { log, COLORS } from '../utils/logUtils.js'

// 与 coder -r 的列表条数保持一致
const LIST_LIMIT = 20

/**
 * 渲染会话列表（时间、轮数、摘要/首问预览），
 * /history 指令与 coder -r 启动列表共用
 */
export function renderSessionList(sessions) {
  log('  最近会话：', { bold: true })
  sessions.forEach((s, i) => {
    const time = new Date(s.createdAt || s.startedAt).toLocaleString('zh-CN', { hour12: false })
    const preview = (s.summary || s.firstQuestion || '（无对话）').replace(/\s+/g, ' ').slice(0, 40)
    log([
      { text: `  [${i + 1}] `, color: COLORS.CYAN },
      { text: `${time}  ${s.turns} 轮  ` },
      { text: preview, color: COLORS.GRAY },
    ])
  })
}

/**
 * /history 指令：显示最近的会话列表（与 coder -r 一致，20 条）
 */
export default {
  name: '/history',
  desc: '显示最近会话列表',
  // 中断类型：列表展示后不发送剩余内容给大模型
  interrupt: true,
  /**
   * @returns {{ok: boolean, count: number}} 执行结果数据
   */
  execute() {
    const sessions = listSessions({ limit: LIST_LIMIT })
    if (!sessions.length) {
      log('  没有历史会话', { color: COLORS.YELLOW })
      log()
      return { ok: true, count: 0 }
    }
    renderSessionList(sessions)
    log('  用 coder -r 可选择会话恢复继续', { color: COLORS.GRAY })
    log()
    return { ok: true, count: sessions.length }
  },
}
