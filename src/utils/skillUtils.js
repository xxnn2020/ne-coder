import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir } from './fileUtils.js'

/**
 * 解析 SKILL.md 文件头部（--- 包裹的元数据），提取 name 与 description
 * 格式：
 *   ---
 *   name: say-hello
 *   description: A simple skill to say hello.
 *   ---
 * 无文件头部或缺少 name 时返回 null
 */
function parseSkillMeta(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null

  let name = ''
  let description = ''
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/)
    if (!kv) continue
    if (kv[1] === 'name') name = kv[2].trim()
    else if (kv[1] === 'description') description = kv[2].trim()
  }
  return name ? { name, description } : null
}

/**
 * 读取全部 skill 元信息：扫描 <目录>/.coder/skills/<子目录>/SKILL.md
 * 查找顺序：当前项目 .coder/skills → 用户设置目录 .coder/skills，同名时当前项目优先
 * 目录或文件不存在时跳过
 * 返回 [{ dir, name, description }]
 */
export function loadSkills() {
  const skills = []
  const seen = new Set()

  for (const base of [getCurrentTerminalDir(), getUserSettingsDir()]) {
    const skillsDir = path.join(getCoderConfigDir(base), 'skills')
    let entries
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true })
    } catch {
      continue // skills 目录不存在，跳过
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const file = path.join(skillsDir, entry.name, 'SKILL.md')
      let meta
      try {
        meta = parseSkillMeta(readFileSync(file, 'utf8'))
      } catch {
        continue // SKILL.md 不存在或读取失败
      }
      if (!meta || seen.has(meta.name)) continue
      seen.add(meta.name)
      skills.push({ dir: path.join(skillsDir, entry.name), ...meta })
    }
  }

  return skills
}

/**
 * 读取 skillContext 模板并替换 ${skillContent} 为全部 skill 的名字与描述
 * 无 skill 或模板缺失时返回空字符串
 */
export function loadSkillContext() {
  const skills = loadSkills()
  if (skills.length === 0) return ''

  let template
  try {
    template = readFileSync(new URL('../docs/skillContext.md', import.meta.url), 'utf8')
  } catch {
    return ''
  }

  const skillContent = skills
    .map((s) => `- name: ${s.name}\n  description: ${s.description}\n  path: ${s.dir}`)
    .join('\n')

  return template.replaceAll('${skillContent}', skillContent)
}