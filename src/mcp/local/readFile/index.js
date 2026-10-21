import path from "node:path"
import { readFileSync } from "node:fs"
import { tool } from "langchain"
import { z } from "zod"

// 返回内容上限，防止大文件刷屏
const MAX_CONTENT = 20000

/**
 * 解析到工作目录内的绝对路径；越界（工作目录之外）返回 null
 */
function safeResolve(filePath) {
    const full = path.resolve(process.cwd(), filePath);
    if (full !== process.cwd() && !full.startsWith(process.cwd() + path.sep)) {
        return null;
    }
    return full;
}

const readFile = tool(
    ({ path: filePath, offset, limit }) => {
        const full = safeResolve(filePath);
        if (!full) {
            return `读取失败：${filePath} 在工作目录之外，仅允许访问工作目录内的文件`;
        }
        try {
            let content = readFileSync(full, "utf8");

            // 行范围读取：offset 从 1 开始，limit 为行数
            if (offset || limit) {
                const lines = content.split("\n");
                const start = Math.max(1, offset || 1) - 1;
                const end = limit ? start + limit : lines.length;
                const picked = lines.slice(start, end).join("\n");
                return `（${filePath} 第 ${start + 1}-${Math.min(end, lines.length)} 行，共 ${lines.length} 行）\n${picked}`;
            }

            if (content.length > MAX_CONTENT) {
                return `文件内容（前 ${MAX_CONTENT} 字符，已截断，可用 offset/limit 分段读取）：\n${content.slice(0, MAX_CONTENT)}`;
            }
            return content || "（空文件）";
        } catch (err) {
            return `读取失败：${err.message}`;
        }
    },
    {
        name: "readFile",
        description:
            "读取指定路径的文件内容（相对当前工作目录或绝对路径）；可选 offset（起始行，从 1 计）与 limit（行数）分段读取大文件，仅允许访问工作目录内的文件",
        schema: z.object({
            path: z.string().describe("文件路径，如 src/index.js"),
            offset: z.number().optional().describe("起始行号（从 1 开始），不传则从头读"),
            limit: z.number().optional().describe("读取的行数，不传则读到文件末尾")
        })
    }
);

export default readFile
