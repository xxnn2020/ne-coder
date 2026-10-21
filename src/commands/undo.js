import path from "node:path"
import { undoLastTurn } from "../utils/editJournal.js"
import { log, COLORS } from "../utils/logUtils.js"
import { shortenPath } from "../utils/fileUtils.js"

/**
 * /undo 指令：回滚最近一轮的文件修改（恢复原内容 / 删除本轮新建文件）
 */
export default {
    name: "/undo",
    desc: "回滚最近一轮文件修改",
    // 中断类型：执行完不发送剩余内容给大模型
    interrupt: true,
    /**
     * @returns {{ok: boolean, restored?: number}}
     */
    execute() {
        const result = undoLastTurn()
        if (!result) {
            log("  没有可回滚的修改记录", { color: COLORS.YELLOW })
            log()
            return { ok: true, restored: 0 }
        }
        log(`  ↩️ 已回滚最近一轮的 ${result.restored} 个文件修改：`, { color: COLORS.GREEN })
        for (const f of result.files) {
            log(`    - ${shortenPath(f)}`, { color: COLORS.GRAY })
        }
        log()
        return { ok: true, restored: result.restored }
    },
}
