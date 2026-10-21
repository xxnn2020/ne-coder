import { readFileSync } from "node:fs"
import { getSessionMessages, getChatModel } from "../utils/llm.js"
import { getSessionStart } from "../utils/runtime.js"
import { getMemory, upsertMemory, MEMORY_CATEGORIES } from "../utils/memoryUtils.js"
import { log, startSpinner, COLORS } from "../utils/logUtils.js"

// 分类中文名（终端展示）
const LABELS = {
  project_traits: "项目特点",
  project_history: "开发历史记录",
  project_pitfalls: "项目常见出错",
  user_preferences: "用户开发偏好",
  user_skills: "用户技术情况",
  user_projects: "用户项目情况",
}

/**
 * 渲染记忆生成提示词（src/docs/memoryContext.md 模板）
 */
function buildPrompt(existingMemory, conversation) {
  let template
  try {
    template = readFileSync(new URL("../docs/memoryContext.md", import.meta.url), "utf8")
  } catch {
    throw new Error("记忆提示词模板缺失：src/docs/memoryContext.md")
  }
  return template
    .replaceAll("${existingMemory}", JSON.stringify(existingMemory))
    .replaceAll("${conversation}", conversation)
}

/**
 * 从模型输出解析六类记忆 JSON（容忍 markdown 代码块包裹）
 */
function parseMemoryResult(text) {
  let raw = String(text || "").trim()
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("模型输出中未找到 JSON")
  const parsed = JSON.parse(raw.slice(start, end + 1))
  if (!parsed.project || !parsed.user) throw new Error("JSON 缺少 project/user 结构")
  return parsed
}

/**
 * 记忆提炼核心流程（/memory 指令与自动定期记忆共用）
 * @param {object} [options] compact 静默模式（自动触发时：精简输出、失败只提示一行）
 * @returns {Promise<{ok: boolean, updated?: number}>}
 */
export async function runMemoryGeneration({ compact = false } = {}) {
  // 当前会话报文（checkpoint）
  let messages
  try {
    messages = await getSessionMessages(String(getSessionStart()))
  } catch (err) {
    if (!compact) log(`  ✖ 读取会话失败：${err.message}`, { color: COLORS.RED })
    return { ok: false }
  }
  const dialog = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool")
  if (dialog.length === 0) {
    if (!compact) {
      log("  当前会话还没有对话内容，无法提炼记忆", { color: COLORS.YELLOW })
      log()
    }
    return { ok: false }
  }
  const conversation = dialog
    .map((m) => {
      if (m.role === "assistant" && m.tool_calls?.length) {
        return `AI 调用工具：${m.tool_calls.map((t) => t.function?.name).join(",")}`
      }
      return `${m.role === "user" ? "用户" : m.role === "tool" ? "工具结果" : "AI"}：${String(m.content).slice(0, 800)}`
    })
    .join("\n\n")

  // 旧记忆（延续合并，不覆盖丢失）
  const existingMemory = { ...getMemory("user"), ...getMemory("project") }
  const hadMemory = Object.keys(existingMemory).length > 0

  const spinner = compact ? null : startSpinner(hadMemory ? "合并更新记忆中…" : "提炼记忆中…", { indent: 2 })
  try {
    const result = await getChatModel().invoke(buildPrompt(existingMemory, conversation), { maxTokens: 1500 })
    if (spinner) spinner.stop()
    const parsed = parseMemoryResult(result?.content)

    // 分库写入
    let updated = 0
    for (const [scope, categories] of Object.entries(MEMORY_CATEGORIES)) {
      for (const cat of categories) {
        const content = String(parsed[scope]?.[cat] ?? "").trim()
        if (!content) continue
        upsertMemory(scope, cat, content)
        updated++
        if (!compact) {
          log(`  ${scope === "project" ? "📁" : "👤"} ${LABELS[cat]}`, { bold: true })
          for (const line of content.split("\n")) {
            if (line.trim()) log(`    ${line.trim()}`, { color: COLORS.GRAY })
          }
        }
      }
    }

    if (compact) {
      // 自动触发：精简提示
      if (updated > 0) {
        log(`  🔄 已自动更新记忆（${updated} 类，新会话起生效）`, { color: COLORS.GRAY })
      } else {
        log(`  🔄 自动记忆完成（无新增内容）`, { color: COLORS.GRAY })
      }
    } else if (updated === 0) {
      log("  本次未提炼出新记忆（内容无变化或无有效信息）", { color: COLORS.YELLOW })
    } else {
      log(`  ✅ 已更新 ${updated} 类记忆，新会话起生效`, { color: COLORS.GREEN })
    }
    if (!compact) log()
    return { ok: true, updated }
  } catch (err) {
    if (spinner) spinner.stop()
    if (compact) {
      log(`  🔄 自动记忆失败（已有记忆不变）：${String(err.message).slice(0, 60)}`, { color: COLORS.GRAY })
    } else {
      log(`  ✖ 记忆生成失败（已有记忆保留不变）：${err.message}`, { color: COLORS.RED })
      log()
    }
    return { ok: false, error: err.message }
  }
}

/**
 * /memory 指令：提炼当前会话为长期记忆（延续合并已有记忆），
 * 项目级与用户级分库存储，新会话起随用户上下文注入
 */
export default {
  name: "/memory",
  desc: "提炼会话生成长期记忆",
  // 中断类型：执行完不发送剩余内容给大模型
  interrupt: true,
  /**
   * @returns {Promise<{ok: boolean}>}
   */
  async execute() {
    log("  ● 记忆", { color: COLORS.MAGENTA, bold: true })
    return runMemoryGeneration({ compact: false })
  },
}
