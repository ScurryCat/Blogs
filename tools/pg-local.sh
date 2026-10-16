#!/usr/bin/env bash
# 本地测试用 PostgreSQL 集群（端口 55432，仅本机、仅测试）。
#
#   tools/pg-local.sh init     重建集群（会删掉现有数据目录！）
#   tools/pg-local.sh start    启动（已在跑则无操作）
#   tools/pg-local.sh stop     停止
#   tools/pg-local.sh status   探活
#
# **为什么要有这个脚本**：2026-10-16 这个集群的数据目录被并行 agent 的一次「清理临时目录」
# 删掉过一次。当时 Postgres 还在跑，靠已打开的文件句柄继续服务，所以我毫不知情；等进程一停
# 就再也起不来，表现为所有需要真实数据库的测试突然 `Connection refused`。
# 恢复步骤原本散在交付单的文字里，现在固化成本脚本。
#
# **LC_ALL 必须显式设置**：macOS 上 locale 无效时 Postgres 会以
# `postmaster became multithreaded during startup` 启动失败 —— 报错完全看不出是 locale 问题。
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.dsh/pgtest/data}"
PGLOG="${PGLOG:-$ROOT/.dsh/pgtest/server.log}"
PORT="${PL_PG_PORT:-55432}"
export LC_ALL=C LANG=C

usage() { sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

case "${1:-}" in
  init)
    echo "重建集群：$PGDATA（会删除现有内容）"
    rm -rf "$PGDATA"
    mkdir -p "$(dirname "$PGDATA")"
    "$PG_BIN/initdb" -D "$PGDATA" -U pl --auth=trust --encoding=UTF8 --locale=C >/dev/null
    echo "完成。接着跑：$0 start"
    ;;
  start)
    if "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
      echo "已在运行（$PORT）"; exit 0
    fi
    [ -d "$PGDATA" ] || { echo "数据目录不存在：$PGDATA —— 先跑 $0 init"; exit 1; }
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -o "-p $PORT -k /tmp" start >/dev/null
    for _ in $(seq 1 20); do
      "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break
      sleep 0.5
    done
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" || { echo "启动失败，看 $PGLOG"; exit 1; }
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
    echo "已停止"
    ;;
  status)
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" || exit 1
    echo "测试库："
    "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U pl -d postgres -tAc \
      "select '  '||datname from pg_database where datname like 'pl_%' order by 1"
    ;;
  *) usage ;;
esac
