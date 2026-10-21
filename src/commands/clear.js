import { loadConfig } from '../utils/llm.js'
import { printBanner } from '../utils/bannerUtils.js'
import { resetInput } from '../utils/runtime.js'

/**
 * /clear 指令：清屏并重新显示横幅
 */
export default {
  name: '/clear',
  desc: '清屏',
  // 中断类型：清屏后本行剩余内容不再发给大模型
  interrupt: true,
  /**
   * @returns {{ok: boolean, cleared: boolean}} 执行结果数据
   */
  execute() {
    console.clear()
    resetInput()
    printBanner(loadConfig())
    return { ok: true, cleared: true }
  },
}
