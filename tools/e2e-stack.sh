#!/usr/bin/env bash
# 隔离全栈（端到端验证用）：up / down / status
#
# 给 tools/e2e-phone-scroll.py 与 tools/e2e-im-draft.py 提供一套**有真实内容、
# 完全不碰共享环境**的栈：独立 Postgres 集群 + 独立 API + 隔离构建的前端 + 种子手记。
#
# 用法：
#   tools/e2e-stack.sh up       # 起栈（首次约 3 分钟，含一次隔离构建）并打印地址
#   tools/e2e-stack.sh down     # 停栈（只停本脚本起的进程与集群）
#   tools/e2e-stack.sh status    # 看状态
#
# 端口都是专用的：集群 55434 / API 8130 / 前端 3130。
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="/tmp/pl-e2e-stack"
PGDATA_DIR="$WORK/pg/data"
PL_PG_PORT=55434
API_PORT=8130
WEB_PORT=3130
PG_BIN="/opt/homebrew/opt/postgresql@18/bin"
OWNER_PASSWORD="e2e-password-123"
API_PID="$WORK/api.pid"
WEB_PID="$WORK/web.pid"

export LC_ALL=C
export UV_CACHE_DIR="${UV_CACHE_DIR:-$REPO/.dsh/uv-cache}"
export npm_config_cache="${npm_config_cache:-$REPO/.dsh/npm-cache}"

say() { printf '  %s\n' "$1"; }

api_url() { echo "http://127.0.0.1:${API_PORT}"; }
web_url() { echo "http://127.0.0.1:${WEB_PORT}"; }

wait_http() { # $1=url $2=秒数
  local url="$1" limit="${2:-40}" i=0
  while [ "$i" -lt "$limit" ]; do
    if curl -sS -m 3 -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

cmd_down() {
  say "停止前端 / API"
  for pidfile in "$WEB_PID" "$API_PID"; do
    if [ -f "$pidfile" ]; then
      pid="$(cat "$pidfile" 2>/dev/null || true)"
      [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
      rm -f "$pidfile"
    fi
  done
  lsof -ti "tcp:${WEB_PORT}" 2>/dev/null | xargs -r kill 2>/dev/null
  lsof -ti "tcp:${API_PORT}" 2>/dev/null | xargs -r kill 2>/dev/null
  say "停止独立集群（${PL_PG_PORT}，数据在 ${PGDATA_DIR}）"
  # ⚠️ 必须显式带 PGDATA/PL_PG_PORT，否则 pg-local.sh 会去停**共享**集群。
  PGDATA="$PGDATA_DIR" PL_PG_PORT="$PL_PG_PORT" "$REPO/tools/pg-local.sh" stop >/dev/null 2>&1 || true
  say "已停止"
}

cmd_up() {
  mkdir -p "$WORK"

  say "1/6 独立集群（${PL_PG_PORT}）"
  PGDATA="$PGDATA_DIR" PL_PG_PORT="$PL_PG_PORT" "$REPO/tools/pg-local.sh" init >/dev/null 2>&1 || true
  PGDATA="$PGDATA_DIR" PL_PG_PORT="$PL_PG_PORT" "$REPO/tools/pg-local.sh" start >/dev/null 2>&1 || true
  "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PL_PG_PORT" >/dev/null 2>&1 || { say "✗ 集群没起来"; exit 1; }

  say "2/6 建库 + 迁移 + 站主"
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PL_PG_PORT" -U pl -d postgres -tAc \
    "select 1 from pg_database where datname='pl_e2e'" 2>/dev/null | grep -q 1 \
    || "$PG_BIN/psql" -h 127.0.0.1 -p "$PL_PG_PORT" -U pl -d postgres -q -c "CREATE DATABASE pl_e2e;"
  (
    cd "$REPO/apps/api" || exit 1
    DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:${PL_PG_PORT}/pl_e2e" \
    SECRET_KEY="e2e-stack-secret-0123456789abcdef0123" \
      uv run alembic upgrade head >/dev/null 2>&1
    DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:${PL_PG_PORT}/pl_e2e" \
    SECRET_KEY="e2e-stack-secret-0123456789abcdef0123" \
      uv run python -m app.commands.bootstrap_admin --username owner --password-stdin \
      <<< "$OWNER_PASSWORD" >/dev/null 2>&1
  ) || { say "✗ 迁移/建站主失败"; exit 1; }

  say "3/6 隔离副本 + 构建（首次约 2 分钟）"
  # 源码比构建新也要重建 —— 否则会拿旧代码跑端到端，判据就失效了（这个坑踩过两次）
  need_build=0
  if [ ! -f "$WORK/web/apps/web/.next/BUILD_ID" ]; then
    need_build=1
  elif [ -n "$(find "$REPO/apps/web/features" "$REPO/apps/web/app" -newer "$WORK/web/apps/web/.next/BUILD_ID" -type f 2>/dev/null | head -1)" ]; then
    need_build=1
    say "源码比构建新，重新构建"
  fi
  if [ "$need_build" -eq 1 ]; then
    rm -rf "$WORK/web/apps/web/.next"
    mkdir -p "$WORK/web"
    rsync -a --exclude node_modules --exclude .next --exclude .git --exclude .dsh --exclude "*.log" \
      "$REPO/" "$WORK/web/"
    cp -al "$REPO/apps/web/node_modules" "$WORK/web/apps/web/node_modules"
    python3 - "$WORK/web/apps/web/next.config.ts" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding="utf-8")
if "turbopack: { root: __dirname }" not in s:
    i = s.find("const nextConfig"); j = s.find("{", i)
    s = s[:j+1] + "\n  turbopack: { root: __dirname }," + s[j+1:]
    p.write_text(s, encoding="utf-8")
PY
    ( cd "$WORK/web/apps/web" || exit 1
      DEV_API_URL="http://127.0.0.1:${API_PORT}" DEV_LEGACY_STATIC_URL="http://127.0.0.1:8000" \
      NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null 2>&1 ) || { say "✗ 构建失败"; exit 1; }
  else
    say "复用已有构建（删掉 ${WORK}/web 可强制重建）"
  fi

  say "4/6 起隔离 API（${API_PORT}）"
  lsof -ti "tcp:${API_PORT}" 2>/dev/null | xargs -r kill 2>/dev/null
  ( cd "$REPO/apps/api" || exit 1
    DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:${PL_PG_PORT}/pl_e2e" \
    SECRET_KEY="e2e-stack-secret-0123456789abcdef0123" \
    MEDIA_ROOT="$WORK/media" \
    CORS_ORIGINS="http://127.0.0.1:${WEB_PORT}" APP_ENV=dev \
      nohup uv run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" \
      > "$WORK/api.log" 2>&1 & echo $! > "$API_PID" )
  wait_http "$(api_url)/api/v1/posts" 40 || { say "✗ API 没就绪，见 $WORK/api.log"; exit 1; }

  say "5/6 种子手记（15 条公开）"
  python3 "$REPO/tools/e2e-seed-journal.py" "$(api_url)" "$OWNER_PASSWORD" 15 >/dev/null 2>&1 \
    && say "种子完成" || say "⚠ 种子失败（看 tools/e2e-seed-journal.py 输出）"

  say "6/6 起隔离前端（${WEB_PORT}）"
  lsof -ti "tcp:${WEB_PORT}" 2>/dev/null | xargs -r kill 2>/dev/null
  ( cd "$WORK/web/apps/web" || exit 1
    DEV_API_URL="http://127.0.0.1:${API_PORT}" DEV_LEGACY_STATIC_URL="http://127.0.0.1:8000" \
    API_INTERNAL_URL="http://127.0.0.1:${API_PORT}" \
      nohup npx next start -p "$WEB_PORT" -H 127.0.0.1 > "$WORK/web.log" 2>&1 & echo $! > "$WEB_PID" )
  wait_http "$(web_url)/" 40 || { say "✗ 前端没就绪，见 $WORK/web.log"; exit 1; }

  say "栈已就绪：前端 $(web_url) / API $(api_url)"
  say "跑端到端：python3 tools/e2e-phone-scroll.py $(web_url)"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status)
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PL_PG_PORT" 2>&1 | sed 's/^/  集群: /'
    curl -sS -m 3 -o /dev/null -w '  API: %{http_code}\n' "$(api_url)/api/v1/posts" 2>/dev/null || echo "  API: 未运行"
    curl -sS -m 3 -o /dev/null -w '  前端: %{http_code}\n' "$(web_url)/" 2>/dev/null || echo "  前端: 未运行"
    ;;
  *)
    sed -n '2,16p' "$0"
    exit 2
    ;;
esac
