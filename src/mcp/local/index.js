import path from "node:path"
import { readdirSync, existsSync, readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assessRisk, getPermissionMode } from "../../utils/guardUtils.js"
import { confirmWithUser } from "./askUser/index.js"
import { renderDiff } from "../../utils/diffUtils.js"
import {
    beginTurn, isApproveAll, setApproveAll, recordEdit,
} from "../../utils/editJournal.js"

// 需要危险操作防护墙审查的工具
const GUARDED_TOOLS = new Set(["bash", "deleteFile"])
// 需要 diff 预览与确认的修改类工具
const DIFF_TOOLS = new Set(["editFile", "writeFile"])

// 确认互斥锁：agent 并行调用多个修改工具时，确认提示必须逐个弹出，
// 不能叠加（两个 ❓ 同屏会错位）；后到的工具排队等前一个确认完成
let confirmChain = Promise.resolve()

/**
 * 修改类工具的 diff 防护包装：
 *   执行前读取原内容并渲染 diff（+绿/-红），confirm 模式需用户确认
 *   （Y 执行 / N 拒绝 / A 本轮全部放行）；yolo 模式跳过确认但仍展示 diff
 *   执行成功后记录修改日志（/undo 可回滚）
 */
function wrapWithDiffGuard(tool) {
    const wrapped = Object.create(tool)

    const extractArgs = (input) =>
        input && typeof input === "object" && input.args && typeof input.args === "object"
            ? input.args
            : input

    const runWrapped = async (callArgs, options) => {
        const filePath = callArgs?.path
        let before = ""
        let existed = false
        try {
            before = readFileSync(filePath, "utf8")
            existed = true
        } catch {
            existed = false
        }

        // 预计算修改后的内容（editFile：oldString 替换；writeFile：整份 content）
        let nextContent
        if (tool.name === "writeFile") {
            nextContent = callArgs?.content ?? ""
        } else {
            const oldStr = callArgs?.oldString
            const first = before.indexOf(oldStr ?? "")
            if (oldStr === undefined || first === -1) {
                nextContent = null // 交给原工具执行并自行报错（找不到替换目标）
            } else {
                nextContent = before.slice(0, first) + (callArgs?.newString ?? "") + before.slice(first + oldStr.length)
            }
        }

        // 执行前展示 diff 预览（正确的 after，一次渲染）
        if (nextContent !== null && nextContent !== undefined) {
            renderDiff(filePath, before, nextContent)
        }

        // 确认（yolo 跳过；本轮已选"全部"跳过）；并行工具通过 confirmChain 串行排队
        if (getPermissionMode() !== "yolo" && !isApproveAll()) {
            if (!process.stdin.isTTY) {
                return `已阻止文件修改：${filePath}。当前为非交互环境，不执行修改操作。`
            }
            const doConfirm = async () => {
                // 轮到自己时可能前面的确认已按 A（全部放行），复查一次
                if (isApproveAll()) return "全部"
                return confirmWithUser(`确认${tool.name === "writeFile" ? "写入" : "修改"} ${filePath}？`, { allowAll: true })
            }
            const pending = confirmChain.then(doConfirm, doConfirm)
            confirmChain = pending.catch(() => {})
            const answer = await pending
            if (answer === "全部") {
                setApproveAll()
            } else if (answer !== "是") {
                return `用户拒绝了本次修改（${filePath}）。不要原样重试，可询问用户意图。`
            }
        }

        const result = await tool.invoke(callArgs, options)

        // 执行成功后记录修改日志（供 /undo）
        if (nextContent !== null && nextContent !== undefined) {
            recordEdit(path.resolve(process.cwd(), filePath), before, existed)
        }
        return result
    }

    wrapped.invoke = async (input, options) => runWrapped(extractArgs(input), options)
    if (typeof tool.func === "function") {
        wrapped.func = async (input, options) => runWrapped(extractArgs(input), options)
    }
    if (typeof tool.call === "function") {
        wrapped.call = async (input, options) => runWrapped(extractArgs(input), options)
    }
    return wrapped
}

/**
 * 给工具包一层审查：调用前评估风险，高危操作需用户确认（Y/N）后放行；
 * yolo 权限模式直接放行；非交互环境直接阻止（安全默认）
 * 注意 agent 执行工具可能走 invoke / func / call 任一入口，三个都需包装，
 * 只包 invoke 会被继承的原方法绕过
 */
function wrapWithGuard(tool) {
    const wrapped = Object.create(tool)

    // 提取真实参数：agent 走 invoke 时参数可能是 Runnable 包装形状 { name, args: {...} }
    const extractArgs = (input) =>
        input && typeof input === "object" && input.args && typeof input.args === "object"
            ? input.args
            : input

    // 审查：通过返回 null，否则返回拒绝消息
    const guardCheck = async (callArgs) => {
        const verdict = assessRisk(tool.name, callArgs || {})
        if (!verdict.dangerous) return null
        if (getPermissionMode() === "yolo") return null
        if (!process.stdin.isTTY) {
            return `已阻止高危操作：${verdict.reason}（${verdict.detail}）。当前为非交互环境，不执行该操作。`
        }
        const answer = await confirmWithUser(
            `工具 ${tool.name} 请求执行高危操作\n    内容：${verdict.detail}\n    风险：${verdict.reason}`
        )
        if (answer !== "是") {
            return `用户拒绝了该操作（${verdict.reason}）。不要原样重试，可询问用户意图或换更安全的方式。`
        }
        return null
    }

    wrapped.invoke = async (input, options) => {
        const callArgs = extractArgs(input)
        const blocked = await guardCheck(callArgs)
        if (blocked) return blocked
        return tool.invoke(callArgs, options)
    }
    if (typeof tool.func === "function") {
        wrapped.func = async (input, options) => {
            const callArgs = extractArgs(input)
            const blocked = await guardCheck(callArgs)
            if (blocked) return blocked
            return tool.func(callArgs, options)
        }
    }
    if (typeof tool.call === "function") {
        wrapped.call = async (input, options) => {
            const callArgs = extractArgs(input)
            const blocked = await guardCheck(callArgs)
            if (blocked) return blocked
            return tool.call(callArgs, options)
        }
    }
    return wrapped
}

class LocalMCPClient {
    constructor() {
        this.tools = new Map()
        this.loaded = false
    }

    /**
     * 注册本地工具（langchain tool 实例）；高危工具包审查防护，修改类工具包 diff 防护
     */
    registerTool(tool) {
        let finalTool = tool
        if (GUARDED_TOOLS.has(tool.name)) finalTool = wrapWithGuard(finalTool)
        if (DIFF_TOOLS.has(tool.name)) finalTool = wrapWithDiffGuard(finalTool)
        this.tools.set(tool.name, finalTool)
    }

    /**
     * 遍历 local 下的子文件夹，动态加载每个 文件夹/index.js 的默认导出并注册
     * 本地工具规范：文件夹/index.js，default 导出一个 tool 实例
     * 单个工具加载失败只跳过自身
     */
    async loadTools() {
        if (this.loaded) return
        this.loaded = true

        const baseDir = path.dirname(fileURLToPath(import.meta.url))
        let entries
        try {
            entries = readdirSync(baseDir, { withFileTypes: true })
        } catch {
            return
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const toolFile = path.join(baseDir, entry.name, "index.js")
            if (!existsSync(toolFile)) continue
            try {
                const mod = await import(pathToFileURL(toolFile).href)
                const tool = mod.default
                if (tool?.name) {
                    this.registerTool(tool)
                } else {
                    console.error(`[MCP] 本地工具 ${entry.name} 未默认导出 tool 实例，已跳过`)
                }
            } catch (err) {
                console.error(`[MCP] 本地工具 ${entry.name} 加载失败，已跳过：${err.message}`)
            }
        }
    }

    /**
     * 手动调用本地工具
     */
    async callTool(name, args) {
        await this.loadTools()
        const tool = this.tools.get(name)
        if (!tool) {
            throw new Error(`MCP 工具 ${name} 未注册`)
        }
        return tool.invoke(args)
    }

    /**
     * 工具实例列表（langchain tool 实例，供 agent 使用）
     */
    async listTools() {
        await this.loadTools()
        return Array.from(this.tools.values())
    }
}

const localMCPClient = new LocalMCPClient()

export default localMCPClient
