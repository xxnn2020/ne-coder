import path from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import XLSX from "xlsx"
import { getSessionMessages, getConfig, SETTING_FIELDS } from "../utils/llm.js"
import { getSessionStart } from "../utils/runtime.js"
import { getCoderConfigDir, getCurrentTerminalDir, shortenPath } from "../utils/fileUtils.js"
import { log, COLORS } from "../utils/logUtils.js"

// 支持的导出格式
const SUPPORTED_FORMATS = ["json", "excel", "xml"]

// excel 单元格内容上限（字符），超出截断
const CELL_LIMIT = 30000

/**
 * 导出目录：<项目>/.coder/export/
 */
function getExportDir() {
  const dir = path.join(getCoderConfigDir(getCurrentTerminalDir()), "export")
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 导出为 JSON：checkpoint 中的会话消息转 LangChain 报文（role/content/tool_calls），
 * 文件名 coder_export_<时间戳>.json
 */
function exportJson(messages, meta, file) {
  const payload = { ...meta, messages }
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8")
}

/**
 * 导出为 Excel：每条报文一行（序号/角色/内容/工具调用/工具调用ID）
 */
function exportExcel(messages, meta, file) {
  const rows = [
    ["序号", "角色", "内容", "工具调用", "工具调用ID"],
    ...messages.map((m, i) => [
      i + 1,
      m.role,
      String(m.content ?? "").slice(0, CELL_LIMIT),
      m.tool_calls ? JSON.stringify(m.tool_calls).slice(0, CELL_LIMIT) : "",
      m.tool_call_id ?? "",
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "会话报文")
  // 元信息放第二个工作表
  const metaWs = XLSX.utils.aoa_to_sheet([
    ["字段", "值"],
    ["导出时间", meta.exportedAt],
    ["会话 threadId", meta.threadId],
    ["模型", meta.model],
    ["报文条数", messages.length],
  ])
  XLSX.utils.book_append_sheet(wb, metaWs, "元信息")
  XLSX.writeFile(wb, file)
}

/**
 * 导出为 XML：message 节点含 role/content/toolCalls，内容用 CDATA 保留换行与特殊字符
 */
function exportXml(messages, meta, file) {
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  const msgXml = messages
    .map((m, i) => {
      const toolCalls = (m.tool_calls || [])
        .map(
          (tc) =>
            `      <toolCall id="${esc(tc.id)}" name="${esc(tc.function?.name)}"><![CDATA[${tc.function?.arguments ?? ""}]]></toolCall>`
        )
        .join("\n")
      return [
        `    <message index="${i + 1}" role="${esc(m.role)}"${m.tool_call_id ? ` toolCallId="${esc(m.tool_call_id)}"` : ""}>`,
        `      <content><![CDATA[${m.content ?? ""}]]></content>`,
        toolCalls,
        `    </message>`,
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<session exportedAt="${esc(meta.exportedAt)}" threadId="${esc(meta.threadId)}" model="${esc(meta.model)}">
  <messages>
${msgXml}
  </messages>
</session>
`
  writeFileSync(file, xml, "utf8")
}

/**
 * /export 指令：导出当前打开的会话（checkpoint 消息转 LangChain 报文）
 *   /export          导出 JSON（默认）
 *   /export json     JSON 格式
 *   /export excel    Excel 格式
 * 文件输出到 <项目>/.coder/export/
 */
export default {
  name: "/export",
  desc: "导出当前会话（json/excel/xml）",
  // 中断类型：导出后不发送剩余内容给大模型
  interrupt: true,
  /**
   * @param {string} restText 格式参数
   * @returns {Promise<{ok: boolean, file?: string, count?: number}>}
   */
  async execute(restText = "") {
    const format = (restText.trim().split(/\s+/)[0] || "json").toLowerCase()

    log("  ● 导出", { color: COLORS.MAGENTA, bold: true })

    if (!SUPPORTED_FORMATS.includes(format)) {
      log(`  ✖ 不支持的格式 "${format}"，当前支持：${SUPPORTED_FORMATS.join(" / ")}`, { color: COLORS.RED })
      log()
      return { ok: false }
    }

    // 读取当前 thread 的会话报文（checkpoint → LangChain 消息 → plain 报文）
    let messages
    let model
    try {
      messages = await getSessionMessages(String(getSessionStart()))
      model = getConfig()[SETTING_FIELDS.model]
    } catch (err) {
      log(`  ✖ 读取会话失败：${err.message}`, { color: COLORS.RED })
      log()
      return { ok: false }
    }
    // 首条为 system 提示词，其后无内容说明没有对话
    if (messages.length <= 1) {
      log("  当前会话还没有对话内容，无可导出", { color: COLORS.YELLOW })
      log()
      return { ok: false }
    }

    const meta = {
      exportedAt: new Date().toISOString(),
      threadId: String(getSessionStart()),
      model,
    }
    const ext = format === "excel" ? "xlsx" : format
    const file = path.join(getExportDir(), `coder_export_${Date.now()}.${ext}`)

    try {
      if (format === "excel") {
        exportExcel(messages, meta, file)
      } else if (format === "xml") {
        exportXml(messages, meta, file)
      } else {
        exportJson(messages, meta, file)
      }
    } catch (err) {
      log(`  ✖ 导出失败：${err.message}`, { color: COLORS.RED })
      log()
      return { ok: false, error: err.message }
    }

    log(`  ✅ 已导出 ${messages.length} 条报文（${format}）：${shortenPath(file)}`, { color: COLORS.GREEN })
    log()
    return { ok: true, file, count: messages.length }
  },
}
