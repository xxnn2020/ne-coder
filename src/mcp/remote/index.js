import path from "node:path";
import { readFileSync } from "node:fs";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { getCurrentTerminalDir, getUserSettingsDir, getCoderConfigDir } from "../../utils/fileUtils.js";

/**
 * 读取指定目录 .coder/setting.json 中的 mcpServer 配置
 * 文件不存在或无 mcpServer 字段时返回空对象
 */
function readMcpServers(base) {
    try {
        const raw = readFileSync(path.join(getCoderConfigDir(base), "setting.json"), "utf8");
        const json = JSON.parse(raw);
        return json.mcpServer && typeof json.mcpServer === "object" ? json.mcpServer : {};
    } catch {
        return {};
    }
}

/**
 * 把配置项转换为 MCPAdapter 的 server 定义
 *   url 型     → http 传输（Streamable HTTP，可配 headers）
 *   command 型 → stdio
 * 注意 transport 合法值为 http / sse / stdio（adapter 的 zod schema 会校验）
 */
function toServerConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return null;
    if (cfg.url) {
        return {
            transport: cfg.transport || "http",
            url: cfg.url,
            ...(cfg.headers ? { headers: cfg.headers } : {})
        };
    }
    if (cfg.command) {
        return {
            transport: "stdio",
            command: cfg.command,
            ...(cfg.args ? { args: cfg.args } : {}),
            ...(cfg.env ? { env: cfg.env } : {})
        };
    }
    return null;
}

export function loadMcpServerConfig() {
    const merged = {
        ...readMcpServers(getUserSettingsDir()),
        ...readMcpServers(getCurrentTerminalDir())
    };
    const servers = {};
    for (const [name, cfg] of Object.entries(merged)) {
        const server = toServerConfig(cfg);
        if (server) servers[name] = server;
    }
    return servers;
}

class RemoteMCPClient {
    constructor() {
        this.servers = loadMcpServerConfig();
    }

    /**
     * 逐个服务器独立连接加载工具：单个服务器失败只跳过自身（stderr 告警），
     * 不影响其余服务器；各服务器并行连接
     */
    async listTools() {
        const entries = Object.entries(this.servers);
        if (entries.length === 0) return [];

        const results = await Promise.allSettled(
            entries.map(async ([name, server]) => {
                const adapter = new MCPAdapter({ servers: { [name]: server } });
                return await adapter.listTools();
            })
        );

        const tools = [];
        results.forEach((result, i) => {
            if (result.status === "fulfilled") {
                tools.push(...result.value);
            } else {
                const reason = String(result.reason?.message || result.reason).slice(0, 100);
                console.error(`[MCP] 服务器 ${entries[i][0]} 连接失败，已跳过：${reason}`);
            }
        });
        return tools;
    }
}

const remoteMCPClient = new RemoteMCPClient();
export default remoteMCPClient;
