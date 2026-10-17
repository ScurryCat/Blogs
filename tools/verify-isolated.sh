#!/usr/bin/env bash
# 在**隔离目录**构建当前 HEAD 并跑浏览器验收 —— 不与并行 worker 抢仓库的 .next。
#
# 为什么需要：同一工作区若有两个 worker，`next build` 会覆盖共享的 .next，
# 把对方正在跑的服务打断（实测表现为 chunk 500、__PHANTOM_DEBUG__ 未注册）。
# 这个脚本把源码复制到 /tmp、用**硬链接**复用 node_modules、在隔离目录构建，
# 再把 T02 套件与取数审计指到隔离端口上跑。
#
# 用法：
#   tools/verify-isolated.sh              # 默认端口 3120
#   tools/verify-isolated.sh 3130         # 指定端口
#   KEEP=1 tools/verify-isolated.sh       # 跑完保留隔离目录（默认保留，便于复跑）
#
# 退出码：0 = 全部通过；非 0 = 有失败（会打印失败项）。
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-3120}"
WORK="/tmp/pl-isolated-verify"
BASE="http://127.0.0.1:${PORT}"

echo "== 1/5 复制源码到 ${WORK}（排除 node_modules/.next/.git/.dsh）=="
rm -rf "$WORK"
mkdir -p "$WORK"
rsync -a \
  --exclude node_modules --exclude .next --exclude .git --exclude .dsh --exclude "*.log" \
  "$REPO/" "$WORK/"

echo "== 2/5 硬链接 node_modules（同卷几乎瞬时，且是真实文件，Turbopack 能解析）=="
cp -al "$REPO/apps/web/node_modules" "$WORK/apps/web/node_modules"

echo "== 3/5 隔离副本 patch next.config：给 /tmp 下的 Turbopack 指定 workspace root =="
python3 - "$WORK/apps/web/next.config.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding="utf-8")
if "turbopack: { root: __dirname }" in s:
    print("  已存在，跳过"); raise SystemExit(0)
i = s.find("const nextConfig"); j = s.find("{", i)
assert i != -1 and j != -1, "找不到 nextConfig 对象"
s = s[:j+1] + "\n  turbopack: { root: __dirname }," + s[j+1:]
p.write_text(s, encoding="utf-8"); print("  ✓ 已 patch（只改隔离副本）")
PY

echo "== 4/5 在隔离目录构建（Turbopack；不要用 --webpack，原因见下）=="
echo "   注意：必须用 Turbopack —— T02 的 .poll-q 还原规则依赖 Turbopack/Lightning CSS"
echo "   会丢掉 translate 的行为；用 --webpack 会保留 translate 导致 Q 双位移 20px（实测）。"
cd "$WORK/apps/web" || exit 1
export npm_config_cache="${npm_config_cache:-/Users/学习/blog/.dsh/npm-cache}"
export NEXT_TELEMETRY_DISABLED=1
DEV_API_URL="${DEV_API_URL:-http://127.0.0.1:8100}" \
DEV_LEGACY_STATIC_URL="${DEV_LEGACY_STATIC_URL:-http://127.0.0.1:8000}" \
npx next build || { echo "✗ 构建失败"; exit 1; }

echo "== 5/5 起服务并跑验收 =="
lsof -ti "tcp:${PORT}" 2>/dev/null | xargs -r kill
DEV_API_URL="${DEV_API_URL:-http://127.0.0.1:8100}" \
DEV_LEGACY_STATIC_URL="${DEV_LEGACY_STATIC_URL:-http://127.0.0.1:8000}" \
API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:8100}" \
nohup npx next start -p "$PORT" -H 127.0.0.1 > "/tmp/pl-isolated-web-${PORT}.log" 2>&1 &
sleep 8
code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "${BASE}/" 2>/dev/null)"
echo "  隔离站 ${BASE} → HTTP ${code}"
[ "$code" = "200" ] || { echo "✗ 隔离站未就绪，见 /tmp/pl-isolated-web-${PORT}.log"; exit 1; }

failed=0
echo "== T02 浏览器套件 =="
python3 "$REPO/apps/web/tools/browser-verification/verify.py" --base "$BASE" || failed=1

echo "== 客户端取数审计 =="
# 该脚本的 BASE 是常量（无 --base），这里用临时副本替换地址，不改仓库。
sed "s|http://127.0.0.1:3100|${BASE}|g" "$REPO/tools/acceptance/verify-client-paths.py" > /tmp/pl-isolated-verify/verify-client-paths.py
python3 /tmp/pl-isolated-verify/verify-client-paths.py || failed=1

echo
if [ "$failed" -eq 0 ]; then
  echo "PASS: 隔离构建上的验收全部通过（${BASE}）"
else
  echo "FAIL: 有验收项未通过（${BASE}），日志见 /tmp/pl-isolated-web-${PORT}.log"
fi
exit "$failed"
