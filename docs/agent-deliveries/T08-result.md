# T08 · 交付单（原版 IM 与剧情 / AI 混合角色消息）

```text
任务：T08 / 原版 IM 与剧情 / AI 混合角色消息
状态：**implemented_waiting_integration** —— 代码、模型、路由、剧本与测试全部落地并在真实
      PostgreSQL + 真实 Next 进程 + 真实浏览器上跑通（后端 160 例、前端 58 例、
      浏览器 42/42）；**未接线**：T00 尚未把 messaging 写进 MODEL_MODULES /
      MODULE_ROUTER_TARGETS / 迁移，也尚未在 INS 壳里注入消息页签。
      真实 AI 供应商**未接通**（无凭证、无预算），因此「真实模型联调」明确未验收。

基线：开工时 main @ cc648dd；交付时 main 已推进到 8dc393e（期间 T00 集成 T05 / T07、
      T10 审查入库）。本包全部是**新增未跟踪文件**，`git status` 里没有任何已跟踪文件被改动，
      因此这段推进不影响本包（已在 8dc393e 上重跑全部验证）
      本轮未提交、未推送、未建分支 / worktree、未启动子 agent
外部影响：**未调用任何外部模型或付费服务**。默认供应商是本地模拟服务（`simulator`），
          不联网、不计费；`openai_compatible` 的实现已写好但默认拒绝启动，且没有任何
          默认端点或密钥。联调只在自建库 `pl_test_t08_smoke` 与自建临时库
          `pl_test_t08_<pid>` 上做，`pl_test`（T00 的共享夹具库）**零写入**。
```

## 1. 范围

**已完成**：访客匿名会话（与站主 `sessions` 完全分离）、一对一角色会话、版本化剧本引擎
（确定性分支，模型无权改）、自由输入 → AI 回复 → 回到话题的混合状态机、可替换 AI 适配层
（模拟服务 / 真 OpenAI 兼容端点 / 停用三态）、输出清洗与内容 ID 白名单、单会话一在途 +
幂等、服务端原子预算与并发闸门、24 小时保留与立即清除、原版 IM 风格的消息页与角色列表、
INS 页签注入契约、手机屏幕、管理端运行状态页。

**未完成（有意不做）**：真实模型联调与费用边界（缺凭证与预算，见 §7）、
群聊、语音、主动推送、跨设备长期记忆、真实用户私信、自动好感度、
按角色/按图片的 AI 读取（首版**完全不向模型传图片**）、相册（T06）。

## 2. 文件

**新增（`apps/api/app/modules/messaging/`，本包独占）**

```text
config.py                 MESSAGING_* 运行参数（独立 BaseSettings，全部有默认值）
models.py                 visitor_sessions / conversations / messages / ai_requests /
                          ai_budget_days / ai_visitor_days + CHECK 与部分唯一索引
schemas.py                公开 DTO（会话 / 消息 / 卡片 / AI 状态 / 用量）与写入 DTO
characters.py             版本化角色卡（双叶 / 摩尔加纳）：语气、话题、禁止虚构项、来源
stories/schema.py         剧本数据结构 + 确定性结构校验（走不通的剧本直接抛错）
stories/futaba.py         双叶：9 节点，3 个入口分支，2 个结尾
stories/morgana.py        摩尔加纳：7 节点，3 个入口分支，1 个结尾
stories/__init__.py       剧本仓库 + 角色↔剧本一致性校验
story 引擎                由 stories/ 与 service.choose / resume / restart 构成（无独立文件）
content.py                公开内容读取、静态路径白名单、卡片解析、模型 token 白名单
sessions.py               访客凭证（只存摘要）、Cookie、滑动 + 绝对过期、清除、到期清理
guards.py                 访客写操作闸门（Origin / Fetch Metadata + CSRF，见 §4 第 1 条）
budget.py                 原子预留 / 结算 / 释放、全站并发、IP 频率、用量快照
service.py                会话服务与混合状态机（不变量 I1–I6 写在文件头）
ai/base.py                AiProvider 协议、请求 / 结果、失败分类
ai/prompts.py             按角色组织上下文（只传必要文本，明确声明「没有收到图片」）
ai/output.py              输出清洗（去标签 / Markdown 链接 / URL / 控制字符）与气泡切分
ai/simulator.py           本地模拟服务（默认）：关键词 → 角色语气模板，sha256 定变体
ai/openai_compatible.py   OpenAI 兼容端点适配（标准库 urllib + 工作线程 + 硬超时 + 有限重试）
ai/registry.py            供应商解析（disabled / simulator / openai_compatible）
router.py                 12 条路径（11 条公开访客 + 1 条管理）
wiring.py                 集成声明：**不向共享注册表贡献条目**，并把三条集成申请写成常量
```

**新增（`apps/api/tests/messaging/`，本包独占，160 例）**

```text
t08_db.py                 自建临时库 pl_test_t08_<pid>（真实迁移 + 补自己的六张表）
conftest.py               夹具装配 + 注册表隔离
helpers.py                测试 app 工厂、可提交的会话、两个「浏览器」、剧情导航
test_models.py            18 例：真实 PostgreSQL 约束、部分唯一索引、FK 级联
test_stories.py           14 例：随包剧本合规 + 校验器真的会拒绝坏剧本
test_ai_adapter.py        30 例：输出清洗 / 模拟服务 / 真实本机 HTTP 往返 / 供应商解析
test_content.py           10 例：只读公开内容、卡片解析、卡片 URL 必须真的有页面
test_hybrid_flow.py       11 例：剧情 → 自由输入 → 回到剧情、重开、清除、过期、两标签页
test_isolation.py          6 例：A 读/选/发/回到/重开/清除 B 的会话全部 404 且数据不变
test_idempotency.py        8 例：重复请求只调一次上游、在途冲突、晚到响应、并发抢锁
test_budget.py            11 例：原子预留不超卖、跨引擎保存、结算 vs 释放、额度耗尽降级
test_degradation.py       12 例：停用 / 未配置 / 超时 / 上游错误 / 输出不可用 / 取消
test_sessions.py          14 例：Cookie 属性、只存摘要、清除、过期、purge、长度限制
test_write_guard.py       14 例：来源与 CSRF 的每个分支（含 Next rewrite 形态）
test_admin_and_wiring.py  12 例：管理总览、不泄密钥、路由清单、无共享贡献
                          —— 合计 160 例
```

**新增（`apps/web/features/messaging/`，本包独占，58 例）**

```text
types.ts                  DTO + 纯函数（码点计数、气泡分组、降级文案、摘要、时间）
paths.ts                  API 与 canonical URL 构造（canonical 里没有会话 UUID）
api.ts                    浏览器端读写（CSRF 进 body；错误分类便于分支处理）
use-conversation.ts       会话状态机：引导 → 取会话 → 发送 / 选择 / 回到 / 重开 / 清除
conversation-screen.tsx   屏幕级组合（独立页与手机共用）
conversation-view.tsx     一对一视图：头部 / 状态条 / 消息 / 选项 / 回到话题 / 输入
message-bubble.tsx        气泡（AI 标记、纯文本、卡片）
content-card.tsx          内容卡片（一律 SiteLink，纯文本）
composer.tsx              「自己说一句」→ 展开输入（首次解释会发送什么）
character-list.tsx        角色列表（无在线状态、无友链）
messages-tab.tsx          InsTabContribution 实例（id=messages，order=40）
ins-integration.tsx       INS 接线件（客户端侧注入页签；供 T00 一行替换）
phone-view.tsx / phone-app.tsx   手机屏幕 messages / conversation
messaging.css             `.msg-` 前缀的独占样式表（有测试断言不越界）
index.ts                  公开入口（只导出页签、屏幕名与视图组件）
types.test.ts             19 例  views.test.tsx 22 例
messaging-css.test.ts     5 例   use-conversation.test.tsx 12 例
```

**新增（路由）**

```text
app/apps/ins/messages/page.tsx                   /apps/ins/messages
app/apps/ins/messages/[character_id]/page.tsx    /apps/ins/messages/<character_id>
app/admin/messages/page.tsx                      /admin/messages
```

**新增（文档与证据）**

```text
docs/design-references/im/README.md              参考来源 + 逐项校准记录 + 截图清单
docs/design-references/im/screens/*.png          12 张真实浏览器截图（可分发，自己截的）
docs/agent-deliveries/T08-result.md              本文件
```

**未改动**（所有权红线，逐条确认）：`app/{main,router,model_registry}.py`、`migrations/`、
两个锁文件、`app/core/`、`app/modules/{auth,media,tags,posts,moments,nav,coop,journal,leisure}/`、
`apps/web/features/{runtime,phone,legacy,auth,ins,coop,journal,leisure,metanav,showcase,gallery}/`、
`components/ui/`、`lib/api/`、`app/{layout.tsx,globals.css,admin/layout.tsx}`、`app/apps/ins/page.tsx`、
`app/apps/ins/[id]/page.tsx`、`contracts/`、`deploy/`、`apps/web/package.json`、`apps/api/pyproject.toml`、
旧站 HTML / `assets/` / `tests/*.cjs`。本包**没有** `dev_app.py`、没有在仓库里留联调脚本。

## 3. 契约增量（08 §6 的三个概念 + 实现补充）

### 3.1 表

| 表 | 列 | 数据库级约束与索引 |
| --- | --- | --- |
| `visitor_sessions` | `id` / `token_hash` / `csrf_secret` / `ip_hash` / `created_at` / `last_seen_at` / `expires_at` / `absolute_expires_at` | `uq_visitor_sessions_token_hash`；`ck_…_token_hash_length`（=64）；`ck_…_csrf_secret_length`（≥32）；`ix_…_expires_at`；`ix_…_ip_hash` |
| `conversations` | `id` / `visitor_session_id` / `character_id` / `story_id` / `story_version` / `node_id` / `node_version` / `status` / `paused_node_id` / `created_at` / `updated_at` / `last_message_at` / `expires_at` | `uq_conversations_visitor_session_character`（同一角色只有一段会话）；`fk_…_visitor_sessions`（CASCADE）；`ck_…_status_valid`（script/free/finished）；`ck_…_paused_node_consistent`（free ⇔ paused_node_id 非空）；`ck_…_node_version_non_negative`；`ix_…_expires_at` |
| `messages` | `id` / `conversation_id` / `character_id` / `seq` / `origin` / `text` / `node_id` / `choice_id` / `generation_request_id` / `client_message_id` / `cards`(JSONB) / `created_at` | `uq_messages_conversation_seq`；`uq_messages_conversation_client_message`（幂等；NULL 互不相等）；`fk_…_ai_requests`（SET NULL）；`ck_…_origin_valid`；`ck_…_text_length`（1–2000）；`ck_…_cards_is_array` |
| `ai_requests` | `id` / `conversation_id` / `visitor_session_id` / `client_request_id` / `status` / `day` / `provider` / `reserved_units` / `settled_units` / `prompt_codepoints` / `output_codepoints` / `error_code` / `created_at` / `updated_at` | `uq_ai_requests_visitor_client_request`（幂等）；**`uq_ai_requests_one_inflight`**（`UNIQUE (conversation_id) WHERE status='pending'`，单会话一在途的数据库级保证）；`ix_…_day` / `ix_…_visitor_day` |
| `ai_budget_days` | `day`(PK) / `reserved_units` / `settled_units` / `request_count` / `updated_at` | `ck_…_counters_non_negative` |
| `ai_visitor_days` | `visitor_session_id`(PK) / `day`(PK) / `requests` / `reserved_units` / `settled_units` / `updated_at` | `fk`（CASCADE）；非负 CHECK |

### 3.2 端点（12 条，全部新增；原 24 条不动）

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/v1/messaging/status` | 运行状态与限额。**无副作用**：不建会话、不发 Cookie（可被探针与预取器安全调用） |
| `GET /api/v1/messaging/characters` | 角色目录 + 当前访客自己的会话摘要（无会话时为 `null`） |
| `POST /api/v1/messaging/session` | 建立 / 续期访客会话，返回 `csrf_token`、角色目录、用量、隐私说明 |
| `DELETE /api/v1/messaging/session` | 立即清除该访客的全部会话与消息（204，同时清 Cookie） |
| `POST /api/v1/messaging/conversations` | 按 `character_id` 取得或创建会话 |
| `GET /api/v1/messaging/conversations/{conversation_id}` | 读取会话与全部消息 |
| `POST …/{conversation_id}/choice` | 消费一个预设选项（`choice_id` + `node_id` + `node_version` + `client_message_id`） |
| `POST …/{conversation_id}/messages` | 自由输入（`text` + `client_request_id`） |
| `POST …/{conversation_id}/resume` | 回到话题（幂等） |
| `POST …/{conversation_id}/restart` | 重开这段剧情（保留聊天记录） |
| `DELETE …/{conversation_id}` | 清除这段会话（204） |
| `GET /api/v1/admin/messaging/overview` | 运行配置（脱敏）+ 今日用量 + 累计计数 + 保留期与清除入口 |

### 3.3 本包定下的、文档未规定的传输细节（请登记为约定）

1. **HTTP 状态码描述「这次 API 操作是否成立」，AI 降级不是 4xx。**
   供应商停用 / 未配置 / 额度耗尽 / 上游超时或报错时返回 **200 + `ai.status`**（稳定机器码）
   + `ai.message`。理由：这些情况下会话状态是被正确读取 / 更新的，而且用户消息可能已经落库；
   把降级伪装成 HTTP 错误会让前端把已经保存的输入当成发送失败。客户端必须按 `ai.status` 分支。
   真正的 4xx 只有：404（不属于你 / 不存在 / 已过期）、409（`STORY_STATE_STALE` /
   `STORY_PAUSED` / `STORY_FINISHED` / `AI_IN_FLIGHT`）、422（非法选项 / 超长输入）、
   429（IP 频率或全站并发）、403（来源 / CSRF）。
2. **`ai.status` 取值集合**：`ok` `in_flight` `replayed` `disabled` `not_configured` `timeout`
   `transport` `upstream` `invalid_output` `internal` `site_daily_budget` `visitor_daily_limit`。
3. **预检失败不改状态、调用失败改状态**：供应商不可用或额度耗尽 → 会话状态**一点不动**，
   输入留在前端；已经打到上游才失败 → 用户消息已落库、剧情进入暂停态，`resume` 仍然可用。
4. **幂等键作用域**：`client_request_id` 限定到「当前访客会话」（不是全局）。
   命中已存在的行时不再调用上游；`pending` 回放返回 `ai.status="in_flight"`，
   已失败回放返回原来的错误码 —— 都不重复计费。
5. **全站日预算把已结算部分一起算**：`reserved_units + settled_units + units <= limit`。
   只看 `reserved` 会让「用一次、结算一次」等于额度永远用不完（本轮自测抓到的真实错误账本）。
6. **静态站内入口白名单**：`content.STATIC_LINKS` 只有 `/apps/ins`、`/apps/metanav`、`/map`、
   `/about`。**没有 `/posts`** —— 当前仓库 `app/posts/` 只有 `[slug]`，没有索引页，`/posts` 会 404。
   有测试逐个核对每个可解析卡片 URL 在 `apps/web/app` 下真的有页面。
7. **访客 CSRF** 复用 `app/core/csrf.py` 的 `csrf_token_for`（同一个 HMAC 原语），
   但**写闸门是本模块自己的**（见 §4 第 1 条）。
8. **单会话一在途 = 1**（`conversation_max_inflight` 固定为 1，字段保留是为了让约束可被断言）。

## 4. 过程中发现并处理的问题（都有回归测试或浏览器证据）

1. **浏览器 → Next(rewrite) → API 的同源 POST 不带 `Origin`**（T03 交付单 §8 第 1 条已记录）。
   T01 的 `verify_write_request` 对缺失 `Origin` 一律 403，因此**照搬它会让全部访客写操作失效**。
   本模块实现了一个更严且在该形态下仍然正确的闸门（`guards.py`）：
   `Origin` 存在 → 必须命中可信来源；缺失 → 必须带 `Sec-Fetch-Site: same-origin|same-site`
   **且** `Sec-Fetch-Mode: cors|same-origin`；两者都缺 → 403。CSRF token 仍必须匹配。
   **结果：真实浏览器联调不需要任何 header 补丁**（T03 当时必须给 `Origin` 打补丁）。
   42 项浏览器检查里没有一项是「补了头才通过」的。
   12 个分支全部有用例，包含「跨站 + 同源标记」与「什么都没有」两类拒绝。
2. **`service` 层没有自己掌握超时**：最初只依赖供应商实现自己的超时，
   结果模拟服务的 `timeout` 模式永远不会真超时（它只是睡一会儿就返回）。
   修为 `asyncio.wait_for(provider.complete(...), timeout=settings.ai_timeout_seconds)`
   —— **截止时间由服务掌握**，供应商的超时降级为第二道防线。端到端用例证明它真的触发。
3. **取消路径会留下 `pending` 行**：请求被取消时若不做收尾，
   `uq_ai_requests_one_inflight` 会把这一段会话锁到超时窗口结束。
   修为捕获 `asyncio.CancelledError` → 标记失败 + 结算 → 再抛出。有用例。
4. **日预算账本错误**（见 §3.3 第 5 条）：自测时「第一次请求成功 → 第二次竟然还能发」，
   原因是结算把 `reserved_units` 减回去了。修为把 `settled_units` 一起计入上限。有用例。
5. **`build_system_prompt` 直接崩**：`CARD_CONTRACT` 是一个**单元素元组**（尾逗号），
   `"\n".join()` 抛 `TypeError`。真实适配层的第一条 HTTP 用例抓到。
6. **macOS 上 `urllib` 会读系统代理**（T03 交付单 §5.3 末尾记录过同一现象）：
   对 `127.0.0.1` 的请求被系统代理探测拖到超时。修为显式 `ProxyHandler({})`，
   需要代理的部署用 `MESSAGING_AI_PROXY_URL` 指定（默认不读系统代理）。
7. **前端自动滚动把整页滚下去了**：`scrollIntoView` 会连带滚动窗口，
   实测「发完一条，输入框跑到顶部、气泡全在视野外」。修为只滚消息列表容器
   （`node.scrollTo`）。浏览器截图 02–05 是修好之后的。
8. **晚到的响应真的会被写进当前会话**：`use-conversation` 的 `send` 最初只在
   `choose/resume/restart` 上校验 conversation id。前端用例
   「晚到的响应属于别的角色」先红后绿，`send` 也加上了同一个校验。
9. **`send` 的清空草稿条件过宽**：只有 `ai.status` 是 `ok` / `replayed` 才清空，
   否则降级时输入会丢。有用例。
10. **`delete_cookie` 写在注入的 `Response` 上、却返回了另一个 `Response`**：
    FastAPI 会合并，但依赖合并顺序迟早出事。修为直接构造返回对象、直接设置 Cookie。
11. **`test_module_registration.py` 的 `EXPECTED_TABLES` 需要同步**（见 §6 第 4 条）：
    `registered_tables()` 返回的是 `Base.metadata` 的**全集**，任何新模块一旦被导入
    就会打破那条断言。这是集成动作，不是本包能改的（T00 所有）。

## 5. 验证（全部实际执行，命令与退出码）

前置：`export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"`
（另需 `npm_config_cache` / `UV_CACHE_DIR` 指向工作区，见环境约定）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `uv run --project apps/api pytest apps/api/tests/messaging` | 0 | **160 passed** |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `cd apps/web && npx eslint features/messaging app/apps/ins/messages app/admin/messages` | 0 | 0 error / 0 warning（**作用域内**） |
| `npm --prefix apps/web run test -- --run` | 0 | 整树通过 —— 交付瞬间 **53 files / 549 passed**，随后 T06 并行新增用例后为 **602 passed**；其中 `features/messaging` 4 files / **58 例**始终通过 |
| `npm --prefix apps/web run build`（`DEV_API_URL=http://127.0.0.1:8100`） | 0 | 含 `○ /apps/ins/messages`、`ƒ /apps/ins/messages/[character_id]`、`○ /admin/messages` |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed**（旧站零回归） |
| `python3 .dsh/t08-smoke/browser-verify.py`（`PHANTOM_POSTS_SOURCE=api` 构建） | 0 | **42/42 checks passed**，11 张截图（§5.3） |
| 同上（默认 `baseline` 构建） | 1 | **41/42** —— 只有 E6 失败，原因见 §5.5（数据源未切换，T00 已登记的决定） |

**整树 `npm run lint` 在本包交付时不为 0**，但**问题全部在别人正在开发的文件里**，
不在本包的任何一个文件（作用域内 lint exit 0）。逐次观察到的状态：

```text
交付过程中某一刻：6 个 error，全在 T06 的文件里
  app/admin/{albums,projects}/page.tsx
  features/gallery/{gallery-tab-loader,gallery-view,lightbox}.tsx
  features/showcase/project-gallery.tsx      （均为 react-hooks/set-state-in-effect）
交付瞬间：1 个 error —— features/showcase/project-gallery.test.tsx:336
  @next/next/no-assign-module-variable（把变量命名为 module）
```

T06 正在并行修改这些文件，因此这个数字会变。**本包结论以作用域内 lint（exit 0）
与 §5 的整树测试结果为准**；上表只是如实记录我观察到的整树状态，供 T00 在集成前复查。

### 5.1 真实 PostgreSQL（不是 SQLite，也不写共享库）

夹具在同一个本机测试集群上**自建** `pl_test_t08_<pid>`（名字经 T00 的
`register_temp_database` 登记 + `assert_test_database_url` 校验，用例结束即 drop；
带 pid 因此同机并行不会互删）。**不复用 `pl_test`**，零写入。

与 T03 的两点不同，都是本模块的性质决定的：

- **用例之间用 TRUNCATE 而不是「一个事务跑完再回滚」**：幂等唯一约束、部分唯一索引、
  跨连接可见性、并发下的原子预留，在「所有写入都待在最后被回滚的事务里」时**根本测不到**。
  清理只 `TRUNCATE visitor_sessions, ai_budget_days RESTART IDENTITY CASCADE`（级联到本模块子表）。
- **不建别人的表**：`ensure_messaging_tables` 只补本模块六张表，
  `t08_schema_report()["created_by_fallback"]` 如实报告补了哪些 —— 迁移落地后应为空。

约束证据（`test_models.py`，全部由 PostgreSQL 实际执行）：
`ck_messages_origin_valid` / `uq_messages_conversation_seq` /
`uq_messages_conversation_client_message`（含「NULL 可以重复」）/
`ck_conversations_paused_node_consistent` / `ck_conversations_status_valid` /
`ck_messages_text_length` / `ck_messages_cards_is_array` /
**`uq_ai_requests_one_inflight`**（在 `pg_indexes` 里确认定义含 `WHERE status = 'pending'`）/
`uq_ai_requests_visitor_client_request` / `ck_ai_requests_units_non_negative` /
`uq_visitor_sessions_token_hash` / 两级 `ON DELETE CASCADE`。

### 5.2 真实 HTTP 往返（不是 mock 上游）

`test_ai_adapter.py` 用一个**真的在监听端口的** stdlib `ThreadingHTTPServer` 当假上游：

```text
200 正常      → 取到 choices[0].message.content
503 → 200     → 只重试一次，共 2 次请求，attempts=2
401           → 不重试（1 次请求），错误码 not_configured，且 sk-… 不出现在异常里
200 空 choices → upstream 错误
硬超时        → timeout（且 retryable=False，不重试）
连不上        → transport / timeout
```

### 5.3 真实浏览器（Playwright + 系统 chromium；两个 BrowserContext，无 mock）

环境：真实 PostgreSQL（`pl_test_t08_smoke`）+ 真实 API 进程（8100）+ 真实 Next 进程（3100，
`DEV_API_URL` 在 `next build` 时就存在）。

```text
浏览器 A（访客 1）                                    浏览器 B（独立 Cookie jar）
 /apps/ins/messages → 消息页签 + 两位角色 ──────────▶ 同一角色 URL
 点「双叶」→ 会话打开（timeOrigin 未变）
 开场 2 条 + 3 个选项 + 「自己说一句」
 展开输入 → 首次解释「会发送给模型服务」
 发送「算法题卡了一晚上。」
   → AI 回复 + AI 标记 + 剧情暂停提示 + 「回到话题」
   → 暂停期间**没有**任何预设选项（模型不能推进剧情）
 点「回到话题」→ 原 3 个选项全部回来
   → 开场台词在整段会话里各只出现一次（无重复开场）
   → timeOrigin 仍未变（没有整页重载 → 音乐不被打断）
 选「聊聊 ACM」→ 推进到 acm 节点（选项变成 2 个）
 刷新 → 仍是同一段会话（9 条气泡 vs 开场 2 条），URL 仍只有角色 id
 /apps/ins/messages/not-a-real-character → 明确「没有这个角色」
 390px：无横向溢出；输入框与发送按钮都在视口内；发送按钮点击区 47.6px
────────────────────────────────────────────────▶ 打开 /apps/ins/messages/futaba：
                                                    看不到 A 的输入、看不到 AI 回复，
                                                    拿到的是全新开场
```

**42 项检查逐条 PASS**（`PHANTOM_POSTS_SOURCE=api` + `API_INTERNAL_URL` 构建，
即 T00 集成时要切到的目标状态；默认 `baseline` 下是 41/42，见 §5.5）。
截图 12 张（**已入库**，可分发）：

```text
docs/design-references/im/screens/01-role-list.png
docs/design-references/im/screens/02-conversation-opening.png
docs/design-references/im/screens/03-free-chat-ai-reply.png
docs/design-references/im/screens/04-back-to-topic.png
docs/design-references/im/screens/05-story-advanced.png
docs/design-references/im/screens/06-unknown-character.png
docs/design-references/im/screens/07-narrow-390-composer.png
docs/design-references/im/screens/08-narrow-390-overlap-poll.png
docs/design-references/im/screens/08-narrow-390-reply.png
docs/design-references/im/screens/09-second-browser-fresh.png
docs/design-references/im/screens/10-content-card.png
docs/design-references/im/screens/11-story-content-card.png
```

### 5.5 联调中发现的一条跨模块事实（数据源未切换时内容卡片会 404）

默认构建（`PHANTOM_POSTS_SOURCE` 未设置 = `baseline`）下，`/posts/<slug>` 只服务旧站
`posts.js` 里的 8 篇；而 T08 的内容卡片是**按 FastAPI 的公开状态**解析出来的，
因此指向一篇只存在于数据库里的文章时，卡片本身正确、目标页面却 404：

```text
baseline 构建：{'/posts/t08-smoke-post': 404, '/apps/ins/<uuid>': 200}   → 41/42
api   构建：{'/posts/t08-smoke-post': 200, '/apps/ins/<uuid>': 200}   → 42/42
（api 构建 = PHANTOM_POSTS_SOURCE=api + API_INTERNAL_URL=http://127.0.0.1:8100，
  两者都必须出现在 **next build** 时；只设运行时变量会让 /posts/[slug] 保持 ● SSG 并返回 404/500）
```

这不是 T08 的缺陷：按 SHARED-CONTRACTS §1，FastAPI 才是公开状态的权威，
卡片跟着权威走是对的。它是 T00 集成日志里已经登记的
「`PHANTOM_POSTS_SOURCE=api` 的切换与重新构建是同一步」那条决定的**用户可见后果** ——
T08 是第一个把它暴露成「点了 404」的模块。**建议 T00 在集成 T08 时一并切换并重新构建。**

**联调脚手架（不是生产接线，且不在仓库里）**：`app/router.py` / `app/model_registry.py`
由 T00 拥有，T08 不改。联调用一个**进程外补丁**
（工作区 `.dsh/t08-smoke/sitecustomize.py`，通过 `PYTHONPATH` + `T08_SMOKE_WIRING=1` 生效）
把 `("messaging", "app.modules.messaging.router")` 与 `app.modules.messaging.models`
追加进清单 —— 它做的正是 §6 要求 T00 做的事。
**因此这 42 项检查跑在原样的生产 app 上，唯一的外力就是那两行清单追加。**

与 T03 的关键差别：**没有给 `Origin` 打补丁**（见 §4 第 1 条）。

### 5.4 验收用例 → 证据映射

| 任务卡验收用例 | 覆盖位置 | 关键断言 |
| --- | --- | --- |
| 自由聊后回到话题 | `test_hybrid_flow.py`（11）+ 浏览器 B14/B15 | `node_id` 与 `node_version` 都不变；开场每句只出现一次；暂停时不给选项；恢复后原选项可用且分支一致 |
| A 浏览器访问 B 的 conversation ID | `test_isolation.py`（6） | 读 / 选 / 发 / 回到 / 重开 / 清除**六条路径全部 404**；B 的消息、节点、版本逐字不变；随机 UUID 与非法 UUID 同形 |
| 网络重试与重复点击 | `test_idempotency.py`（8） | 同一 `client_request_id` 只调上游一次（用计数 provider 断言），`ai.status="replayed"`；不同 ID 在途 → 409；两标签页共用同一段会话 |
| 切换角色后旧响应到达 | `test_idempotency.py` 两例 + 前端 1 例 | 写回时 `conversation_id` 与 `character_id` **同时**匹配；不匹配即丢弃；前端也校验 | 
| 私密日记 / 草稿 / 其他会话不进模型输入或卡片 | `test_content.py`（11） | 候选清单里根本没有草稿；模型回显的清单外 token 被丢弃；`/admin` 之类路径不在白名单 |
| 请求预算跨重启、并发 | `test_budget.py`（11） | 4 线程抢 4 个单位只成功 4 次；换独立引擎仍读得到计数；`settled` 计入上限 |
| 无模型或额度耗尽 | `test_degradation.py`（12） | 停用 / 未配置 / 超时 / 上游错误 / 输出不可用 / 取消六种路径下**预设剧情仍可继续**；文案说的是服务不是角色情绪 |
| 清除 / 过期 / 恢复备份 | `test_sessions.py`（13）+ `test_hybrid_flow.py` 1 例 | 清除后消息行数为 0；过期后**物理删除**并新建；`purge_expired` 幂等；全站预算不因清除而回退 |
| 原版对照与 390px 软键盘 | `docs/design-references/im/` + 浏览器 D1–D4 | 无横向溢出、输入与发送都在视口内、点击区 ≥44px；**视觉还原本身未验收**（§7 第 1 条） |
| 内容卡片只指向真实公开内容 | `test_content.py`（10）+ 浏览器 B21–B23 / E4–E6 | 模型回显的清单外 token 被丢弃；卡片 URL 由服务端生成；`/posts/<slug>` 与 `/apps/ins/<uuid>` 都真的返回 200（§5.5 记录数据源未切换时的例外） |

## 6. 集成申请（按优先级）

### A. 必须（不做就等于没接线）

1. **模型注册**：`app/model_registry.py` 的 `MODEL_MODULES` 追加
   `"app.modules.messaging.models"`。它不引用其他域的表，放在 `auth` 之后即可
   （推荐追加到末尾）。
2. **路由登记**：`app/router.py` 的 `MODULE_ROUTER_TARGETS` 追加
   `("messaging", "app.modules.messaging.router")`。按名称排序会插到
   `media` 与 `moments` 之间；两条前缀（`/messaging`、`/admin/messaging`）当前无人占用
   （已对照 8dc393e 的清单确认）。
3. **迁移**：新建一个 Alembic revision 建出 §3.1 的六张表与全部约束 / 索引。
   **重点**：`uq_ai_requests_one_inflight` 必须是
   `UNIQUE (conversation_id) WHERE status = 'pending'` 的**部分唯一索引**，
   否则「单会话一在途请求」失去数据库级保证（它正是并发用例的依据）。
   T08 **没有**写 `migrations/`、没有执行迁移、没有改 `model_registry.py`。
4. **`apps/api/tests/test_module_registration.py` 的 `EXPECTED_TABLES`** 追加六个表名：
   `ai_budget_days` / `ai_requests` / `ai_visitor_days` / `conversations` / `messages` /
   `visitor_sessions`。`registered_tables()` 返回 `Base.metadata` 的**全集**，
   因此这条断言与 `MODEL_MODULES` 必须同时更新（这是 T00 的文件，T08 不改）。
5. **环境变量（全部有默认值，不配也能跑）**：`deploy/env.example` 与
   `deploy/compose.dev.yaml` 建议加入 `MESSAGING_AI_PROVIDER=simulator`、
   `MESSAGING_AI_TIMEOUT_SECONDS`、`MESSAGING_VISITOR_DAILY_REQUESTS`、
   `MESSAGING_SITE_DAILY_UNITS`、`MESSAGING_SITE_MAX_CONCURRENCY`、
   `MESSAGING_VISITOR_SESSION_IDLE_SECONDS`、`MESSAGING_CONVERSATION_IDLE_SECONDS`。
   **当前一条都不配置时全部走默认值**（默认供应商 = 模拟服务，不联网）。

### B. 前端接线（两处，都很小）

6. **INS 独立页显示消息页签**（`app/apps/ins/page.tsx` 是 T03 的文件，T08 不改）：
   把 `import { InsApp } from "@/features/ins/ins-app"` 换成
   `import { InsAppWithMessages } from "@/features/messaging/ins-integration"`，
   JSX 标签同步改名，其余 props 原样传。
   **为什么必须换组件而不是直接传 `tabContributions`**：`MESSAGES_TAB` 里含
   `render` / `isAvailable` 两个**函数**，React 不允许把函数从服务端组件传给客户端组件。
   `InsAppWithMessages` 是客户端组合件，注入发生在客户端这一侧。
7. **手机屏**（`features/ins/phone-app.tsx` 是 T03 的文件，T08 不改）：把默认导出换成按屏幕分派：

```ts
import MessagingPhoneView, { screens as MESSAGING_SCREENS } from "@/features/messaging/phone-app";

function InsPhoneRoot(props: PhoneViewProps) {
  if (MESSAGING_SCREENS.includes(props.screen)) return <MessagingPhoneView {...props} />;
  return <InsPhoneView {...props} />;
}
export default InsPhoneRoot;
export const screens = [...INS_APP_SCREENS, ...MESSAGING_SCREENS];
```

   不做这一步的后果是明确的：`screen=messages` 会被宿主**正确回退桌面**（不显示坏按钮），
   canonical 路由 `/apps/ins/messages` 仍然可用 —— 也就是「能用但没有手机入口」。
   屏幕名：`messages`（列表）/ `conversation`（一对一，`item` = 角色 id）。
8. **`OpenAPI` / 生成类型**：由 T00 在挂载后端后重跑 `npm run gen:api`。本包前端**没有**
   import `lib/api/generated/`，用的是手写但逐字段对齐的接口，字段名不变。

### C. 请 T00 决策

9. **`.dsh/t08-smoke/` 的三件套（`prepare.py` / `browser-verify.py` / `sitecustomize.py`）
   在工作区临时目录里，不属于仓库**。要不要像 T02 那样整理成
   `apps/web/tools/browser-verification/messaging-*.py` 由 T00 决定。
   `sitecustomize.py` 只做清单追加（T00 接线后就只剩空文件，可删）。
10. **本包没有新增任何依赖**。真实适配层用标准库 `urllib`，因此**不需要**把 `httpx`
    从 dev 提升为运行时依赖。若 T00 更希望用 `httpx`，替换
    `ai/openai_compatible.py` 的 `_post_json` 一个函数即可，其余代码不动。
11. **`T01 verify_write_request` 的候选改进**（§4 第 1 条）：把「缺失 `Origin` 但
    `Sec-Fetch-Site` 证明同源」视为同源，可以让所有模块都不再需要联调补丁。
    T08 没有改 `app/core/`；本模块的 `guards.py` 已经这么做了，可直接参考。

## 7. 未验证项及原因（不得当作已通过）

1. **原版 IM 的视觉还原本身未验收**。任务卡要求「先取得完整的一对一 / 回复选项参考帧」，
   本轮手上只有**元件素材表**（`132782-im-assets-cn-jp.png`），没有任何一帧完整界面。
   素材表能证明「有哪些图形」，推导不出整屏比例。因此：结构、配色与消息层次是按 08 §5
   的语汇实现的原创适配，**逐像素对照未做**。逐项校准与偏差记录见
   `docs/design-references/im/README.md` §3。**需要有人提供完整参考帧才能补这一项。**
2. **真实 AI 供应商完全未接通**。没有凭证、没有预算、没有确定供应商，因此：
   - `openai_compatible` 适配层只用**本机假上游**验证过（真实 HTTP 往返，但不是真模型）；
   - 「真实模型的回复质量 / 角色一致性 / 越狱抵抗 / 真实费用」一项都没测；
   - `/status` 与 `/admin/messages` 会如实显示当前是「模拟服务」，不会伪装成真模型。
   这是任务卡明确要求诚实说明的项。
3. **多进程 / 多 worker 下的并发闸门**：`site_max_concurrency` 读的是 `ai_requests` 里的
   `pending` 行（跨进程有效），但真实 uvicorn 多 worker 压测没做；
   `anyio.CapacityLimiter` 那条路径（`app/core/concurrency.py`）只在图片处理里用过。
4. **真机（Android / iOS）与软键盘**：只有桌面 chromium。390px 验证的是布局与
   「输入区在视口内」，没有真机软键盘弹起后的可视区变化证据。
5. **Safari / Firefox**：未测。`crypto.randomUUID` 的降级路径有单测（`newClientId`），
   但真实隐私模式下的 Cookie 行为未验证。
6. **定时清理与备份**：`sessions.purge_expired()` 是**可被调用的入口**，有用例证明它幂等、
   真的删行；但没有任何调度器在跑它，也**没有验证「恢复备份后旧会话不会悄悄复活」**。
   按任务卡，这两项交给 T10（`/admin/messages` 的 `retention` 段如实写明了这一点）。
7. **Docker / 容器内运行**：Docker daemon 未运行，未做容器内联调（属 T10）。
8. **「关闭面板停止接收」的上游取消效果**：前端 abort 会让服务端的 `wait_for` 收到取消，
   测试覆盖了「取消时不留下 `pending` 行」；但**已经产生的上游成本不假装撤销**
   （结算保留），而真实供应商是否支持服务端主动取消，未验证。
9. **跨浏览器并发编辑同一段会话**：`STORY_STATE_STALE` 有 API 用例与前端用例，
   但没有两个真实浏览器同时选同一节点的端到端录制。
10. **读屏软件**：ARIA 结构（`role="tablist"` / `role="status"` / `ol` 顺序语义 /
    `aria-invalid` / `aria-describedby`）都有断言，但没有用 VoiceOver / NVDA 实测。
11. **`MESSAGING_*` 环境变量在 `Settings` 里的共存**：已验证 T00 的
    `Settings(extra="forbid")` **不会**因为存在 `MESSAGING_*` 变量而启动失败（实测），
    但没有在完整 `deploy` 配置下验证。

## 8. 遗留与需要外部选择的问题

1. **【需要决策】模型供应商、凭证与日预算**。`MESSAGING_AI_PROVIDER` 默认 `simulator`；
   要接通真实模型需要供应商、端点、密钥、型号与预算上限。在拿到之前，
   本包的功能边界是「链路与降级全部成立，真实模型未验收」。
2. **【需要决策】每日额度与保留期的最终数值**。当前默认：每访客每天 20 次、
   输入 1000 码点、每次最多 3 个短气泡、全站 2000 单位/天、全站并发 4、
   会话保留 24 小时（滑动）+ 72 小时绝对上限。这些是 08 §7 的候选值，没有真实费用依据。
3. **【跨模块观察】全站问卷浮层在 390px 上盖住页面底部的输入区**。
   证据：`docs/design-references/im/screens/08-narrow-390-overlap-poll.png`。
   浮层是 `position: fixed`（T02 / 旧站遗产），因此**任何**页面底部的交互元素都会被盖住
   （不只角色消息）。用户可以按 Escape / 点 X 关掉。是否需要调整属 T02 / T10。
4. **【跨模块发现，T03 的范围】INS 底部的 `<Link href="/posts">长文在博客里</Link>`
   指向一个不存在的路由**：当前 `apps/web/app/posts/` 只有 `[slug]`，没有索引页，
   因此 `/posts` 会 404。T08 在自己的 `STATIC_LINKS` 白名单里**刻意排除了 `/posts`**，
   并有测试逐个核对卡片 URL 真的有页面。`features/ins/ins-shell.tsx` 的那一处请 T03 / T00 决定。
5. **`shared` 判定：`/apps/ins/messages` 目前是「能用但没有入口」**。
   在 §6 第 6 / 7 条接线完成前，访客只能通过直接 URL 进入；
   `<InsShell>` 的页签条上没有「消息」（这是 T03 组合契约的正确行为：未注入就不显示）。
6. **`api_requests` 的 `prompt_codepoints` 只是输入文本长度**，不含系统提示与候选清单，
   因此它不是 token 数、也不是费用。真实供应商接上后应按上游返回的 usage 结算
   （`budget.settle(units=…)` 已经预留了这个入口）。
7. **`cards` 用 JSONB 而不是独立表**：单条消息最多 2 张卡片、不需要反向查询，
   因此没有建 `message_cards`。若将来要「按内容反查哪些会话提到它」，需要改为关联表。
8. **`.next` 是共享构建产物，且我留下的状态需要你知道**。交付瞬间它是：
   `DEV_API_URL=http://127.0.0.1:8100` + **默认数据源**（`PHANTOM_POSTS_SOURCE` 未设置）
   的一次 `next build`。我的 `uvicorn`(8100) 与 `next start`(3100) **已按端口精确停止**
   （`lsof -ti tcp:8100 | xargs -r kill`，没有用 `pkill`），旧站 8000 预览未动。
   做集成回归前请用你自己的配置重新 `next build` 再 `next start`
   （与 T03 交付单 §8 第 6/9 条同一件事）。
9. **我为联调建的三件套已清理**：`pl_test_t08_smoke` 已 drop（`pl_test_t08_*` 现在一个不剩），
   `.dsh/t08-smoke/` 仍在工作区（不在仓库里），可随时删除。
   别人的库（`pl_test_t03_smoke` / `pl_test_t04_dev` / `pl_test_t05_dev` / `pl_test_t06_dev` /
   `pl_test_t07_dev` / `pl_test_t10proxy_*`）**一个都没有碰**。

## 9. 复现命令

```bash
cd /Users/学习/blog/Blogs
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"

# 后端（自建 pl_test_t08_<pid>，用例结束自动 drop）
uv run --project apps/api pytest apps/api/tests/messaging        # 160 passed
# 前端
npm --prefix apps/web run typecheck
(cd apps/web && npx eslint features/messaging app/apps/ins/messages app/admin/messages)  # 作用域内 lint，exit 0
npm --prefix apps/web run test -- --run                          # 整树通过（T08 的 58 例在内）
DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
# 旧站零回归
node --test tests/*.test.cjs                                     # 53 passed

# 真实浏览器闭环（三件套：联调库 + API + Web）
# 先用自己登记的库名建库（prepare.py 内部会 register_temp_database 后 drop+create）
export APP_ENV=dev SECRET_KEY="t08-smoke-secret-key-not-used-anywhere-0123456789"
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
export DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t08_smoke"
uv run --project apps/api python /Users/学习/blog/.dsh/t08-smoke/prepare.py

T08_SMOKE_WIRING=1 PYTHONPATH="/Users/学习/blog/.dsh/t08-smoke:apps/api" \
  APP_ENV=dev DATABASE_URL="$DATABASE_URL" SECRET_KEY="$SECRET_KEY" \
  MEDIA_ROOT=/Users/学习/blog/.dsh/t08-smoke/media CORS_ORIGINS=http://127.0.0.1:3100 \
  uv run --project apps/api uvicorn app.main:app --port 8100

# 目标状态（42/42）：数据源与内部地址在 **build 时**就要有值
PHANTOM_POSTS_SOURCE=api API_INTERNAL_URL=http://127.0.0.1:8100 \
  DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
PHANTOM_POSTS_SOURCE=api API_INTERNAL_URL=http://127.0.0.1:8100 \
  DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run start   # 3100
python3 /Users/学习/blog/.dsh/t08-smoke/browser-verify.py          # 42/42 passed

# 默认数据源（baseline）下是 41/42：只有「卡片指向的 /posts/<slug> 真的存在」这一项失败，
# 原因见 §5.5（T00 已登记的「数据源切换与重新构建是同一步」）。
DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run start
```

清理：临时库由夹具自动 drop；`pl_test_t08_smoke`、`.dsh/t08-smoke/`（含 media 与截图脚本）
都是工作区临时对象，可随时删除。**仓库内的 `docs/design-references/im/screens/*.png` 是
要保留的对照证据**（可分发，自己截的）。
