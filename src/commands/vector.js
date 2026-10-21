import path from "node:path"
import os from "node:os"
import {
    resolveTargets,
    defaultDocFiles,
    vectorizeFiles,
    SUPPORTED_EXTS,
} from "../utils/vectorUtils.js"
import { log, style, COLORS } from "../utils/logUtils.js"
import { getUserSettingsDir } from "../utils/fileUtils.js"

/**
 * 路径展示：家目录替换为 ~
 */
function displayPath(file) {
    return file.startsWith(os.homedir()) ? "~" + file.slice(os.homedir().length) : file
}

/**
 * 渲染向量化结果报告
 */
function report(result) {
    const { added, modified, skipped, deleted, chunks } = result
    const list = (title, files, color) => {
        if (!files.length) return
        log(`  ${title}（${files.length}）：`, { color, bold: true })
        for (const f of files) {
            log(`    - ${displayPath(f)}`, { color: COLORS.GRAY })
        }
    }
    log("")
    list("新增", added, COLORS.GREEN)
    list("修改", modified, COLORS.YELLOW)
    list("删除", deleted, COLORS.RED)
    list("跳过（内容未变化）", skipped, COLORS.GRAY)
    log(`  共 ${added.length} 新增、${modified.length} 修改、${deleted.length} 删除、${skipped.length} 跳过${chunks ? `，生成 ${chunks} 个向量块` : ""}`)
}

const vector = {
    name: "/vector",
    desc: "文档向量化存储（txt/pdf/docx/xlsx/md）",
    // 中断类型：执行完不再把剩余文本发给大模型
    interrupt: true,
    /**
     * @param {string} restText 指令后的剩余文本，可含 @目录/@文件 指定向量化范围
     * @returns {{ok: boolean}}
     */
    async execute(restText = "") {
        const atPaths = (restText.match(/@(\S+)/g) || []).map((m) => m.slice(1))

        log("  ● 向量化", { color: COLORS.MAGENTA, bold: true })

        let files
        let fullScan = false
        if (atPaths.length > 0) {
            // 指定范围模式：仅处理 @目标，格式不满足则不执行
            const { files: targetFiles, unsupported } = resolveTargets(atPaths)
            if (unsupported.length > 0 && targetFiles.length === 0) {
                for (const u of unsupported) {
                    log(`  ✖ ${u}`, { color: COLORS.RED })
                }
                log(`  仅支持 ${SUPPORTED_EXTS.join(" / ")} 格式，未执行向量化`, { color: COLORS.GRAY })
                return { ok: false }
            }
            for (const u of unsupported) {
                log(`  ⚠ 已跳过 ${u}`, { color: COLORS.YELLOW })
            }
            files = targetFiles
        } else {
            // 默认模式：项目与用户设置目录下的 .coder/docs
            files = defaultDocFiles()
            fullScan = true
            if (files.length === 0) {
                log("  未找到可向量化的文档", { color: COLORS.YELLOW })
                log(`  文档目录：项目 .coder/docs 或 ${displayPath(getUserSettingsDir())}/.coder/docs，支持 ${SUPPORTED_EXTS.join(" / ")}`, { color: COLORS.GRAY })
                return { ok: false }
            }
        }

        log(`  待处理 ${files.length} 个文件，支持格式 ${SUPPORTED_EXTS.join("/")}`, { color: COLORS.GRAY })
        try {
            const result = await vectorizeFiles(files, { fullScan })
            report(result)
            log("")
            return { ok: true, ...result }
        } catch (err) {
            log(`  ✖ 向量化失败：${err.message}`, { color: COLORS.RED })
            log("")
            return { ok: false, error: err.message }
        }
    },
}

export default vector
