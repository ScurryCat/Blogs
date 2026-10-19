# 文档导航

更新：2026-10-19。本页是仓库内的阅读入口，不是新的验收结论。

## 从哪里开始

| 你要做的事 | 先读 |
| --- | --- |
| 了解项目、启动新版应用 | [项目 README](../README.md)、[开发指南](development/README.md) |
| 修改代码、提交 PR、交给其他 agent | [贡献与交接约定](../CONTRIBUTING.md) |
| 了解当前创作台范围 | [第一批创作台设计](handoff/2026-10-18-p5-creator-workspace-design.md)、[交付说明](agent-deliveries/P5-final-report.md) |
| 查看已记录的返工与验证 | [返工验证记录](acceptance/P5-rework-verification-2026-10-19.md)、[D1 容器证据](acceptance/P5-D1-compose-healthcheck-2026-10-19.md) |
| 规划部署、备份和回退 | [运维入口](operations/README.md)；先读限制，再执行经过核对的手册 |
| 准备受限个人试用 | [M1A 试用手册](operations/trial-runbook.md)；远端接入和真机仍须单独确认 |
| 找游戏图标、视觉参考与素材范围 | [图标映射](design-references/icon-mapping.md)、[参考帧来源](design-references/reference-frame-sources.md)、[参考缺口](design-references/reference-frame-gaps.md) |
| 维护早期静态站或问卷组件 | [旧版静态站说明](legacy/README-static-site.md)，不作为新版启动说明 |

## 设计与共享约定

早期设计保留原路径供追溯；其中的栏目、照片展区、手机顺序和阶段状态可能已被后续设计覆盖。实施时核对最新需求、当前代码和交付记录，不根据旧文档恢复已经替换的行为。

- [技术架构](superpowers/specs/2026-10-16-stack-architecture-design.md)
- [数据与 API](superpowers/specs/2026-10-16-data-api-design.md)
- [手机应用平台](superpowers/specs/2026-10-16-phone-app-platform-design.md)
- [INS](superpowers/specs/2026-10-16-ins-design.md) 与 [角色消息](superpowers/specs/2026-10-16-character-messaging-design.md)
- [异世界导航](superpowers/specs/2026-10-16-metaverse-navigator-design.md) 与 [世界功能](superpowers/specs/2026-10-16-world-features-design.md)
- [早期共享契约](superpowers/plans/2026-10-16-agent-handoff/SHARED-CONTRACTS.md) 与 [任务划分](superpowers/plans/2026-10-16-agent-handoff/README.md)
- [第三轮集成记录](agent-deliveries/N0-result.md)、[创作台集成约定](agent-deliveries/P5-C0-integration-contract.md)

后续 M0–M5 路线摘要在 [项目 README](../README.md#后续路线)。长期开发主本目前仍在站主的规划工作区，由站主／集成负责人维护；它尚未迁入本仓库，也不把交接包中的旧快照另立为主本。需要该主本时随任务单明确提供版本。

## 验收和交付资料怎么读

| 目录 | 含义 | 不能据此推断 |
| --- | --- | --- |
| `acceptance/` | 指定版本的检查、问题和证据入口 | 当前代码、全部真机或生产均已通过 |
| `agent-deliveries/` | 开发方的实现清单、过程记录、测试报告 | 自动等同于独立验收签收 |
| `design-references/` | 游戏参考、适配说明、来源、素材清单 | 已取得所有资源的分发授权 |
| `handoff/` | 设计和特定时点交接资料 | 所有历史条目仍是当前需求 |
| `superpowers/` | 早期规格、实施计划与任务卡 | 可以不核对新版本直接执行 |
| `operations/` | 发布、运行与恢复手册，部分含历史快照 | 已经获得远端操作权限或完成上线 |
| `legacy/` | 旧版静态站文档 | 新版应用仍然零构建、只需静态托管 |

更新状态时写明代码 SHA、环境、命令、结果及未验证范围。日期较新也不自动表示证据更完整；冲突应显式注明，不悄悄修改历史测试输出。

## 素材入口

- [活动精选库方案](design-references/persona-curated-plan.md)
- [允许使用清单](design-references/persona-assets-allowlist.md) 与 [机器可读清单](design-references/persona-assets-manifest.csv)
- [排除审计](design-references/persona-assets-excluded.md) 与 [移除记录](design-references/persona-assets-removed.md)
- [原版 App 图标](design-references/original-app-icons.md)、[字体与反馈规范](design-references/typography-and-feedback.md)、[IM 参考与对照](design-references/im/README.md)

“允许使用清单”是本项目的资源选择／复核记录，不等同于第三方版权授权。原始参考库不默认打包到网站。

## 历史交接 ZIP

下列文件已经被 Git 跟踪，本轮原样保留。它们是历史快照，不代表当前 HEAD，也不建议把新代码覆盖打包回同名文件。

| 快照 | 用途 |
| --- | --- |
| [2026-10-17](handoff-package-2026-10-17.zip) | 早期交付包 |
| [2026-10-17 v2](handoff-package-2026-10-17-v2.zip) | 同日第二版交付包 |
| [2026-10-18 complete](handoff-package-2026-10-18-complete.zip) | 当轮交付快照；文件名不表示当前已全部完成 |
| [2026-10-19 creator workspace](handoff-package-2026-10-19-p5-creator-workspace.zip) | 创作台交付快照 |

新增交接 ZIP 默认忽略；文本任务单、验收摘要和脱敏证据应优先独立维护。需要分发新包时使用新文件名，记录来源 SHA、包含清单、哈希与验证范围，按任务要求单独交付。

`tools/package-handoff.py` 当前默认目标是历史 v2 包，并带有旧验收断言。不要将它作为通用命令直接运行；使用前必须核对输出位置、断言和文件范围，避免覆盖历史或把旧结论写进新包。

## 文档维护规则

1. README 概括项目、当前边界和入口；操作细节放开发／运维文档，避免多份命令各自漂移。
2. 文档使用仓库相对链接，命令从明确的工作目录执行，不把某台机器的绝对路径当作通用前提。
3. 历史证据保留；纠正旧结论时添加带日期的说明，不能把过去的失败改写成通过。
4. 不提交真实 `.env`、访问令牌、Cookie、用户私密内容、数据库备份或未经核查的原始素材。
