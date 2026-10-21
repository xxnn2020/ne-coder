import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-context-'))
process.chdir(TMP)

const { globToRegExp, expandFileRefs } = await import('../src/utils/contextUtils.js')

test('globToRegExp：双星跨目录匹配', () => {
  const re = globToRegExp('**/*.css')
  assert.ok(re.test('style.css'))
  assert.ok(re.test('src/a/b/style.css'))
  assert.ok(!re.test('style.less'))
})

test('globToRegExp：单星不跨目录', () => {
  const re = globToRegExp('src/*.js')
  assert.ok(re.test('src/index.js'))
  assert.ok(!re.test('src/utils/index.js'))
})

test('globToRegExp：特殊字符转义', () => {
  const re = globToRegExp('a.b(c).txt')
  assert.ok(re.test('a.b(c).txt'))
  assert.ok(!re.test('axbxc.txt'))
})

test('expandFileRefs：文件内容包装为 file 标签', () => {
  fs.writeFileSync(path.join(TMP, 'demo.txt'), '内容ABC')
  const out = expandFileRefs('看看 @demo.txt', TMP)
  assert.ok(out.includes('<file path="demo.txt">'))
  assert.ok(out.includes('内容ABC'))
  assert.ok(!out.includes('@demo.txt'))
})

test('expandFileRefs：不存在的路径保留原样', () => {
  const out = expandFileRefs('看看 @no-such.txt', TMP)
  assert.ok(out.includes('@no-such.txt'))
})

test('expandFileRefs：无 @ 引用原样返回', () => {
  assert.equal(expandFileRefs('普通问题', TMP), '普通问题')
})
