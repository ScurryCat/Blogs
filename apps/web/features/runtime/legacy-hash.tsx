"use client";

/**
 * 旧站锚点落地（01 §5）：
 * `index.html#posts` / `index.html#archive` / `index.html#latest` 迁移到新站后仍要落到正确区块。
 *
 * 浏览器的原生锚点滚动在 Next 客户端路由里并不可靠（首帧内容可能还没提交），
 * 因此这里在路由提交后补一次 `scrollIntoView`：**不 push 历史、不播过场**，
 * 减少动态效果时用 `instant`。
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { isHomeAnchor } from "@/features/legacy/routes";
import { prefersReducedMotion } from "@/features/runtime/effects/crowd";

export function LegacyHashLanding(): null {
  const pathname = usePathname();

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw || !isHomeAnchor(raw)) return;
    const target = document.getElementById(raw);
    if (!target) return;
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, [pathname]);

  return null;
}
