import {
    listModels,
    listEmbeddingModels,
    switchModel,
    switchEmbeddingModel,
    getConfig,
    SETTING_FIELDS,
} from "../utils/llm.js"
import { log, COLORS } from "../utils/logUtils.js"
import { promptUser } from "../mcp/local/askUser/index.js"

/**
 * 渲染模型列表（带编号与生效标记）
 */
function renderList(title, models) {
    if (!models.length) return
    log(`  ${title}：`, { bold: true })
    models.forEach((m, i) => {
        log([
            { text: m.active ? "  ● " : "    ", color: m.active ? COLORS.GREEN : COLORS.GRAY },
            { text: `${i + 1}. `, color: COLORS.CYAN },
            { text: `${m.model}`, bold: m.active },
            ...(m.baseURL ? [{ text: `  ${m.baseURL.replace(/^https?:\/\//, "")}`, color: COLORS.GRAY }] : []),
        ])
    })
}

/**
 * /model 指令：查看与热切换对话/embedding 模型
 *   /model                交互选择（对话模型 → embedding 模型，回车跳过）
 *   /model <ID或编号>      切换对话模型
 *   /model -e <ID或编号>   切换 embedding 模型
 */
export default {
    name: "/model",
    desc: "查看/切换模型（-e 切 embedding）",
    // 中断类型：切换后本行剩余内容不发给大模型
    interrupt: true,
    /**
     * @param {string} restText 指令后的参数
     * @returns {{ok: boolean}}
     */
    async execute(restText = "") {
        const args = restText.trim().split(/\s+/).filter(Boolean)
        log("  ● 模型", { color: COLORS.MAGENTA, bold: true })

        // 参数式切换：/model <ID|编号> 或 /model -e <ID|编号>
        if (args.length > 0) {
            const isEmbedding = args[0] === "-e" || args[0] === "--embedding"
            const selector = isEmbedding ? args[1] : args[0]
            if (!selector) {
                log("  ✖ 缺少模型参数，用法：/model <ID或编号> 或 /model -e <ID或编号>", { color: COLORS.RED })
                log()
                return { ok: false }
            }
            try {
                if (isEmbedding) {
                    const model = switchEmbeddingModel(selector)
                    log(`  ✅ 已切换 embedding 模型：${model}`, { color: COLORS.GREEN })
                    log("  ⚠ 既有向量库需重新执行 /vector 重建（向量空间已变化）", { color: COLORS.YELLOW })
                } else {
                    const model = switchModel(selector)
                    log(`  ✅ 已切换模型：${model}，下一轮对话生效`, { color: COLORS.GREEN })
                }
                log()
                return { ok: true }
            } catch (err) {
                log(`  ✖ ${err.message}`, { color: COLORS.RED })
                log()
                return { ok: false, error: err.message }
            }
        }

        // 无参数：列出两段列表；交互终端逐段选择
        const chatModels = listModels()
        const embedModels = listEmbeddingModels()
        const config = getConfig()

        renderList("对话模型", chatModels)
        if (!chatModels.length) {
            log(`  当前：${config[SETTING_FIELDS.model]}（未配置 models 列表）`, { color: COLORS.GRAY })
        }
        renderList("Embedding 模型", embedModels)
        if (!embedModels.length) {
            log(`  当前：${config[SETTING_FIELDS.embeddingModel] || "text-embedding-v4"}（未配置 embeddingModels 列表）`, { color: COLORS.GRAY })
        }
        log(`  配置示例："models": [{ "model": "qwen3.6-flash" }]、"embeddingModels": [{ "model": "text-embedding-v4" }]`, { color: COLORS.GRAY })

        const pick = async (label, models, switcher) => {
            if (!models.length) return
            const answer = await promptUser(`  选择${label}（编号/ID，回车跳过）: `)
            if (!answer) return
            try {
                const model = switcher(answer)
                log(`  ✅ ${label}已切换：${model}`, { color: COLORS.GREEN })
                if (label === "Embedding 模型") {
                    log("  ⚠ 既有向量库需重新执行 /vector 重建", { color: COLORS.YELLOW })
                }
            } catch (err) {
                log(`  ✖ ${err.message}`, { color: COLORS.RED })
            }
        }

        if (chatModels.length || embedModels.length) {
            await pick("对话模型", chatModels, switchModel)
            await pick("Embedding 模型", embedModels, switchEmbeddingModel)
        }
        log()
        return { ok: true }
    },
}
