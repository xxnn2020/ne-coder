import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-vec-'))
process.chdir(TMP)
fs.mkdirSync(path.join(TMP, '.coder/docs/md'), { recursive: true })
fs.writeFileSync(path.join(TMP, '.coder/docs/a.md'), 'md 内容')
fs.writeFileSync(path.join(TMP, '.coder/docs/md/b.md'), 'md 内容')
fs.writeFileSync(path.join(TMP, '.coder/docs/notes.txt'), 'txt 内容')
fs.writeFileSync(path.join(TMP, '.coder/docs/ignore.pdf'), 'pdf 内容')
fs.writeFileSync(path.join(TMP, '.coder/docs/data.xlsx'), 'xlsx')

const { resolveTargets, SUPPORTED_EXTS } = await import('../src/utils/vectorUtils.js')

test('SUPPORTED_EXTS：五种支持格式', () => {
  assert.deepEqual(SUPPORTED_EXTS, ['.txt', '.pdf', '.docx', '.xlsx', '.md'])
})

test('resolveTargets：目录递归收集且仅保留支持格式', () => {
  fs.writeFileSync(path.join(TMP, '.coder/docs/ignore.doc'), 'doc 不支持')
  const { files, unsupported } = resolveTargets(['.coder/docs'])
  const basenames = files.map((f) => path.basename(f)).sort()
  // 支持 5 种格式全部收集，.doc 被过滤
  assert.deepEqual(basenames, ['a.md', 'b.md', 'data.xlsx', 'ignore.pdf', 'notes.txt'])
  assert.equal(unsupported.length, 0)
})

test('resolveTargets：不支持的文件报 unsupported', () => {
  const { files, unsupported } = resolveTargets(['.coder/docs/ignore.doc'])
  assert.equal(files.length, 0)
  assert.equal(unsupported.length, 1)
  assert.match(unsupported[0], /格式不支持/)
})

test('resolveTargets：不存在的路径报 unsupported', () => {
  const { unsupported } = resolveTargets(['no/such/path'])
  assert.equal(unsupported.length, 1)
  assert.match(unsupported[0], /不存在/)
})

test('resolveTargets：文件列表去重', () => {
  const { files } = resolveTargets(['.coder/docs/a.md', '.coder/docs/a.md'])
  assert.equal(files.length, 1)
})
