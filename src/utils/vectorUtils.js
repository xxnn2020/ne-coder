import crypto from 'node:crypto'
import path from 'node:path'
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { OpenAIEmbeddings } from '@langchain/openai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import XLSX from 'xlsx'
import { loadConfig, SETTING_FIELDS } from './llm.js'
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir } from './fileUtils.js'
import { log, COLORS } from './logUtils.js'

// HNSWLib 懒加载：hnswlib-node 是可选依赖（原生模块，编译失败不阻塞安装），
// 缺失时向量功能禁用，其余功能不受影响
let HNSWLibClass = null
let hnswlibLoadFailed = false

/**
 * 动态加载 HNSWLib；hnswlib-node 未安装/加载失败时返回 null（仅首次失败打印提示）
 */
async function getHNSWLibClass() {
  if (HNSWLibClass) return HNSWLibClass
  if (hnswlibLoadFailed) return null
  try {
    const mod = await import('@langchain/community/vectorstores/hnswlib')
    HNSWLibClass = mod.HNSWLib
    return HNSWLibClass
  } catch {
    hnswlibLoadFailed = true
    log('  ⚠ 向量功能不可用（hnswlib-node 安装失败）。如需 RAG 检索，请手动安装：npm install hnswlib-node', { color: COLORS.GRAY })
    return null
  }
}

// 支持的文档格式
export const SUPPORTED_EXTS = ['.txt', '.pdf', '.docx', '.xlsx', '.md']

// 分块参数：每段 1000 字，冗余 100 字
const CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 100

/**
 * 按文档位置归属确定存储目录：
 *   项目目录下的文档 → <项目>/.coder/vector-store/
 *   用户设置目录下的文档 → <用户设置目录>/.coder/vector-store/
 * manifest（vector-manifest.json）与库同目录
 */
function storeDirFor(file) {
  const projectDir = getCurrentTerminalDir()
  const userDir = getUserSettingsDir()
  if (file.startsWith(projectDir + path.sep) || file === projectDir) {
    return path.join(getCoderConfigDir(projectDir), 'vector-store')
  }
  if (file.startsWith(userDir + path.sep) || file === userDir) {
    return path.join(getCoderConfigDir(userDir), 'vector-store')
  }
  // 两个目录之外的路径默认归项目库（当前工作域）
  return path.join(getCoderConfigDir(projectDir), 'vector-store')
}

/**
 * 递归收集目录下支持格式的文档文件（跳过隐藏文件与 node_modules）
 */
function collectDocFiles(dir, base = dir) {
  const files = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectDocFiles(full, base))
    } else if (SUPPORTED_EXTS.includes(path.extname(entry.name).toLowerCase())) {
      files.push(full)
    }
  }
  return files
}

/**
 * 解析单个文档为纯文本：txt/md 直接读取，pdf/docx 用 langchain loader，xlsx 用 SheetJS
 */
async function parseDocument(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.txt' || ext === '.md') {
    return readFileSync(file, 'utf8')
  }
  if (ext === '.pdf') {
    const docs = await new PDFLoader(file).load()
    return docs.map((d) => d.pageContent).join('\n')
  }
  if (ext === '.docx') {
    const docs = await new DocxLoader(file).load()
    return docs.map((d) => d.pageContent).join('\n')
  }
  if (ext === '.xlsx') {
    const wb = XLSX.readFile(file)
    return wb.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
      return `# 工作表: ${name}\n${csv}`
    }).join('\n\n')
  }
  throw new Error(`不支持的格式 ${ext}`)
}

/**
 * 文件内容 md5（原始字节）
 */
function md5Of(file) {
  return crypto.createHash('md5').update(readFileSync(file)).digest('hex')
}

/**
 * 读取/写入向量化清单，与向量库同目录
 * 结构：{ files: { 文件路径: md5 }, chunks: 库内块总数 }
 * chunks 缺失（旧格式或异常状态）时触发全量重建自愈
 */
function readManifest(manifestFile) {
  try {
    const raw = JSON.parse(readFileSync(manifestFile, 'utf8'))
    if (raw && typeof raw.files === 'object') return raw
    // 旧格式（flat 的 路径→md5）迁移为 { files }，chunks 缺失将触发自愈重建
    return { files: raw || {}, chunks: undefined }
  } catch {
    return { files: {}, chunks: undefined }
  }
}
function writeManifest(manifestFile, manifest) {
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
}

/**
 * 获取向量模型（复用 setting.json 的密钥与端点）
 */
function getEmbeddings() {
  const config = loadConfig()
  const apiKey = config?.[SETTING_FIELDS.apiKey]
  if (!apiKey) {
    throw new Error(`配置文件缺少 ${SETTING_FIELDS.apiKey} 字段，无法调用向量模型`)
  }
  return new OpenAIEmbeddings({
    model: config[SETTING_FIELDS.embeddingModel] || 'text-embedding-v4',
    apiKey,
    // DashScope text-embedding-v4 单批上限 10 条
    batchSize: 10,
    configuration: { baseURL: config[SETTING_FIELDS.baseURL] || undefined },
  })
}

/**
 * 文档文本分块
 */
async function splitText(text, source) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  })
  // 1.x 的 splitText 返回 Promise
  const chunks = await splitter.splitText(text)
  return chunks.map(
    (chunk) =>
      new Document({
        pageContent: chunk,
        metadata: { source },
      })
  )
}

/**
 * 解析 @路径 参数为绝对路径列表（目录递归收集、仅保留支持格式）
 * 返回 { files, unsupported }：unsupported 为格式不满足的目标
 */
export function resolveTargets(atPaths) {
  const files = []
  const unsupported = []
  for (const p of atPaths) {
    const full = path.resolve(getCurrentTerminalDir(), p)
    let stat
    try {
      stat = statSync(full)
    } catch {
      unsupported.push(`${p}（不存在）`)
      continue
    }
    if (stat.isDirectory()) {
      const collected = collectDocFiles(full)
      if (collected.length === 0) {
        unsupported.push(`${p}（目录下无支持格式的文档）`)
      } else {
        files.push(...collected)
      }
    } else if (SUPPORTED_EXTS.includes(path.extname(full).toLowerCase())) {
      files.push(full)
    } else {
      unsupported.push(`${p}（格式不支持，仅支持 ${SUPPORTED_EXTS.join('/')}）`)
    }
  }
  return { files: [...new Set(files)], unsupported }
}

/**
 * 默认文档源：当前项目与用户设置目录下的 .coder/docs，
 * 外加历史清单（@ 模式曾向量化过、可能位于 docs 目录之外）中仍存在于磁盘的文件，
 * 避免全量执行时把它们误判为"已删除"
 */
export function defaultDocFiles() {
  const docFiles = [
    ...collectDocFiles(path.join(getCoderConfigDir(getCurrentTerminalDir()), 'docs')),
    ...collectDocFiles(path.join(getCoderConfigDir(getUserSettingsDir()), 'docs')),
  ]
  for (const base of [getCurrentTerminalDir(), getUserSettingsDir()]) {
    const manifestFile = path.join(getCoderConfigDir(base), 'vector-store', 'vector-manifest.json')
    const { files } = readManifest(manifestFile)
    for (const file of Object.keys(files)) {
      if (existsSync(file) && !docFiles.includes(file)) {
        docFiles.push(file)
      }
    }
  }
  return [...new Set(docFiles)]
}

/**
 * 向量化存储主流程：按文档归属（项目/用户设置目录）分组，各组独立存储
 * @param {string[]} files 本次待处理的文件绝对路径列表
 * @param {boolean} fullScan 是否全量扫描模式（决定是否检测已删除的文件）
 * @returns {Promise<{added: string[], modified: string[], skipped: string[], deleted: string[], chunks: number}>}
 */
export async function vectorizeFiles(files, { fullScan = false } = {}) {
  // 按存储域分组
  const groups = new Map()
  for (const file of files) {
    const dir = storeDirFor(file)
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push(file)
  }

  // 各组独立执行（独立 manifest、独立库、独立重建判断），结果汇总
  const summary = { added: [], modified: [], skipped: [], deleted: [], chunks: 0 }
  for (const [storeDir, groupFiles] of groups) {
    const result = await vectorizeGroup(storeDir, groupFiles, fullScan)
    summary.added.push(...result.added)
    summary.modified.push(...result.modified)
    summary.skipped.push(...result.skipped)
    summary.deleted.push(...result.deleted)
    summary.chunks += result.chunks
  }
  return summary
}

/**
 * 单个存储域的向量化：manifest 与库都在 storeDir 下
 */
async function vectorizeGroup(storeDir, files, fullScan) {
  const manifestFile = path.join(storeDir, 'vector-manifest.json')
  const { files: manifest, chunks: recordedChunks } = readManifest(manifestFile)
  const added = []
  const modified = []
  const skipped = []

  for (const file of files) {
    const md5 = md5Of(file)
    const prev = manifest[file]
    if (!prev) {
      added.push(file)
    } else if (prev !== md5) {
      modified.push(file)
    } else {
      skipped.push(file)
    }
  }

  // 全量模式下检测清单中已不存在（被删除/移走）的文件
  const deleted = fullScan ? Object.keys(manifest).filter((f) => !files.includes(f)) : []
  // chunks 缺失说明库与清单可能不同步（旧格式/历史异常），强制全量重建自愈
  const needWork =
    added.length > 0 ||
    modified.length > 0 ||
    deleted.length > 0 ||
    typeof recordedChunks !== 'number' ||
    !existsSync(storeDir)

  if (!needWork) {
    return { added, modified, skipped, deleted, chunks: 0 }
  }

  const embeddings = getEmbeddings()
  const HNSWLib = await getHNSWLibClass()
  if (!HNSWLib) {
    throw new Error('向量功能不可用（hnswlib-node 安装失败），请先手动安装：npm install hnswlib-node')
  }

  // 统一全量重建：HNSWLib 无法按条删除旧向量，且增量 addDocuments 后 save
  // 存在落盘丢失新向量的问题，全量重建保证磁盘数据与文档始终一致
  let chunkCount = 0
  const allDocs = []
  for (const file of files) {
    const text = await parseDocument(file)
    const docs = await splitText(text, file)
    chunkCount += docs.length
    allDocs.push(...docs)
    log(`  解析 ${path.basename(file)}（${docs.length} 段）`, { color: COLORS.GRAY })
  }

  const store = await HNSWLib.fromDocuments(allDocs, embeddings, {
    dbConfig: { space: 'cosine' },
  })
  await store.save(storeDir)
  // 库已更新，清除检索侧的实例缓存，确保后续对话能搜到新数据
  storeCache.delete(storeDir)

  // 更新清单（记录块数，供下次判断库与清单是否同步）
  for (const file of added) manifest[file] = md5Of(file)
  for (const file of modified) manifest[file] = md5Of(file)
  for (const file of deleted) delete manifest[file]
  writeManifest(manifestFile, { files: manifest, chunks: chunkCount })

  return { added, modified, skipped, deleted, chunks: chunkCount }
}

/**
 * 清空两个存储域的向量库与清单（预留）
 */
export function resetVectorStore() {
  for (const base of [getCurrentTerminalDir(), getUserSettingsDir()]) {
    rmSync(path.join(getCoderConfigDir(base), 'vector-store'), { recursive: true, force: true })
  }
}


// 向量库实例缓存（会话内避免重复加载索引）
const storeCache = new Map()

/**
 * 清空向量库实例缓存：切换 embedding 模型后调用，
 * 旧实例绑定的旧模型会导致向量空间不一致
 */
export function invalidateStoreCache() {
  storeCache.clear()
}

/**
 * 关键词通道：在库的内存文档块（docstore._docs 为 Map）中做子串匹配
 * 命中关键词越多分越高；专有名词/精确词由该通道保障
 * 不调用 embedding，可用作向量接口失败时的降级检索
 */
function keywordSearch(store, terms) {
  const docs = store.docstore?._docs
  if (!(docs && typeof docs.values === 'function')) return []
  const keywords = terms.filter((t) => t && t.length >= 2)
  if (!keywords.length) return []

  const hits = []
  for (const doc of docs.values()) {
    const text = String(doc.pageContent || '')
    let matched = 0
    for (const kw of keywords) {
      if (text.includes(kw)) matched++
    }
    if (matched > 0) {
      hits.push({ content: doc.pageContent, source: doc.metadata?.source || '', score: matched })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}

/**
 * 在两个向量存储域（项目/用户）中混合检索与问题相关的文档块：
 *   向量通道（语义）+ 关键词通道（精确词），RRF 融合排名
 * 自适应截断：无关键词命中且向量 top1 距离 > 0.7（明显无关）时视为无相关内容
 * @param {string} query 检索问题（或关键词串）
 * @param {object} [options] topK 结果条数；maxScore 向量召回阈值（cosine 距离，默认 0.65 宽松召回）
 * @returns {Promise<{hits: Array<{content, source, score}>, degraded: boolean}>}
 *   degraded=true 表示向量接口失败、结果来自纯关键词降级
 */
export async function searchVectorStores(query, { topK = 4, maxScore = 0.65 } = {}) {
  const empty = { hits: [], degraded: false }
  if (!query || !query.trim()) return empty

  const terms = query.trim().split(/\s+/)
  const candidates = [] // 各通道候选（channel 标记 + 通道内原始分）
  let degraded = false
  let vectorFailed = false

  // hnswlib-node 不可用时检索整体禁用（buildRagContext 已有降级提示）
  const HNSWLib = await getHNSWLibClass()
  if (!HNSWLib) {
    return { hits: [], degraded: true }
  }

  for (const base of [getCurrentTerminalDir(), getUserSettingsDir()]) {
    const dir = path.join(getCoderConfigDir(base), 'vector-store')
    if (!existsSync(path.join(dir, 'hnswlib.index'))) continue
    try {
      let store = storeCache.get(dir)
      if (!store) {
        store = await HNSWLib.load(dir, getEmbeddings())
        storeCache.set(dir, store)
      }

      // 关键词通道（纯内存，总是执行）
      for (const hit of keywordSearch(store, terms).slice(0, topK * 2)) {
        candidates.push({ ...hit, channel: 'kw' })
      }

      // 向量通道（embedding 接口失败则标记降级，关键词结果仍返回）
      if (!vectorFailed) {
        const count = store.index?.getCurrentCount?.() ?? topK
        const k = Math.max(1, Math.min(topK * 2, count))
        const hits = await store.similaritySearchWithScore(query, k)
        for (const [doc, score] of hits) {
          if (score > maxScore) continue // 宽松召回阈值，相关性交给融合排名
          candidates.push({
            content: doc.pageContent,
            source: doc.metadata.source,
            score,
            channel: 'vec',
          })
        }
      }
    } catch (err) {
      if (err && (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 429)) {
        vectorFailed = true
        degraded = true
      }
      // 其他错误（索引损坏等）跳过该库
    }
  }

  if (candidates.length === 0) return { hits: [], degraded }

  // 各通道内部排名（向量按距离升序、关键词按命中数降序），跨通道以 内容标识 合并后 RRF 融合
  const idOf = (r) => r.source + '||' + String(r.content).slice(0, 64)
  const byVec = candidates.filter((r) => r.channel === 'vec').sort((a, b) => a.score - b.score)
  const byKw = candidates.filter((r) => r.channel === 'kw').sort((a, b) => b.score - a.score)

  const merged = new Map()
  const addRank = (list, key) => {
    list.forEach((item, i) => {
      const id = idOf(item)
      if (!merged.has(id)) merged.set(id, { ...item, vecRank: 0, kwRank: 0 })
      merged.get(id)[key] = i + 1
    })
  }
  addRank(byVec, 'vecRank')
  addRank(byKw, 'kwRank')

  const RRF_K = 60
  const fused = [...merged.values()].map((r) => ({
    ...r,
    rrf: (r.vecRank ? 1 / (RRF_K + r.vecRank) : 0) + (r.kwRank ? 1 / (RRF_K + r.kwRank) : 0),
  }))
  fused.sort((a, b) => b.rrf - a.rrf)

  // 自适应截断：有关键词命中时信任融合排名（宽松）；
  // 纯向量结果时用严格阈值（top1 距离 > 0.5 视为无相关内容，丢弃全部）
  if (byKw.length === 0 && byVec.length > 0 && byVec[0].score > 0.5) {
    return { hits: [], degraded }
  }

  const hits = fused.slice(0, topK).map((r) => ({
    content: r.content,
    source: r.source,
    score: r.score,
  }))
  return { hits, degraded }
}
