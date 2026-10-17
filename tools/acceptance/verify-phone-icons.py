"""手机 App 图标接入审计（任务书 §2.3 / §5.2 / §5.3）。

检查的是**引用侧**，补 N6 脚本的空白：
- `tools/acceptance/verify-no-akechi-assets.py` 检查的是「已排除资源不在磁盘上」；
- 本脚本检查「代码里声明的图标路径：文件真的存在、在素材清单（CSV）里、SHA-256 一致、
  且没有指向已移除的资源」。

用法：python3 tools/acceptance/verify-phone-icons.py
退出码：0 = 全部通过；1 = 有问题。
"""

from __future__ import annotations

import csv
import hashlib
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WEB = REPO / "apps" / "web"
PUBLIC = WEB / "public"
CSV_PATH = REPO / "docs" / "design-references" / "persona-assets-manifest.csv"

# 手机 App 的 manifest 与旧站入口表：图标声明的来源
MANIFEST_FILES = [
    "features/velvet/phone-manifest.ts",
    "features/exploration/phone-manifest.ts",
    "features/ins/phone-manifest.tsx",
    "features/coop/phone-manifest.tsx",
    "features/showcase/phone-manifest.ts",
    # registry.ts 里还有 journal / leisure / metanav 三个**内联** manifest ——
    # 第一版漏了这个文件，等于漏掉了三个 App 的图标审计。
    "features/phone/registry.ts",
    "features/phone/legacy-apps.ts",
]

# 已移除 / 排除的资源（N6 removed 清单里的文件名），代码不得再引用
REMOVED_MARKERS = ["crow.webp", "akechi", "黑面具"]


def collect_icons() -> dict[str, list[str]]:
    """返回 {图标路径: [声明它的文件…]}。"""
    found: dict[str, list[str]] = {}
    for rel in MANIFEST_FILES:
        path = WEB / rel
        if not path.exists():
            print(f"  ✗ 找不到 manifest：{rel}")
            continue
        text = path.read_text(encoding="utf-8")
        # 文件内的常量（如 COOP_PHONE_ICON = "/assets/..."）
        consts = dict(re.findall(r'const\s+([A-Z_]+)\s*=\s*"(/assets/[^"]+)"', text))
        for raw in re.findall(r"icon:\s*([^,\n]+)", text):
            value = raw.strip()
            if value in consts:
                value = consts[value]
            value = value.strip().strip('"')
            if not value.startswith("/assets/"):
                continue
            found.setdefault(value, []).append(rel)
    return found


def canonical_paths() -> dict[str, list[str]]:
    """返回 {canonical_path: [声明它的文件…]}。"""
    found: dict[str, list[str]] = {}
    for rel in MANIFEST_FILES:
        text = (WEB / rel).read_text(encoding="utf-8")
        for value in re.findall(r'canonical_path:\s*"([^"]+)"', text):
            found.setdefault(value, []).append(rel)
    return found


def check_routes() -> list[str]:
    failures: list[str] = []
    paths = canonical_paths()
    for path, owners in sorted(paths.items()):
        # /apps/ins → apps/web/app/apps/ins/page.tsx；/posts → apps/web/app/posts/page.tsx
        rel = path.strip("/")
        route = (WEB / "app" / rel / "page.tsx") if rel else (WEB / "app" / "page.tsx")
        if route.exists():
            print(f"  ✓ {path:<28} → {route.relative_to(WEB)}")
        else:
            failures.append(
                f"{path}：没有对应路由文件（{route.relative_to(REPO)} 不存在；被 {', '.join(owners)} 声明）"
            )
    return failures


def main() -> int:
    if not CSV_PATH.exists():
        print(f"✗ 缺少素材清单：{CSV_PATH}")
        return 1
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    by_public = {row["public_path"]: row for row in rows}

    icons = collect_icons()
    print(f"== 扫描到 {len(icons)} 个图标引用（来自 {len(MANIFEST_FILES)} 个 manifest）==")

    failures: list[str] = []
    for public_path, owners in sorted(icons.items()):
        name = Path(public_path).name
        # 1) 已移除资源不得被引用
        if any(marker in public_path for marker in REMOVED_MARKERS):
            failures.append(f"{public_path}：引用了已移除/排除的资源（被 {', '.join(owners)} 引用）")
            continue
        # 2) 文件存在
        disk = PUBLIC / public_path.lstrip("/")
        if not disk.exists():
            failures.append(f"{public_path}：磁盘上不存在（应为 {disk.relative_to(REPO)}）")
            continue
        # 3) 在素材清单里
        row = by_public.get(public_path)
        if row is None:
            failures.append(f"{public_path}：不在素材清单 CSV 里（来源不可追溯）")
            continue
        # 4) 哈希一致
        digest = hashlib.sha256(disk.read_bytes()).hexdigest()
        if row.get("sha256") and digest != row["sha256"]:
            failures.append(
                f"{public_path}：SHA-256 与清单不一致（清单 {row['sha256'][:12]}… / 实际 {digest[:12]}…）"
            )
            continue
        print(f"  ✓ {public_path}  ({name}, {disk.stat().st_size} B) ← {', '.join(owners)}")

    # 5) 说明性提及（注释里解释「原来用的是 crow，现改为中性图标」）不是缺陷，
    #    只在实际的 icon 值里出现才拦（上面第 1 步已经拦了），这里仅作提示。
    print("\n== 已排除资源的说明性提及（注释，非引用；仅供人工核对）==")
    mentioned = False
    for rel in MANIFEST_FILES:
        text = (WEB / rel).read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            is_comment = stripped.startswith(("*", "//", "/*"))
            if is_comment and any(marker in line for marker in REMOVED_MARKERS):
                print(f"  · {rel}:{i} 注释提及：{stripped[:60]}")
                mentioned = True
    if not mentioned:
        print("  （无）")

    # 6) 注册表里声明的 canonical_path 必须有真实路由，不能「注册了但页面不存在」
    print("\n== canonical_path ↔ 路由 ==")
    route_failures = check_routes()
    failures.extend(route_failures)

    print("\n== 结果 ==")
    if failures:
        for item in failures:
            print(f"  ✗ {item}")
        return 1
    print(f"  （无问题 ✓：{len(icons)} 个图标全部存在、在清单内、哈希一致，且未引用已移除资源）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
