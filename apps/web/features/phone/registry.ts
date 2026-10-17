/**
 * 手机应用注册表。
 *
 * 所有权：T00（SHARED-CONTRACTS §2）。应用清单、路由与跨 App 接线都在这里，
 * 各功能包把自己的 manifest 交给 T00 登记，不各自往宿主里塞条件分支
 * （02 §164：新增 App 只改注册表和自身模块）。
 *
 * 注册表来自仓库里的可信模块，**首版不从数据库下载 JavaScript**。
 */

import { COOP_PHONE_MANIFEST } from "@/features/coop/phone-manifest";
import { EXPLORATION_MANIFEST } from "@/features/exploration/phone-manifest";
import { SHOWCASE_MANIFEST } from "@/features/showcase/phone-manifest";
import { INS_MANIFEST } from "@/features/ins/phone-manifest";
import { VELVET_MANIFEST } from "@/features/velvet/phone-manifest";

import type { PhoneAppManifest, PhoneAppModule } from "./types";

/** id 必须是稳定的小写标识，不允许中文或随展示名变化。 */
const APP_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export class PhoneRegistryError extends Error {}

/**
 * 正式桌面应用清单。
 *
 * 未接入的能力**不显示坏按钮**（SHARED-CONTRACTS §4），所以这里只放已交付并接线完成的应用。
 *
 * **order 按 07 §7 的首屏顺序预留序位**（每档留 10，便于插入）：
 *
 *   ins(10) → 手记(20) → 放课后(30) → coop(40) → metanav(50) → 殿堂(60)
 *   → 天鹅绒(70) → 印象空间(80)
 *
 * 「我的殿堂」不在 07 §7 的首屏清单里，因此排在既有顺序**之后**（60），不打断设计顺序。
 *
 * **注意**：应用与 4 个 site-link 入口（palace/tokyo/cast/profile，order 10/20/30/40）共用同一
 * 个 order 命名空间，因此实际桌面顺序是交错的：
 * `ins, palace, tokyo, cast, coop, profile, metanav`。应用**之间**的相对顺序符合设计。
 *
 * 也就是说 COOP 在导航**之前**。T07 建议给自己取 30，但那会排在 metanav(20) 之后、
 * 与设计顺序相反；这里改为按设计预留，T05 的两个应用登记时直接用 20 / 30 即可，不必重排。
 *
 * 登记规则：各包提供 `features/<pkg>/phone-app.tsx`（`default` + `screens` + 可选 `dispose`）
 * 与一份 10 字段 manifest，由 T00 写入这里 —— 包不自己往宿主里塞条件分支。
 */
export const PHONE_APPS: readonly PhoneAppManifest[] = Object.freeze([
  // INS 由 T03 交付并自带 manifest（`features/ins/phone-manifest.tsx`），这里只做登记。
  INS_MANIFEST,
  // 手记与放课后由 T05 交付。**order 用预留序位 20 / 30**（T05 建议的 30/40 会与 coop(40)
  // 冲突、且把放课后排到 COOP 之后，与 07 §7 首屏顺序相反）。leisure 的图标改用 fox.webp，
  // 避免与 metanav 共用同一张 oracle.webp。
  {
    id: "journal",
    name: "手记",
    subtitle: "日记与日历",
    icon: "/assets/legacy/img/icon/morgana.webp",
    order: 20,
    kind: "embedded",
    canonical_path: "/apps/journal",
    loader: () => import("@/features/journal/phone-app"),
    feature_flag: null,
    state_version: 1,
  },
  {
    id: "leisure",
    name: "放课后",
    subtitle: "追番与游戏",
    icon: "/assets/legacy/img/icon/fox.webp",
    order: 30,
    kind: "embedded",
    canonical_path: "/apps/leisure",
    loader: () => import("@/features/leisure/phone-app"),
    feature_flag: null,
    state_version: 1,
  },
  // COOP 由 T07 交付并自带 manifest。
  COOP_PHONE_MANIFEST,
  // 我的殿堂由 T06 交付并自带 manifest。
  SHOWCASE_MANIFEST,
  // 天鹅绒房间 / 印象空间由 T09 交付并自带 manifest（order 70 / 80）。
  // 第二轮任务书 §4.8 要求它们成为手机内置应用；两包的 manifest 早就交齐，
  // 但一直没登记（`?phone=velvet` 会静默回落到桌面）—— 这里补上登记。
  VELVET_MANIFEST,
  EXPLORATION_MANIFEST,
  {
    id: "metanav",
    name: "导航",
    subtitle: "异世界导航",
    // 仓库内已有的迁移图标资源（T02 的 public/assets/legacy/img/icon/），不新增素材。
    icon: "/assets/legacy/img/icon/oracle.webp",
    // 50 = 排在 COOP 之后（07 §7 的首屏顺序）。
    order: 50,
    kind: "embedded",
    canonical_path: "/apps/metanav",
    loader: () => import("@/features/metanav/phone-app"),
    feature_flag: null,
    // 与 footprint 的存储键版本一致，便于将来迁移旧键。
    state_version: 1,
  },
]);

export interface PhoneRegistryOptions {
  /** 编译期启用的 feature flag 集合；未启用的应用不出现在桌面。 */
  enabledFeatureFlags?: ReadonlySet<string>;
}

export interface PhoneRegistry {
  /** 可显示的应用，按 order 升序；同 order 按 id 稳定排序。 */
  manifests(): readonly PhoneAppManifest[];
  /** 按 id 查找可显示的应用；不存在或未启用都返回 undefined。 */
  find(appId: string): PhoneAppManifest | undefined;
  /** 懒加载内置应用视图。site-link 与未注册 id 一律拒绝。 */
  load(appId: string): Promise<PhoneAppModule>;
}

function assertManifest(manifest: PhoneAppManifest): void {
  if (!APP_ID_PATTERN.test(manifest.id)) {
    throw new PhoneRegistryError(`应用 id ${JSON.stringify(manifest.id)} 必须是小写稳定标识`);
  }
  if (!manifest.canonical_path.startsWith("/")) {
    throw new PhoneRegistryError(`应用 ${manifest.id} 的 canonical_path 必须是站内绝对路径`);
  }
  if (manifest.kind === "embedded" && typeof manifest.loader !== "function") {
    throw new PhoneRegistryError(`内置应用 ${manifest.id} 必须提供构建期 loader`);
  }
  if (manifest.kind === "site-link" && manifest.loader !== undefined) {
    throw new PhoneRegistryError(`站点链接 ${manifest.id} 不应带 loader，它没有内置视图`);
  }
  if (!Number.isInteger(manifest.state_version) || manifest.state_version < 1) {
    throw new PhoneRegistryError(`应用 ${manifest.id} 的 state_version 必须是正整数`);
  }
}

export function createPhoneRegistry(
  manifests: readonly PhoneAppManifest[],
  options: PhoneRegistryOptions = {},
): PhoneRegistry {
  const enabled = options.enabledFeatureFlags;
  const byId = new Map<string, PhoneAppManifest>();

  for (const manifest of manifests) {
    assertManifest(manifest);
    if (byId.has(manifest.id)) {
      throw new PhoneRegistryError(`应用 id ${manifest.id} 重复登记`);
    }
    byId.set(manifest.id, manifest);
  }

  const isEnabled = (manifest: PhoneAppManifest): boolean =>
    manifest.feature_flag === null || enabled === undefined || enabled.has(manifest.feature_flag);

  const visible = (): PhoneAppManifest[] =>
    [...byId.values()]
      .filter(isEnabled)
      .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order));

  return {
    manifests: visible,
    find(appId) {
      const manifest = byId.get(appId);
      return manifest && isEnabled(manifest) ? manifest : undefined;
    },
    async load(appId) {
      const manifest = byId.get(appId);
      if (!manifest || !isEnabled(manifest)) {
        throw new PhoneRegistryError(`应用 ${appId} 未注册或未启用`);
      }
      if (manifest.kind !== "embedded" || !manifest.loader) {
        throw new PhoneRegistryError(`应用 ${appId} 没有内置视图，不能按内置方式加载`);
      }
      const loaded = await manifest.loader();
      if (typeof loaded?.default !== "function") {
        throw new PhoneRegistryError(`应用 ${appId} 的模块缺少默认视图组件`);
      }
      return loaded;
    },
  };
}

/** 正式注册表。宿主只依赖这个接口，新增应用不需要改宿主条件分支。 */
export const phoneRegistry: PhoneRegistry = createPhoneRegistry(PHONE_APPS);
