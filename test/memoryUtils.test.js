process.env.CODER_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-user-')) // 测试隔离：不读写真实用户数据
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-mem-'))
process.chdir(TMP) // 项目级记忆写入 <cwd>/.coder/db/

const { getMemory, upsertMemory, renderMemoryBlock, MEMORY_CATEGORIES } = await import(
  '../src/utils/memoryUtils.js'
)

beforeEach(() => {
  // 每个用例前清空项目库
  fs.rmSync(path.join(TMP, '.coder'), { recursive: true, force: true })
})

test('MEMORY_CATEGORIES：六类（项目三 + 用户三）', () => {
  assert.deepEqual(MEMORY_CATEGORIES.project, ['project_traits', 'project_history', 'project_pitfalls'])
  assert.deepEqual(MEMORY_CATEGORIES.user, ['user_preferences', 'user_skills', 'user_projects'])
})

test('getMemory：空库返回空对象', () => {
  assert.deepEqual(getMemory('project'), {})
})

test('upsertMemory + getMemory：写入与更新', () => {
  upsertMemory('project', 'project_traits', '- 特点1')
  assert.equal(getMemory('project').project_traits, '- 特点1')
  upsertMemory('project', 'project_traits', '- 特点1\n- 特点2')
  assert.ok(getMemory('project').project_traits.includes('特点2'))
})

test('项目级与用户级相互隔离', () => {
  upsertMemory('project', 'project_traits', '项目记忆')
  upsertMemory('user', 'user_preferences', '用户记忆')
  assert.deepEqual(getMemory('project'), { project_traits: '项目记忆' })
  assert.deepEqual(getMemory('user'), { user_preferences: '用户记忆' })
})

test('renderMemoryBlock：带分类标题渲染，空记忆返回空串', () => {
  assert.equal(renderMemoryBlock('project'), '')
  upsertMemory('project', 'project_pitfalls', '- 坑1')
  const block = renderMemoryBlock('project')
  assert.ok(block.includes('项目常见出错'))
  assert.ok(block.includes('- 坑1'))
})
