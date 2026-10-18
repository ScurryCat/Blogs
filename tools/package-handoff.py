#!/usr/bin/env python3
"""重新打包交接包（v2）：把当前仓库的**文档 + 工具**打成一个可直接接手的 zip。

为什么需要：第一版交接包（`docs/handoff-package-2026-10-17.zip`，HEAD 6320861）打包后，
会话又完成了 13 轮视觉还原/缺陷修复/验收复跑，文档与工具都变了；接手者应该拿到
**当前状态**的自包含包，而不是在旧包基础上再翻 git 历史。

与原包保持同样的内容口径（便于对照）：
  - 包含：HANDOFF.md（更新版）+ MANIFEST + SHA256SUMS + docs/agent-deliveries/ +
    docs/design-references/ + tools/（原包同款的脚本白名单 + 新增的视觉复核种子脚本）
  - 不包含：源代码（在仓库里）、`.dsh/` 截图与分析产物（工作区外/未入库）、任何凭据。

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
    "e2e-im-image-card.py",
    "e2e-ins-tag.py",
    "e2e-journal-reading.py",
    "e2e-metanav-palace.py",
    "e2e-phone-scroll.py",
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
> ## ⚠️ 这个包是 v2（打包后更新的版本）
>
> 第一版包对应 HEAD `6320861`；本包对应 **HEAD `{head}`**，包含此后的全部增量工作：
> **B1 视觉还原（9 界面元件级 v1 + 11 类缺陷修复）**、手机桌面应用补登记、
> 可及性收尾（减少动效 / 触控目标 / WCAG 对比度 / 焦点 / 结构 / 失败态）、
> 验证环境修复（系统代理绕过、常驻服务与媒体根说明）与全量验收复跑（`--e2e` 7/7 段全绿）。
> **首页按站主指令**：保持原本布局、去掉「怪盗手记」红底、打开即完整显示人物卡与
> 左侧 5 个栏目（A/B/C/D 变体已撤回）；底部迷你播放器已按站主要求移除；
> 9 个视觉还原界面的演示内容与手机 deep link 已在本地分享库中。
>
> **当前验收摘要（单一基线，勿再用历史正文数字拼凑）**：
> 代码基线 = 包内 `{head}`；前端 **933** 单测、后端 **952**（`--e2e --mobile` 7/7 段全绿、端到端 12 项）。
> 独立验收 v2 结论：**功能阶段通过，完整验收未通过**；逐项回应与证据见
> `docs/agent-deliveries/acceptance-v2-response.md`；验收报告点名的
> **F1 / F2 / F3 已返工**（详见 `docs/agent-deliveries/P4-acceptance-v2-fixes.md`）：
> F1 默认素材入口迁移到 `persona-curated/`（旧库降级离线档案）；
> F2 桌面接入 2 枚已审核原版图标（metanav 经典红眼 / ins 原版消息标识，其余 8 个仍标适配）；
> F3 INS 收录相册改 cursor 全量分页 + 列表外已选相册详情补取（仅 404 判删除）。
> **参考帧补齐（2026-10-18，三批 17 张）**：P5R 6（G2 回复选择 / G1 普通对话 ×2 /
> IM 完整屏 ×2 / 手机 HUD）+ P5 6（存档/读取 / 手机主屏 / 日历 / 五维状态 / 校内地图 / 东京地图）
> + 5（天鹅绒房间 / 印象空间 / COOP / 殿堂 / 放课后），
> `tools/acceptance/verify-reference-frames.py` **17/17**；来源核实见
> `docs/design-references/reference-frame-sources.md`（官方 3：PS CDN 1 + Steam 2；
> 可追溯非官方 12；未核实 2=IM 两帧）。整屏参考帧缺口已收口。
> **移动引擎证据（2026-10-18）**：WebKit + iPhone 视口 24/24（首页/手机/IM/图库灯箱/触控点按），
> 但**不等于真机**；软键盘/中文输入法/真实触控仍需真机（`P4-mobile-engine-evidence.md`）。
> **IM 整屏视觉修形（2026-10-18，两轮，站主指令 IM 优先）**：纸白宽消息条 + 白纸黑框拍立得头像 +
> 放大 IM wordmark + 红点操作提示 + 4:3 大图片卡（`P4-im-visual-refinement.md`；仍部分还原）。
> **手记整屏视觉修形第一轮（2026-10-18）**：存档列表纸白/深红大槽位 + SAVE DATA 大字；
> 日历黑底大字网格（周日红/周六青）、记录日红数字+下划线、TODAY 贴纸
> （`P4-journal-visual-refinement.md`；仍部分还原）。
> **协助者 COOP 整屏视觉修形第一轮（2026-10-18）**：纸白卡面 + 红黑斜切插画区 + 拍立得头像 +
> 黑色姓名条 + 深红大序号（`P4-coop-visual-refinement.md`；仍部分还原，RANK 无数据不伪造）。
> **我的殿堂 Showcase 整屏视觉修形第一轮（2026-10-18）**：暗红/黑斜切宝库墙 + 金色宝箱辉光 +
> 金色 TREASURE 贴牌 + 纸白宝物卡 + 金色页签（`P4-showcase-visual-refinement.md`；仍部分还原）。
> **天鹅绒房间整屏视觉修形第一轮（2026-10-18）**：深蓝丝绒条纹 + 冷光 + 金/冰饰线 +
> 白色登记板技能卡 + REGISTRY 金贴牌（`P4-velvet-visual-refinement.md`；仍部分还原）。
> **视觉对照证据（2026-10-18）**：`tools/capture-visual-comparison.py` 把 17 张参考帧与
> 站点 13 个界面并排对照，逐项结论见 `P4-visual-comparison-evidence.md`
> （13 项语言级部分对照 / 2 项未实现（图片消息、楼层图）/ 2 项无对应整屏；**整屏还原仍未通过**）。
> **IM 图片消息 Phase 1 已实现（2026-10-18，站主拍板方案 A）**：剧本图片卡
> （`image`/`album_photo`）+ 白框拍立得 + 灯箱 + 撤回/失效降级；后端 9 / 前端 4 /
> 浏览器 e2e 8/8（`tools/e2e-im-image-card.py`）；Phase 2 AI 选图 / Phase 3 访客引用相册仍未做。
> 仍未关闭：真实设备（触控/软键盘/移动 Safari）。
> **管理端 INS 收录 UI 真实浏览器全流程已补齐**：`tools/e2e-ins-album-links-ui.py` 9/9 通过
> （登录→建相册草稿→建动态→上传→收录→保存→发布→公开页可见）；期间修复了 2 个真实 UI 阻断缺陷：
> 管理列表 limit=50 超后端上限 30 的 422、画廊写接口 CSRF body 字段导致的 422/500。
> **请先读 `docs/agent-deliveries/HANDOFF-ADDENDUM-2026-10-17.md`**（状态增量与未完成项），
> 再读 `docs/agent-deliveries/P4-final-state.md`（一页纸速览）与本文其余部分。
> 重要：B1 **整屏还原仍不可判定**（缺 G2/G3 与各界面整屏参考帧），不要把元件级 v1
> 读成整屏验收通过；B4 图片消息仍需产品拍板。
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

    for item in TOOL_WHITELIST:
        target = REPO / "tools" / item
        if target.is_dir():
            for child in sorted(target.rglob("*")):
                if child.is_file() and "__pycache__" not in child.parts:
                    add(child, f"tools/{child.relative_to(REPO / 'tools').as_posix()}")
        else:
            add(target, f"tools/{item}")

    return entries


def build(out: Path) -> tuple[int, int, str]:
    head = git_head()
    entries = collect()
    handoff_src = (REPO / "docs" / "agent-deliveries" / "HANDOFF.md").read_text(encoding="utf-8")
    handoff_v2 = UPDATE_BANNER.format(head=head) + handoff_src

    now = datetime.now(timezone.utc).astimezone()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S %z")

    manifest_lines = ["./HANDOFF.md", "./MANIFEST.txt", "./SHA256SUMS"]
    manifest_lines += [f"./{arcname}" for _, arcname in entries]
    manifest = "\n".join(manifest_lines) + "\n"
    manifest += (
        "\n--- 说明 ---\n"
        "交接包 · 怪盗手机 P5 第二轮 UI（v2，打包后更新版）\n"
        f"打包时间 {stamp}；代码状态 HEAD {head}（分支 main，未推送）\n"
        "内容：HANDOFF.md（v2 更新横幅 + 原文）+ MANIFEST.txt + SHA256SUMS + "
        "docs/agent-deliveries/ + docs/design-references/ + tools/\n"
        "未包含（有意）：源代码（在仓库里）、.dsh/ 下的截图与分析产物（工作区外，未入库）、任何凭据。\n"
        f"文件数：{len(entries) + 3}（含 HANDOFF/MANIFEST/SHA256SUMS）\n"
    )

    sums = []
    for source, arcname in entries:
        sums.append(f"{file_sha256(source)}  {arcname}")
    sums.append(f"{hashlib.sha256(handoff_v2.encode('utf-8')).hexdigest()}  HANDOFF.md")
    sums_text = "\n".join(sorted(sums)) + "\n"

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(f"{PACKAGE_DIR}/HANDOFF.md", handoff_v2)
        archive.writestr(f"{PACKAGE_DIR}/MANIFEST.txt", manifest)
        archive.writestr(f"{PACKAGE_DIR}/SHA256SUMS", sums_text)
        for source, arcname in entries:
            archive.write(source, f"{PACKAGE_DIR}/{arcname}")
    return len(entries) + 3, out.stat().st_size, head


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
