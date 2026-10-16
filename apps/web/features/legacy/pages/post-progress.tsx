"use client";

/**
 * 文章阅读进度条 + 目录高亮 —— 旧站 `assets/js/post.js` 下半部分迁移。
 *
 * 只计算正文区域：进度条宽度走 CSS 变量 `--p`，目录高亮取最后一个滚过 30% 视高的标题。
 * 滚动监听用 rAF 节流，卸载时移除（旧站靠 `PL.onLeave`）。
 */

import { useEffect, useRef, type ReactNode } from "react";

export function PostProgress({ headingIds }: { headingIds: readonly string[] }): ReactNode {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const article = document.getElementById("article");
    const bar = barRef.current;
    if (!article || !bar) return;

    const links = [...document.querySelectorAll<HTMLAnchorElement>(".toc a")];
    const heads = headingIds.map((id) => document.getElementById(id));
    let ticking = false;

    const update = () => {
      ticking = false;
      const rect = article.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - window.innerHeight)));
      bar.style.setProperty("--p", progress.toFixed(4));
      let active = -1;
      heads.forEach((heading, index) => {
        if (heading && heading.getBoundingClientRect().top < window.innerHeight * 0.3) active = index;
      });
      links.forEach((link, index) => link.classList.toggle("on", index === active));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, [headingIds]);

  return <div className="progress" aria-hidden="true" ref={barRef} />;
}
