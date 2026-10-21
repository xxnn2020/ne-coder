import path from 'node:path'
import { statSync, readFileSync } from 'node:fs'
import { getCurrentTerminalDir } from './fileUtils.js'
import { loadRules } from './ruleUtils.js'

// 单个文件注入上下文的最大长度，超出截断
const FILE_CONTEXT_LIMIT = 80000

// 规则缓存：会话期间避免重复扫描目录
let rulesCache = null
function getRules() {
  if (!rulesCache) rulesCache = loadRules()
  return rulesCache
}

/**
 * glob 转 RegExp（支持双星跨目录、单星单段、问号单字符）
 * 例如 "双星/单星.css" 形式的模式可匹配任意目录深度下的 .css 文件
 */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

/**
 * 找出与文件路径匹配的所有规则内容（相对路径与文件名都参与匹配）
 */
function matchRuleContents(relPath) {
  const contents = []
  const fileName = path.basename(relPath)
  for (const [, { content, rules }] of getRules()) {
    for (const pattern of rules) {
      let re
      try {
        re = globToRegExp(pattern)
      } catch {
        continue // 非法模式跳过
      }
      if (re.test(relPath) || re.test(fileName)) {
        if (content) contents.push(content)
        break
      }
    }
  }
  return contents
}

/**
 * 展开文本中的 @路径 引用：读取文件内容包装为上下文块，随提问一起发给大模型
 * 文件命中 rules 规则（glob 匹配后缀/路径）时，对应规则的 content 一并附加
 * 路径不存在或读取失败时保留原样
 */
export function expandFileRefs(text, baseDir = getCurrentTerminalDir()) {
  return text.replace(/@(\S+)/g, (match, rel) => {
    try {
      const full = path.resolve(baseDir, rel)
      if (!statSync(full).isFile()) return match
      let content = readFileSync(full, 'utf8')
      if (content.length > FILE_CONTEXT_LIMIT) {
        content = content.slice(0, FILE_CONTEXT_LIMIT) + '\n…（内容过长，已截断）'
      }

      // 匹配规则：命中的规则内容附加在文件内容之后
      const ruleContents = matchRuleContents(rel)
      const ruleBlock = ruleContents.length
        ? `\n<rules>\n${ruleContents.join('\n\n')}\n</rules>`
        : ''

      return `\n<file path="${rel}">\n${content}${ruleBlock}\n</file>`
    } catch {
      return match
    }
  })
}
