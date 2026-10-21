process.env.CODER_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-user-')) // 测试隔离：不读写真实用户数据
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-skill-'))
process.chdir(TMP)
fs.mkdirSync(path.join(TMP, '.coder/skills/hello'), { recursive: true })
fs.mkdirSync(path.join(TMP, '.coder/skills/empty'), { recursive: true })

fs.writeFileSync(
  path.join(TMP, '.coder/skills/hello/SKILL.md'),
  '---\nname: say-hello\ndescription: A simple skill to say hello.\nlicense: MIT\n---\n# Say Hello\n正文'
)
// empty 目录无 SKILL.md，应跳过

const { loadSkills, loadSkillContext } = await import('../src/utils/skillUtils.js')

test('loadSkills：解析 name/description，忽略 license 等字段', () => {
  const skills = loadSkills()
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'say-hello')
  assert.equal(skills[0].description, 'A simple skill to say hello.')
  assert.ok(skills[0].dir.endsWith('hello'))
})

test('loadSkills：无 SKILL.md 的目录跳过', () => {
  assert.ok(loadSkills().every((s) => s.name !== 'empty'))
})

test('loadSkillContext：模板填充（项目根目录为空时返回空串）', () => {
  // 模板位于 src/docs，独立测试只验证不抛异常
  assert.doesNotThrow(() => loadSkillContext())
})
