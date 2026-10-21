import { tool } from "langchain"
import { z } from "zod"

// 请求超时与响应截断限制
const TIMEOUT_MS = 15_000
const MAX_BODY = 5000

const fetchTool = tool(
    async ({ url, body }) => {
        if (!/^https?:\/\//i.test(url)) {
            return "请求失败：仅支持 http/https 地址";
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: body ? "POST" : "GET",
                headers: body ? { "Content-Type": "application/json" } : undefined,
                body: body || undefined,
                signal: controller.signal
            });
            const text = (await res.text()).slice(0, MAX_BODY);
            const truncated = text.length >= MAX_BODY ? `\n…（正文已达 ${MAX_BODY} 字符上限，已截断）` : "";
            return `HTTP ${res.status} ${res.statusText}\nContent-Type: ${res.headers.get("content-type") || "未知"}\n\n${text}${truncated}`;
        } catch (err) {
            const reason = err.name === "AbortError" ? `超时（${TIMEOUT_MS / 1000} 秒）` : err.message;
            return `请求失败：${reason}`;
        } finally {
            clearTimeout(timer);
        }
    },
    {
        name: "fetch",
        description:
            "发起 HTTP 请求获取网页或接口内容：默认 GET，传入 body 时为 POST（JSON）；返回状态码与正文（15 秒超时，正文截断）",
        schema: z.object({
            url: z.string().describe("请求地址，http/https"),
            body: z.string().optional().describe("POST 请求的 JSON 字符串请求体，不传则为 GET")
        })
    }
);

export default fetchTool
