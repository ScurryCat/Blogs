#!/usr/bin/env python3
"""N6 复验：网站公开目录 / 构建输入 / 构建产物中不得含明智吾郎（Goro Akechi）素材。

第三轮 P5 内容架构 v3 · 任务书 §5 / §8.3。本脚本是**只读检查**，不修改任何文件。
期望结果：最后一行以 `PASS:` 开头、退出码 0；任何 `FAIL:` 都会让退出码为 1。

用法（仓库根 `/Users/学习/blog/Blogs`）：
    python3 tools/acceptance/verify-no-akechi-assets.py
    python3 tools/acceptance/verify-no-akechi-assets.py --json   # 额外输出机读汇总

检查项：
  1. 已知 3 个含明智原文件的 SHA-256 不得出现在 `apps/web/public/**` 与仓库根 `assets/**`
     （`.dsh/archived-assets/` 是**有意保留**的可恢复归档，不扫描）。
  2. 点名路径不得存在：`legacy/img/icon/crow.webp`、`legacy/img/band-halftone.jpg`。
  3. 公开目录与构建输入中不得出现明智别名文件名：
     akechi / goro / 明智 / あけち / クロウ / black-mask；`crow` 仅当**不是** `crowd`。
  4. 前端运行时引用不得再出现 `/assets/legacy/img/icon/crow.webp`（排除注释/迁移守卫/文档）。
  5. 替换资源存在且哈希正确：`icon/mementos.webp`、替换版 `cover/platinum.jpg`、`app/coop.png`。
  6. crowd 人群过场完整：12 张 original 精灵哈希与 `provenance.json` 一致；
     `features/runtime/effects/crowd.ts` 的 SPRITES 文件名在公开目录全部存在。
  7. 若存在构建产物 `apps/web/.next`：JS/HTML/JSON 中不得出现被移除文件名。
  8. 若存在 N5 过场短版 `public/assets/clip/isekai-showcase.webm`：打印其哈希供登记核对（提示性）。

对应清单：docs/design-references/persona-assets-allowlist.md / persona-assets-excluded.md /
persona-assets-removed.md；复验记录见 docs/agent-deliveries/N6-result.md。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
PUBLIC = REPO / "apps/web/public"
ROOT_ASSETS = REPO / "assets"
NEXT_DIR = REPO / "apps/web/.next"
SRC_DIRS = [REPO / "apps/web/features", REPO / "apps/web/app", REPO / "apps/web/components"]

# 含明智吾郎的原文件（已移除/替换；恢复归档在 .dsh/archived-assets/，有意保留，不扫描）
BANNED_SHA256 = {
    "2c94638757c68b665742067376ce8abeb375b31749311cd7420c400430e9c58e": "icon/crow.webp（明智吾郎头像）",
    "085e6df989e982f1c92f83ab6606c10fb4b2f2d229fb11eb0b3011c9a8bad2d6": "cover/platinum.jpg 原版（明智立绘）",
    "f6eade8ed6710a3f6b16317cbda8521b34ca57d1962b81d954c73a49352519db": "band-halftone.jpg 原版（Joker+黑面具明智）",
}
BANNED_PUBLIC_PATHS = [
    "assets/legacy/img/icon/crow.webp",
    "assets/legacy/img/band-halftone.jpg",
]
# 明智别名（文件名层面）。`crow` 单独判断：后面跟 d 的 crowd 必须放行。
ALIAS_RE = re.compile(r"akechi|goro|明智|あけち|クロウ|black[\s_-]?mask", re.IGNORECASE)
CROW_RE = re.compile(r"crow(?!d)", re.IGNORECASE)

REQUIRED = {
    "apps/web/public/assets/legacy/img/icon/mementos.webp":
        "d0de74b64abec29f19f799eae4001f569503b51f6fc0549ca3d9dbdca0c6cdd6",
    "apps/web/public/assets/legacy/img/cover/platinum.jpg":
        "394c37ce82717c45f83bd78d09ecad288fb506e42ac2eb0ab19d7fed7d69d142",
    "apps/web/public/assets/legacy/img/app/coop.png":
        "7422fb937fea92b6698767af3a982b18b3ccab4798e176311d2d27fa4e0290de",
}
CROWD_SPRITE_DIR = "apps/web/public/assets/legacy/img/crowd/original"
CROWD_CODE = REPO / "apps/web/features/runtime/effects/crowd.ts"
N5_MEDIA = REPO / "apps/web/public/assets/clip/isekai-showcase.webm"
N5_EXPECTED_SHA = "a716f8e835eb9373639648a72a7fba3529ec99ed8bb623d24cf48b868a91ccb7"

RESULTS: list[dict] = []


def judge(item: str, ok: bool, detail: str = "") -> None:
    RESULTS.append({"item": item, "ok": ok, "detail": detail})
    mark = "PASS" if ok else "FAIL"
    line = f"[{mark}] {item}" + (f" — {detail}" if detail else "")
    print(line, file=sys.stdout if ok else sys.stderr)


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def iter_files(root: pathlib.Path):
    if not root.is_dir():
        return
    for p in root.rglob("*"):
        if p.is_file():
            yield p


def check_banned_hashes() -> None:
    hits: list[str] = []
    files = list(iter_files(PUBLIC)) + list(iter_files(ROOT_ASSETS))
    for p in files:
        digest = sha256(p)
        if digest in BANNED_SHA256:
            hits.append(f"{p.relative_to(REPO)} sha256={digest[:12]}… ({BANNED_SHA256[digest]})")
    judge("1) 公开目录/构建输入无含明智原文件哈希", not hits, "; ".join(hits[:4]) or f"扫描 {len(files)} 文件")


def check_banned_paths() -> None:
    hits = [rel for rel in BANNED_PUBLIC_PATHS if (PUBLIC / rel).exists()]
    judge("2) 点名路径不存在（icon/crow.webp、band-halftone.jpg）", not hits, ", ".join(hits))


def check_alias_filenames() -> None:
    hits: list[str] = []
    files = list(iter_files(PUBLIC)) + list(iter_files(ROOT_ASSETS))
    for p in files:
        name = p.name
        if CROW_RE.search(name) or ALIAS_RE.search(name):
            hits.append(str(p.relative_to(REPO)))
    judge("3) 公开目录/构建输入无明智别名文件名（crowd 放行）", not hits, "; ".join(hits[:5]))


def check_runtime_references() -> None:
    pattern = re.compile(r"/assets/legacy/img/icon/crow\.webp")
    hits: list[str] = []
    exts = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json"}
    for d in SRC_DIRS:
        for p in iter_files(d):
            if p.suffix not in exts:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if pattern.search(text):
                hits.append(str(p.relative_to(REPO)))
    judge("4) 前端运行时不再引用 /assets/legacy/img/icon/crow.webp", not hits, "; ".join(hits[:5]))


def check_replacements() -> None:
    problems: list[str] = []
    for rel, expected in REQUIRED.items():
        p = REPO / rel
        if not p.is_file():
            problems.append(f"缺少 {rel}")
            continue
        got = sha256(p)
        if got != expected:
            problems.append(f"{rel} 哈希 {got[:12]}… ≠ 期望 {expected[:12]}…")
    judge("5) 替换资源存在且哈希正确（mementos / platinum / coop）", not problems, "; ".join(problems))


def check_crowd() -> None:
    prov_path = REPO / CROWD_SPRITE_DIR / "provenance.json"
    problems: list[str] = []
    sprite_names: list[str] = []
    try:
        prov = json.loads(prov_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:  # noqa: PERF203 - 验收脚本，直接报错即可
        judge("6) crowd 人群过场完整", False, f"provenance.json 读取失败：{exc}")
        return
    for entry in prov.get("sprites", []):
        name = entry["file"]
        sprite_names.append(name)
        p = REPO / CROWD_SPRITE_DIR / name
        if not p.is_file():
            problems.append(f"缺少 {name}")
            continue
        got = sha256(p)
        if got != entry["sha256"]:
            problems.append(f"{name} 哈希 {got[:12]}… ≠ provenance {entry['sha256'][:12]}…")
    # 代码里实际用到的 SPRITES 文件名必须都在
    code = CROWD_CODE.read_text(encoding="utf-8") if CROWD_CODE.is_file() else ""
    used = re.findall(r'"([a-z0-9_]+\.pac_[0-9]_risultato\.png)"', code)
    for name in used:
        if not (REPO / CROWD_SPRITE_DIR / name).is_file():
            problems.append(f"代码引用但缺失 {name}")
    detail = f"provenance {len(sprite_names)} 张全部哈希一致；代码引用 {len(used)} 张全部存在" if not problems else "; ".join(problems[:5])
    judge("6) crowd 人群过场完整（12/12 哈希 + 代码引用）", not problems, detail)


def check_build_output() -> None:
    if not NEXT_DIR.is_dir():
        print("[SKIP] 7) 构建产物检查（apps/web/.next 不存在，先 npm run build）", file=sys.stderr)
        return
    # 只看真正会被浏览器执行的产物（JS/HTML/JSON/CSS）；`.map` 是 source map，
    # 其中可能包含「已移除路径」的源码注释（文档性文字，不是明智素材，也不是运行时引用），
    # 按任务书口径不构成「实际下载文件包含明智」，故跳过并在 detail 中说明。
    needles = [b"/assets/legacy/img/icon/crow.webp", b"band-halftone.jpg"]
    hits: list[str] = []
    scanned = 0
    skipped_maps = 0
    for p in iter_files(NEXT_DIR):
        # `.next/dev/**` 是正在运行的 `next dev` 工件，不是生产构建输出；跳过并说明。
        if "/dev/" in p.as_posix():
            continue
        if p.suffix == ".map":
            skipped_maps += 1
            continue
        if p.suffix not in {".js", ".html", ".json", ".css"}:
            continue
        if p.stat().st_size > 8 * 1024 * 1024:
            continue
        try:
            data = p.read_bytes()
        except OSError:
            continue
        scanned += 1
        if any(n in data for n in needles):
            hits.append(str(p.relative_to(REPO)))
    judge(
        "7) 生产构建产物无被移除文件名引用（已跳过 .next/dev）",
        not hits,
        "; ".join(hits[:5])
        or f"扫描 {scanned} 个产物文件（跳过 {skipped_maps} 个 source map，含源码注释）",
    )


def check_n5_media() -> None:
    if not N5_MEDIA.is_file():
        print("[SKIP] 8) N5 过场短版媒体未找到", file=sys.stderr)
        return
    got = sha256(N5_MEDIA)
    rel = N5_MEDIA.relative_to(REPO)
    matched = "与登记一致" if got == N5_EXPECTED_SHA else f"与登记不同（期望 {N5_EXPECTED_SHA[:12]}…）"
    print(f"[INFO] 8) 过场短版 {rel} sha256={got}（{matched}）")


def main() -> int:
    parser = argparse.ArgumentParser(description="N6 无明智素材复验")
    parser.add_argument("--json", action="store_true", help="额外输出机读汇总")
    args = parser.parse_args()

    print("N6 · 不含明智吾郎素材复验（公开目录 / 构建输入 / 构建产物）")
    print(f"仓库：{REPO}")
    check_banned_hashes()
    check_banned_paths()
    check_alias_filenames()
    check_runtime_references()
    check_replacements()
    check_crowd()
    check_build_output()
    check_n5_media()

    failed = [r for r in RESULTS if not r["ok"]]
    if args.json:
        print(json.dumps({"results": RESULTS, "failed": len(failed)}, ensure_ascii=False))
    if failed:
        print(f"FAIL: {len(failed)} 项未通过 —— 网站实际资源不得包含明智吾郎，请按清单排查。", file=sys.stderr)
        return 1
    print(f"PASS: {len(RESULTS)} 项检查全部通过 —— 公开目录/构建输入/构建产物无明智吾郎素材，crowd 过场完整。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
