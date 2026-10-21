process.env.CODER_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-user-')) // 测试隔离：不读写真实用户数据
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-rule-'))
process.chdir(TMP)
fs.mkdirSync(path.join(TMP, '.coder/rules'), { recursive: true })

fs.writeFileSync(
  path.join(TMP, '.coder/rules/css.md'),
  '---\npaths:\n    - "**/*.css"\n    - "**/*.less"\n---\n# CSS 规范\n正文内容'
)
fs.writeFileSync(
  path.join(TMP, '.coder/rules/js.md'),
  '---\npaths:\n  - "**/*.js"\n---\n# JS 规范\n使用 ESM'
)
fs.writeFileSync(path.join(TMP, '.coder/rules/plain.md'), '# 无头部\n直接全文')

const { loadRules } = await import('../src/utils/ruleUtils.js')

test('loadRules：解析 paths 列表与正文', () => {
  const map = loadRules()
  const css = [...map.values()].find((r) => r.content.includes('CSS 规范'))
  assert.deepEqual(css.rules, ['**/*.css', '**/*.less'])
  assert.ok(css.content.startsWith('# CSS 规范'))
})

test('loadRules：无文件头部时 rules 为空、content 为全文', () => {
  const map = loadRules()
  const plain = [...map.values()].find((r) => r.content.includes('无头部'))
  assert.deepEqual(plain.rules, [])
  assert.ok(plain.content.includes('直接全文'))
})

test('loadRules：key 为文件绝对路径', () => {
  const map = loadRules()
  for (const key of map.keys()) {
    assert.ok(path.isAbsolute(key))
    assert.ok(key.endsWith('.md'))
  }
})
