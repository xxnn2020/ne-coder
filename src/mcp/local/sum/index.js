import { tool } from "langchain"
import { z } from "zod"

const sum = tool(
    ({ numbers }) => {
        const result = numbers.reduce((acc, val) => acc + val, 0)
        return `已为你调用工具 sum 计算和：${result}`
    },
    {
        name: "sum",
        description: "计算多个数的和",
        // 顶层 schema 必须是 object（function calling 参数规范），数组作为字段传入
        schema: z.object({
            numbers: z.array(z.number()).describe("参与求和的数字数组")
        })
    }
)

export default sum
