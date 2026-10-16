/**
 * 页脚 —— 旧站 `core.js` 的 `chrome()` 页脚部分迁移。
 * 跑马灯、品牌、Hideout / Contact 两列与版权行都按原样保留。
 */

import type { ReactNode } from "react";

import { MAIN_NAV } from "./site-header";
import { Ticker } from "@/features/legacy/text/ticker";
import { site } from "@/features/legacy/config";
import { SiteLink } from "@/features/runtime/navigation/site-link";

/**
 * 页脚版权说明里的 `<b>` 是配置里唯一的富文本标记（基线的静态文案，不是用户输入）。
 * 这里按标记切成 React 节点，**不走 `dangerouslySetInnerHTML`**。
 */
function LegalText({ html }: { html: string }): ReactNode {
  const parts = html.split(/(<b>.*?<\/b>)/g);
  return (
    <p>
      {parts.map((part, index) =>
        part.startsWith("<b>") && part.endsWith("</b>") ? (
          <b key={index}>{part.slice(3, -4)}</b>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export function SiteFooter(): ReactNode {
  return (
    <footer className="foot">
      <Ticker />
      <div className="shell foot-in">
        <div className="foot-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站品牌图，尺寸固定。 */}
          <img src={site.logo} alt="Persona 5 Royal" loading="lazy" width={248} height={74} />
          <LegalText html={site.legal} />
        </div>
        <nav className="foot-links" aria-label="页脚导航">
          <h3 className="kick">Hideout</h3>
          {MAIN_NAV.map((item) => (
            <SiteLink href={item.href} source="top-nav" key={item.key}>
              {item.en}
            </SiteLink>
          ))}
        </nav>
        <div className="foot-links">
          <h3 className="kick">Contact</h3>
          {site.social.map((link) => (
            <a
              href={link.url}
              key={link.k}
              {...(/^https?:/.test(link.url) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.k}
            </a>
          ))}
        </div>
      </div>
      <div className="shell">
        <div className="foot-legal">
          <span>{site.copyright}</span>
          <span>Made with skewX(-10deg)</span>
        </div>
      </div>
    </footer>
  );
}
