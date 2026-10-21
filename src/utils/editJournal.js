import { writeFileSync, rmSync } from 'node:fs'

/**
 * 会话内文件修改日志：按轮记录修改对（原内容），/undo 回滚最近一轮
 * 每轮 = 一次用户提交到 AI 回复完成（chatWithAI 开始时 beginTurn）
 */
let journal = [] // [{ turn, file, before, existed }]
let currentTurn = 0
// 本轮"全部放行"信号：用户确认时按 A 置位，beginTurn 重置
let approveAll = false

/**
 * 开始新一轮：轮号递增，清除"全部放行"信号
 */
export function beginTurn() {
  currentTurn++
  approveAll = false
}

/**
 * 当前轮号
 */
export function currentTurnNumber() {
  return currentTurn
}

/**
 * 是否已在本轮选择"全部放行"
 */
export function isApproveAll() {
  return approveAll
}

/**
 * 置位"全部放行"（用户按 A）
 */
export function setApproveAll() {
  approveAll = true
}

/**
 * 记录一次修改（执行成功后调用）
 * @param {string} file 文件路径
 * @param {string} before 修改前内容（不存在时为 ''）
 * @param {boolean} existed 修改前文件是否存在
 */
export function recordEdit(file, before, existed) {
  journal.push({ turn: currentTurn, file, before, existed })
}

/**
 * 回滚最近一轮的全部修改
 * @returns {{restored: number, files: string[]}|null} 无记录返回 null
 */
export function undoLastTurn() {
  if (journal.length === 0) return null
  const lastTurn = journal[journal.length - 1].turn
  const entries = journal.filter((e) => e.turn === lastTurn)
  journal = journal.filter((e) => e.turn !== lastTurn)

  const files = []
  for (const e of entries) {
    try {
      if (e.existed) {
        writeFileSync(e.file, e.before, 'utf8')
      } else {
        // 本轮新建的文件：回滚即删除
        rmSync(e.file, { force: true })
      }
      files.push(e.file)
    } catch {
      // 单个恢复失败跳过，继续其余
    }
  }
  return { restored: files.length, files }
}

/**
 * 清空日志（/clear 或新会话时可选）
 */
export function clearJournal() {
  journal = []
}
