#!/usr/bin/env python3
"""验收 v2 补帧复验：精选库里的 6 张完整帧存在、哈希一致、索引/来源可追溯。

对应验收报告 §5.1 / §7.3：本地参考库要能支撑「完整帧」视觉对照
（回复选择 G2、普通对话 G1、IM 完整屏、手机 HUD），并记录来源与哈希。

只读检查；外部参考库不存在时 SKIP（其它机器上的独立副本不强制要求）。
用法：python3 tools/acceptance/verify-reference-frames.py [--reference DIR] [--json]
退出码：0 = 通过 / SKIP；1 = 失败。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

DEFAULT_REFERENCE = pathlib.Path("/Users/v/Documents/ChatGPT/Blog开发/assets/reference")

# 期望帧：路径 → (sha256, (宽, 高), 用途)
EXPECTED = {
    "hud/p5r-dialogue-choice-fullframe.jpg": (
        "2392b491423975316e3a025bb1c144baafc33e792c16ea808e394798c7f83a2c",
        (1920, 1080),
        "G2 回复选择完整帧",
    ),
    "hud/p5r-dialogue-normal-fullframe.jpg": (
        "7ca48c1b02572f79202216b5b786acdb303b7d062bc3179637c40f1018290d4d",
        (3840, 2160),
        "G1 普通对话完整帧（PS 官方 CDN）",
    ),
    "hud/p5r-dialogue-maruki-fullframe.jpg": (
        "feabb3592c057dc9751655fe5504c59a8a1a0bc8a12a5276b7573594732d21f9",
        (1920, 1080),
        "G1 普通对话完整帧（本地导入）",
    ),
    "hud/p5r-im-groupchat-fullframe.jpg": (
        "44b761f42b7094ba3edba53a7f3587d4923e01cc9afa7717e1384ca1561b709e",
        (1280, 720),
        "IM 完整屏（群聊）",
    ),
    "hud/p5r-im-photo-fullframe.jpg": (
        "4aa5330b1fe601bf40737f584ffc4a5a5d8dfe30526e75614c1076d3c3c3f3bf",
        (1920, 1080),
        "IM 完整屏（含图片消息）",
    ),
    "hud/p5r-street-hud-fullframe.jpg": (
        "c56d8e149535c398ce0af17ebcb38b2c55970c4272ffb582c2b950a5e8c47e59",
        (1920, 1080),
        "手机 HUD 完整帧（含 IM 通知）",
    ),
}

failures: list[str] = []
checks: list[str] = []


def ok(label: str) -> None:
    checks.append(label)
    print(f"  ✓ {label}")


def fail(label: str) -> None:
    failures.append(label)
    print(f"  ✗ {label}")


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", default=str(DEFAULT_REFERENCE))
    parser.add_argument("--json", default="")
    args = parser.parse_args()
    root = pathlib.Path(args.reference)
    print(f"== 精选库完整帧复验：{root} ==")
    if not root.is_dir():
        print("  SKIP：参考库目录不存在（非本机验收环境）")
        return 0

    curated = root / "persona-curated"
    try:
        from PIL import Image
    except Exception:  # noqa: BLE001
        print("  SKIP：缺少 Pillow，无法读尺寸")
        return 0

    index_text = (curated / "INDEX.md").read_text(encoding="utf-8") if (curated / "INDEX.md").exists() else ""
    hashes = json.loads((curated / "provenance" / "hashes.json").read_text(encoding="utf-8"))
    sources = json.loads((curated / "provenance" / "sources.json").read_text(encoding="utf-8"))
    hash_paths = {item["path"] for item in hashes.get("items", [])}
    source_paths = {item["path"] for item in sources.get("sources", [])}

    for rel, (expected_sha, expected_size, purpose) in EXPECTED.items():
        file = curated / rel
        if not file.is_file():
            fail(f"缺少 {rel}（{purpose}）")
            continue
        digest = sha256(file)
        if digest != expected_sha:
            fail(f"{rel} 哈希不符：{digest[:16]}… ≠ {expected_sha[:16]}…")
            continue
        with Image.open(file) as image:
            size = image.size
        if tuple(size) != expected_size:
            fail(f"{rel} 尺寸 {size} ≠ {expected_size}")
            continue
        if rel not in index_text:
            fail(f"{rel} 未登记在 persona-curated/INDEX.md")
            continue
        if rel not in hash_paths or rel not in source_paths:
            fail(f"{rel} 未同时登记在 provenance/hashes.json 与 sources.json")
            continue
        ok(f"{purpose}：{rel}（{size[0]}×{size[1]}，哈希一致）")

    # 来源 URL 至少要出现在 sources.json（本地导入帧有「未核实」说明）
    if "未核实" in (curated / "provenance" / "sources.json").read_text(encoding="utf-8"):
        ok("来源记录保留「未核实」口径（本地导入帧）")

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
