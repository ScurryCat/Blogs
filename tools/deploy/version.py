#!/usr/bin/env python3
"""写一个 version.json，用来回答「线上到底是哪个版本」。

为什么不用在 HTML 里写 <meta name="version">：nginx 的 root 直接指向克隆目录时，
改 HTML 会让工作区变脏，之后 git pull 可能就被挡住。所以版本信息单独放一个
**不入库**的 version.json（已在 .gitignore 里），部署完顺手写下即可。

用法：
    python3 tools/deploy/version.py            # 写到仓库根目录
    python3 tools/deploy/version.py --check    # 只打印，不写

装上钩子后每次 git pull 会自动更新，见 tools/deploy/install-hook.sh。
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "version.json"


def git(*args):
    try:
        return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return ""


def info():
    index = ROOT / "index.html"
    return {
        "commit": git("rev-parse", "HEAD") or "unknown",
        "short": git("rev-parse", "--short", "HEAD") or "unknown",
        "branch": git("rev-parse", "--abbrev-ref", "HEAD") or "unknown",
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        # index.html 的指纹：和本地 sha256sum 对一下就知道服务器送出的 HTML 是不是这份
        "indexSha256": hashlib.sha256(index.read_bytes()).hexdigest()[:16] if index.exists() else "",
        "dirty": bool(git("status", "--porcelain")),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只打印，不写文件")
    a = ap.parse_args()
    d = info()
    if a.check:
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return
    OUT.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写 {OUT.relative_to(ROOT)}: {d['short']} ({d['branch']})"
          + ("  ⚠ 工作区有未提交改动" if d["dirty"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
