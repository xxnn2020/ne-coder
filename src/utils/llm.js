import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { ChatOpenAI } from '@langchain/openai'
import { createAgent, summarizationMiddleware } from 'langchain'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, RemoveMessage } from '@langchain/core/messages'
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir, shortenPath } from './fileUtils.js'
import { loadSkillContext } from './skillUtils.js'
import { isInterruptRequested } from './runtime.js'
import { searchVectorStores, invalidateStoreCache } from './vectorUtils.js'
import { setSessionSummary } from './historyUtils.js'
import { renderMemoryBlock } from './memoryUtils.js'
import { log, COLORS } from './logUtils.js'
import { getMcpTools } from '../mcp/index.js'

// setting.json 中的字段名
export const SETTING_FIELDS = {
  apiKey: 'OPENAI_API_KEY',
  baseURL: 'OPENAI_BASE_URL',
  model: 'OPENAI_MODEL',
  embeddingModel: 'OPENAI_EMBEDDING_MODEL',
  permissionMode: 'PERMISSION_MODE',
  models: 'models',
  ragQueryRewrite: 'RAG_QUERY_REWRITE',
  ragMaxScore: 'RAG_MAX_SCORE',
  memoryAutoInterval: 'MEMORY_AUTO_INTERVAL',
}

const SETTING_FILE_NAME = 'setting.json'

let cachedConfig = null

/**
 * 读取指定目录下 .coder/setting.json
 * 文件不存在返回 null，存在但内容非法则抛出异常
 */
function readSettingsFrom(dir) {
  const file = path.join(getCoderConfigDir(dir), SETTING_FILE_NAME)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw new Error(`读取配置文件失败 ${file}：${err.message}`)
  }
  try {
    return { file, ...JSON.parse(raw) }
  } catch {
    throw new Error(`配置文件格式不是合法 JSON：${file}`)
  }
}

/**
 * 加载配置，优先级：
 *   1. 当前终端目录下的 .coder/setting.json
 *   2. 当前用户设置目录下的 .coder/setting.json
 * 两处都不存在时返回 null
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig
  const settings =
    readSettingsFrom(getCurrentTerminalDir()) ?? readSettingsFrom(getUserSettingsDir())
  if (settings) cachedConfig = settings
  return settings
}

/**
 * 获取配置，配置缺失时抛出异常（正常情况下启动时已校验过）
 */
export function getConfig() {
  const config = loadConfig()
  if (!config) {
    throw new Error(
      `未找到配置文件 ${path.join(getCoderConfigDir(getCurrentTerminalDir()), SETTING_FILE_NAME)} ` +
        `和 ${path.join(getCoderConfigDir(getUserSettingsDir()), SETTING_FILE_NAME)}`
    )
  }
  return config
}

/**
 * 加载系统提示词模板：读取 src/docs/systemPrompt.md 并替换占位符
 *   ${systemInfo} → 操作系统信息
 *   ${workPath}   → 当前工作目录
 * 模板缺失或读取失败时回退为默认提示词
 */
function loadSystemPrompt() {
  const file = new URL('../docs/systemPrompt.md', import.meta.url)
  let template
  try {
    template = readFileSync(file, 'utf8')
  } catch {
    return '你是运行在终端里的 AI 助手，回答简洁、直接。'
  }
  return template
    .replaceAll('${systemInfo}', `${os.type()} ${os.release()} ${os.arch()}`)
    .replaceAll('${workPath}', process.cwd())
}

const SYSTEM_PROMPT = loadSystemPrompt()

/**
 * 加载用户上下文：读取用户设置目录与项目目录下的 .coder.md，
 * 填充到 src/docs/userContext.md 模板作为附加要求
 *   ${userPath}/${userContent}       → 用户上下文（<用户设置目录>/.coder/.coder.md）
 *   ${projectPath}/${projectContent} → 项目上下文（<当前项目目录>/.coder.md）
 * 文件不存在时对应内容为空；模板缺失或两边都无内容时返回 ''
 */
function loadUserContext() {
  const userContextFile = path.join(getCoderConfigDir(getUserSettingsDir()), '.coder.md')
  const projectContextFile = path.join(getCurrentTerminalDir(), '.coder.md')
  const readIfExists = (file) => {
    try {
      return readFileSync(file, 'utf8').trim()
    } catch {
      return ''
    }
  }

  const userContent = readIfExists(userContextFile)
  const projectContent = readIfExists(projectContextFile)
  // 记忆（sqlite）独立于 .coder.md：任一来源有内容即注入
  const userMemory = renderMemoryBlock('user')
  const projectMemory = renderMemoryBlock('project')
  if (!userContent && !projectContent && !userMemory && !projectMemory) return ''

  let template
  try {
    template = readFileSync(new URL('../docs/userContext.md', import.meta.url), 'utf8')
  } catch {
    return ''
  }

  return template
    .replaceAll('${userPath}', userContextFile)
    .replaceAll('${userContent}', userContent)
    .replaceAll('${projectPath}', projectContextFile)
    .replaceAll('${projectContent}', projectContent)
    .replaceAll('${userMemory}', userMemory || '（暂无记忆，可用 /memory 生成）')
    .replaceAll('${projectMemory}', projectMemory || '（暂无记忆，可用 /memory 生成）')
}

const USER_CONTEXT = loadUserContext()
const SKILL_CONTEXT = loadSkillContext()

/**
 * thread 头部消息：用户提示词（.coder.md）与 skill 列表，
 * 每个 thread 初始化时注入一次（会话期间配置变更不重复注入，新会话生效）
 */
function buildHeadMessages() {
  const heads = []
  if (USER_CONTEXT) heads.push(new HumanMessage(USER_CONTEXT))
  if (SKILL_CONTEXT) heads.push(new HumanMessage(SKILL_CONTEXT))
  return heads
}

// SqliteSaver checkpointer 单例：会话状态（消息）持久化到 <项目>/.coder/db/coder.sqlite
let checkpointer = null
async function getCheckpointer() {
  if (!checkpointer) {
    const dbDir = path.join(getCoderConfigDir(getCurrentTerminalDir()), 'db')
    mkdirSync(dbDir, { recursive: true })
    checkpointer = await SqliteSaver.fromConnString(path.join(dbDir, 'coder.sqlite'))
  }
  return checkpointer
}

// 模型与 agent 懒加载单例
let chatModel = null
let agent = null

// /model 热切换后的当前生效模型（null = 使用 setting.json 默认配置）
let activeModel = null

/**
 * 规范化模型列表配置：数组格式为准；兼容旧的对象格式（取 value 拼成列表）
 */
function normalizeModelList(raw) {
  if (Array.isArray(raw)) return raw.filter((e) => e && e.model)
  if (raw && typeof raw === 'object') return Object.values(raw).filter((e) => e && e.model)
  return []
}

/**
 * 列出 setting.json 中配置的可切换对话模型
 * 返回 [{ model, apiKey?, baseURL?, active }]
 */
export function listModels() {
  const config = loadConfig() || {}
  return normalizeModelList(config[SETTING_FIELDS.models]).map((entry) => ({
    ...entry,
    active: activeModel ? activeModel.model === entry.model : config[SETTING_FIELDS.model] === entry.model,
  }))
}

/**
 * 列出可切换的 embedding 模型，返回 [{ model, active }]
 */
export function listEmbeddingModels() {
  const config = loadConfig() || {}
  return normalizeModelList(config.embeddingModels).map((entry) => ({
    ...entry,
    active: config[SETTING_FIELDS.embeddingModel] === entry.model,
  }))
}

/**
 * 更新配置文件（config.file 来源的 setting.json），保留其他字段
 */
function updateSettingFile(patch) {
  const config = loadConfig()
  if (!config?.file) return
  try {
    const raw = JSON.parse(readFileSync(config.file, 'utf8'))
    Object.assign(raw, patch)
    writeFileSync(config.file, JSON.stringify(raw, null, 2), 'utf8')
    cachedConfig = null // 让下次 loadConfig 重新读取
  } catch {
    // 写回失败只影响持久化，内存配置仍生效
  }
}

/**
 * 按模型 ID 或编号（从 1 起）在列表中查找条目
 */
function findBySelector(list, selector) {
  if (!selector) return undefined
  const index = parseInt(selector, 10)
  if (Number.isInteger(index) && index >= 1 && index <= list.length) {
    return list[index - 1]
  }
  return list.find((e) => e.model === selector)
}

/**
 * 热切换对话模型（/model 指令）：
 *   失效 agent/模型单例（下轮对话重建），消息上下文与工具保留；
 *   同时写回 setting.json 持久化
 * @param {string} selector 模型 ID 或列表编号
 * @returns {string} 实际模型 ID
 */
export function switchModel(selector) {
  const config = getConfig()
  const list = listModels()
  const entry = findBySelector(list, selector)
  if (!entry) {
    throw new Error(
      list.length
        ? `未找到模型 "${selector}"，可用：${list.map((e, i) => `${i + 1}.${e.model}`).join('、')}`
        : `配置文件未配置 models 列表，无法切换。示例：{ "models": [{ "model": "qwen3.6-flash" }] }`
    )
  }

  // 失效单例，下轮对话以新模型重建 agent
  chatModel = null
  agent = null
  activeModel = { ...entry }

  // 持久化：模型 ID + 条目自带的密钥/端点写回顶层字段
  const patch = { [SETTING_FIELDS.model]: entry.model }
  if (entry.apiKey) patch[SETTING_FIELDS.apiKey] = entry.apiKey
  if (entry.baseURL) patch[SETTING_FIELDS.baseURL] = entry.baseURL
  updateSettingFile(patch)
  return entry.model
}

/**
 * 切换 embedding 模型（/model -e）：
 *   写回配置并清空向量库实例缓存（旧实例绑定旧模型，向量空间不一致）；
 *   既有向量库需重新执行 /vector 重建
 * @param {string} selector 模型 ID 或列表编号
 * @returns {string} 实际模型 ID
 */
export function switchEmbeddingModel(selector) {
  const list = listEmbeddingModels()
  const entry = findBySelector(list, selector)
  if (!entry) {
    throw new Error(
      list.length
        ? `未找到 embedding 模型 "${selector}"，可用：${list.map((e, i) => `${i + 1}.${e.model}`).join('、')}`
        : `配置文件未配置 embeddingModels 列表。示例：{ "embeddingModels": [{ "model": "text-embedding-v4" }] }`
    )
  }
  updateSettingFile({ [SETTING_FIELDS.embeddingModel]: entry.model })
  invalidateStoreCache()
  return entry.model
}

/**
 * 获取 ChatOpenAI 模型实例（对接 OpenAI 兼容端点）；
 * /model 切换后优先使用 activeModel（/memory 等指令也复用此模型）
 */
export function getChatModel() {
  if (!chatModel) {
    const config = getConfig()
    const apiKey = activeModel?.apiKey || config[SETTING_FIELDS.apiKey]
    const baseURL = activeModel?.baseURL || config[SETTING_FIELDS.baseURL]
    const model = activeModel?.model || config[SETTING_FIELDS.model]
    if (!apiKey) {
      throw new Error(`配置文件缺少 ${SETTING_FIELDS.apiKey} 字段`)
    }
    chatModel = new ChatOpenAI({
      model,
      apiKey,
      configuration: baseURL ? { baseURL } : undefined,
    })
  }
  return chatModel
}

/**
 * 获取 agent 实例：createAgent + ChatOpenAI + MCP 工具（远程 + 本地）
 * 挂 SqliteSaver checkpointer（会话状态持久化到 .coder/db/coder.sqlite）
 * 与 summarizationMiddleware（长会话自动压缩：超阈值旧消息摘要替代，保留最近 N 条原文）
 */
async function getAgent() {
  if (!agent) {
    agent = createAgent({
      model: getChatModel(),
      tools: await getMcpTools(),
      checkpointer: await getCheckpointer(),
      middleware: [
        summarizationMiddleware({
          model: getChatModel(),
          trigger: { tokens: 24000 },
          keep: { messages: 20 },
        }),
      ],
      systemPrompt: `${SYSTEM_PROMPT}

# 工具使用说明
- 可以调用提供的工具完成计算、查询等任务，按工具描述正确传参。
- 用户消息中以 <file path="..."> 标签提供的内容是已注入的文件全文，回答时直接参考，无需再读取这些文件。
- 用户消息中 <retrieved_docs> 标签内是检索到的相关文档片段，回答相关问题时优先参考这些内容；与问题明显无关时忽略。
- 当回答引用了 <retrieved_docs> 中的信息时，必须在回答末尾列出对应出处，格式为：出处：后跟各条"[序号] 文件路径"，每行一条；回答未引用检索内容时不加出处。
- 不要输出 <tool_call> 等工具调用格式的文本，需要工具时使用真正的工具调用能力。
- 删除、覆盖、移动等不可逆操作前，或缺少关键决策信息时，必须先调用 askUser 工具向用户提问确认，不要自行猜测或代替用户决定；是/否类确认问题调用时传 confirm: true。`,
    })
  }
  return agent
}

/**
 * 读取 thread 的当前消息（由 checkpointer 托管）
 */
async function getThreadMessages(threadId) {
  const state = await (await getAgent()).getState({ configurable: { thread_id: String(threadId) } })
  return state?.values?.messages || []
}

/**
 * thread 初始化：首条消息前注入头部上下文（用户提示词/skill 列表），每个 thread 一次
 */
async function ensureThread(threadId) {
  const existing = await getThreadMessages(threadId)
  if (existing.length === 0) {
    const heads = buildHeadMessages()
    if (heads.length) {
      await (await getAgent()).updateState(
        { configurable: { thread_id: String(threadId) } },
        { messages: heads }
      )
    }
  }
}

/**
 * RAG 查询改写：把口语问题改写为检索关键词串（空格分隔、含同义扩展），
 * 提升问句式提问的召回；3 秒超时或失败降级用原问题，结果缓存
 */
const rewriteCache = new Map()
async function rewriteQuery(question) {
  const config = loadConfig() || {}
  if (config[SETTING_FIELDS.ragQueryRewrite] === false) return question
  if (rewriteCache.has(question)) return rewriteCache.get(question)

  try {
    const result = await Promise.race([
      getChatModel().invoke([
        { role: 'system', content: '你是检索查询改写器。把用户问题改写为一行检索关键词：空格分隔、包含关键实体与同义词、不超过 30 个字、直接输出关键词不要任何解释。' },
        { role: 'user', content: question.slice(0, 300) },
      ], { maxTokens: 60 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('改写超时')), 3000)),
    ])
    const rewritten = String(result?.content || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    if (rewritten) {
      rewriteCache.set(question, rewritten)
      if (rewriteCache.size > 100) rewriteCache.delete(rewriteCache.keys().next().value)
      return rewritten
    }
  } catch {
    // 改写失败（超时/接口错误）降级用原问题
  }
  return question
}

/**
 * RAG 检索（增强版）：查询改写 + 向量/关键词双通道混合检索
 * 检索查询取问题前 500 字（排除 @文件展开等长文本干扰）
 * 向量接口失败时自动降级纯关键词检索（结果带降级标注）；
 * 完全失败（无库等）会话内首次给出提示，之后静默跳过
 */
let ragErrorShown = false
async function buildRagContext(question) {
  try {
    const config = loadConfig() || {}
    const query = await rewriteQuery(question.slice(0, 500))
    const { hits, degraded } = await searchVectorStores(query, {
      maxScore: Number(config[SETTING_FIELDS.ragMaxScore]) || 0.65,
    })
    if (!hits.length) return ''
    const parts = hits
      .map((h, i) => `[${i + 1}] 来源: ${shortenPath(h.source)}\n${h.content}`)
      .join('\n\n')
    const flag = degraded ? '（向量接口不可用，关键词检索降级）' : ''
    // 出处要求紧贴注入内容（比 system prompt 里的说明对模型约束力更强）
    return `以下是与问题相关的知识库检索片段${flag}。回答中引用了这些内容时，必须在回答末尾按"出处：[序号] 文件路径"分行列出对应来源。\n\n${parts}`
  } catch (err) {
    if (!ragErrorShown) {
      ragErrorShown = true
      log(`  ⚠ 向量检索失败，本次起跳过检索：${String(err.message).slice(0, 120)}`, { color: COLORS.GRAY })
    }
    return ''
  }
}

/**
 * 发送用户输入到 agent，通过 streamEvents 流式返回模型文本增量
 * 消息历史由 checkpointer 按 threadId 托管，这里只传本轮增量；
 * 运行产生的工具调用记录与最终回复由 agent 自动写入 thread 状态
 */
export async function* chatStream(userInput, hooks = {}, threadId = 'default') {
  const { [SETTING_FIELDS.apiKey]: apiKey } = getConfig()
  if (!apiKey) {
    throw new Error(`配置文件缺少 ${SETTING_FIELDS.apiKey} 字段`)
  }

  // thread 初始化（首条消息前注入头部上下文）
  await ensureThread(threadId)

  // 向量库检索相关文档块，随提问一起作为参考上下文
  const rag = await buildRagContext(userInput)
  const prompt = rag
    ? `<retrieved_docs>\n${rag}\n</retrieved_docs>\n\n${userInput}`
    : userInput

  const eventStream = await (await getAgent()).streamEvents(
    { messages: [new HumanMessage(prompt)] },
    { version: 'v2', configurable: { thread_id: String(threadId) } }
  )

  let full = ''
  // 并发工具计数：全部结束才通知外层恢复加载动画，
  // 避免并行工具中一个结束就重启 spinner、压到另一个工具的确认提示上
  let pendingToolCalls = 0
  for await (const event of eventStream) {
    // 用户请求中断（AI 回复中 Ctrl+C）：提前结束流，已产生的内容照常写入上下文
    if (isInterruptRequested()) break
    if (event.event === 'on_chat_model_stream') {
      // 模型流式增量：agent 循环中每次模型调用的 token 都会经过这里
      const delta = event.data?.chunk?.content
      if (typeof delta === 'string' && delta) {
        full += delta
        yield delta
      }
    }
    // 工具开始/结束：通知外层暂停/恢复加载动画（askUser 等待用户输入期间终端保持安静）
    if (event.event === 'on_tool_start') {
      hooks.toolStart?.(event.name)
    } else if (event.event === 'on_tool_end') {
      // 不在这里恢复 spinner，避免并行工具调用时提前恢复 spinner 压到确认提示上；
      // 整个对话结束后由 chatWithAI 统一处理（有内容则不显示思考中）。
    }
  }
}

/**
 * 请求失败时回滚本次用户消息，避免失败内容污染后续对话上下文
 * （从 thread 状态中移除最后一条 human 消息）
 */
export async function rollbackLastUserMessage(threadId = 'default') {
  const config = { configurable: { thread_id: String(threadId) } }
  const msgs = await getThreadMessages(threadId)
  const last = msgs[msgs.length - 1]
  if (last instanceof HumanMessage && last.id) {
    await (await getAgent()).updateState(config, { messages: [new RemoveMessage({ id: last.id })] })
  }
}

/**
 * LangChain 消息转通用 { role, content }（OpenAI 风格，含 tool_calls），
 * 供会话历史持久化与摘要转录使用
 */
function lcToPlain(m) {
  if (m instanceof AIMessage) {
    const plain = { role: 'assistant', content: String(m.content ?? '') }
    if (m.tool_calls?.length) {
      plain.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }))
    }
    return plain
  }
  if (m instanceof ToolMessage) {
    return {
      role: 'tool',
      content: String(m.content ?? ''),
      tool_call_id: m.tool_call_id ?? '',
    }
  }
  return { role: 'user', content: String(m.content ?? '') }
}

/**
 * 获取指定会话（thread）的全部消息（含 system），用于会话历史持久化
 */
export async function getSessionMessages(threadId = 'default') {
  const msgs = await getThreadMessages(threadId)
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...msgs.map(lcToPlain)]
}

// 会话摘要（/summary 生成后存放于内存，随历史持久化）
let sessionSummary = ''

/**
 * 获取当前会话摘要
 */
export function getSessionSummary() {
  return sessionSummary
}

/**
 * 恢复历史会话消息到对话上下文（-c / -r 启动参数）
 * plain { role, content } 转换为 LangChain 消息：
 *   system 跳过（由 agent 的 systemPrompt 携带）；
 *   历史 user 消息若为旧上下文头部（用户上下文/skill 列表）则跳过——
 *   模块加载时已按当前配置重新注入，避免重复
 * assistant 的 tool_calls 从 OpenAI 格式转为 LangChain 格式
 * 返回恢复的对话消息条数
 */
export async function restoreSessionMessages(threadId, plainMessages) {
  // 优先使用 checkpoint 已有状态（新版会话）
  const existing = await getThreadMessages(threadId)
  if (existing.length > 0) {
    return existing.length
  }

  // 旧版会话（仅有 JSON 快照，无 checkpoint）：转换后注入 thread
  const LEGACY_HEAD_PREFIXES = ['用户额外有以下要求', '当前有如下Skill']
  const restored = []

  for (const m of plainMessages || []) {
    if (!m || typeof m.content !== 'string') continue
    if (m.role === 'user') {
      if (LEGACY_HEAD_PREFIXES.some((p) => m.content.startsWith(p))) continue
      restored.push(new HumanMessage(m.content))
    } else if (m.role === 'assistant') {
      const toolCalls = (m.tool_calls || [])
        .filter((tc) => tc?.function?.name)
        .map((tc) => {
          let args = {}
          try {
            args = JSON.parse(tc.function.arguments || '{}')
          } catch {
            // 参数解析失败按空对象处理
          }
          return { id: tc.id, name: tc.function.name, args }
        })
      restored.push(
        toolCalls.length
          ? new AIMessage({ content: m.content || '', tool_calls: toolCalls })
          : new AIMessage(m.content || '')
      )
    } else if (m.role === 'tool') {
      restored.push(new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id || '' }))
    }
  }

  if (restored.length > 0) {
    // 头部上下文 + 旧对话一并注入
    const heads = buildHeadMessages()
    await (await getAgent()).updateState(
      { configurable: { thread_id: String(threadId) } },
      { messages: [...heads, ...restored] }
    )
  }
  return restored.length
}

/**
 * 调用大模型总结当前会话，流式返回摘要增量
 * 摘要请求独立于对话上下文（不写入 thread 状态），完成后保存在内存中
 */
export async function* summarizeStream(threadId = 'default') {
  const LEGACY_HEAD_PREFIXES = ['用户额外有以下要求', '当前有如下Skill']
  // 用户提示词与 skill 列表等上下文消息不属于对话内容，摘要时排除
  const dialog = (await getThreadMessages(threadId)).filter(
    (m) => m instanceof AIMessage || m instanceof ToolMessage || !LEGACY_HEAD_PREFIXES.some((p) => String(m.content || '').startsWith(p))
  )
  if (dialog.length === 0) {
    throw new Error('本次会话还没有对话内容')
  }

  const transcript = dialog
    .map((m) => {
      if (m instanceof AIMessage) {
        return m.tool_calls?.length
          ? `AI 调用工具：${m.tool_calls.map((t) => t.name).join(', ')}`
          : `AI：${m.content}`
      }
      if (m instanceof ToolMessage) {
        return `工具结果：${String(m.content).slice(0, 200)}`
      }
      return `用户：${m.content}`
    })
    .join('\n\n')

  const stream = await getChatModel().stream([
    new SystemMessage('你是会话摘要助手，用简洁的中文总结对话要点，输出 3 到 5 条要点列表。'),
    new HumanMessage(`请总结以下对话：\n\n${transcript}`),
  ])

  let full = ''
  for await (const chunk of stream) {
    const delta = chunk?.content
    if (typeof delta === 'string' && delta) {
      full += delta
      yield delta
    }
  }
  sessionSummary = full
  // 摘要即时写入会话元数据（与 checkpoint 同库的 session_meta 表）
  setSessionSummary(threadId, full)
}
