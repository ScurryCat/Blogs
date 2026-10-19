#!/bin/sh
# schema 权限初始化（06 §2 / §5：数据库角色与授权需单独重建，不能假设单库 dump
# 包含完整集群身份配置）。
#
# ⚠️ 本脚本在 **initdb 阶段**执行：只覆盖「一个全新的空集群」。已经跑过的集群新增角色
# 或改授权要用 `deploy/db/grant-runtime.sql`（幂等，可重复执行）。
#
# 权限设计：
#   - public schema 的 CREATE 从 PUBLIC 收回，只给迁移账号（默认情况下所有角色都能
#     在 public 里建对象，那是 PostgreSQL < 15 的旧默认，收紧掉）。
#   - 运行账号现在**不给任何表权限**：表还没建。表建好之后由 `grant-runtime.sql` 授权，
#     迁移流程要求迁移后执行那一步（见 docs/operations/release.md）。
set -eu

. /docker-entrypoint-initdb.d/_lib/common.sh

POSTGRES_MIGRATOR_USER="${POSTGRES_MIGRATOR_USER:-pl_migrator}"
POSTGRES_APP_USER="${POSTGRES_APP_USER:-pl_app}"

echo "[initdb] 收紧 public schema 权限（$POSTGRES_MIGRATOR_USER 可建对象，$POSTGRES_APP_USER 不能）"

psql_admin \
	-v migrator_user="$POSTGRES_MIGRATOR_USER" \
	-v app_user="$POSTGRES_APP_USER" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"migrator_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
-- 建表能力只给迁移账号；运行账号没有 CREATE。
GRANT CREATE ON SCHEMA public TO :"migrator_user";

-- 之后由迁移账号建出来的表，默认只给「表 owner」，运行账号的权限等
-- grant-runtime.sql 显式授予 —— 不用 ALTER DEFAULT PRIVILEGES 偷偷放开，
-- 免得新表在没被审查的情况下自动对运行账号可写。
SQL

echo "[initdb] 完成。迁移后请在目标库执行 deploy/db/grant-runtime.sql"
