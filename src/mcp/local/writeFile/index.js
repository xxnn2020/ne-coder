import path from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { tool } from "langchain"
import { z } from "zod"

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

const writeFile = tool(
    ({ path: filePath, content }) => {
        const full = safeResolve(filePath);
        if (!full) {
            return `写入失败：${filePath} 在工作目录之外，仅允许写工作目录内的文件`;
        }
        try {
            // 目录不存在时自动创建，文件已存在则覆盖
            mkdirSync(path.dirname(full), { recursive: true });
            writeFileSync(full, content ?? "", "utf8");
            return `已写入 ${filePath}（${(content ?? "").length} 字符）`;
        } catch (err) {
            return `写入失败：${err.message}`;
        }
    },
    {
        name: "writeFile",
        description:
            "将内容写入指定路径的文件（相对当前工作目录或绝对路径），目录不存在时自动创建，文件已存在则覆盖；仅允许写工作目录内的文件",
        schema: z.object({
            path: z.string().describe("文件路径，如 src/utils/newHelper.js"),
            content: z.string().describe("写入的完整文件内容")
        })
    }
);

export default writeFile
