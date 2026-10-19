#!/usr/bin/env bash
# 生成本机受限试用所需的临时 secrets 与 trial.env（**仅用于隔离验证 / 本机试用准备**）。
#
# 为什么要有它：试用环境需要数据库三个账号口令、SECRET_KEY 和网关 Basic Auth 哈希；
# 手工生成容易把明文写进编排或提交到仓库。本脚本把它们写到调用者指定目录（chmod 600），
# 不打印口令，只打印文件路径；实际 trial.env 被 deploy/env/.gitignore 的 *.env 排除。
#
# 用法：
#   bash tools/setup-trial-secrets.sh --out /path/to/private-trial-dir
#   # 可选：--site-address http://127.0.0.1:18091 --http-port 18091 --https-port 18491
#   #      --api-image phantom-log-api:trial --web-image phantom-log-web:trial
#   #      --username trial-owner --force
#
# 真实远端试用不要把生成目录放进仓库；建议 /etc/phantom-log/trial 之类仅本机账号可读的路径。
# 依赖：openssl（口令/密钥）、Docker（用 caddy 镜像计算 bcrypt 哈希）。
set -euo pipefail

OUT=""
SITE_ADDRESS="http://127.0.0.1:18091"
HTTP_PORT="18091"
HTTPS_PORT="18491"
API_IMAGE="phantom-log-api:trial"
WEB_IMAGE="phantom-log-web:trial"
USERNAME="trial-owner"
FORCE=""
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.10.2-alpine}"

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out 需要目录}"; shift 2 ;;
    --site-address) SITE_ADDRESS="${2:?}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:?}"; shift 2 ;;
    --https-port) HTTPS_PORT="${2:?}"; shift 2 ;;
    --api-image) API_IMAGE="${2:?}"; shift 2 ;;
    --web-image) WEB_IMAGE="${2:?}"; shift 2 ;;
    --username) USERNAME="${2:?}"; shift 2 ;;
    --force) FORCE="1"; shift ;;
    *) usage ;;
  esac
done
[ -n "$OUT" ] || usage

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT_ABS="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")" || { echo "✗ 输出目录的父目录不存在：$OUT" >&2; exit 1; }
command -v openssl >/dev/null || { echo "✗ 缺少 openssl" >&2; exit 1; }
command -v docker >/dev/null || { echo "✗ 缺少 docker（计算 bcrypt 哈希需要 caddy 镜像）" >&2; exit 1; }

if [ -e "$OUT_ABS" ] && [ -n "$(ls -A "$OUT_ABS" 2>/dev/null)" ] && [ -z "$FORCE" ]; then
  echo "✗ 输出目录已存在且非空：$OUT_ABS（确认后加 --force 才覆盖）" >&2
  exit 1
fi
umask 077
SEC_DIR="$OUT_ABS/secrets"
mkdir -p "$SEC_DIR"

gen() { openssl rand -hex "$1"; }
ADMIN_PW="$(gen 24)"; MIGRATOR_PW="$(gen 24)"; APP_PW="$(gen 24)"
SECRET_KEY="$(gen 32)"
ACCESS_PW="$(openssl rand -base64 18 | tr -d '/+' | tr -d '\n')"

printf '%s' "$ADMIN_PW" > "$SEC_DIR/postgres_admin_password"
printf '%s' "$MIGRATOR_PW" > "$SEC_DIR/postgres_migrator_password"
printf '%s' "$APP_PW" > "$SEC_DIR/postgres_app_password"
printf '%s' "$ACCESS_PW" > "$SEC_DIR/trial_access_password"
chmod 600 "$SEC_DIR"/*
chmod 700 "$SEC_DIR" "$OUT_ABS"

# bcrypt：口令从 stdin 进入容器，不出现在宿主 argv；只把哈希写进 trial.env。
HASH="$(printf '%s\n' "$ACCESS_PW" | docker run -i --rm "$CADDY_IMAGE" caddy hash-password)"
[ -n "$HASH" ] || { echo "✗ caddy hash-password 没有输出哈希" >&2; exit 1; }
# Compose 的 --env-file 会对值做 `$VAR` 插值；bcrypt 哈希里的 `$` 必须写成 `$$`，
# 否则 `$<salt>` 会被当成变量而丢字符（2026-10-19 M1A 隔离验证实测踩到）。
HASH_ESCAPED="${HASH//\$/\$\$}"

cat > "$OUT_ABS/trial.env" <<ENV
# 由 tools/setup-trial-secrets.sh 生成的**本机私有**试用环境（chmod 600，不入库）。
SITE_ADDRESS=$SITE_ADDRESS
GATEWAY_HTTP_HOST_PORT=$HTTP_PORT
GATEWAY_HTTPS_HOST_PORT=$HTTPS_PORT
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
POSTGRES_IMAGE=postgres:18-alpine
CADDY_IMAGE=$CADDY_IMAGE
APP_VERSION=trial-local
TRIAL_AUTH_USER=$USERNAME
TRIAL_AUTH_HASH=$HASH_ESCAPED
POSTGRES_DB=pl
POSTGRES_ADMIN_USER=pl_admin
POSTGRES_MIGRATOR_USER=pl_migrator
POSTGRES_APP_USER=pl_app
POSTGRES_ADMIN_PASSWORD_FILE=$SEC_DIR/postgres_admin_password
POSTGRES_MIGRATOR_PASSWORD_FILE=$SEC_DIR/postgres_migrator_password
POSTGRES_APP_PASSWORD_FILE=$SEC_DIR/postgres_app_password
POSTGRES_MIGRATOR_PASSWORD=$MIGRATOR_PW
POSTGRES_APP_PASSWORD=$APP_PW
SECRET_KEY=$SECRET_KEY
MEDIA_MAX_CONCURRENCY=2
PL_BACKUP_DIR=$OUT_ABS/backups
ENV
chmod 600 "$OUT_ABS/trial.env"
mkdir -p "$OUT_ABS/backups"

cat > "$OUT_ABS/ACCESS-CREDENTIALS.txt" <<CRED
受限试用网关访问凭据（本机私有，chmod 600，不入库、不进截图/日志）
用户名：$USERNAME
口令：  $ACCESS_PW
修改口令：在部署机重新执行 caddy hash-password 并更新 trial.env 的 TRIAL_AUTH_HASH 后重启 gateway。
数据库三个账号口令文件在：$SEC_DIR/
CRED
chmod 600 "$OUT_ABS/ACCESS-CREDENTIALS.txt"

echo "✓ 已生成（未打印任何口令）："
echo "  env:         $OUT_ABS/trial.env"
echo "  secrets dir: $SEC_DIR"
echo "  访问凭据:    $OUT_ABS/ACCESS-CREDENTIALS.txt"
echo "  备份目录:    $OUT_ABS/backups"
echo
echo "下一步（先渲染检查，再起栈）："
echo "  cd $REPO"
echo "  docker compose -f deploy/compose.prod.yaml -f deploy/compose.trial.yaml \\"
echo "    -p phantom-log-trial --env-file $OUT_ABS/trial.env config >/dev/null"
echo "  # 起栈见 docs/operations/trial-runbook.md"
