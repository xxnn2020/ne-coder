import { exec, execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { tool } from "langchain"
import { z } from "zod"

// 输出与超时限制，防止命令卡死或结果过长
const TIMEOUT_MS = 30_000
const MAX_OUTPUT = 4000

const IS_WIN = process.platform === "win32"

/**
 * Windows 下探测 bash（优先 Git Bash 常见安装路径，再查 PATH），找不到返回 null
 */
function findWindowsBash() {
    const candidates = [
        process.env.ProgramFiles && process.env.ProgramFiles + "\\Git\\bin\\bash.exe",
        process.env.ProgramFiles && process.env.ProgramFiles + "\\Git\\usr\\bin\\bash.exe",
        process.env["ProgramFiles(x86)"] && process.env["ProgramFiles(x86)"] + "\\Git\\bin\\bash.exe",
        "C:\\Program Files\\Git\\bin\\bash.exe"
    ].filter(Boolean);
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    try {
        const found = execSync("where bash", { encoding: "utf8", timeout: 3000 })
            .split("\n")[0]
            .trim();
        if (found) return found;
    } catch {}
    return null;
}

/**
 * 按平台选择执行 shell：
 *   Linux / macOS → bash（取环境变量 SHELL，默认 /bin/bash）
 *   Windows       → 优先 Git Bash；未安装则回退 PowerShell
 */
const SHELL_CONFIG = (() => {
    if (!IS_WIN) {
        return { shell: process.env.SHELL || "/bin/bash", name: "bash", syntax: "bash" };
    }
    const bashPath = findWindowsBash();
    if (bashPath) {
        return { shell: bashPath, name: "bash", syntax: "bash" };
    }
    return { shell: "powershell.exe", name: "shell", syntax: "PowerShell" };
})();

/**
 * 执行脚本命令，返回标准输出/错误信息
 */
const bash = tool(
    ({ script }) =>
        new Promise((resolve) => {
            exec(
                script,
                {
                    shell: SHELL_CONFIG.shell,
                    timeout: TIMEOUT_MS,
                    maxBuffer: 1024 * 1024,
                    cwd: process.cwd(),
                    // Windows 下 PowerShell 输出为 GBK 等编码时尽量正常解码
                    ...(IS_WIN ? { windowsHide: true } : {})
                },
                (error, stdout, stderr) => {
                    if (error) {
                        const reason = String(stderr || error.message).slice(0, MAX_OUTPUT);
                        resolve(`执行失败（退出码 ${error.code ?? "?"}）：\n${reason}`);
                    } else {
                        resolve(String(stdout || "（无输出）").slice(0, MAX_OUTPUT));
                    }
                }
            );
        }),
    {
        name: SHELL_CONFIG.name,
        description: `在当前工作目录执行 ${SHELL_CONFIG.syntax} 脚本命令（当前系统：${process.platform}），返回命令的标准输出或错误信息`,
        schema: z.object({
            script: z.string().describe(`要执行的 ${SHELL_CONFIG.syntax} 命令或脚本`)
        })
    }
);

export default bash;
