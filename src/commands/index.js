import help from './help.js'
import clear from './clear.js'
import exitCommand from './exit.js'
import quit from './quit.js'
import summary from './summary.js'
import vector from './vector.js'
import model from './model.js'
import history from './history.js'
import exportCmd from './export.js'
import memory from './memory.js'
import undo from './undo.js'
import { loadCustomCommands } from '../utils/customCommands.js'

// 内置指令
const BUILTIN = [help, clear, summary, vector, model, history, exportCmd, memory, undo, exitCommand, quit]

// 自定义指令（.coder/commands 下的 md），与内置重名时内置优先
const custom = loadCustomCommands().filter((c) => !BUILTIN.some((b) => b.name === c.name))

/**
 * 全部指令：/help 渲染与 / 补全列表共用
 * 每个指令含 name、desc、interrupt（中断类型：执行后退出程序）、execute()（返回执行结果数据）
 */
export const COMMANDS = [...BUILTIN, ...custom]

/**
 * 按指令名查找，未找到返回 undefined
 */
export function findCommand(name) {
  return COMMANDS.find((c) => c.name === name)
}
