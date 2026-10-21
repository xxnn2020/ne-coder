import path from "node:path"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { tool } from "langchain"
import { z } from "zod"

// 搜索限制：忽略目录、结果条数、深度、单文件大小
const IGNORED_ENTRIES = new Set(["node_modules", ".git", ".coder"])
const MAX_RESULTS = 50
const MAX_DEPTH = 8
const MAX_FILE_SIZE = 512 * 1024
const MAX_LINE_LENGTH = 200

const grep = tool(
    ({ pattern, path: searchPath }) => {
        let re
        try {
            re = new RegExp(pattern)
        } catch (err) {
            return `正则表达式无效：${err.message}`
        }

        const base = path.resolve(process.cwd(), searchPath || ".")
        if (base !== process.cwd() && !base.startsWith(process.cwd() + path.sep)) {
            return "搜索失败：仅允许搜索工作目录内的路径"
        }

        const results = []
        const walk = (dir, depth) => {
            if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return
            let entries
            try {
                entries = readdirSync(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                if (entry.name.startsWith(".") || IGNORED_ENTRIES.has(entry.name)) continue
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                    walk(full, depth + 1)
                    continue
                }
                try {
                    if (statSync(full).size > MAX_FILE_SIZE) continue
                    const content = readFileSync(full, "utf8")
                    if (content.includes(String.fromCharCode(0))) continue // 二进制文件跳过
                    const rel = path.relative(process.cwd(), full)
                    const lines = content.split("\n")
                    for (let i = 0; i < lines.length; i++) {
                        if (re.test(lines[i])) {
                            results.push(`${rel}:${i + 1}:${lines[i].trim().slice(0, MAX_LINE_LENGTH)}`)
                            if (results.length >= MAX_RESULTS) return
                        }
                    }
                } catch {
                    // 单个文件读取失败跳过
                }
            }
        }
        walk(base, 1)

        if (results.length === 0) {
            return `未找到匹配 "${pattern}" 的内容`
        }
        return results.join("\n") + (results.length >= MAX_RESULTS ? `\n…（结果已达 ${MAX_RESULTS} 条上限，可缩小范围或细化关键词）` : "")
    },
    {
        name: "grep",
        description:
            "在工作目录内递归搜索文件内容，按正则表达式逐行匹配，返回 文件路径:行号:行内容；可通过 path 参数限定搜索的文件或目录",
        schema: z.object({
            pattern: z.string().describe("要搜索的正则表达式，如 createAgent|streamEvents"),
            path: z.string().optional().describe("限定的搜索路径（文件或目录），默认当前工作目录")
        })
    }
)

export default grep
