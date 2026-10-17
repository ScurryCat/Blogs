/**
 * INS 的滚动位置记忆（任务书 §4.1「切换详情后返回列表时恢复浏览位置」）。
 *
 * 实现已提到 `features/runtime/scroll-memory.ts` —— 手记、相册等列表也需要同一套能力，
 * 而「手机里滚 `.pw-screen`、独立页滚窗口」的判定对谁都一样。这里只保留 INS 自己的
 * 分键规则与旧的导出名，避免调用方大改。
 */

export {
  phoneScrollContainer,
  scrollContainerFor,
  useScrollMemory,
} from "@/features/runtime/scroll-memory";
import { useScrollMemory, type RestoreScrollOptions } from "@/features/runtime/scroll-memory";

export const FEED_SCROLL_PREFIX = "ins.feed.scroll.v1";

export function scrollKey(tag: string | null): string {
  return `${FEED_SCROLL_PREFIX}:${(tag ?? "").trim() || "__all__"}`;
}

/** INS 的封装：按标签分键。 */
export function useFeedScrollRestore(
  key: string,
  ready: boolean,
  options: RestoreScrollOptions,
): void {
  useScrollMemory(key, ready, options);
}
