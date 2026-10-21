# ne-coder — AI 终端编程助手

一个运行在终端上的 AI 助手工具，类似 Claude Code、Codex、Trae 等 Agent 工具，旨在通过终端界面辅助用户进行软件开发。

## 项目简介

本项目是一个基于 Node.js 开发的 AI 终端应用，运行后可在终端启动一个对话界面，辅助用户进行开发工作。支持与大模型对话、本地文件操作、文档向量化检索（RAG）、会话管理与记忆系统、危险操作防护等功能。

## 技术栈

- **运行环境**：Node.js (ESModule 规范)
- **大模型接口**：OpenAI 兼容接口（支持百炼/DashScope、OpenAI 等兼容端点）
- **核心依赖**：
  - `openai` / `@langchain/openai`：大模型对话
  - `@langchain/langgraph`：Agent 代理与会话管理
  - `@langchain/langgraph-checkpoint-sqlite`：会话状态持久化（SqliteSaver）
  - `@langchain/community`、`@langchain/textsplitters`：文档加载与分块
  - `hnswlib-node`：向量存储（RAG 检索）
  - `chalk`：终端颜色输出
  - `ora`：加载动画（已替换为自研轻量 spinner）
  - `xlsx`：Excel 导出支持

## 快速开始

### 1. 安装依赖

```bash
cd ne-coder
npm install
```

### 2. 配置模型密钥

在项目根目录创建 `.coder/setting.json`（或在用户主目录 `~/.coder/setting.json`）：

```json
{
  "OPENAI_API_KEY": "你的API密钥",
  "OPENAI_BASE_URL": "https://api.openai.com/v1",
  "OPENAI_MODEL": "gpt-4o-mini",
  "OPENAI_EMBEDDING_MODEL": "text-embedding-v4"
}
```

> **优先级**：当前终端目录下的 `.coder/setting.json` 优先于用户主目录下的 `~/.coder/setting.json`。

### 3. 启动应用

```bash
npm start
```

或

```bash
node src/index.js
```

启动后终端会展示对话界面：

```
   ██    ████    ██████    ████   ██████   ███████ ██████  
  ████    ██    ██    ██  ██  ██  ██    ██ ██      ██    ██
 ██  ██   ██    ██       ██    ██ ██    ██ ██████  ██    ██
████████  ██    ██       ██    ██ ██    ██ ██      ██████  
██    ██  ██    ██    ██  ██  ██  ██    ██ ██      ██    ██
██    ██ ████    ██████    ████   ██████   ███████ ██    ██

  ✨ AI 终端助手  v1.0.0

  ╭──────────────────────────────────────────────────────╮
  │  模型  qwen3.7-plus                                  │
  │  端点  dashscope.aliyuncs.com                        │
  │  配置  ~/Documents/neoy/AI-Coding/ne-coder/.coder/…  │
  │  目录  ~/Documents/neoy/AI-Coding/ne-coder           │
  ╰──────────────────────────────────────────────────────╯

  /help 查看命令  ·  /clear 清屏  ·  /exit 退出


❯ 
```

## 命令参考

在交互界面中输入以下命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清屏 |
| `/exit` / `/quit` | 退出程序 |
| `/help` | 查看可用命令 |
| `/model` | 查看/切换对话模型（交互式选择） |
| `/model <名称>` | 直接切换到指定模型 |
| `/model -e <名称>` | 切换 embedding 模型 |
| `/summary` | 总结当前会话 |
| `/clear` | 清屏 |
| `/exit` | 退出程序 |

### 模型相关命令

```
# 查看当前可用模型列表
/model

# 切换模型（按编号或模型名）
/model 2
/model qwen3.7-plus

# 切换 embedding 模型
/model -e text-embedding-v4
```

### 会话记忆命令

```
/memory     # 获取当前会话的记忆摘要
```

### 对话导出命令

```
/export           # 导出 JSON 格式（默认）
/export json      # 导出 JSON 格式
/export excel     # 导出 Excel 格式
```

导出的文件保存在 `.coder/export/` 目录下，文件名为 `coder_export_<时间戳>.<扩展名>`。

## 可用工具

coder 提供以下本地工具，模型会根据需要自动调用：

| 工具 | 说明 |
|------|------|
| `readFile` | 读取指定文件内容（支持行范围） |
| `writeFile` | 写入文件（自动创建目录） |
| `editFile` | 精确修改文件（支持 diff 预览与确认） |
| `bash` | 执行终端命令（跨平台支持 Bash/PowerShell） |
| `grep` | 在文件中搜索关键词/正则 |
| `globFile` | 按通配符查找文件 |
| `fetch` | 发起 HTTP 请求 |
| `loadSkill` | 加载技能文件 |

### 安全防护

系统内置危险操作防护墙，对以下操作会进行确认提示：
- `rm -rf`、`rm -f` 等删除操作
- `sudo` 提权命令
- `git push -f`、`git reset --hard` 等危险 Git 操作
- `curl | sh` 等下载执行脚本
- 文件删除操作

可通过 `setting.json` 的 `PERMISSION_MODE` 设置：
- `confirm`（默认）：高危操作需用户确认
- `yolo`：全部自动执行（不推荐生产环境使用）

## 配置详解

### `.coder/setting.json` 示例

```json
{
  "OPENAI_API_KEY": "sk-xxx",
  "OPENAI_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "OPENAI_MODEL": "qwen-flash",
  "OPENAI_EMBEDDING_MODEL": "text-embedding-v4",
  "models": [
    { "model": "qwen3.6-flash" },
    { "model": "qwen3.7-plus" },
    { "model": "gpt-4o-mini", "apiKey": "sk-...", "baseURL": "https://api.openai.com/v1" }
  ],
  "embeddingModels": [
    { "model": "text-embedding-v4" },
    { "model": "text-embedding-v3" }
  ],
  "PERMISSION_MODE": "confirm",
  "RAG_QUERY_REWRITE": true,
  "RAG_MAX_SCORE": 0.65,
  "MEMORY_AUTO_INTERVAL": 20
}
```

### 配置项说明

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | 大模型 API 密钥 | 必填 |
| `OPENAI_BASE_URL` | API 端点地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 对话模型名称 | `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | 嵌入模型名称 | `text-embedding-v4` |
| `models` | 可选对话模型列表（热切换用） | `[]` |
| `embeddingModels` | 可选嵌入模型列表 | `[]` |
| `PERMISSION_MODE` | 危险操作确认模式（confirm/yolo） | `confirm` |
| `RAG_QUERY_REWRITE` | 是否启用查询改写 | `true` |
| `RAG_MAX_SCORE` | 向量检索相似度阈值 | `0.65` |
| `MEMORY_AUTO_INTERVAL` | 自动记忆提炼轮数间隔（0 关闭） | `20` |

## 目录结构

```
ne-coder/
├── .coder/                 # 配置目录（项目级）
│   ├── setting.json        # 配置文件
│   ├── db/
│   │   └── coder.sqlite    # 会话 checkpoint 与记忆元数据
│   ├── vector-store/       # 向量存储目录
│   │   ├── hnswlib.index
│   │   ├── docstore.json
│   │   ├── args.json
│   │   └── vector-manifest.json
│   ├── export/             # 会话导出目录
│   │   └── coder_export_*.json/xlsx/xml
│   ├── commands/           # 自定义指令目录（*.md → /命令名）
│   ├── docs/               # 项目文档目录（RAG 检索源）
│   ├── rules/              # 规则文件目录（@文件匹配）
│   └── skills/             # 技能目录（每个子目录含 SKILL.md）
├── src/
│   ├── index.js            # 项目入口文件
│   ├── commands/           # 内置指令（/help, /clear, /exit 等）
│   ├── utils/              # 工具函数
│   │   ├── llm.js          # 大模型调用封装
│   │   ├── fileUtils.js    # 文件工具
│   │   ├── historyUtils.js # 会话历史工具
│   │   ├── mathUtils.js    # 数学工具
│   │   ├── fileUtils.js    # 文件工具
│   │   ├── llm.js          # 大模型调用
│   │   ├── mcpUtils.js     # MCP 工具
│   │   ├── mathUtils.js    # 数学工具
│   │   └── ...
│   └── mcp/                # MCP 工具
│       ├── local/          # 本地工具
│       │   ├── index.js    # 本地工具入口
│       │   ├── askUser/    # 交互式问询工具
│       │   ├── bash/       # 终端命令执行
│       │   ├── readFile/   # 文件读取
│       │   ├── writeFile/  # 文件写入
│       │   ├── editFile/   # 文件编辑（带 diff 预览）
│       │   ├── moveFile/   # 文件移动
│       │   ├── deleteFile/ # 文件删除
│       │   ├── grep/       # 文件内容搜索
│       │   ├── globFile/   # 文件查找
│       │   ├── fetch/      # HTTP 请求
│       │   └── loadSkill/  # 技能加载
│       └── remote/         # 远程 MCP 服务器
├── package.json
├── package-lock.json
└── README.md
```

## 开发规范

1. **ESModule 规范**：项目使用 ESModule，不使用 CommonJS
2. **JavaScript**：项目采用 JavaScript 开发，不使用 TypeScript
3. **依赖检查**：启动后扫描 `package.json` 中的包是否安装，没有则提示安装
4. **代码提交**：每次执行新需求时，先询问是否需要代码提交；如果需要，先把上一次的需求总结，然后做 git commit，不需要推送到远程

## 主要功能说明

### 对话交互

启动后进入终端对话界面，输入问题即可与大模型对话。支持多轮对话，模型会记住上下文。

### 内置指令

| 指令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清屏 |
| `/exit` | 退出程序 |
| `/model` | 查看/切换模型 |
| `/summary` | 总结当前会话 |
| `/memory` | 提炼会话为长期记忆 |
| `/export` | 导出会话（json/excel/xml） |
| `/undo` | 撤销最近一轮文件修改 |
| `/history` | 查看历史会话列表 |

### 记忆系统

支持多类记忆存储（项目级 + 用户级），自动定期提炼对话内容为长期记忆，并在新会话中注入，实现跨会话记忆。

## 常见问题

### Q：启动后提示未设置 OPENAI_API_KEY？

A：请在 `.coder/setting.json` 中配置 `OPENAI_API_KEY`，或使用环境变量。

### 文件读取失败？

A：确保文件路径正确，且在项目根目录或用户设置目录下。

### 向量检索不生效？

A：先执行 `/vector` 对文档进行向量化，确保 `.coder/vector-store/` 目录下有索引文件。

## 许可证

MIT License

---

**ne-coder** - 在终端里与 AI 对话，辅助你的开发工作。
