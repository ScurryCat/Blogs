"use client";

/**
 * 带「导航来源」的站内链接。
 *
 * 保留真实 `href`（新标签页、复制链接、爬虫、无脚本回退都正常）；
 * 只有普通左键点击才交给导航协调器播过场：
 * Ctrl / Cmd / Shift / Alt、中键、`target`、`download` 一律放行给浏览器。
 * 键盘 Enter 触发的是同一次 click，因此与鼠标点击等价。
 */

import type { AnchorHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";

import type { NavigationSource } from "@/features/phone/types";
import { navigationRequestFromClick } from "@/features/runtime/navigation/link-guard";
import { useNavigation } from "@/features/runtime/navigation/coordinator";

export interface SiteLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** 语义来源：决定过场效果，不按当前页面猜。 */
  source: NavigationSource;
  /** React 19 起 `ref` 就是普通 prop，不再需要 forwardRef。 */
  ref?: Ref<HTMLAnchorElement>;
  children?: ReactNode;
}

export function SiteLink({ href, source, onClick, children, ref, ...rest }: SiteLinkProps): ReactNode {
  const navigation = useNavigation();

  /**
   * 刻意用**捕获阶段**：Next 16 会在 document 上挂自己的点击处理（同一节点上先注册的先跑），
   * 如果等冒泡到 body 才 preventDefault，浏览器可能已经开始了默认的整页跳转
   * —— 表现为「RSC 请求发出去了，但文档还是整页重载」（实测：window 冒泡处
   * defaultPrevented 已经是 true，页面依旧重载）。在捕获阶段先拦住就不会有这个竞态。
   */
  const handleClickCapture = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const request = navigationRequestFromClick(event, event.currentTarget, href, source);
    if (!request) return;
    event.preventDefault();
    event.stopPropagation();
    navigation.navigate(request);
  };

  return (
    <a ref={ref} href={href} onClickCapture={handleClickCapture} {...rest}>
      {children}
    </a>
  );
}
