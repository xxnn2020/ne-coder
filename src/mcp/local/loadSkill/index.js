import path from "node:path"
import { readFileSync } from "node:fs"
import { tool } from "langchain"
import { z } from "zod"
import { loadSkills } from "../../../utils/skillUtils.js"

const loadSkill = tool(
    ({ name }) => {
        // 从已加载的 skill 列表（含目录地址）中查找
        const skill = loadSkills().find((s) => s.name === name);
        if (!skill) {
            const available = loadSkills().map((s) => s.name).join("、") || "（无）";
            return `未找到 skill "${name}"，当前可用：${available}`;
        }
        try {
            const content = readFileSync(path.join(skill.dir, "SKILL.md"), "utf8");
            return content || "（SKILL.md 为空）";
        } catch (err) {
            return `加载 skill 失败：${err.message}`;
        }
    },
    {
        name: "loadSkill",
        description: "加载指定 skill 的完整说明（SKILL.md 全文），按用户上下文中列出的 skill 名称调用",
        schema: z.object({
            name: z.string().describe("skill 名称，如 say-hello")
        })
    }
);

export default loadSkill
