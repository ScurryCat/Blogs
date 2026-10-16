-- 把运行账号（默认 pl_app）的权限补齐到「已迁移的库」上。
--
-- 为什么需要单独一步：迁移账号是表的 owner，运行账号不是。新建的表默认只有 owner
-- 有权限，所以每次跑完迁移都要重新执行本文件；它是**幂等**的。
--
-- 用法（在目标库上以管理员或迁移账号执行）：
--   psql -v ON_ERROR_STOP=1 -U pl_admin -d pl -v app_user=pl_app -f deploy/db/grant-runtime.sql
--   # 或在容器里：
--   docker compose -f deploy/compose.prod.yaml exec -T db \
--     psql -U pl_admin -d pl -v app_user=pl_app -f /docker-entrypoint-initdb.d/../grant-runtime.sql
--
-- 授权范围（最小够用，不给 DDL）：
--   - schema public 的 USAGE（不含 CREATE）。
--   - 现有全部表的 SELECT / INSERT / UPDATE / DELETE。
--   - 现有全部序列的 USAGE / SELECT（自增主键需要）。
--   - DEFAULT PRIVILEGES 交给迁移账号以后新建的对象（下一次迁移不必再手工补）。
--
-- ⚠️ 生产数据库里 `\gexec` 与 plpgsql 都可用（都是核心功能，不需要扩展）。

\set app_user :app_user

GRANT USAGE ON SCHEMA public TO :"app_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";

-- 迁移账号之后建的新表 / 新序列，自动带上运行账号的权限。
-- 以迁移账号身份执行本文件时才会生效；由管理员执行时，这里为其名下的未来对象授权。
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

-- 明确**不**授予：CREATE（DDL）、TRUNCATE、REFERENCES、TRIGGER、超级用户、建库、建角色。
