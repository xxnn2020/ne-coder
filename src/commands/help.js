import { log, COLORS } from '../utils/logUtils.js'
import { COMMANDS } from './index.js'

/**
 * /help 指令：显示所有可用命令
 */
export default {
  name: '/help',
  desc: '显示帮助信息',
  // 非中断类型：执行完继续后续流程
  interrupt: false,
  /**
   * @returns {{ok: boolean, count: number}} 执行结果数据
   */
  execute() {
    log('\n可用命令：', { bold: true })
    for (const cmd of COMMANDS) {
      log([
        { text: `  ${cmd.name}`, color: COLORS.CYAN },
        { text: `  ${cmd.desc}` },
      ])
    }
    log()
    return { ok: true, count: COMMANDS.length }
  },
}
