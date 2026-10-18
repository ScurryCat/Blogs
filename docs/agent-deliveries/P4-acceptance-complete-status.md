# 完整验收 2026-10-18 · 当前状态单一摘要（2026-10-18）

> 对象：`docs/acceptance/2026-10-18-complete-acceptance.md`。
> 本文件替代历史报告里互相矛盾的数字，只列**当前**已通过范围与未关闭项。

## 1. 源码与包

- 仓库 HEAD：`dfb3fca`（`main` 领先本地 `origin/main` 30 个提交，**未推送**）
- 完整交接包：`docs/handoff-package-2026-10-18-complete.zip`（161 文件 / 13.2 MiB；
  `--check`、`unzip -t` 通过；包内 HEAD 为打包提交前祖先，属正常）
- 自动化：前端 **936** 单测 / 后端 **952** / T02 52/52 / 多视口 11 / 业务流 4/4 / 端到端 12；
  WebKit 28/28；图片消息 e2e 60/60；管理端隔离流程 19/19

## 2. 本轮（完整验收）已修复

| 项 | 结果 | 证据 |
| --- | --- | --- |
| R2 图片灯箱 Escape 退出 App | ✅ 修复（OverlayManager + Portal；会话/滚动/焦点保留） | `P4-acceptance-complete-r2r3.md`；e2e 60/60 |
| R3 灯箱图片失败无降级 | ✅ 修复（可读状态 + 可关闭） | 同上；单测/浏览器 |
| R1 参考帧游戏/用途错标 | ✅ 帧已重标/补正确 P5R 帧；**G2 回复选择帧仍缺** | `P4-acceptance-complete-r1.md`；21/21 |
| §6.1 AI 位图默认回退 | ✅ 已移除；2 原版 + 8 自绘适配；**全部原作图标仍未定稿** | `P4-acceptance-complete-residual.md` |
| §6.2 相册 1200 上限提示 | ✅ 已加提示 | 同上；编辑器测试 13/13 |
| §6.3 pending/失败标题 | ✅ 中性文案 | 同上 |
| §6.4 历史文档混杂 | ✅ 当前 HANDOFF 更新、历史文档标注 | 同上 |
| §6.5 精选库摘要 | ✅ README/INDEX 21 帧 | 同上 |
| §6.6 IM 阶段边界 | ✅ Phase 1 完成、2/3 未做 | 同上 |
| §5 WebKit 断言有效性 | ✅ 目标应用/IM 会话/回复选项断言；28/28 | `P4-mobile-engine-evidence.md` |
| §7.4 管理端隔离全流程 | ✅ 草稿保留/图库/撤回联动；19/19 | `P4-acceptance-complete-admin-flow.md` |

## 3. 仍未关闭（需外部输入）

1. **G2**：P5/P5R IM **回复选择**完整帧仍缺（已穷尽 Steam/PS/GUD/Wccftech/Bing/Yandex）；
2. **手机图标全部原作定稿**：剩余 8 枚为自绘适配，AI 位图回退已移除；
3. **真机验证**：无 iPhone/Android 设备（软键盘/中文输入法/真实触控/移动 Safari）；
4. **整屏逐像素还原验收**：当前为视觉语言级修形，尺寸/间距/字体未逐像素对照；
   IM 消息块已按报告 §5 改为黑底白边斜切（第三轮），标题比例/头像/选项布局仍待微调。

## 4. 复验命令

```bash
bash tools/verify-all.sh --e2e --mobile        # 全量 7/7
PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright python3 tools/e2e-webkit-mobile-smoke.py http://127.0.0.1:3100
python3 tools/e2e-im-image-card.py http://127.0.0.1:3100
bash tools/e2e-stack.sh up && E2E_ADMIN_USER=owner E2E_ADMIN_PASSWORD=e2e-password-123 \
  python3 tools/e2e-ins-draft-album-flow.py http://127.0.0.1:3130 && bash tools/e2e-stack.sh down
python3 tools/acceptance/verify-reference-frames.py
```
