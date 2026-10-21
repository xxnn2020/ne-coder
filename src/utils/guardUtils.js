import { loadConfig, SETTING_FIELDS } from './llm.js'

/**
 * bash 高危命令审查规则：命中即需用户确认
 * 规则按行匹配，命令以 ; && || 分隔的每一段都会被检查
 */
const BASH_DANGEROUS_RULES = [
  { pattern: /\brm\b[^&|;]*\s-[a-zA-Z]*r/, reason: '递归删除（rm -r）' },
  { pattern: /\brm\b[^&|;]*\s-[a-zA-Z]*f/, reason: '强制删除（rm -f）' },
  { pattern: /\bsudo\b/, reason: '提权执行（sudo）' },
  { pattern: /\bgit\s+push\b[^&|;]*(-f\b|--force\b)/, reason: '强制推送（git push -f/--force）' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: '硬重置工作区（git reset --hard）' },
  { pattern: /\bgit\s+clean\b[^&|;]*-[a-zA-Z]*f/, reason: '强制清理未跟踪文件（git clean -f）' },
  { pattern: /\b(mkfs|fdisk)\b/, reason: '磁盘分区操作' },
  { pattern: /\bdd\s+if=/, reason: '磁盘级写入（dd）' },
  { pattern: /\bchmod\s+(-R\b|777\b)/, reason: '批量/开放权限（chmod）' },
  { pattern: /\bchown\s+-R\b/, reason: '批量修改属主（chown -R）' },
  { pattern: /(curl|wget)[^|;]*\|\s*(ba|z|fi)?sh\b/, reason: '下载并执行脚本' },
  { pattern: /\b(kill\s+-9|killall|pkill)\b/, reason: '强制终止进程' },
]

/**
 * 评估工具调用风险
 * @param {string} toolName 工具名
 * @param {object} args 工具参数
 * @returns {{dangerous: boolean, reason?: string, detail?: string}}
 */
export function assessRisk(toolName, args = {}) {
  // 删除文件不可逆，一律确认
  if (toolName === 'deleteFile' && args.path) {
    return { dangerous: true, reason: '删除文件不可恢复', detail: `删除 ${args.path}` }
  }
  // bash 逐行匹配高危命令模式
  if (toolName === 'bash' && typeof args.script === 'string') {
    for (const line of args.script.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      for (const rule of BASH_DANGEROUS_RULES) {
        if (rule.pattern.test(trimmed)) {
          return { dangerous: true, reason: rule.reason, detail: trimmed.slice(0, 120) }
        }
      }
    }
  }
  return { dangerous: false }
}

/**
 * 获取权限模式（setting.json 的 PERMISSION_MODE）：
 *   confirm（默认）—— 高危操作必须用户确认
 *   yolo            —— 全部放行
 */
export function getPermissionMode() {
  try {
    return loadConfig()?.[SETTING_FIELDS.permissionMode] || 'confirm'
  } catch {
    return 'confirm'
  }
}
