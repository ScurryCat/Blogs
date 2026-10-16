"use client";

/**
 * 阅读页里指向其他殿堂的链接：`SiteLink` + 记一次本机足迹。
 *
 * 为什么单独成组件：`PalaceReading` 是服务端组件（要能 SSR），它不能直接读浏览器存储。
 * 这个小组件把「记足迹」留在客户端，链接本身仍然是真实的 `<a href>`（可新标签页打开）。
 */

import { useMemo, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { createBrowserStateAdapter, recordVisit } from "./footprint";
import { palacePath } from "./paths";

export function PalaceEntryLink({
  slug,
  title,
  className,
  children,
}: {
  slug: string;
  title: string;
  className?: string;
  children: ReactNode;
}): ReactNode {
  const state = useMemo(() => createBrowserStateAdapter(), []);
  return (
    <SiteLink
      className={className}
      href={palacePath(slug)}
      source="metaverse-entry"
      onClick={() => {
        recordVisit(state, { slug, title });
      }}
    >
      {children}
    </SiteLink>
  );
}
