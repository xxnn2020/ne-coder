import { requestExit } from '../utils/runtime.js'

/**
 * /quit 指令：退出程序（/exit 的别名）
 */
export default {
  name: '/quit',
  desc: '退出程序',
  // 中断类型：执行后程序退出
  interrupt: true,
  /**
   * @returns {{ok: boolean, exit: boolean}} 执行结果数据
   */
  execute() {
    requestExit()
    return { ok: true, exit: true }
  },
}
