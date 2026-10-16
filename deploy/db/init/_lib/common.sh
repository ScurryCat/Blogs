#!/bin/sh
# 角色初始化脚本共用的工具函数。
#
# ⚠️ 位置：放在 `_lib/` 子目录里，**不是** `/docker-entrypoint-initdb.d/` 的顶层。
# 官方 postgres 镜像的入口会把该目录顶层的 `*.sh` 当成要执行的初始化脚本、`*.sql`
# 拿去做 psql 输入；放一个只提供函数的库文件在顶层会被当成脚本执行（而且是以管理员
# 身份执行）。放子目录即可，官方入口不递归。
#
# 用法：`. /docker-entrypoint-initdb.d/_lib/common.sh`

# 从 KEY=value 形式的 env 文件里取一个值；找不到就返回失败。
# 用法：value="$(read_env_var FILE KEY)"
read_env_var() {
	file="$1"
	key="$2"
	[ -f "$file" ] || return 1
	line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1)"
	[ -n "$line" ] || return 1
	value="${line#*=}"
	# 去掉可能存在的成对引号（env 文件里允许 `KEY="值"`）。
	case "$value" in
		\"*\") value="${value#\"}" && value="${value%\"}" ;;
		\'*\') value="${value#\'}" && value="${value%\'}" ;;
	esac
	printf '%s' "$value"
}

# 校验一个标识符（角色名）：只允许小写字母、数字与下划线。
require_identifier() {
	name="$1"
	value="$2"
	case "$value" in
		'' | *[!a-z0-9_]*)
			echo "[initdb] $name 必须是 [a-z0-9_]+ 形式的标识符，当前值不合法" >&2
			exit 1
			;;
	esac
}

# 拒绝空口令：宁可初始化失败，也不要建出无口令角色。
require_password() {
	name="$1"
	value="$2"
	[ -n "$value" ] || {
		echo "[initdb] $name 为空；拒绝创建无口令角色" >&2
		exit 1
	}
}

# 给 psql 变量用的字面量：把单引号写成两个单引号。返回时**不带**外层引号。
sql_literal() {
	printf '%s' "$1" | sed "s/'/''/g"
}

psql_admin() {
	psql --no-psqlrc -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}
