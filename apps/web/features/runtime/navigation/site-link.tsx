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

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const request = navigationRequestFromClick(event, event.currentTarget, href, source);
    if (!request) return;
    event.preventDefault();
    navigation.navigate(request);
  };

  return (
    <a ref={ref} href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
