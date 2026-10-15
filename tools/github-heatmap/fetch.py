#!/usr/bin/env python3
"""抓取 GitHub 贡献日历 -> assets/js/heatmap-data.js

用法：
    python3 tools/github-heatmap/fetch.py                        # 默认 ScurryCat，最近一年
    python3 tools/github-heatmap/fetch.py --user someone
    python3 tools/github-heatmap/fetch.py --from 2023-10-12 --to 2026-10-15

为什么要构建期抓：GitHub 没有公开的贡献日历 API（GraphQL 要 token，REST 的
/events 只有 90 天且限速 60 次/小时），而页面本身那个日历是服务端渲染的 HTML。
抓一次存成本地数据，站点运行时零外部依赖 —— 和仓库里其它素材一个路子。

私密贡献：默认不计入公开日历。要让它们出现，用户得自己去
    GitHub -> Settings -> Public profile -> 勾选 "Include private contributions on my profile"
勾选后只会显示等级与次数，不泄露仓库名。改完重跑本脚本即可。
"""
import argparse
import datetime as dt
import json
import re
import sys
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
OUT = "assets/js/heatmap-data.js"


def _ssl_context():
    """macOS 上 python.org 版 Python 默认没有 CA 包（urllib 会报
       CERTIFICATE_VERIFY_FAILED），有 certifi 就用它；再不行退回 curl。"""
    try:
        import certifi
        import ssl
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return None


def fetch(user, frm, to):
    url = f"https://github.com/users/{user}/contributions?from={frm}&to={to}"
    ctx = _ssl_context()
    if ctx is not None:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return r.read().decode("utf-8", "replace")
    import subprocess                                  # 没 certifi 就借系统的 curl（走钥匙串）
    out = subprocess.run(["curl", "-sSfL", "-m", "30", "-H", f"User-Agent: {UA}",
                          "-H", "Accept-Language: en", url],
                         capture_output=True, check=True)
    return out.stdout.decode("utf-8", "replace")


def parse(html):
    """td 上的属性顺序不固定，所以先整体取出每个 td 再分别找 id / data-date / data-level"""
    days = {}
    for td in re.findall(r"<td\b[^>]*\bdata-date=\"[0-9-]+\"[^>]*>", html):
        d = re.search(r'data-date="([0-9-]+)"', td)
        lv = re.search(r'data-level="([0-9])"', td)
        cid = re.search(r'id="([^"]+)"', td)
        if not (d and lv and cid):
            continue
        days[cid.group(1)] = {"date": d.group(1), "level": int(lv.group(1)), "count": 0}
    # 次数在配套的 <tool-tip for="单元格 id"> 里
    for tip in re.findall(r"<tool-tip\b[^>]*>.*?</tool-tip>", html, re.S):
        m = re.search(r'for="([^"]+)"', tip)
        if not m or m.group(1) not in days:
            continue
        text = re.sub(r"<[^>]*>", "", tip)
        n = re.search(r"(\d+|No)\s+contribution", text)
        if n:
            days[m.group(1)]["count"] = 0 if n.group(1) == "No" else int(n.group(1))
    return sorted(days.values(), key=lambda x: x["date"])


def streaks(days):
    """当前连续 / 历史最长连续（只算 count>0 的天）"""
    best = cur = 0
    best_run = cur_run = None
    prev = None
    for d in days:
        if d["count"] > 0:
            day = dt.date.fromisoformat(d["date"])
            if prev is not None and (day - prev).days == 1:
                cur += 1
            else:
                cur = 1
            prev = day
            if cur > best:
                best, best_run = cur, (day - dt.timedelta(days=cur - 1), day)
        # 不重置 prev：断档时下一次会走 else 分支重新起算
    # 当前连续：从最后一天往回数
    run = 0
    last = dt.date.fromisoformat(days[-1]["date"]) if days else None
    for d in reversed(days):
        if d["count"] > 0:
            run += 1
        elif dt.date.fromisoformat(d["date"]) != last:   # 允许最后一天还没提交
            break
    return run, best, best_run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="ScurryCat")
    ap.add_argument("--from", dest="frm", default=None, help="YYYY-MM-DD，默认最近一年")
    ap.add_argument("--to", dest="to", default=None)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()

    today = dt.date.today()
    to = a.to or today.isoformat()
    frm = a.frm or (today - dt.timedelta(days=365)).isoformat()

    print(f"抓取 github.com/users/{a.user}/contributions  {frm} → {to}")
    html = fetch(a.user, frm, to)
    days = parse(html)
    if not days:
        print("❌ 没解析到日历。可能是用户名不存在、被限流，或 GitHub 改了标记结构。", file=sys.stderr)
        sys.exit(1)

    counts = [d["count"] for d in days]
    total = sum(counts)
    mx = max(counts) if counts else 0
    active = sum(1 for c in counts if c)
    cur, best, best_run = streaks(days)
    busiest = max(days, key=lambda d: d["count"]) if days else None

    print(f"  {len(days)} 天，有贡献 {active} 天，合计 {total} 次，单日最高 {mx}"
          f"（{busiest['date'] if busiest else '—'}）")
    print(f"  当前连续 {cur} 天，最长连续 {best} 天"
          + (f"（{best_run[0]} → {best_run[1]}）" if best_run else ""))
    if active / max(len(days), 1) < .05:
        print("  ⚠️  活跃天占比不足 5%：私密仓库的贡献默认不计入，"
              "去 GitHub → Settings → Public profile 勾上 "
              "\"Include private contributions on my profile\" 后重跑本脚本。")

    payload = {
        "user": a.user, "from": frm, "to": to,
        # 紧凑：[[日期, 等级, 次数], ...] —— 一天约 20 字节，比对象数组省一半
        "days": [[d["date"], d["level"], d["count"]] for d in days],
        "total": total, "max": mx, "active": active,
        "streak": {"current": cur, "longest": best},
        "busiest": {"date": busiest["date"], "count": busiest["count"]} if busiest else None,
    }
    js = ("/* =====================================================================\n"
          "   PHANTOM LOG · heatmap-data.js —— GitHub 贡献日历（由 tools/github-heatmap/fetch.py 生成）\n"
          f"   账号 {a.user} · {frm} → {to} · {len(days)} 天 · 合计 {total} 次 · 单日最高 {mx}\n"
          "   只在 about.html 上加载。刷新数据：python3 tools/github-heatmap/fetch.py\n"
          "   ===================================================================== */\n"
          "window.PL_HEATMAP = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    open(a.out, "w", encoding="utf-8").write(js)
    print(f"写出 {a.out}: {len(js)} 字节")


if __name__ == "__main__":
    main()
