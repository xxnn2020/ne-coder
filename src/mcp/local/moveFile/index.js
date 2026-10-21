import path from "node:path"
import { renameSync, mkdirSync, copyFileSync, rmSync } from "node:fs"
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

const moveFile = tool(
    ({ from, to }) => {
        const src = safeResolve(from);
        const dest = safeResolve(to);
        if (!src || !dest) {
            return `移动失败：源或目标路径在工作目录之外，仅允许操作工作目录内的文件`;
        }
        try {
            mkdirSync(path.dirname(dest), { recursive: true });
            try {
                renameSync(src, dest);
            } catch (err) {
                if (err.code !== "EXDEV") throw err;
                // 跨设备移动：复制后删除源文件
                copyFileSync(src, dest);
                rmSync(src);
            }
            return `已移动 ${from} → ${to}`;
        } catch (err) {
            return `移动失败：${err.message}`;
        }
    },
    {
        name: "moveFile",
        description: "移动或重命名文件/文件夹（目标目录不存在时自动创建），仅允许操作工作目录内的路径",
        schema: z.object({
            from: z.string().describe("原路径"),
            to: z.string().describe("目标路径")
        })
    }
);

export default moveFile
