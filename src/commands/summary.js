import { summarizeStream, getSessionSummary } from '../utils/llm.js'
import { getSessionStart } from '../utils/runtime.js'
import { streamToTerminal, log, COLORS } from '../utils/logUtils.js'

/**
 * /summary 指令：调用大模型总结当前会话，流式输出摘要
 * 摘要存放于内存（llm 模块），随历史持久化到 summary 字段
 */
export default {
  name: '/summary',
  desc: '总结当前会话',
  // 非中断类型：执行完继续后续流程
  interrupt: false,
  /**
   * @returns {Promise<{ok: boolean, summary?: string, error?: string}>} 执行结果数据
   */
  async execute() {
    const result = await streamToTerminal(() => summarizeStream(String(getSessionStart())), {
      title: '摘要',
      spinnerText: '总结中…',
      titleColor: COLORS.YELLOW,
      emptyText: '（没有生成摘要）',
    })

    if (!result.ok) {
      log([
        { text: '  ✖ 出错了：', color: COLORS.RED },
        { text: result.error },
      ])
      log()
      return { ok: false, error: result.error }
    }

    return { ok: true, summary: getSessionSummary() }
  },
}
