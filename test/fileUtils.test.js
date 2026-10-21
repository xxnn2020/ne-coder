process.env.CODER_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-user-')) // 测试隔离：不读写真实用户数据
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-fileutils-'))
process.chdir(TMP) // fileUtils 依赖 cwd（getCurrentTerminalDir）

const { listDirEntries, searchDirEntries, shortenPath } = await import(
  '../src/utils/fileUtils.js'
)

test('listDirEntries：文件夹在前、同类型按名称排序', () => {
  fs.writeFileSync(path.join(TMP, 'b.txt'), 'x')
  fs.writeFileSync(path.join(TMP, 'a.txt'), 'x')
  fs.mkdirSync(path.join(TMP, 'zdir'))
  fs.mkdirSync(path.join(TMP, 'adir'))
  const items = listDirEntries(TMP)
  assert.deepEqual(
    items.map((i) => i.name),
    ['adir', 'zdir', 'a.txt', 'b.txt']
  )
  assert.equal(items[0].isDir, true)
  assert.equal(items[2].isDir, false)
})

test('listDirEntries：过滤隐藏文件与 node_modules/.git', () => {
  fs.mkdirSync(path.join(TMP, '.hidden'))
  fs.mkdirSync(path.join(TMP, 'node_modules'))
  fs.mkdirSync(path.join(TMP, '.git'))
  fs.writeFileSync(path.join(TMP, '.env'), 'x')
  const names = listDirEntries(TMP).map((i) => i.name)
  assert.ok(!names.includes('.hidden'))
  assert.ok(!names.includes('node_modules'))
  assert.ok(!names.includes('.git'))
  assert.ok(!names.includes('.env'))
})

test('listDirEntries：目录不存在返回空数组', () => {
  assert.deepEqual(listDirEntries(path.join(TMP, 'not-exist')), [])
})

test('searchDirEntries：递归子目录、子串匹配、浅层优先', () => {
  fs.mkdirSync(path.join(TMP, 'src/utils'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'index.js'), 'x')
  fs.writeFileSync(path.join(TMP, 'src', 'utils', 'index.js'), 'x')
  fs.writeFileSync(path.join(TMP, 'src', 'utils', 'other.js'), 'x')

  const hits = searchDirEntries(TMP, 'index')
  assert.deepEqual(hits.map((h) => h.name), ['index.js', 'src/utils/index.js'])

  // 深度 8 层内可命中
  const deep = searchDirEntries(TMP, 'other')
  assert.equal(deep.length, 1)
  assert.equal(deep[0].name, 'src/utils/other.js')
})

test('searchDirEntries：跳过 node_modules 与隐藏目录', () => {
  fs.mkdirSync(path.join(TMP, 'node_modules/pkg'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'node_modules', 'pkg', 'index.js'), 'x')
  const hits = searchDirEntries(TMP, 'index')
  assert.ok(hits.every((h) => !h.name.startsWith('node_modules')))
})

test('searchDirEntries：空关键词返回空', () => {
  assert.deepEqual(searchDirEntries(TMP, ''), [])
})

test('shortenPath：家目录替换为 ~', () => {
  assert.equal(shortenPath(os.homedir() + '/x/y'), '~/x/y')
  assert.equal(shortenPath('/usr/local'), '/usr/local')
})

afterEach(() => {})
