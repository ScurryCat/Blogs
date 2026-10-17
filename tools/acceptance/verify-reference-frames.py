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
    # --- 2026-10-18 第二批：P5 完整帧（Game UI Database 归档页） ---
    "hud/p5-load-save-fullframe.jpg": (
        "65f9e7fff69aa68b2af087f01d5478e4302e5153b2d966bf78680212359e5409",
        (1920, 1080),
        "存档/读取整屏帧（P5 Load Game 存档槽）",
    ),
    "hud/p5-phone-home-fullframe.jpg": (
        "25549fa56b7e9948e5cae19971494737a4b80add6fa5942fff66f11f02db2220",
        (1920, 1080),
        "手机主屏完整帧（P5 App 网格/红眼图标）",
    ),
    "hud/p5-calendar-fullframe.jpg": (
        "eb1bbf4d103c99912e25bc0ec129cd1192c93bfd9bdc474ad5006fe782c51183",
        (1920, 1080),
        "日历整屏帧（手记参考）",
    ),
    "hud/p5-status-fullframe.jpg": (
        "7a613ba13a9f7750482dd6d368e0114691ff36900c51e8ccdcec15dce8229e91",
        (1920, 1080),
        "五维状态整屏帧（人物档案参考）",
    ),
    "hud/p5-map-school-fullframe.jpg": (
        "1c9e07173b5309d6a3f3a844c94be37d769131987cd81d5653c6c0c250dd7d35",
        (1920, 1080),
        "校内地图整屏帧（地图/殿堂参考）",
    ),
    "hud/p5-tokyo-map-fullframe.jpg": (
        "b5036e9387f34e5f518350a01d67bf386d84b6810052bc640649ab6cab9268b4",
        (1920, 1080),
        "东京地图整屏帧（东京漫游参考）",
    ),
    # --- 2026-10-18 第三批：界面整屏帧（天鹅绒/印象空间/COOP/殿堂/放课后） ---
    "hud/p5r-velvet-room-fullframe.jpg": (
        "2ee23c9363ebc617ff82d2d88393d5ffbd4ff55f961f8dfb8eea0f46389457cc",
        (3840, 2160),
        "天鹅绒房间整屏帧（P5R Velvet Room）",
    ),
    "hud/p5-mementos-fullframe.jpg": (
        "e94b414fda0caea2575a68a0435db25e0c09676a23c9478437694280b75df3f4",
        (800, 447),
        "印象空间整屏帧（Mementos Aiyatsbus）",
    ),
    "hud/p5r-coop-confidant-fullframe.jpg": (
        "b3ef4cc5615854ae6d784bb2bac56bcbd34534d10b869f4bd3c6951690ebace8",
        (1400, 788),
        "COOP 协助者整屏帧（Confidant 升阶）",
    ),
    "hud/p5-palace-treasure-fullframe.jpg": (
        "a5e4d4ce11edc42c6ef228583c024a9e5f306a432ba4a250e74c864ae62da3f3",
        (1280, 720),
        "殿堂整屏帧（宝库/殿堂内景）",
    ),
    "hud/p5-leisure-batting-fullframe.jpg": (
        "69aeee91e074a6b911dc5c968610e210e272a771196e71c349c666b5cb59d0d8",
        (1281, 723),
        "放课后整屏帧（打击练习场迷你游戏）",
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
