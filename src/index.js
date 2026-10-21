#!/usr/bin/env node
import readline from 'node:readline'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  chatStream, rollbackLastUserMessage, loadConfig, getConfig, SETTING_FIELDS,
  getSessionSummary, restoreSessionMessages,
} from './utils/llm.js'
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir, shortenPath } from './utils/fileUtils.js'
import { expandFileRefs } from './utils/contextUtils.js'
import { listSessions, createSessionMeta, bumpSessionTurns } from './utils/historyUtils.js'
import { createInteractInput } from './utils/interactUtils.js'
import { promptUser } from './mcp/local/askUser/index.js'
import { printBanner } from './utils/bannerUtils.js'
import {
  initRuntime, setInteractInput, setReadline,
  requestExit, markExit, isExitRequested, getSessionStart, setSessionStart,
  setProcessing, isInterruptRequested, clearInterrupt,
} from './utils/runtime.js'
import { beginTurn } from './utils/editJournal.js'
import { COMMANDS, findCommand } from './commands/index.js'
import { renderSessionList } from './commands/history.js'
import { runMemoryGeneration } from './commands/memory.js'
import { log, style, COLORS, streamToTerminal } from './utils/logUtils.js'

// 是否为交互终端：TTY 下用自绘输入框（支持 / 与 @ 补全列表），否则回退 readline（管道/测试）
const IS_TTY = Boolean(process.stdin.isTTY)
let interactInput = null
let rl = null

/**
 * 重新显示输入提示符：AI 输出等完成后调用
 */
function redisplayPrompt() {
  if (IS_TTY) {
    interactInput?.render()
  } else {
    rl?.prompt()
  }
}

/**
 * 调用大模型，流式输出 Markdown 渲染后的回复内容
 */
async function chatWithAI(input) {
  clearInterrupt() // 每轮开始先清除残留的中断请求
  beginTurn() // 文件修改日志的轮边界（/undo 回滚粒度）
  const threadId = String(getSessionStart()) // 会话 thread（与历史文件名一致）

  const result = await streamToTerminal((hooks) => chatStream(input, hooks, threadId), {
    title: 'AI',
    spinnerText: '思考中…',
    titleColor: COLORS.GREEN,
  })

  // AI 回复被用户 Ctrl+C 中断：提示后可继续提问
  if (isInterruptRequested()) {
    clearInterrupt()
    log('  ⚠ 已中断', { color: COLORS.GRAY })
  }

  if (!result.ok) {
    rollbackLastUserMessage(threadId)
    log([
      { text: '  ✖ 出错了：', color: COLORS.RED },
      { text: result.error },
    ])
    log(
      `  当前模型：${getConfig()[SETTING_FIELDS.model]}，请检查配置文件中的 ${SETTING_FIELDS.apiKey} / ${SETTING_FIELDS.baseURL}`,
      { color: COLORS.GRAY }
    )
    log()
  } else {
    // 登记会话元数据（首问 + 轮数），供 /history 与 coder -r 列表
    createSessionMeta(threadId, {
      model: getConfig()[SETTING_FIELDS.model],
      firstQuestion: input.replace(/\s+/g, ' ').slice(0, 200),
    })
    const turns = bumpSessionTurns(threadId)

    // 自动定期记忆：轮数达到阈值整数倍时提炼（MEMORY_AUTO_INTERVAL，默认 20，0 关闭）
    const interval = Number(getConfig()[SETTING_FIELDS.memoryAutoInterval] ?? 20)
    if (Number.isInteger(interval) && interval > 0 && turns > 0 && turns % interval === 0) {
      await runMemoryGeneration({ compact: true })
    }
  }
}

/**
 * 处理一条用户输入
 */
async function handleLine(line) {
  const input = line.trim()

  // 空输入直接跳过
  if (!input) return

  // 从输入中提取所有指令（任意位置、按空格分词，支持中文等指令名，@路径等不受影响）
  const words = input.split(/\s+/)
  const cmdWords = words.filter((w) => /^\/[^\s/]+$/.test(w))

  // 剔除输入中所有指令词后的剩余文本（作为指令参数与发往大模型的内容）
  const text = words.filter((w) => !w.startsWith('/')).join(' ').trim()

  // 依次执行已知指令：核心逻辑在各指令文件内自主处理，剩余文本作为参数传入；
  // 中断类型（如 /exit、/vector）执行后立即结束，不再调用大模型；
  // 自定义指令返回 context（md 内容），随提问一起带给大模型
  let commandContext = ''
  for (const word of cmdWords) {
    const cmd = findCommand(word)
    if (!cmd) continue
    const result = await cmd.execute(text)
    if (cmd.interrupt) return
    if (result?.context) {
      commandContext += `${result.context}\n`
    } else if (result && !result.ok && result.error) {
      log([
        { text: `  ✖ 指令 ${word} 出错：`, color: COLORS.RED },
        { text: result.error },
      ])
    }
  }

  // 剔除输入中所有指令词，剩余内容发给大模型
  if (!text && !commandContext) {
    // 仅提示未识别的指令词（已执行成功的指令不提示）
    const unknown = cmdWords.filter((w) => !findCommand(w))
    if (unknown.length) {
      log([
        { text: `  ✖ 未知指令 ${unknown.join(' ')}`, color: COLORS.RED },
        { text: '  输入 /help 查看可用命令', color: COLORS.GRAY },
      ])
    }
    return
  }

  // 组装发送内容：指令上下文（自定义指令 md）+ 用户提问，展开 @路径 引用
  const prompt = commandContext ? `${commandContext}\n${text}` : text
  await chatWithAI(expandFileRefs(prompt, getCurrentTerminalDir()))
}

// 输入队列：等待 AI 回复期间，用户新输入会被排队，保证对话按顺序处理
const inputQueue = []
initRuntime({ inputQueue })

let processing = false

/**
 * 依次处理队列中的输入，全部处理完后重新显示提示符
 */
async function drainQueue() {
  if (processing) return
  processing = true
  setProcessing(true)
  try {
    while (inputQueue.length > 0) {
      await handleLine(inputQueue.shift())
    }
  } finally {
    processing = false
    setProcessing(false)
  }
  if (isExitRequested()) {
    exitProgram()
    return
  }
  redisplayPrompt()
}

/**
 * 退出程序：会话状态已由 checkpoint（sqlite）实时托管，无需额外保存
 */
let exited = false
async function exitProgram() {
  if (exited) return
  exited = true
  interactInput?.close() // 恢复终端 raw mode 等状态
  log('\n  再见！👋', { color: COLORS.GRAY })
  process.exit(0)
}

// 终端窗口被直接关闭（SIGHUP）或输入流结束（EOF）时保存历史并退出
process.on('SIGHUP', exitProgram)
process.stdin.on('end', () => {
  // 还有输入没处理完时，处理完再退出（不清空队列）
  if (processing || inputQueue.length > 0) {
    markExit()
  } else {
    exitProgram()
  }
})

/**
 * 首次使用引导：交互式收集端点/密钥/模型，生成 ~/.coder/setting.json
 * 非交互终端回退为打印配置示例后退出
 * @returns {Promise<boolean>} 是否成功生成配置
 */
async function firstRunSetup() {
  log('  👋 欢迎使用 coder！首次使用需要完成初始配置。', { color: COLORS.CYAN, bold: true })
  log(`  配置将写入 ${shortenPath(path.join(getCoderConfigDir(getUserSettingsDir()), 'setting.json'))}`, { color: COLORS.GRAY })

  // 非交互终端无法引导，打印示例后退出
  if (!IS_TTY) {
    log()
    log('  请手动创建配置文件（任选其一）：', { color: COLORS.YELLOW })
    log(`    1. ${getCoderConfigDir(getCurrentTerminalDir())}/setting.json`, { color: COLORS.GRAY })
    log(`    2. ${getCoderConfigDir(getUserSettingsDir())}/setting.json`, { color: COLORS.GRAY })
    log('  内容示例：', { color: COLORS.GRAY })
    log(`  {`, { color: COLORS.GRAY })
    log(`    "${SETTING_FIELDS.apiKey}": "sk-xxx",`, { color: COLORS.GRAY })
    log(`    "${SETTING_FIELDS.baseURL}": "https://dashscope.aliyuncs.com/compatible-mode/v1",`, { color: COLORS.GRAY })
    log(`    "${SETTING_FIELDS.model}": "qwen-flash"`, { color: COLORS.GRAY })
    log(`  }`, { color: COLORS.GRAY })
    return false
  }

  // 交互引导：端点 → 密钥 → 模型（均有默认值，回车采用）
  const endpoint = (await promptUser('  1/3 API 端点（回车使用 DashScope）: ')).trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  let apiKey = ''
  while (!apiKey) {
    apiKey = (await promptUser('  2/3 API 密钥（必填）: ')).trim()
    if (!apiKey) log('  密钥不能为空，请重新输入', { color: COLORS.YELLOW })
  }
  const model = (await promptUser('  3/3 模型名称（回车使用 qwen-flash）: ')).trim() || 'qwen-flash'

  // 写入用户设置目录（全局生效；项目级可后续自行添加）
  const settingFile = path.join(getCoderConfigDir(getUserSettingsDir()), 'setting.json')
  try {
    mkdirSync(getCoderConfigDir(getUserSettingsDir()), { recursive: true })
    writeFileSync(
      settingFile,
      JSON.stringify(
        {
          [SETTING_FIELDS.apiKey]: apiKey,
          [SETTING_FIELDS.baseURL]: endpoint,
          [SETTING_FIELDS.model]: model,
        },
        null,
        2
      ),
      'utf8'
    )
  } catch (err) {
    log(`  ✖ 配置写入失败：${err.message}`, { color: COLORS.RED })
    return false
  }

  log(`  ✅ 配置已保存：${shortenPath(settingFile)}`, { color: COLORS.GREEN })
  log('  可随时编辑该文件调整模型、增加 models 热切换列表等', { color: COLORS.GRAY })
  log()
  return true
}

// 启动：先加载配置，横幅中展示配置信息
let config = loadConfig()

if (!config) {
  printBanner(null)
  // 无配置：引导生成；失败（写入失败/非交互取消）则退出
  const ok = await firstRunSetup()
  if (!ok) {
    process.exit(1)
  }
  config = loadConfig()
}
printBanner(config)

/**
 * 恢复会话：优先用 checkpoint 状态（thread = startedAt），旧会话走 JSON 注入；
 * 沿用原时间戳（继续对话覆盖保存原会话文件）
 */
async function restoreSession(session) {
  const restoredCount = await restoreSessionMessages(String(session.startedAt), session.messages)
  setSessionStart(session.startedAt)
  const time = new Date(session.createdAt || session.startedAt).toLocaleString('zh-CN', { hour12: false })
  log(`  ⏳ 已恢复会话：${time}（${restoredCount} 条消息）`, { color: COLORS.CYAN })
  log()
}

/**
 * -c：继续最近一次会话
 */
async function continueLastSession() {
  const sessions = listSessions({ limit: 1 })
  if (!sessions.length) {
    log('  没有历史会话，将开始新会话', { color: COLORS.YELLOW })
    log()
    return
  }
  await restoreSession(sessions[0])
}

/**
 * -r：列出最近 20 次会话供选择（交互终端）
 */
async function resumeSessionPicker() {
  const sessions = listSessions({ limit: 20 })
  if (!sessions.length) {
    log('  没有历史会话，将开始新会话', { color: COLORS.YELLOW })
    log()
    return
  }

  renderSessionList(sessions)

  if (!IS_TTY) {
    log('  非交互终端不支持选择，已开始新会话', { color: COLORS.YELLOW })
    log()
    return
  }

  const answer = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(style('  选择要恢复的会话编号（1-' + sessions.length + '，回车取消）: ', { color: COLORS.CYAN_BRIGHT }), (a) => {
      rl.close()
      resolve(a.trim())
    })
  })
  const index = parseInt(answer, 10)
  if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
    await restoreSession(sessions[index - 1])
  } else {
    log('  已取消，开始新会话', { color: COLORS.GRAY })
    log()
  }
}

// 启动参数：-c 继续最近会话；-r 从最近 20 次会话中选择恢复
const startArgs = process.argv.slice(2)
if (startArgs.includes('-c')) {
  await continueLastSession()
} else if (startArgs.includes('-r')) {
  await resumeSessionPicker()
}

// 创建输入通道：TTY 用自绘输入框（/ 指令补全、@ 文件选择），管道回退 readline
if (IS_TTY) {
  interactInput = createInteractInput({
    prompt: style('❯ ', { color: COLORS.CYAN_BRIGHT }),
    commands: COMMANDS,
    onSubmit: (line) => {
      inputQueue.push(line)
      drainQueue()
    },
    onExit: exitProgram,
  })
  setInteractInput(interactInput)
} else {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: style('❯ ', { color: COLORS.CYAN_BRIGHT }),
    terminal: false,
  })
  rl.on('line', (line) => {
    inputQueue.push(line)
    drainQueue()
  })
  rl.on('SIGINT', exitProgram)
  rl.on('close', () => {
    // 还有输入没处理完时（如管道输入），处理完再退出（不清空队列）
    if (processing || inputQueue.length > 0) {
      markExit()
    } else {
      exitProgram()
    }
  })
  setReadline(rl)
  rl.prompt()
}
