/**
 * COOP 的站内地址（07 §7：友链的 canonical 路由是 `/apps/coop`）。
 *
 * 没有「每条友链一个路径」：任务卡给出的字段里没有 slug，友链详情在应用内展开，
 * 通过查询参数 `item=<uuid>` 分享（可刷新、可加入书签、Back 可用）。
 * 将来若需要稳定的逐条 URL，加 slug + 迁移重定向再谈，不先造一个会变的地址。
 */

export const COOP_PATH = "/apps/coop";

export interface CoopQueryState {
  /** 标签筛选（原始展示名；服务端按规范化值匹配）。 */
  tag?: string | null;
  /** 展开的友链 id（UUID）。 */
  item?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 非法 id 一律当作「没有展开任何卡片」，不执行任意路径（02 §6 的同一条原则）。 */
export function normalizeCoopItem(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function normalizeCoopTag(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 40) return null;
  return candidate;
}

export function coopPath(state: CoopQueryState = {}): string {
  const params = new URLSearchParams();
  const tag = normalizeCoopTag(state.tag);
  const item = normalizeCoopItem(state.item);
  if (tag) params.set("tag", tag);
  if (item) params.set("item", item);
  const query = params.toString();
  return query ? `${COOP_PATH}?${query}` : COOP_PATH;
}

/** 由当前查询串构造变更后的地址（保留其它参数；值为空时删掉该参数）。 */
export function buildCoopHref(
  pathname: string,
  search: string,
  changes: CoopQueryState,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const apply = (key: "tag" | "item", value: string | null | undefined): void => {
    if (value === undefined) return;
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  };
  apply("tag", normalizeCoopTag(changes.tag));
  apply("item", normalizeCoopItem(changes.item));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
