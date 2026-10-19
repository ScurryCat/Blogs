#!/usr/bin/env python3
"""重新打包交接包（v2）：把当前仓库的**文档 + 工具**打成一个可直接接手的 zip。

为什么需要：第一版交接包（`docs/handoff-package-2026-10-17.zip`，HEAD 6320861）打包后，
会话又完成了 13 轮视觉还原/缺陷修复/验收复跑，文档与工具都变了；接手者应该拿到
**当前状态**的自包含包，而不是在旧包基础上再翻 git 历史。

与原包保持同样的内容口径（便于对照），P5 起补充交接必需材料：
  - 包含：HANDOFF.md（更新版 + P5 段）+ MANIFEST + SHA256SUMS + SOURCE-REVISION.md +
    docs/agent-deliveries/ + docs/design-references/ + **docs/acceptance/** +
    **docs/handoff/（设计书副本）** + **contracts/openapi.json** + tools/（脚本白名单）+
    visual-evidence/（本地视觉证据快照，含 P5 关键流程）
  - 不包含：源代码（在仓库里）、任何凭据、未列入 visual-evidence 的临时分析产物。

用法：
    python3 tools/package-handoff.py                 # 写到默认位置
    python3 tools/package-handoff.py --check         # 只检查包内容与源文件是否一致
    python3 tools/package-handoff.py --out <path>

退出码：0 = 成功（并打印包大小/文件数/HEAD）；非 0 = 缺文件或写失败。
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / "docs" / "handoff-package-2026-10-17-v2.zip"
PACKAGE_DIR = "handoff"

# 作业类脚本之外的小工具目录：与原包一致，属工作流辅助，不随交接包分发。
TOOL_WHITELIST = [
    "acceptance",
    "e2e-im-draft.py",
    "e2e-ins-conversation.py",
    "e2e-ins-album-links-ui.py",
    "e2e-ins-draft-album-flow.py",
    "e2e-im-image-card.py",
    "e2e-ins-tag.py",
    "e2e-journal-reading.py",
    "e2e-metanav-palace.py",
    "e2e-phone-scroll.py",
    "e2e-p5-workspace.py",
    "e2e-seed-journal.py",
    "e2e-seed-palaces.py",
    "e2e-seed-previews.py",
    "e2e-stack.sh",
    "p0-analyze-sprites.py",
    "p0-contact-sheets.py",
    "p0-extract-sheets.py",
    "pg-local.sh",
    "verify-all.sh",
    "verify-backend-isolated.sh",
    "verify-isolated.sh",
    "audit-contrast.py",
    "audit-structure.py",
    "audit-failure-states.py",
    "seed-demo-content.py",
    "verify-home-refresh.py",
    "capture-visual-comparison.py",
    "verify-demo-content.py",
    "package-handoff.py",
]

UPDATE_BANNER = """<!-- PACKAGE-V2 -->
> ## 当前状态（2026-10-19）
>
> 代码基线 = 包内 `{head}`；分支/远端状态以 `handoff/SOURCE-REVISION.md` 为准。
> **全量门禁**：`tools/verify-all.sh --e2e --mobile` **7/7 段全绿**——前端 **1123** 单测、
> 后端 **1025**、T02 52/52、多视口 11、业务流 4/4、端到端 12（桌面 6 + 移动 6）；
> 另有 WebKit + iPhone 视口 **28/28**、IM 图片 e2e **60/60**、管理端 INS 隔离流程 **19/19**、
> 参考帧校验 **22/22**。
>
> **P5 第一批 · 站主日常创作体验（2026-10-19 实现 + 验收通过）**
> - 提交：`3b0914e`（实现）→ `9644737`（验收期修复 + 验收报告）→ `84cb75c`（最终交付报告/收口）。
> - 范围：`/admin` 创作台首页；INS 选图优先独立编辑页；手记独立编辑页（默认私密、保存≠公开、
>   公开编辑走工作副本）；**服务端工作草稿**（自动保存只写草稿、本机恢复副本、412 版本冲突显式处理、
>   跨设备恢复、幂等提交/事务/双版本检查）；共享图片选择器；放课后追番/游戏快捷更新；
>   前台 INS/手记/放课后/勒布朗站主入口与 `returnTo` 来源上下文恢复。
> - 验收：**A1–A12 全通过**；B1/B3/B4/B5 通过；**B2 真机（触控/软键盘/中文输入法/移动 Safari）
>   未验证（无设备）**。P5 e2e **219/0**；后端整树 **1025/0**；前端单测 **1123/0**；
>   隔离 build exit 0（37/37）；迁移 upgrade→downgrade→upgrade + 旧数据保留 PASS；OpenAPI/gen:api 无漂移。
> - **详细交接**：`docs/agent-deliveries/P5-HANDOFF-2026-10-19.md`（架构/接口/文件地图/复验命令/坑）；
>   总结 `P5-final-report.md`；逐条证据 `docs/acceptance/P5-acceptance-report.md`；
>   接口约定 `P5-C0-integration-contract.md`；设计书 `docs/handoff/2026-10-18-p5-creator-workspace-design.md`。
> - 证据截图：`visual-evidence/p5-*.png`；e2e 脚本：`tools/e2e-p5-workspace.py`。
> - **边界**：文章编辑器与完整媒体管理属第二/三批，不计入第一批完成声明。
>
> **2026-10-19 · 游戏内 IM 聊天界面复刻（6 轮，目标完成）**
> - 手机宿主内全屏 IM：去掉网页式 App 头，返回键改浮层黑白红方钮；IM 占满手机屏；
> - 黑底白字 + 红色左条 + 红硬阴影的 IM wordmark；
> - 黑底白边粗体消息条、4px 白边、逐条微倾角、头像白纸黑框压边 + 白色三角、右下白色小标记；
> - 白底黑边箭头回复选项、右对齐、首条红字、紧叠错位；
> - 底部圆形操作键 `(L) 滚动` / `(✕) 返回`（手机内隐藏自由输入条，独立页保留）；
> - 收件列表：黑底白边斜切行、IM wordmark、真实会话状态标签与 `last_message_at` 日期标签
>   （`M/D 周X`，Asia/Shanghai），不伪造游戏 HOLD/NEW；
> - 证据：`docs/agent-deliveries/P4-im-game-replica.md`、
>   `visual-evidence/im-game-replica-comparison.png`（游戏帧 ↔ 站点并排）、
>   `visual-evidence/im-game-replica-conversation.png`、`im-game-replica-inbox.png`。
> - **边界**：不复制游戏场景/手部；站点是固定桌面手机壳；内容量不同；不宣称逐像素等比。
>
> **完整验收 2026-10-18 报告**：可执行返工项已收口——
> R1 三张错标参考帧已重标并补正确 P5R 帧，**G2 回复选择帧由站主提供（22/22）**；
> R2 灯箱 Escape 不再退出 App、R3 灯箱失败降级（e2e 60/60）；§6 相册上限提示/中性标题/
> 历史标注/精选库摘要/IM 阶段边界；§7.4 管理端隔离全流程 19/19；WebKit 断言 28/28。
> 手机图标：2 枚原版 + 10 枚站主授权的 AI 同风格图标（`ai-app-icons.md`），旧 AI 位图默认回退已移除。
> 真机验证按站主指示**暂时跳过**；不宣称真机或跨设备逐像素通过。
>
> 此前交付（保留在文档中）：B1 九界面视觉修形、IM 图片消息 Phase 1、G2/参考帧补齐、
> AI 图标、手记/IM 逐像素轮次、P5 创作台集成（工作草稿/自动保存/INS 选图/快捷入口）。
>
> **仍未关闭**：真实设备（软键盘/中文输入法/真机触控/移动 Safari）；整屏逐像素还原；
> IM 图片消息 Phase 2（AI 选图）/ Phase 3（访客引用相册）未做。
>
> 建议阅读顺序：`docs/agent-deliveries/HANDOFF.md` → `P5-HANDOFF-2026-10-19.md`（接 P5 任务必读）
> → `P5-final-report.md` → `P5-C0-integration-contract.md` → `P4-acceptance-complete-status.md`
> → `P4-im-game-replica.md` → `P4-final-state.md` → 本包 `handoff/SOURCE-REVISION.md`。
> 历史文档（v2 fixes、round3 补帧、acceptance-v2-response）已标注适用基线，勿用旧数字拼凑。
<!-- /PACKAGE-V2 -->

"""


def run(*args: str) -> str:
    return subprocess.run(args, cwd=REPO, check=True, capture_output=True, text=True).stdout


def git_head() -> str:
    return run("git", "rev-parse", "--short", "HEAD").strip()


def is_ancestor(ancestor: str, descendant: str) -> bool:
    """`ancestor` 是否是 `descendant` 的祖先（包内 HEAD 通常落后于当前 HEAD 1–2 个提交，
    因为「生成包」与「提交包」不可能在同一个提交里完成）。"""
    try:
        run("git", "merge-base", "--is-ancestor", ancestor, descendant)
        return True
    except subprocess.CalledProcessError:
        return False


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


# 视觉证据（本地工作区截图；存在才随包分发，缺失不阻塞打包/校验）。
# 这些图片是文档里引用路径的实体，让接手者不必先重跑浏览器就能看到修形结果。
VISUAL_EVIDENCE = [
    (".dsh/screenshots/visual-comparison/comparison-1.png", "visual-evidence/comparison-1-phone-home-im.png"),
    (".dsh/screenshots/visual-comparison/comparison-2.png", "visual-evidence/comparison-2-journal-about-map.png"),
    (".dsh/screenshots/visual-comparison/comparison-3.png", "visual-evidence/comparison-3-coop-palace-velvet-mementos-leisure.png"),
    (".dsh/screenshots/visual-comparison/comparison-4.png", "visual-evidence/comparison-4-leisure.png"),
    (".dsh/screenshots/phone-about-map-visual/01-phone-home.png", "visual-evidence/phone-home.png"),
    (".dsh/screenshots/phone-about-map-visual/02b-about-stats.png", "visual-evidence/about-stats.png"),
    (".dsh/screenshots/phone-about-map-visual/03-map.png", "visual-evidence/tokyo-map.png"),
    (".dsh/screenshots/im-visual-v2/03-list-black.png", "visual-evidence/im-list.png"),
    (".dsh/screenshots/im-visual-v2/01-start.png", "visual-evidence/im-conversation-black-bars.png"),
    (".dsh/screenshots/im-visual-v2/02-map-node.png", "visual-evidence/im-photo-message-black-bars.png"),
    (".dsh/screenshots/im-visual-v2/04-compact-header.png", "visual-evidence/im-conversation-compact-header.png"),
    (".dsh/screenshots/im-visual-v2/05-pixel-round2.png", "visual-evidence/im-pixel-round2.png"),
    (".dsh/screenshots/im-visual-v2/06-wordmark.png", "visual-evidence/im-wordmark-pixel-round3.png"),
    (".dsh/screenshots/journal-visual-v2/01-save-list.png", "visual-evidence/journal-pixel-round2-save-list.png"),
    (".dsh/screenshots/journal-visual-v2/02-calendar.png", "visual-evidence/journal-pixel-round2-calendar.png"),
    (".dsh/screenshots/im-replica/14-final-conversation.png", "visual-evidence/im-game-replica-conversation.png"),
    (".dsh/screenshots/im-replica/12-inbox-clean.png", "visual-evidence/im-game-replica-inbox.png"),
    (".dsh/screenshots/im-replica/comparison-conversation.png", "visual-evidence/im-game-replica-comparison.png"),
    (".dsh/screenshots/im-replica/10-mobile-v2.png", "visual-evidence/im-game-replica-mobile.png"),
    (".dsh/ai-icons/sheet.jpg", "visual-evidence/ai-app-icons-sheet.jpg"),
    (".dsh/screenshots/im-image-card/01-conversation-image-card.png", "visual-evidence/im-image-card-e2e.png"),
    (".dsh/screenshots/acceptance-complete-r2r3/01-lightbox-open.png", "visual-evidence/im-lightbox-open.png"),
    (".dsh/screenshots/acceptance-complete-r2r3/02-after-escape-still-in-conversation.png", "visual-evidence/im-lightbox-escape-stays-in-conversation.png"),
    (".dsh/screenshots/acceptance-complete-r2r3/03-lightbox-failure-fallback.png", "visual-evidence/im-lightbox-failure-fallback.png"),
    (".dsh/screenshots/mobile-webkit/im-list-390x844.png", "visual-evidence/webkit-im-list.png"),
    (".dsh/screenshots/mobile-webkit/im-conversation-390x844.png", "visual-evidence/webkit-im-conversation.png"),
    (".dsh/screenshots/ins-draft-album/01-draft-filled.png", "visual-evidence/ins-draft-filled.png"),
    (".dsh/screenshots/ins-draft-album/03-back-draft-preserved.png", "visual-evidence/ins-draft-preserved.png"),
    (".dsh/screenshots/ins-draft-album/05-gallery-visible.png", "visual-evidence/ins-gallery-visible.png"),
    (".dsh/screenshots/ins-draft-album/06-after-withdraw-gallery.png", "visual-evidence/ins-withdraw-gallery-gone.png"),
    (".dsh/screenshots/journal-visual/01-journal-list.png", "visual-evidence/journal-save-slots.png"),
    (".dsh/screenshots/journal-visual/02-journal-calendar.png", "visual-evidence/journal-calendar.png"),
    (".dsh/screenshots/coop-visual/01-coop.png", "visual-evidence/coop.png"),
    (".dsh/screenshots/showcase-visual/01-showcase.png", "visual-evidence/showcase.png"),
    (".dsh/screenshots/velvet-visual/01-velvet.png", "visual-evidence/velvet.png"),
    (".dsh/screenshots/mementos-visual/01-mementos.png", "visual-evidence/mementos.png"),
    (".dsh/screenshots/leisure-visual/01-leisure.png", "visual-evidence/leisure.png"),
    # P5 第一批（站主创作台）：来自 C5 最终 e2e run（2026-10-19 01:07，105 张中的关键流程）。
    (".dsh/screenshots/p5-workspace/20261019-010738-workspace-home.png", "visual-evidence/p5-workspace-home.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-workspace-start-moment.png", "visual-evidence/p5-workspace-start-moment.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-ins-editor-empty.png", "visual-evidence/p5-ins-editor-empty.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-ins-editor-synced.png", "visual-evidence/p5-ins-editor-synced.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-ins-editor-after-picker.png", "visual-evidence/p5-ins-editor-after-picker.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-ins-editor-published.png", "visual-evidence/p5-ins-editor-published.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-ins-album-roundtrip.png", "visual-evidence/p5-ins-album-roundtrip.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-conflict-notice.png", "visual-evidence/p5-conflict-notice.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-journal-saved.png", "visual-evidence/p5-journal-saved-private.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-journal-published.png", "visual-evidence/p5-journal-published.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-leisure-quick-success.png", "visual-evidence/p5-leisure-quick-success.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-leisure-quick-failed.png", "visual-evidence/p5-leisure-quick-failed.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-media-picker-selected.png", "visual-evidence/p5-media-picker-selected.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-front-ins-new-editor.png", "visual-evidence/p5-front-ins-new-editor.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-mobile-390x844-workspace.png", "visual-evidence/p5-mobile-390-workspace.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-mobile-390x844-editor.png", "visual-evidence/p5-mobile-390-editor.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-mobile-390x844-journal.png", "visual-evidence/p5-mobile-390-journal.png"),
    (".dsh/screenshots/p5-workspace/20261019-010738-mobile-320x720-editor.png", "visual-evidence/p5-mobile-320-editor.png"),
    (".dsh/screenshots/p5-workspace/20261019-005908-webkit-390x844-editor.png", "visual-evidence/p5-webkit-390-editor.png"),
]


def collect() -> list[tuple[Path, str]]:
    """返回 (源文件路径, 包内相对路径) 列表（已排序、已去重）。"""

    entries: list[tuple[Path, str]] = []

    def add(source: Path, arcname: str) -> None:
        if not source.is_file():
            raise SystemExit(f"✗ 缺文件：{source}")
        entries.append((source, arcname))

    for doc in sorted((REPO / "docs" / "agent-deliveries").glob("*.md")):
        add(doc, f"docs/agent-deliveries/{doc.name}")
    for doc in sorted((REPO / "docs" / "design-references").glob("*.md")):
        add(doc, f"docs/design-references/{doc.name}")
    # P5 起：验收证据（P5-acceptance-*.md）与上游设计书副本也是交接必需材料。
    for doc in sorted((REPO / "docs" / "acceptance").glob("*.md")):
        add(doc, f"docs/acceptance/{doc.name}")
    for doc in sorted((REPO / "docs" / "handoff").glob("*.md")):
        add(doc, f"docs/handoff/{doc.name}")
    # API 契约（OpenAPI 导出）让接手者无需先跑后端也能看到完整接口面。
    add(REPO / "contracts" / "openapi.json", "contracts/openapi.json")

    for item in TOOL_WHITELIST:
        target = REPO / "tools" / item
        if target.is_dir():
            for child in sorted(target.rglob("*")):
                if child.is_file() and "__pycache__" not in child.parts:
                    add(child, f"tools/{child.relative_to(REPO / 'tools').as_posix()}")
        else:
            add(target, f"tools/{item}")

    # 可选：视觉证据图（本地快照；不存在则跳过，并在 MANIFEST 里注明数量）。
    for relative, arcname in VISUAL_EVIDENCE:
        source = REPO / relative
        if source.is_file():
            entries.append((source, arcname))

    return entries


def source_revision_text() -> str:
    """把当前代码状态写成接手者能核对的一页纸（不包含 diff 正文）。"""

    head = run("git", "rev-parse", "HEAD").strip()
    branch = run("git", "rev-parse", "--abbrev-ref", "HEAD").strip()
    remote = run("git", "remote", "get-url", "origin").strip()
    ahead = run("git", "rev-list", "--count", "origin/main..HEAD").strip()
    # 只记录与本交接包直接相关的路径状态：工作区可能同时有其它 worker 的
    # 后端/前端改动，未提交状态不应污染交接包的源码基线说明。
    status = run(
        "git",
        "status",
        "--short",
        "--untracked-files=no",
        "--",
        "docs",
        "tools",
        "contracts",
        "apps/api/app/modules/work_drafts",
        "apps/web/features/workspace",
        "apps/web/features/media-picker",
        "apps/web/features/ins",
        "apps/web/features/journal",
        "apps/web/features/leisure",
        "apps/web/features/leblanc",
        "apps/web/features/messaging",
        "apps/web/features/phone",
        "apps/web/public/assets/legacy/img/app/ai",
    ).strip() or "（相关文件工作区干净）"
    log = run("git", "log", "--oneline", "-25").strip()
    return (
        "# 源码版本清单（交接包自动生成）\n\n"
        f"- 仓库：`{REPO}`\n"
        f"- 分支：`{branch}`\n"
        f"- HEAD：`{head}`\n"
        f"- origin：`{remote}`\n"
        f"- 相对 origin/main：领先 {ahead} 个提交"
        + ("（**未推送**，完成推送后此数字会变为 0）" if ahead != "0" else "（已同步）") + "\n"
        "\n## 工作区状态（打包时）\n\n```\n" + status + "\n```\n"
        "\n## 最近提交\n\n```\n" + log + "\n```\n"
        "\n> 源码在仓库中；本交接包不包含源码副本。截图证据见 `visual-evidence/`。\n"
    )


def build(out: Path) -> tuple[int, int, str]:
    head = git_head()
    entries = collect()
    handoff_src = (REPO / "docs" / "agent-deliveries" / "HANDOFF.md").read_text(encoding="utf-8")
    handoff_v2 = UPDATE_BANNER.format(head=head) + handoff_src

    now = datetime.now(timezone.utc).astimezone()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S %z")

    source_info = source_revision_text()
    manifest_lines = ["./HANDOFF.md", "./MANIFEST.txt", "./SHA256SUMS", "./SOURCE-REVISION.md"]
    manifest_lines += [f"./{arcname}" for _, arcname in entries]
    manifest = "\n".join(manifest_lines) + "\n"
    manifest += (
        "\n--- 说明 ---\n"
        "交接包 · 怪盗手机（含 P5 第一批站主创作台 + P4 视觉/验收历史）\n"
        f"打包时间 {stamp}；代码状态 HEAD {head}（分支 main，未推送）\n"
        "内容：HANDOFF.md（更新横幅 + 原文）+ MANIFEST.txt + SHA256SUMS + SOURCE-REVISION.md + "
        "docs/agent-deliveries/ + docs/design-references/ + docs/acceptance/ + docs/handoff/ + "
        "contracts/openapi.json + tools/ + visual-evidence/（本地视觉证据快照，含 P5 关键流程）\n"
        "P5 第一批交接入口：docs/agent-deliveries/P5-HANDOFF-2026-10-19.md；"
        "逐条验收证据：docs/acceptance/P5-acceptance-report.md；e2e：tools/e2e-p5-workspace.py。\n"
        "未包含（有意）：源代码（在仓库里，见 SOURCE-REVISION.md）、任何凭据；"
        ".dsh/ 下未列入 visual-evidence 的临时分析产物不随包分发。\n"
        f"文件数：{len(entries) + 4}（含 HANDOFF/MANIFEST/SHA256SUMS/SOURCE-REVISION）\n"
    )

    sums = []
    for source, arcname in entries:
        sums.append(f"{file_sha256(source)}  {arcname}")
    sums.append(f"{hashlib.sha256(handoff_v2.encode('utf-8')).hexdigest()}  HANDOFF.md")
    sums.append(f"{hashlib.sha256(source_info.encode('utf-8')).hexdigest()}  SOURCE-REVISION.md")
    sums_text = "\n".join(sorted(sums)) + "\n"

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(f"{PACKAGE_DIR}/HANDOFF.md", handoff_v2)
        archive.writestr(f"{PACKAGE_DIR}/MANIFEST.txt", manifest)
        archive.writestr(f"{PACKAGE_DIR}/SHA256SUMS", sums_text)
        archive.writestr(f"{PACKAGE_DIR}/SOURCE-REVISION.md", source_info)
        for source, arcname in entries:
            archive.write(source, f"{PACKAGE_DIR}/{arcname}")
    return len(entries) + 4, out.stat().st_size, head


def check(out: Path) -> int:
    if not out.is_file():
        print(f"✗ 包不存在：{out}")
        return 1
    head = git_head()
    with zipfile.ZipFile(out) as archive:
        names = set(archive.namelist())
        required = {
            f"{PACKAGE_DIR}/HANDOFF.md",
            f"{PACKAGE_DIR}/MANIFEST.txt",
            f"{PACKAGE_DIR}/SHA256SUMS",
        }
        missing = required - names
        if missing:
            print(f"✗ 缺少必需文件：{sorted(missing)}")
            return 1
        manifest = archive.read(f"{PACKAGE_DIR}/MANIFEST.txt").decode("utf-8")
        listed = {
            line.strip()[2:]
            for line in manifest.splitlines()
            if line.startswith("./")
        }
        actual = {name[len(PACKAGE_DIR) + 1 :] for name in names if name.startswith(PACKAGE_DIR + "/")}
        # MANIFEST 列出的路径应全部在包里（HANDOFF/MANIFEST/SHA256SUMS 特判）
        allowed_missing = {"HANDOFF.md", "MANIFEST.txt", "SHA256SUMS"}
        absent = {path for path in listed if path not in actual and path not in allowed_missing}
        if absent:
            print(f"✗ MANIFEST 列出但包里没有：{sorted(absent)}")
            return 1
        head_line = next((line for line in manifest.splitlines() if line.startswith("打包时间")), "")
        pkg_head = head_line.split("HEAD ")[-1].split("（")[0].strip() if "HEAD " in head_line else ""
        if not pkg_head:
            print(f"✗ MANIFEST 缺少 HEAD 记录：{head_line}")
            return 1
        if pkg_head != head and not is_ancestor(pkg_head, head):
            print(
                f"✗ 包内 HEAD {pkg_head} 既不是当前 HEAD {head}，也不是它的祖先 —— "
                "包可能来自另一条分支，请重新打包"
            )
            return 1
        handoff = archive.read(f"{PACKAGE_DIR}/HANDOFF.md").decode("utf-8")
        if "PACKAGE-V2" not in handoff:
            print("✗ HANDOFF.md 缺少 v2 更新横幅")
            return 1
    behind = "（包内 HEAD 落后于当前 HEAD，属正常：打包与提交不在同一提交里）" if pkg_head != head else ""
    print(f"✓ 包校验通过：{len(actual)} 个文件；包内 HEAD {pkg_head}，当前 HEAD {head}{behind}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    if args.check:
        return check(out)
    count, size, head = build(out)
    print(f"✓ 交接包 v2 已生成：{out}")
    print(f"  文件数 {count}；大小 {size / 1024:.0f} KiB；HEAD {head}")
    return check(out)


if __name__ == "__main__":
    sys.exit(main())
