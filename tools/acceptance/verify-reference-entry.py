#!/usr/bin/env python3
"""F1 复验：统一素材入口的默认浏览路径只进入已复核精选库。

对应验收报告 `docs/acceptance/2026-10-17-handoff-v2-acceptance.md` F1：
- 统一入口 `assets/reference/index.html` / `README.md` 的默认路径指向 `persona-curated/`；
- 旧库 `persona-dist/`、`persona5-spriters/` 仅作为「离线档案（按需手动打开）」保留，
  不再被默认预览/缩略图/生成脚本自动加载；
- 旧入口文件有可回退备份；旧库本体未移动、未删除。

用法（仓库根）：
    python3 tools/acceptance/verify-reference-entry.py [--reference DIR] [--json]
默认参考库目录：/Users/v/Documents/ChatGPT/Blog开发/assets/reference
目录不存在时打印 SKIP 并返回 0（其他机器上的独立副本不强制要求外部资料）。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

DEFAULT_REFERENCE = pathlib.Path("/Users/v/Documents/ChatGPT/Blog开发/assets/reference")

failures: list[str] = []
checks: list[str] = []


def ok(label: str) -> None:
    checks.append(label)
    print(f"  ✓ {label}")


def fail(label: str) -> None:
    failures.append(label)
    print(f"  ✗ {label}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", default=str(DEFAULT_REFERENCE))
    parser.add_argument("--json", default="")
    args = parser.parse_args()
    root = pathlib.Path(args.reference)
    print(f"== 统一素材入口复验（F1）：{root} ==")
    if not root.is_dir():
        print("  SKIP：参考库目录不存在（非本机验收环境）")
        return 0

    index = root / "index.html"
    readme = root / "README.md"
    curated = root / "persona-curated"

    # 1) 精选库与允许清单存在
    for name in ("README.md", "INDEX.md"):
        if (curated / name).is_file():
            ok(f"精选库存在：persona-curated/{name}")
        else:
            fail(f"缺少精选库文件：persona-curated/{name}")

    # 2) index.html 默认区指向精选库
    index_text = index.read_text(encoding="utf-8") if index.is_file() else ""
    if re.search(r'href="persona-curated/(README|INDEX)\.md"', index_text):
        ok("index.html 默认入口链接到 persona-curated/")
    else:
        fail("index.html 默认入口没有链接到 persona-curated/")

    # 3) 旧库链接只在 <details>（离线档案）里
    for marker in ("persona-dist/index.html", "persona5-spriters/INDEX.md"):
        positions = [m.start() for m in re.finditer(re.escape(marker), index_text)]
        if not positions:
            ok(f"{marker} 未出现在默认入口页（或已移除）")
            continue
        details_open = [m.start() for m in re.finditer(r"<details", index_text)]
        guard = details_open[0] if details_open else len(index_text)
        before = [p for p in positions if p < guard]
        if before:
            fail(f"{marker} 出现在 <details> 离线档案区之外（默认路径会进入旧库）")
        else:
            ok(f"{marker} 只出现在「离线档案」折叠区")

    # 4) 默认页不自动加载旧库缩略图/预览/脚本
    forbidden = re.findall(r"<(?:img|iframe|script)\b[^>]*(?:persona-dist|persona5-spriters)", index_text, re.I)
    if forbidden:
        fail(f"index.html 仍内嵌旧库资源引用：{forbidden[:2]}")
    else:
        ok("index.html 不含旧库 <img>/<iframe>/<script> 自动加载")

    # 5) README 默认区指向精选库，旧库标为离线档案
    readme_text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    if "persona-curated/README.md" in readme_text:
        ok("README.md 默认入口指向 persona-curated/")
    else:
        fail("README.md 默认入口没有指向 persona-curated/")
    if "离线档案" in readme_text:
        ok("README.md 标明旧库为「离线档案」")
    else:
        fail("README.md 未标明旧库为离线档案")

    # 6) 旧入口文件可回退（备份存在）
    backups = sorted(root.glob("index.html.bak-entry-*")) + sorted(root.glob("README.md.bak-entry-*"))
    if backups:
        ok(f"旧入口已备份（{', '.join(p.name for p in backups[:2])}…）")
    else:
        fail("找不到旧入口备份（index.html.bak-entry-* / README.md.bak-entry-*）")

    # 7) 旧库本体未移动/未删除
    for lib in ("persona-dist", "persona5-spriters"):
        if (root / lib).is_dir():
            ok(f"旧库保留：{lib}/（未移动/未删除）")
        else:
            fail(f"旧库缺失：{lib}/")

    print("\n== 失败项 ==")
    if failures:
        for item in failures:
            print(f"  ✗ {item}")
        if args.json:
            pathlib.Path(args.json).write_text(
                json.dumps({"failures": failures, "checks": checks}, ensure_ascii=False, indent=1),
                encoding="utf-8",
            )
        return 1
    print("  （无 ✓）")
    if args.json:
        pathlib.Path(args.json).write_text(
            json.dumps({"failures": [], "checks": checks}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
