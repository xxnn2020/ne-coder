import path from "node:path"
import { statSync, unlinkSync } from "node:fs"
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

const deleteFile = tool(
    ({ path: filePath }) => {
        const full = safeResolve(filePath);
        if (!full) {
            return `删除失败：${filePath} 在工作目录之外，仅允许删除工作目录内的文件`;
        }
        try {
            if (statSync(full).isDirectory()) {
                return `删除失败：${filePath} 是目录，仅支持删除单个文件；删除目录请使用 bash 工具的 rm -r（便于用户感知风险）`;
            }
            unlinkSync(full);
            return `已删除 ${filePath}`;
        } catch (err) {
            return `删除失败：${err.message}`;
        }
    },
    {
        name: "deleteFile",
        description: "删除单个文件（不支持删除目录，删除目录需用 bash 的 rm -r），仅允许删除工作目录内的文件",
        schema: z.object({
            path: z.string().describe("要删除的文件路径")
        })
    }
);

export default deleteFile
