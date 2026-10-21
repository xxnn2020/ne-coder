import path from "node:path"
import { readFileSync, writeFileSync } from "node:fs"
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

const editFile = tool(
    ({ path: filePath, oldString, newString }) => {
        const full = safeResolve(filePath);
        if (!full) {
            return `编辑失败：${filePath} 在工作目录之外，仅允许编辑工作目录内的文件`;
        }
        if (!oldString) {
            return "编辑失败：oldString 不能为空";
        }

        let content;
        try {
            content = readFileSync(full, "utf8");
        } catch (err) {
            return `编辑失败：${err.message}`;
        }

        // oldString 必须唯一命中，否则拒绝修改
        const first = content.indexOf(oldString);
        if (first === -1) {
            return `编辑失败：未在 ${filePath} 中找到要替换的内容，请确认 oldString 与文件内容完全一致（含缩进）`;
        }
        if (content.indexOf(oldString, first + 1) !== -1) {
            return `编辑失败：oldString 在 ${filePath} 中出现多次，请提供更长、更唯一的上下文（包含前后行）`;
        }

        try {
            const next = content.slice(0, first) + newString + content.slice(first + oldString.length);
            writeFileSync(full, next, "utf8");
            return `已编辑 ${filePath}（替换 ${oldString.length} 字符 → ${newString.length} 字符）`;
        } catch (err) {
            return `编辑失败：${err.message}`;
        }
    },
    {
        name: "editFile",
        description:
            "精确编辑文件：在指定文件中查找 oldString 并替换为 newString（oldString 必须在文件中唯一，包含足够上下文以确保唯一），适合小范围修改；大范围重写请用 writeFile",
        schema: z.object({
            path: z.string().describe("文件路径，如 src/utils/runtime.js"),
            oldString: z.string().describe("要被替换的原文（必须与文件内容完全一致，含缩进，且在文件中唯一）"),
            newString: z.string().describe("替换后的新内容")
        })
    }
);

export default editFile
