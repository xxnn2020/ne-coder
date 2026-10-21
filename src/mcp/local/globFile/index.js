import path from "node:path"
import { readdirSync } from "node:fs"
import { tool } from "langchain"
import { z } from "zod"
import { globToRegExp } from "../../../utils/contextUtils.js"

// 遍历限制：忽略目录、深度、结果条数
const IGNORED_ENTRIES = new Set(["node_modules", ".git", ".coder"])
const MAX_DEPTH = 8
const LIMIT = 100

const globFile = tool(
    ({ pattern, path: searchPath }) => {
        let re
        try {
            re = globToRegExp(pattern)
        } catch (err) {
            return `通配符模式无效：${err.message}`
        }

        const base = path.resolve(process.cwd(), searchPath || ".")
        if (base !== process.cwd() && !base.startsWith(process.cwd() + path.sep)) {
            return "搜索失败：仅允许搜索工作目录内的路径"
        }

        const results = []
        const walk = (dir, rel, depth) => {
            if (results.length >= LIMIT || depth > MAX_DEPTH) return
            let entries
            try {
                entries = readdirSync(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                if (entry.name.startsWith(".") || IGNORED_ENTRIES.has(entry.name)) continue
                const relPath = rel ? `${rel}/${entry.name}` : entry.name
                if (!entry.isDirectory() && re.test(relPath)) {
                    results.push(relPath)
                    if (results.length >= LIMIT) return
                }
                if (entry.isDirectory()) {
                    walk(path.join(dir, entry.name), relPath, depth + 1)
                }
            }
        }
        walk(base, "", 1)

        if (results.length === 0) {
            return `未找到匹配 "${pattern}" 的文件`
        }
        return results.join("\n") + (results.length >= LIMIT ? `\n…（已达 ${LIMIT} 条上限）` : "")
    },
    {
        name: "globFile",
        description:
            "按通配符模式查找文件路径（如 **/*.js、src/**/*.md），返回匹配的相对路径列表；可通过 path 参数限定起始目录",
        schema: z.object({
            pattern: z.string().describe("通配符模式，** 匹配任意目录深度，* 匹配单段内任意字符"),
            path: z.string().optional().describe("限定的起始目录，默认当前工作目录")
        })
    }
)

export default globFile
