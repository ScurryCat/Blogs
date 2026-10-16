/**
 * 外链地址的前端兜底（验收第 2 条）。
 *
 * 服务端已经在写入与读取两侧拒绝非 http(s) 地址（`app/modules/coop/urls.py` +
 * 数据库 CHECK），这里仍然再判一次，理由有两条：
 *
 *   1. **纵深防御**：把不可信字符串放进 `href` 就是把它放进可执行位置。
 *      哪天接口换了、缓存脏了、或者有人手工改库，渲染层不能跟着一起失守。
 *   2. **可测试**：这个纯函数可以用 `javascript:` 之类的字符串直接断言，
 *      而不是只在「服务端一定正确」的前提下相信界面安全。
 *
 * 规则与后端同形：只接受 http / https，必须有主机名（域名或 IP 字面量），
 * 不允许内嵌用户名密码，不允许空白与控制字符。
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** 控制字符与空白：浏览器会忽略其中一部分，攻击者正是靠它绕过前缀检查。 */
const FORBIDDEN_CHARS = /[\u0000-\u0020\u007f\u00a0\u2028\u2029]/;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isSafeExternalUrl(value: string): boolean {
  return externalLinkAttributes(value) !== null;
}

export interface ExternalLinkAttributes {
  href: string;
  target: "_blank";
  rel: "noopener noreferrer";
}

/**
 * 安全外链的锚点属性；地址不可用时返回 `null`（调用方应渲染成纯文本，而不是链接）。
 *
 * 新窗口行为固定 `target="_blank"` + `rel="noopener noreferrer"`：
 * 前者让访客留在本站（离开本站是可辨识的动作），后者让外部页面拿不到 `window.opener`。
 */
export function externalLinkAttributes(value: string): ExternalLinkAttributes | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || FORBIDDEN_CHARS.test(candidate)) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (!isPlausibleHostname(parsed.hostname)) return null;

  return { href: parsed.toString(), target: "_blank", rel: "noopener noreferrer" };
}

/** 域名（含至少一个点）或 IP 字面量；`localhost` 这类内网名不算外链。 */
function isPlausibleHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost") return false;
  if (IPV4.test(hostname)) return true;
  // URL 会把 IPv6 主机名规范化成带方括号的形式（jsdom 与浏览器一致）。
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  return hostname.includes(".") && !hostname.startsWith(".") && !hostname.endsWith(".");
}
