#!/usr/bin/env bash
# 用**独立的 Postgres 集群**跑后端整树 —— 避开与并行 worker 的测试库撞名。
#
# 为什么需要：后端测试会在同一个测试集群上建固定名字的库（`pl_test_*`）。
# 同一工作区两个 worker 同时跑时，会被对方建/删同一个库，表现为
# `database "pl_test_t01" does not exist` 与大批 journal 用例 ERROR —— 不是代码问题。
#
# 这个脚本在 /tmp 起第二个集群（不同端口），跑完即停，完全不碰共享集群。
#
# 用法：
#   tools/verify-backend-isolated.sh            # 默认端口 55433
#   tools/verify-backend-isolated.sh 55434
#
# 退出码：0 = 全部通过；非 0 = 有失败。
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-55433}"
WORK="/tmp/pl-pg-backend-${PORT}"
export LC_ALL=C
export PGDATA="$WORK/data"
export PL_PG_PORT="$PORT"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/Users/学习/blog/.dsh/uv-cache}"
PG_BIN="/opt/homebrew/opt/postgresql@18/bin"

echo "== 1/4 初始化独立集群（${PORT}，数据在 ${PGDATA}）=="
"$REPO/tools/pg-local.sh" init 2>&1 | tail -2
"$REPO/tools/pg-local.sh" start 2>&1 | tail -2

cleanup() {
  echo "== 4/4 停止并清理独立集群 =="
  "$REPO/tools/pg-local.sh" stop 2>&1 | tail -1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== 2/4 建共享夹具库 =="
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U pl -d postgres -q -c "CREATE DATABASE pl_test;" 2>&1 | sed 's/^/  /'

echo "== 3/4 跑后端整树 =="
cd "$REPO" || exit 1
TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:${PORT}/pl_test" \
DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:${PORT}/pl_test" \
uv run --project apps/api pytest apps/api/tests -q -p no:warnings > "/tmp/pl-backend-isolated-${PORT}.log" 2>&1
code=$?
# 该环境里 pytest 的总结行常被吞，用进度点计数（全绿时每点 = 1 个通过）作为判据。
python3 - "/tmp/pl-backend-isolated-${PORT}.log" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
dots = sum(len(m.group(1)) for m in re.finditer(r"^([.]+)\s+\[\s*\d+%\]", text, re.M))
bad = len(re.findall(r"^[FEsxX]+\s+\[\s*\d+%\]", text, re.M))
print(f"  进度点（通过用例数）: {dots}　失败/错误进度行: {bad}")
PY
echo "  pytest 退出码: $code"
if [ "$code" -eq 0 ]; then
  echo "PASS: 后端整树在独立集群上通过（日志 /tmp/pl-backend-isolated-${PORT}.log）"
else
  echo "FAIL: 后端整树有失败（日志 /tmp/pl-backend-isolated-${PORT}.log）"
  tail -20 "/tmp/pl-backend-isolated-${PORT}.log"
fi
exit "$code"
