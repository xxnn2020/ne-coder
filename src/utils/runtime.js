/**
 * 应用运行时共享状态与动作：入口启动时注入，各指令模块直接调用
 * 指令 execute 不接收实现方法参数，全部自主处理
 */
const state = {
  interactInput: null, // TTY 自绘输入框
  rl: null, // 非 TTY readline 回退
  inputQueue: [], // 待处理输入队列（主循环消费）
  exitAfterDrain: false, // 退出请求：主循环在当前输入处理完后真正退出
  sessionStart: Date.now(), // 会话启动时间戳（历史文件名）
  processing: false, // 主循环是否正在处理输入（AI 回复中）
  interruptRequested: false, // 中断请求：AI 回复中 Ctrl+C 触发，由流式循环消费
}

/**
 * 绑定主循环的输入队列（入口启动时调用）
 */
export function initRuntime({ inputQueue }) {
  if (Array.isArray(inputQueue)) state.inputQueue = inputQueue
}

/**
 * 绑定 TTY 输入组件
 */
export function setInteractInput(input) {
  state.interactInput = input
}

/**
 * 绑定非 TTY readline 实例
 */
export function setReadline(rl) {
  state.rl = rl
}

/**
 * 重置输入组件绘制状态（清屏后调用）
 */
export function resetInput() {
  state.interactInput?.reset()
}

/**
 * 暂停输入组件的按键处理（askUser 等临时接管输入时调用）
 */
export function pauseInput() {
  state.interactInput?.pause()
}

/**
 * 恢复输入组件的按键处理
 */
export function resumeInput() {
  state.interactInput?.resume()
}

/**
 * 请求退出：清空待处理输入并关闭输入通道（/exit 指令等主动退出场景）
 * 实际退出由主循环在当前输入处理完成后执行（保存历史等收尾）
 */
export function requestExit() {
  state.inputQueue.length = 0
  state.exitAfterDrain = true
  if (state.interactInput) state.interactInput.close()
  else if (state.rl) state.rl.close()
}

/**
 * 标记退出请求：仅标记，不清空队列
 * 输入流结束（EOF/SIGHUP）时使用——已排队的输入处理完再退出
 */
export function markExit() {
  state.exitAfterDrain = true
}

/**
 * 是否已请求退出（主循环判断）
 */
export function isExitRequested() {
  return state.exitAfterDrain
}

/**
 * 会话启动时间戳（历史文件名）
 */
export function getSessionStart() {
  return state.sessionStart
}

/**
 * 覆盖会话启动时间戳：恢复历史会话时沿用原时间戳，
 * 使继续对话保存时覆盖原会话文件（会话延续）
 */
export function setSessionStart(ts) {
  if (Number.isFinite(ts)) state.sessionStart = ts
}

/**
 * 设置主循环处理状态（drainQueue 调用，供 Ctrl+C 判断当前是否在 AI 回复中）
 */
export function setProcessing(processing) {
  state.processing = processing
}

/**
 * 是否正在处理输入（AI 回复中）
 */
export function isProcessing() {
  return state.processing
}

/**
 * 请求中断当前 AI 回复：流式事件循环检测到后提前结束
 */
export function requestInterrupt() {
  state.interruptRequested = true
}

/**
 * 是否已请求中断
 */
export function isInterruptRequested() {
  return state.interruptRequested
}

/**
 * 清除中断请求
 */
export function clearInterrupt() {
  state.interruptRequested = false
}
