# 受限试用运行手册（M1A · 本地就绪 / 远端实施前置）

任务批次：P5-M0M1-20261019-r1。本文是**操作手册**，不是「已上线」声明。
状态边界：本机隔离验证已完成（见 `M1A-LOCAL-READINESS.md` 与交付证据）；
真实域名 / HTTPS / 远端主机 / iOS / Android 真机属于 M1B，**必须站主提供目标与明确授权后另行确认**，
本文第 8 节的实施单信息未采集齐前不得执行远端写入。

## 1. 组成与与生产的差异

- 基础编排：`deploy/compose.prod.yaml`（db / migrate / grants / api / web / gateway）。
- 试用覆盖层：`deploy/compose.trial.yaml`——只做两件事：
  1. 网关把 `deploy/gateway/access/trial` 覆盖挂载到 `/etc/caddy/access`（全站 Basic Auth）；
  2. 注入 `TRIAL_AUTH_USER` / `TRIAL_AUTH_HASH`（bcrypt 哈希；明文口令不进入编排 / 镜像）。
- **不复制全量 Compose**、不新增服务、不改端口和权限模型；健康检查、migrate/grants 依赖链、
  非 root / read-only、数据库与媒体卷类型全部沿用生产编排。
- 隔离维度：`-p <项目名>` 决定容器 / 网络 / 卷前缀；宿主端口用
  `GATEWAY_HTTP_HOST_PORT` / `GATEWAY_HTTPS_HOST_PORT`；数据目录由独立卷承载。
  本项目默认示例：`phantom-log-trial` + `18091/18491`（仅本机 HTTP 冒烟用）。

## 2. 访问保护（网关层）

- `deploy/gateway/access/trial/trial-auth.caddy` 对所有路径启用 Basic Auth：
  页面、`/api/v1`、媒体变体、`/_next` 静态资源、`/assets/music` 都在保护范围内。
- 唯一免认证路径是 `/gateway-healthz`（网关容器自身 healthcheck 的 loopback 目标，不含业务数据）。
  api / web 的健康检查在各自容器内部直连，不经过网关，因此无需放行。
- Basic Auth 是**额外一层**：通过后，站主登录（FastAPI 会话）、CSRF / Origin 校验、媒体权限
  仍按原逻辑生效；两层不能互相替代。
- 生产项目挂载 `deploy/gateway/access/prod`（只有注释的空规则片段），行为与之前一致。
- **哈希转义**：Compose 的 `--env-file` 会对值做 `$VAR` 插值；bcrypt 哈希里的每个 `$`
  必须写成 `$$`（`tools/setup-trial-secrets.sh` 已自动处理；手工填写时注意，否则鉴权会随机失败）。
  或用 shell 环境变量注入 `TRIAL_AUTH_HASH`（环境变量优先、按字面值使用）。

## 3. 首次准备（本机 / 部署机）

```bash
cd /path/to/Blogs
export UV_CACHE_DIR=/path/to/uv-cache   # 本机示例 /Users/学习/blog/.dsh/uv-cache

# 1) 镜像：真实试用按 CI 构建的不可变 digest；本机隔离验证可本地构建 tag
docker build -f deploy/prod.Dockerfile.api -t phantom-log-api:trial .
docker build -f deploy/prod.Dockerfile.web --build-context music=assets/music -t phantom-log-web:trial .

# 2) 一次性 secrets 与 trial.env（写到私有目录；不打印口令；目录勿入库）
bash tools/setup-trial-secrets.sh --out /path/to/private-trial-dir
#    可选：--site-address http://127.0.0.1:18091 --http-port 18091 --https-port 18491

# 3) 渲染 + 静态审查（不需要 daemon；会把编排与网关片段一起检查）
docker compose -f deploy/compose.prod.yaml -f deploy/compose.trial.yaml \
  -p phantom-log-trial --env-file /path/to/private-trial-dir/trial.env config --format json \
  > /tmp/trial-rendered.json
python3 deploy/check-trial-config.py --compose-config /tmp/trial-rendered.json
python3 deploy/check-prod-config.py --compose-config /tmp/prod-rendered.json   # 生产编排回归
```

## 4. 启动 / 状态 / 停止

```bash
cd /path/to/Blogs
TRIAL_ENV=/path/to/private-trial-dir/trial.env
COMPOSE="docker compose -f deploy/compose.prod.yaml -f deploy/compose.trial.yaml -p phantom-log-trial --env-file $TRIAL_ENV"

$COMPOSE config >/dev/null                 # 先渲染，失败即停
$COMPOSE up -d --remove-orphans            # 首次全新库也会自动完成 migrate → grants
$COMPOSE ps                                # db/api/web/gateway healthy；migrate/grants Exited(0)

# 本机 HTTP 冒烟：未认证应 401，带 Basic Auth 应能拿到 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18091/            # 401
curl -s -u "$TRIAL_AUTH_USER:$TRIAL_AUTH_PASSWORD" -o /dev/null \
  -w '%{http_code}\n' http://127.0.0.1:18091/                               # 200
curl -s -u ... http://127.0.0.1:18091/api/v1/health/ready                   # {"status":"ready",...}

# 停止：只停本项目容器（不加 -v；卷保留）
$COMPOSE stop
# 完全移除本项目容器 / 网络（数据卷保留；确认不再需要时才考虑卷）
$COMPOSE down --remove-orphans
```

> 不要对整个仓库执行 `docker compose down -v`；不要停止 / 覆盖其他项目与服务。
> 清理只能按 `com.docker.compose.project=phantom-log-trial` 标签确认属于本项目的资源。

## 5. 升级与回退

- 升级：换 `API_IMAGE` / `WEB_IMAGE` 为新的不可变 digest → 先按第 7 节做**发布前成对备份** →
  `$COMPOSE up -d`（migrate/grants 会先完成）→ 等 healthy → 跑第 9 节冒烟。
- 应用回退（schema 兼容）：把两个镜像 tag 换回上一个 digest，`$COMPOSE up -d`；
  不要动数据库。
- schema 不兼容 / 数据需回退：经站主确认后，把发布前备份恢复到**新库**，再切连接串；
  禁止自动 downgrade、禁止覆盖故障现场。
- 迁移失败：保持旧实例在线，只修迁移；不要反复 `upgrade/downgrade` 试错。

## 6. 备份与恢复

- 设计与脚本沿用 `deploy/backup.py` / `deploy/restore.py`，详见 `docs/operations/backup-restore.md`。
- 试用数据**每日一次**成对备份（数据库 dump + 媒体 + checksums + manifest），至少一份
  **加密异机副本**；备份目的地、权限、容量、定时执行与失败告警必须在 M1B 前确认。
- 恢复后必须执行 `python -m app.commands.revoke_sessions --all`，再开放访问（防旧 Cookie 复活）。
- RPO 24h / RTO 4h 是待实测目标，不是保证；本机小数据量演练数字见
  `M1A-LOCAL-READINESS.md` 第 6 节，不代表生产规模。
- 真实试用数据与一次性自动化测试数据必须分开；**绝不对真实试用库跑清库型 e2e**。

## 7. 发布前检查清单（远端）

- [ ] 站主已确认目标主机 / 子域名 / 变更窗口与操作范围（第 8 节信息齐备）。
- [ ] 独立 `-p` 项目名、独立卷、独立宿主端口；与现有服务无重叠。
- [ ] secrets 与口令文件权限正确（600 / 仅运行账号可读），未进入 Git / 镜像 / 日志。
- [ ] 发布前成对备份成功且 checksums 核对通过。
- [ ] 真实域名 HTTPS 生效，Cookie `Secure` / `__Host-` 行为实测；未认证直连 API / 媒体 / 静态被阻断。
- [ ] `migrate` / `grants` Exited(0)，四个长驻服务 healthy。
- [ ] 冒烟：登录、上传、发布、撤回、媒体匿名/站主权限、音频 Range。
- [ ] 回退镜像 digest 与恢复步骤已记录。

## 8. 远端实施单（待站主确认；未采集项不得虚构）

| 项目 | 需要的信息 | 当前状态 |
|---|---|---|
| 主机 | 脱敏标识、系统/架构、CPU/内存/磁盘、Docker 版本 | 未采集 |
| 访问方式 | 允许使用的安全连接渠道与只读审查范围 | 未采集 |
| 子域名 / DNS | 试用子域名、解析控制方、TLS 条件 | 未采集 |
| 现有服务避让 | 服务/端口/网关/卷清单、禁止影响范围 | 未核对 |
| Compose 项目/卷 | 项目名、卷名、数据目录 | 待本地准备后提交 |
| 镜像来源 | CI digest（禁止 latest、禁止现场 build） | 未采集 |
| 端口 / 防火墙 | 宿主端口、仅网关对外开放 | 待确认 |
| 备份目的地 | 异机位置、加密、保留、失败通知 | 未采集 |
| 维护窗口 | 可停机时间（默认不假设停机） | 未确认 |
| 授权 | 授权人、时间、具体范围（含 DNS/证书/防火墙） | 未记录 |

## 9. 本机隔离验证与已知限制（2026-10-19）

- 已在隔离项目（唯一项目名 / 端口 / 临时 secrets）真实启动 base+trial 编排，验证匿名保护、
  登录 / CSRF、上传 / 发布 / 撤回、媒体权限、DB 故障恢复、迁移与授权失败阻断，以及真实 Caddy
  validate。证据与断言见 `M1A-LOCAL-READINESS.md` 与交付 `evidence/`。
- **未验证**：真实域名 / TLS / ACME、远端主机部署与防火墙、iOS / Android 真机（含软键盘、
  中文输入法、触控）、生产规模备份恢复与回退、长时间运行与弱网。
- 本机 HTTP 冒烟不验证浏览器 `Secure` Cookie 行为（`__Host-` Cookie 只在 HTTPS 下由浏览器回传）；
  服务端登录语义通过显式回放 Cookie 验证，**不能替代 M1B 的 HTTPS 真机验收**。
