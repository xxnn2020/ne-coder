process.env.CODER_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-user-')) // 测试隔离：不读写真实用户数据
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-cmd-'))
process.chdir(TMP)

const { loadCustomCommands } = await import('../src/utils/customCommands.js')

beforeEach(() => {
  fs.rmSync(path.join(TMP, '.coder'), { recursive: true, force: true })
  fs.rmSync(path.join(os.homedir(), '.coder/commands'), { recursive: true, force: true })
})

test('loadCustomCommands：xx.md → /xx', () => {
  fs.mkdirSync(path.join(TMP, '.coder/commands'), { recursive: true })
  fs.writeFileSync(path.join(TMP, '.coder/commands/deploy.md'), '# 部署指南\n内容')
  const cmds = loadCustomCommands()
  const deploy = cmds.find((c) => c.name === '/deploy')
  assert.ok(deploy)
  assert.equal(deploy.desc, '部署指南') // 首行标题作为描述
  assert.equal(deploy.interrupt, false)
})

test('loadCustomCommands：a/b.md → /a:b', () => {
  fs.mkdirSync(path.join(TMP, '.coder/commands/git'), { recursive: true })
  fs.writeFileSync(path.join(TMP, '.coder/commands/git/commit.md'), '# 提交规范')
  const cmds = loadCustomCommands()
  assert.ok(cmds.some((c) => c.name === '/git:commit'))
})

test('loadCustomCommands：execute 返回 md 内容作为 context', () => {
  fs.mkdirSync(path.join(TMP, '.coder/commands'), { recursive: true })
  fs.writeFileSync(path.join(TMP, '.coder/commands/t1.md'), '# 标题\n正文内容')
  const cmd = loadCustomCommands().find((c) => c.name === '/t1')
  const result = cmd.execute()
  assert.equal(result.ok, true)
  assert.ok(result.context.includes('正文内容'))
})

test('loadCustomCommands：目录不存在返回空', () => {
  assert.deepEqual(loadCustomCommands(), [])
})
