/**
 * 返回上下文（returnTo）工具（P5 第一批 · 契约 §4.6 / §9.5）。
 *
 * 用途：从创作台 / 编辑器返回**来源页面、筛选条件与手机 App 上下文**。
 * 安全约束（只允许站内白名单目标，非法一律回 `/admin`）：
 *  - 只接受字符串、以**单个** `/` 开头；
 *  - 拒绝 `//` 开头的协议相对地址、反斜杠（浏览器会把 `\` 当 `/`）、任何控制字符；
 *  - 路径（去掉查询串/片段后）必须落在白名单内：
 *    `/`（仅首页本身）、`/apps/ins`、`/apps/journal`、`/apps/leisure`、`/apps/leblanc` 及其子路径；
 *  - 协议/主机（如 `https://…`、`javascript:…`）天然不满足「以 / 开头」，因此被拒。
 *
 * 注意：`URLSearchParams.get()` 会先做百分号解码，所以 `%2F%2Fevil` 会被还原成
 * `//evil` 并被下面的检查拦住；这里不信任调用方传入的「已解码」状态。
 */

/** 允许 returnTo 指向的站内路径前缀（含首页本身）。 */
const ALLOWED_PATH_PREFIXES: readonly string[] = [
  "/apps/ins",
  "/apps/journal",
  "/apps/leisure",
  "/apps/leblanc",
];

/** 控制字符（含 NUL、换行、TAB、DEL）：URL 里绝不应出现，出现即拒绝。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 校验并返回安全的站内路径；不合法返回 `null`。
 *
 * 返回的是**调用方传入的原字符串**（保留查询串与片段），不做重编码 —— 它已经通过校验，
 * 交给 `router.replace` / `href` 时行为可预期。调用点统一用 `?? "/admin"` 兜底。
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // 必须是单个 `/` 开头：`//host` 与 `/\host` 都会被浏览器当成跨源地址，直接拒绝。
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (CONTROL_CHARS.test(value)) return null;
  // 去掉查询串与片段后做白名单判断；查询串允许任意内容（手机 deep-link 的 phone/screen/item 就在里面）。
  const path = value.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (path === "/") return value;
  const allowed = ALLOWED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return allowed ? value : null;
}

/** 把已校验的 returnTo 编码进站内链接的查询串（无 query 时用 `?`，否则用 `&`）。 */
export function withReturnTo(href: string, returnTo: string | null | undefined): string {
  if (!returnTo) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}

/** 从查询参数里读取并校验 returnTo；非法返回 `null`（调用方回 `/admin`）。 */
export function readReturnTo(searchParams: URLSearchParams | null | undefined): string | null {
  if (!searchParams) return null;
  return safeInternalPath(searchParams.get("returnTo"));
}

/**
 * 去掉 URL 里的手机浮层上下文参数（`phone` / `screen` / `item`）。
 *
 * 契约 §9.5：点击站主入口时若手机浮层正打开，必须先把浮层关掉（或至少把 phone 参数去掉）
 * 再跳转，否则编辑器会被 `.pw-wrap` 浮层遮挡。这个 helper 只做 URL 层兜底：
 * 优先用手机宿主自己的导航/浮层 API，拿不到时再用 `router.replace(stripPhoneContext(...))`。
 */
export function stripPhoneContext(href: string): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex === -1) return href;
  const path = withoutHash.slice(0, queryIndex);
  const query = withoutHash.slice(queryIndex + 1);
  const kept = new URLSearchParams(query);
  for (const key of ["phone", "screen", "item"]) kept.delete(key);
  const suffix = kept.toString();
  return `${path}${suffix ? `?${suffix}` : ""}${hash}`;
}
