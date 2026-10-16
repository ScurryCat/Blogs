/**
 * 仅测试使用的最小 App 样例。
 *
 * 用途（T00 执行清单）：验证**只改注册表和自身模块**就能把应用接进手机，
 * 不需要修改播放器、宿主或加条件分支。它**不加入正式手机**（PHONE_APPS 里没有它）。
 */

import type { PhoneAppManifest, PhoneAppModule } from "../types";

export const TEST_APP_ID = "pl-test-app";

function TestAppView() {
  // 视图只是一个组件：不读 window、不碰全局 DOM、不自建音频。
  return null;
}

export const testAppManifest: PhoneAppManifest = {
  id: TEST_APP_ID,
  name: "测试应用",
  subtitle: "T00 骨架验证用，不进正式桌面",
  icon: "/assets/img/icon/joker.webp",
  order: 999,
  kind: "embedded",
  canonical_path: "/apps/pl-test-app",
  loader: async (): Promise<PhoneAppModule> => ({
    default: TestAppView,
    screens: ["home"],
  }),
  feature_flag: null,
  state_version: 1,
};
