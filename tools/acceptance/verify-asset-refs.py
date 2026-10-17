"""静态资源引用审计：代码里引用了、但 public/ 下不存在的资源（会直接 404）。

为什么需要：Next 静态资源是**按路径直出**的，写错一个目录名不会在构建时报错，
只会在运行时 404。手机桌面、过场、图标都靠这些路径，断链会直接表现为「图裂 / 过场不播」。

范围：
- `apps/web/features/**`、`apps/web/app/**` 的 .ts/.tsx 里以 `/assets/…` 开头且**带扩展名**的字符串；
- `apps/web/app/globals.css` 里的 `url(/assets/…)`；
- 以 `/` 结尾的目录前缀与模板拼接无法静态判定，单独列出、不算失败。

用法：python3 tools/acceptance/verify-asset-refs.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WEB = REPO / "apps" / "web"
PUBLIC = WEB / "public"

SCAN_DIRS = ["features", "app"]
ASSET_REF = re.compile(r'["\'](/assets/[^"\']*?\.[A-Za-z0-9]{2,5})["\']')
DIR_PREFIX = re.compile(r'["\'](/assets/[^"\']*/)["\']')
CSS_URL = re.compile(r"url\((/assets/[^)\"']+)\)")


def iter_sources():
    for base in SCAN_DIRS:
        root = WEB / base
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.suffix in (".ts", ".tsx") and path.is_file():
                yield path
    css = WEB / "app" / "globals.css"
    if css.exists():
        yield css


def main() -> int:
    refs: dict[str, list[str]] = {}
    dir_prefixes: dict[str, list[str]] = {}
    for path in iter_sources():
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(WEB)
        pattern = CSS_URL if path.suffix == ".css" else ASSET_REF
        for match in pattern.finditer(text):
            refs.setdefault(match.group(1), []).append(str(rel))
        if path.suffix != ".css":
            for match in DIR_PREFIX.finditer(text):
                dir_prefixes.setdefault(match.group(1), []).append(str(rel))

    print(f"== 扫描到 {len(refs)} 条具体资源引用、{len(dir_prefixes)} 条目录前缀 ==")

    missing: list[tuple[str, list[str]]] = []
    fixture_only: list[tuple[str, list[str]]] = []
    for ref, owners in sorted(refs.items()):
        disk = PUBLIC / ref.lstrip("/")
        if disk.exists():
            continue
        # 测试夹具/测试文件里的引用不影响生产，单独归类
        production = [o for o in owners if ".test." not in o and "__fixtures__" not in o]
        if production:
            missing.append((ref, production))
        else:
            fixture_only.append((ref, owners))

    print(f"\n== 生产代码断链（{len(missing)}）==")
    if missing:
        for ref, owners in missing:
            print(f"  ✗ {ref}  ← {', '.join(sorted(set(owners)))}")
    else:
        print("  （无 ✓）")

    print(f"\n== 仅测试夹具引用（不产出页面，但建议对齐真实路径）（{len(fixture_only)}）==")
    if fixture_only:
        for ref, owners in fixture_only:
            print(f"  · {ref}  ← {', '.join(sorted(set(owners)))}")
    else:
        print("  （无）")

    print(f"\n== 动态拼接的目录前缀（无法静态判定，仅供参考）（{len(dir_prefixes)}）==")
    for prefix, owners in sorted(dir_prefixes.items()):
        # 两种合法位置：① Next 的 public/；② 旧站静态根（仓库根 assets/，
        # 开发由 next.config 的 rewrite 代理、生产由网关转发 —— 见 features/legacy/music.ts）。
        in_public = (PUBLIC / prefix.lstrip("/")).exists()
        in_legacy_root = (REPO / prefix.lstrip("/")).exists()
        where = "public/" if in_public else ("仓库根静态目录（网关转发）" if in_legacy_root else "")
        print(f"  {'✓' if where else '✗'} {prefix}  ← {', '.join(sorted(set(owners)))}" + (f"  [{where}]" if where else ""))
        if not where:
            missing.append((prefix, owners))

    if missing:
        print(f"\n✗ 共 {len(missing)} 处引用不到文件")
        return 1
    print("\n✓ 生产代码里的静态资源引用全部能找到对应文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
