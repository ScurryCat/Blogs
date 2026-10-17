#!/usr/bin/env python3
"""真实浏览器 WCAG 对比度巡检（Playwright + Chromium，无新依赖）。

为什么需要：静态 CSS 检查看不出「半透明层叠后的实际对比度」；本脚本在真实浏览器里
对**可见文字**做前景/背景的实际色值合成与对比度计算，按 WCAG AA（普通文字 4.5:1 /
大字 3:1）报告不达标项。

边界（避免假阳性）：
  - 跳过背景是图片/渐变（无法用纯色判定）的元素；
  - 跳过「透明填充 + -webkit-text-stroke」的装饰描边字（其填充色透明是设计）；
  - 只统计有直接文本节点的元素；行内链接等按元素自身色值判断。

用法：
    python3 tools/audit-contrast.py [BASE] [--json OUT]
默认 BASE=http://127.0.0.1:3130（隔离栈前端）。

退出码：0 = 没有不达标项；1 = 有不达标项（便于接 CI；人工评审后可按页面白名单放宽）。
"""

from __future__ import annotations

import argparse
import json
import sys

from playwright.sync_api import sync_playwright

PAGES = {
    "home": "/",
    "about": "/about",
    "posts": "/posts",
    "showcase": "/showcase",
    "gallery": "/gallery",
    "velvet": "/velvet",
    "metanav": "/apps/metanav",
    "coop": "/apps/coop",
    "leisure": "/apps/leisure",
    "journal": "/apps/journal",
    "mementos": "/apps/metanav/mementos",
    "leblanc": "/apps/leblanc",
}

JS = r"""
() => {
  function parseColor(c){
    const m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null;
    const p=m[1].split(/[, /]+/).filter(Boolean).map(Number);
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};
  }
  function lum({r,g,b}){ const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); }
  function blend(fg,bg){ const a=fg.a??1; return {r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1}; }
  function effBg(el){
    const stack=[]; let node=el;
    while(node && node!==document.documentElement){
      const cs=getComputedStyle(node);
      if(cs.backgroundImage && cs.backgroundImage!=='none') return null; // 图片/渐变背景：不判定
      const c=parseColor(cs.backgroundColor);
      if(c && c.a>0) stack.push(c);
      if(c && c.a>=0.999) break;
      node=node.parentElement;
    }
    let base={r:10,g:10,b:11,a:1}; // 站点深色底
    for(let i=stack.length-1;i>=0;i--){ base=blend(stack[i], base); }
    return base;
  }
  const out=[];
  const els=[...document.querySelectorAll('main p, main li, main h1, main h2, main h3, main h4, main h5, main h6, main a, main button, main label, main time, main code, main span')];
  for(const el of els){
    const direct=[...el.childNodes].some((n)=>n.nodeType===3 && n.textContent.trim().length>1);
    if(!direct) continue;
    const r=el.getBoundingClientRect();
    if(r.width<2 || r.height<2) continue;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden' || cs.display==='none' || Number(cs.opacity)===0) continue;
    const fg0=parseColor(cs.color); if(!fg0) continue;
    if(fg0.a===0) continue; // 透明填充（描边字）：装饰性，不判定
    const bg=effBg(el); if(!bg) continue;
    const fg=fg0.a<1 ? blend(fg0,bg) : fg0;
    const L1=lum(fg), L2=lum(bg);
    const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const fontSize=parseFloat(cs.fontSize), weight=Number(cs.fontWeight)||400;
    const large = fontSize>=24 || (fontSize>=18.66 && weight>=700);
    const need = large?3:4.5;
    if(ratio<need){
      out.push({ratio:Math.round(ratio*100)/100, need, color:cs.color,
        bg:`rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        font:fontSize, weight, cls:(el.className||'').toString().slice(0,60), tag:el.tagName,
        text:(el.textContent||'').trim().slice(0,40)});
    }
  }
  const seen=new Set(); const uniq=[];
  for(const item of out){ const k=item.cls+'|'+item.color+'|'+item.ratio; if(seen.has(k)) continue; seen.add(k); uniq.push(item); }
  uniq.sort((a,b)=>a.ratio-b.ratio);
  return uniq.slice(0,30);
}
"""


def boot(page) -> None:
    page.wait_for_timeout(1300)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001 - 启动动画可能已消失
            pass
        page.wait_for_timeout(500)


def dismiss_poll(page) -> None:
    try:
        button = page.locator(".poll-close").first
        if button.count():
            button.click(timeout=1200)
            page.wait_for_timeout(250)
    except Exception:  # noqa: BLE001 - 浮层不是每次都会出现
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://127.0.0.1:3130")
    parser.add_argument("--json", default="")
    args = parser.parse_args()

    report: dict[str, list[dict]] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 1200})
        for name, path in PAGES.items():
            page = context.new_page()
            try:
                page.goto(args.base + path, wait_until="load", timeout=30000)
                boot(page)
                page.wait_for_timeout(1800)
                dismiss_poll(page)
                report[name] = page.evaluate(JS)
            except Exception as error:  # noqa: BLE001 - 单页失败不中断整轮
                report[name] = [{"error": str(error)[:120]}]
            page.close()
        browser.close()

    failures = {name: items for name, items in report.items() if items}
    print(
        json.dumps(
            {
                "pages": {name: len(items) for name, items in report.items()},
                "total": sum(len(items) for items in report.values()),
                "failures": failures,
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=1)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
