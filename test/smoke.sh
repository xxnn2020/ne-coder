#!/bin/bash
# pty 冒烟测试：验证 coder 的核心交互链路（启动 → 对话 → 指令 → 退出）
# 用法：bash test/smoke.sh [项目根目录]（默认为脚本所在目录的上两级）
# 依赖：script 命令（macOS/Linux 自带）；需要已配置 .coder/setting.json
set -u

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
OUT=$(mktemp /tmp/coder-smoke-XXXXXX.txt)
PASS=0
FAIL=0

check() {
    local name="$1" cond="$2"
    if eval "$cond"; then
        echo "  ✓ $name"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $name"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== coder pty 冒烟测试 ==="

# 场景1：管道模式对话 + 指令 + 退出（无 pty 依赖，CI 可跑）
PIPE_OUT=$(printf '/help\n/exit\n' | node "$ROOT/src/index.js" 2>&1)
check "help 指令渲染" "echo \"\$PIPE_OUT\" | grep -q '可用命令'"
check "正常退出" "echo \"\$PIPE_OUT\" | grep -q '再见'"

# 场景2：pty 模式启动 + / 补全列表 + /exit 逐字输入退出
(sleep 2; printf '/'; sleep 1; printf '\033'; sleep 0.5; printf '\x7f/exit\r'; sleep 3) |
    script -q /dev/null node "$ROOT/src/index.js" > "$OUT" 2>&1
check "pty 启动 banner" "grep -q 'AI 终端助手' '$OUT'"
check "指令补全列表弹出" "grep -q '/help' '$OUT'"
check "pty 正常退出" "grep -q '再见' '$OUT'"

rm -f "$OUT"
echo "=== 结果：$PASS 通过 / $FAIL 失败 ==="
[ "$FAIL" -eq 0 ]
