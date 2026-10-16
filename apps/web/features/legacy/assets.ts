/**
 * 旧站静态资源的地址映射。
 *
 * 迁移把已审查的资源逐字节复制到 `apps/web/public/assets/legacy/`（旧站 `assets/` 只读）。
 * 旧配置里的 `assets/img/...` 一律经 `asset()` 转成 Next 静态根下的地址，
 * 这样 `site.json` / `posts.json` 保持旧站原样、不夹带新站路径，也便于核对。
 */

export const LEGACY_ASSET_PREFIX = "/assets/legacy/";

/** `assets/img/x.webp` → `/assets/legacy/img/x.webp`；绝对地址与站内绝对路径原样返回。 */
export function asset(legacyPath: string): string {
  if (!legacyPath) return legacyPath;
  if (/^[a-z][a-z0-9+.-]*:/i.test(legacyPath) || legacyPath.startsWith("//")) return legacyPath;
  if (legacyPath.startsWith("/")) return legacyPath;
  return LEGACY_ASSET_PREFIX + legacyPath.replace(/^assets\//, "");
}
