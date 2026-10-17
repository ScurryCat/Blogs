/**
 * 旧照片墙地址 `/showcase/photos` → 生活图库 `/gallery`（第三轮任务书 §4.1）。
 *
 * 第三轮起「我的殿堂」只保留作品与作品详情，照片迁入生活图库；旧地址**保留重定向**，
 * 携带原相册与合法筛选参数（`album`、`scope`、`kind`、`year`、`month`）。
 *
 * 三条硬规则：
 *  1. **不传导航意图**：图库不是作品殿堂边界。旧地址虽含 `showcase` 前缀，但
 *     `features/runtime/navigation/showcase-boundary.ts` 已把它排除在殿堂边界外，
 *     这里也只做服务端重定向，不触碰协调器 —— 因此不会播放异世界过场（任务书 §6.1）。
 *  2. 只做服务端永久重定向（308）：原查询串里的旧参数由
 *     `legacyPhotosRedirectPath()` 白名单化后拼进目标地址，未知 / 分页参数丢弃。
 *  3. 手机参数（`phone` / `screen` / `item`）不转发：旧手机照片 / 相册深链由
 *     `features/showcase/phone-view.tsx` 在手机宿主里转发到图库（保留目标相册），
 *     这里的目标是**页面内容**本身，转发手机参数只会让手机壳在新页面上重新打开一次。
 */

import { permanentRedirect } from "next/navigation";

import { legacyPhotosRedirectPath } from "@/features/gallery/paths";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LegacyPhotosPage({ searchParams }: PageProps): Promise<never> {
  const params = await searchParams;
  permanentRedirect(legacyPhotosRedirectPath(params));
}
