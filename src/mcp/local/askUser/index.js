import readline from "node:readline"
import { tool } from "langchain"
import { z } from "zod"
import { style, COLORS } from "../../../utils/logUtils.js"
import { pauseInput, resumeInput } from "../../../utils/runtime.js"

// 确认类回答的词语解析（不区分大小写），命中后规范化返回 是/否
const YES_WORDS = new Set(["y", "yes", "是", "好", "好的", "好吧", "确认", "确定", "可以", "行", "嗯", "ok", "okay", "当然", "没问题"])
const NO_WORDS = new Set(["n", "no", "否", "不", "不要", "不行", "不可以", "取消", "算了", "nope"])

/**
 * 确认模式：提示 (Y/N) 或 (Y/N/A)，单键立即生效，或输入词语后回车（是/好的/确认/否/取消等）
 * allowAll 时 A 返回 "全部"（本轮剩余修改全部放行）
 * 返回规范化为 是 / 否 / 全部，未匹配词语原样返回
 */
function askConfirm(question, resolve, { allowAll = false } = {}) {
    pauseInput()
    const hint = allowAll ? "(Y/N/A=本轮全部允许)" : "(Y/N)"
    process.stdout.write(style(`\n  ❓ ${question} ${hint}\n  ❯ `, { color: COLORS.YELLOW, bold: true }))

    let buf = ""
    let done = false
    const finish = (answer) => {
        if (done) return
        done = true
        process.stdin.removeListener("keypress", onKey)
        process.stdout.write("\n")
        resumeInput()
        resolve(answer)
    }
    const onKey = (str, key) => {
        if (done) return
        if (key.ctrl && (key.name === "c" || key.name === "d")) {
            process.stdout.write("\n")
            finish("用户取消了输入")
            return
        }
        if (key.name === "return") {
            const word = buf.trim().toLowerCase()
            if (!word) {
                finish("（用户未选择）")
                return
            }
            finish(YES_WORDS.has(word) ? "是" : NO_WORDS.has(word) ? "否" : buf.trim())
            return
        }
        if (key.name === "backspace") {
            if (buf) {
                buf = buf.slice(0, -1)
                process.stdout.write("\b \b")
            }
            return
        }
        if (str && !key.ctrl && !key.meta) {
            // 空缓冲时单键 Y/N/A 直接生效
            if (!buf && allowAll && (str === "a" || str === "A")) {
                process.stdout.write(str)
                finish("全部")
                return
            }
            if (!buf && (str === "y" || str === "Y")) {
                process.stdout.write(str)
                finish("是")
                return
            }
            if (!buf && (str === "n" || str === "N")) {
                process.stdout.write(str)
                finish("否")
                return
            }
            buf += str
            process.stdout.write(str)
        }
    }
    process.stdin.on("keypress", onKey)
}

/**
 * 普通模式：显示问题并用 readline 读取一行自由回答
 */
function askFree(question, resolve) {
    pauseInput()
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    })
    rl.question(style(`  ❓ ${question}\n  答案: `, { color: COLORS.YELLOW, bold: true }), (answer) => {
        rl.close()
        resumeInput()
        resolve(answer.trim() || "（用户未输入内容）")
    })
}

const askUser = tool(
    ({ question, confirm }) =>
        new Promise((resolve) => {
            // 非交互环境（管道/测试）无法提问，引导模型自行处理
            if (!process.stdin.isTTY) {
                resolve("当前为非交互环境，无法向用户提问；请基于已有信息继续，或说明该操作需要用户确认后跳过")
                return
            }
            if (confirm) {
                askConfirm(question, resolve)
            } else {
                askFree(question, resolve)
            }
        }),
    {
        name: "askUser",
        description:
            "向用户提出问题并等待回答。自由问题直接传 question；是否/确认类问题传 confirm: true（界面提示 Y/N，用户可单键 Y/N 或输入 是/好的/确认/否 等词语，回答规范化为 是/否）",
        schema: z.object({
            question: z.string().describe("要向用户提出的问题"),
            confirm: z.boolean().optional().describe("是否为确认类问题（是/否），是则界面提示 (Y/N)")
        })
    }
);

export default askUser

/**
 * 供其他模块复用的用户确认（Promise 形式的 askConfirm）：
 * 防护墙等在工具执行前调用；非交互环境直接按"否"处理
 * allowAll 时提示 (Y/N/A)，A 返回 "全部"
 */
export function confirmWithUser(question, { allowAll = false } = {}) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("否")
      return
    }
    askConfirm(question, resolve, { allowAll })
  })
}

/**
 * 供其他模块复用的自由输入提示（如 /model 的编号选择）：
 * 非交互环境直接返回空字符串
 */
export function promptUser(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("")
      return
    }
    pauseInput()
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })
    rl.question(style(`${question}`, { color: COLORS.CYAN_BRIGHT }), (answer) => {
      rl.close()
      resumeInput()
      resolve(answer.trim())
    })
  })
}
