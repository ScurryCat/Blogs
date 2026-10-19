#!/bin/sh
# 建两个非超级用户角色（06 §2：运行账号不是超级用户，迁移账号与运行账号分开）。
#
# 只做「建角色」，授权在 20-grants.sh —— 那里在目标库上显式执行，不依赖 PUBLIC 默认权限。
#
# 口令来源（按优先级）：
#   1. `POSTGRES_MIGRATOR_PASSWORD_FILE` / `POSTGRES_APP_PASSWORD_FILE` 指向的文件
#      （Docker secret；推荐，值不出现在 `docker inspect` 的环境变量里）。
#   2. 同名环境变量（compose --env-file 注入）。
# **没有默认值**，两者都缺即初始化失败 —— 宁可起不来，也不建无口令角色。
#
# 管理员口令走官方镜像自己的 `POSTGRES_PASSWORD_FILE`，与这里无关。
set -eu

. /docker-entrypoint-initdb.d/_lib/common.sh

POSTGRES_MIGRATOR_USER="${POSTGRES_MIGRATOR_USER:-pl_migrator}"
POSTGRES_APP_USER="${POSTGRES_APP_USER:-pl_app}"

# 优先读 *_FILE；文件存在但为空同样算缺失。
if [ -z "${POSTGRES_MIGRATOR_PASSWORD:-}" ] && [ -n "${POSTGRES_MIGRATOR_PASSWORD_FILE:-}" ]; then
	POSTGRES_MIGRATOR_PASSWORD="$(tr -d '\r\n' < "$POSTGRES_MIGRATOR_PASSWORD_FILE" 2>/dev/null || true)"
fi
if [ -z "${POSTGRES_APP_PASSWORD:-}" ] && [ -n "${POSTGRES_APP_PASSWORD_FILE:-}" ]; then
	POSTGRES_APP_PASSWORD="$(tr -d '\r\n' < "$POSTGRES_APP_PASSWORD_FILE" 2>/dev/null || true)"
fi

require_identifier POSTGRES_MIGRATOR_USER "$POSTGRES_MIGRATOR_USER"
require_identifier POSTGRES_APP_USER "$POSTGRES_APP_USER"
require_password POSTGRES_MIGRATOR_PASSWORD "${POSTGRES_MIGRATOR_PASSWORD:-}"
require_password POSTGRES_APP_PASSWORD "${POSTGRES_APP_PASSWORD:-}"


if [ "$POSTGRES_MIGRATOR_USER" = "$POSTGRES_APP_USER" ]; then
	echo "[initdb] 迁移账号与运行账号不能同名" >&2
	exit 1
fi

echo "[initdb] 创建角色 $POSTGRES_MIGRATOR_USER（迁移）与 $POSTGRES_APP_USER（运行）"

psql_admin \
	-v migrator_user="$POSTGRES_MIGRATOR_USER" \
	-v migrator_password="$(sql_literal "$POSTGRES_MIGRATOR_PASSWORD")" \
	-v app_user="$POSTGRES_APP_USER" \
	-v app_password="$(sql_literal "$POSTGRES_APP_PASSWORD")" <<'SQL'
-- 迁移账号：建表、加列、写 alembic_version。不是超级用户，也不能建库 / 建角色。
CREATE ROLE :"migrator_user" LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- 运行账号：只读写数据。不能建表、不能建库、不能建角色。
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
SQL

echo "[initdb] 角色创建完成（schema 权限见 20-grants.sh）"
