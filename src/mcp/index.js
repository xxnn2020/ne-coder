import localMCPClient from "./local/index.js";
import remoteMCPClient from "./remote/index.js";

/**
 * 获取全部 MCP 工具（langchain tool 实例）：远程 MCP + 本地注册工具
 * 远程服务器连接失败时降级为仅本地工具
 */
export async function getMcpTools() {
    let localTools = [],
        remoteTools = [],
        tools = [];
    try {
        localTools = await localMCPClient.listTools();
    } catch {}
    try {
        remoteTools = await remoteMCPClient.listTools();
    } catch {}
    tools = [...remoteTools, ...localTools];
    return tools;
}

/**
 * 工具描述列表（展示用）
 */
export async function listMcpTools() {
    const tools = await getMcpTools();
    return tools.map(tool => ({ name: tool.name, description: tool.description }));
}
