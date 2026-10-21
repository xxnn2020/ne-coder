import { tool } from "langchain"
import { z } from "zod"
import { log, COLORS } from "../../../utils/logUtils.js"

// 任务状态标记与配色
const STATUS_MARKS = {
    pending: { mark: "☐", color: COLORS.GRAY },
    in_progress: { mark: "◐", color: COLORS.CYAN },
    completed: { mark: "☑", color: COLORS.GREEN }
}

const todoWrite = tool(
    ({ todos }) => {
        if (!todos.length) {
            return "清单已清空"
        }

        log("\n  📋 任务清单", { color: COLORS.CYAN_BRIGHT, bold: true })
        for (const todo of todos) {
            const s = STATUS_MARKS[todo.status] || STATUS_MARKS.pending
            const done = todo.status === "completed"
            log([
                { text: `    ${s.mark} `, color: s.color },
                { text: todo.content, color: done ? COLORS.GRAY : undefined }
            ])
        }
        const completed = todos.filter((t) => t.status === "completed").length
        const inProgress = todos.filter((t) => t.status === "in_progress").length
        log(
            `    进度：${completed}/${todos.length} 完成${inProgress ? `，进行中 ${inProgress}` : ""}\n`,
            { color: COLORS.GRAY }
        )
        return `清单已更新（${completed}/${todos.length} 完成）`
    },
    {
        name: "todoWrite",
        description:
            "维护并渲染当前任务清单：每次全量传入所有任务（含状态），适合多步骤任务的进度跟踪；状态为 pending（未开始）/ in_progress（进行中）/ completed（已完成）",
        schema: z.object({
            todos: z
                .array(
                    z.object({
                        content: z.string().describe("任务内容，简短一句话"),
                        status: z.enum(["pending", "in_progress", "completed"]).describe("任务状态")
                    })
                )
                .describe("全部任务的最新状态，全量覆盖")
        })
    }
);

export default todoWrite
