/**
 * 注册表行为测试。
 *
 * 关键断言：测试 App **只通过公开类型**接入（注册表 + 宿主服务），
 * 宿主侧不需要任何针对具体应用的判断分支。
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { APP_ICONS } from "./app-icons";
import { PHONE_APPS, PhoneRegistryError, createPhoneRegistry } from "./registry";
import type { PhoneAppManifest, PhoneAppModule, PhoneHost } from "./types";
import { TEST_APP_ID, testAppManifest } from "./__fixtures__/test-app";

function embeddedApp(overrides: Partial<PhoneAppManifest> = {}): PhoneAppManifest {
  return {
    id: "demo-app",
    name: "示例",
    subtitle: "示例",
    icon: "/assets/img/icon/joker.webp",
    order: 10,
    kind: "embedded",
    canonical_path: "/apps/demo-app",
    loader: async (): Promise<PhoneAppModule> => ({ default: () => null, screens: ["feed"] }),
    feature_flag: null,
    state_version: 1,
    ...overrides,
  };
}

describe("手机应用注册表", () => {
  it("正式桌面只含已登记的真实应用：没有测试应用，也没有未接入能力的占位", () => {
    const registry = createPhoneRegistry(PHONE_APPS);

    // 未接入的能力不显示坏按钮：测试应用不会出现在正式桌面。
    expect(registry.find(TEST_APP_ID)).toBeUndefined();

    // 断言具体清单：新增/移除登记时集成负责人会被强制确认一次，而不是静默改变桌面。
    expect(registry.manifests().map((manifest) => manifest.id)).toEqual(
      ["ins", "journal", "leisure", "coop", "metanav", "showcase", "velvet", "mementos"],
    );
  });

  it("每个登记应用的图标都指向仓库里真实存在的资源", () => {
    // 占位路径或指向不存在文件的图标会让桌面出现裂图 —— 类型层看不出这类错误，
    // 所以在测试里查文件系统（icon 是 public/ 下的站内绝对路径）。
    for (const manifest of createPhoneRegistry(PHONE_APPS).manifests()) {
      const file = path.join(process.cwd(), "public", manifest.icon.replace(/^\//, ""));
      expect(existsSync(file), `${manifest.id} 的图标不存在：${manifest.icon}`).toBe(true);
    }
  });

  it("每个登记应用都有自绘图标；AI 位图不再作为桌面默认回退", () => {
    // 完整验收 §6.1：AI 位图不再作为默认图标来源。桌面顺序是
    // 已审核原版图标（2 个）→ 自绘 SVG（明确标 adapted）→ 旧字形/文字首字。
    for (const manifest of createPhoneRegistry(PHONE_APPS).manifests()) {
      expect(
        Boolean(APP_ICONS[manifest.id]),
        `${manifest.id} 没有自绘 SVG 条目（AI 位图回退已移除）`,
      ).toBe(true);
    }
  });

  it("加入测试应用只需要注册表，不需要改宿主", async () => {
    const registry = createPhoneRegistry([...PHONE_APPS, testAppManifest]);
    expect(registry.find(TEST_APP_ID)?.name).toBe("测试应用");

    const loaded = await registry.load(TEST_APP_ID);
    expect(typeof loaded.default).toBe("function");
    expect(loaded.screens).toContain("home");
  });

  it("宿主用公开类型就能驱动应用，无需任何按应用分支", async () => {
    const registry = createPhoneRegistry([...PHONE_APPS, testAppManifest]);
    const opened: string[] = [];

    // 这是一个「按契约实现」的宿主替身：它只认识注册表接口，不认识任何具体应用。
    const host: Pick<PhoneHost, "openApp"> = {
      openApp: (appId) => {
        const manifest = registry.find(appId);
        if (!manifest) return; // 未注册 → 不做任何事，不执行任意路径
        opened.push(manifest.id);
      },
    };

    host.openApp(TEST_APP_ID);
    host.openApp("not-registered");

    expect(opened).toEqual([TEST_APP_ID]);
  });

  it("按 order 升序排列，同 order 按 id 稳定排序", () => {
    const registry = createPhoneRegistry([
      embeddedApp({ id: "zebra", order: 5 }),
      embeddedApp({ id: "alpha", order: 5 }),
      embeddedApp({ id: "first", order: 1 }),
    ]);
    expect(registry.manifests().map((app) => app.id)).toEqual(["first", "alpha", "zebra"]);
  });

  it("被禁用的 feature flag 不出现，但禁用不等于鉴权", () => {
    const registry = createPhoneRegistry([embeddedApp({ feature_flag: "ins" })], {
      enabledFeatureFlags: new Set<string>(),
    });
    expect(registry.manifests()).toEqual([]);
    expect(registry.find("demo-app")).toBeUndefined();
  });

  it("重复 id 直接报错，不静默覆盖", () => {
    expect(() => createPhoneRegistry([embeddedApp(), embeddedApp()])).toThrow(PhoneRegistryError);
  });

  it("内置应用必须带 loader，站点链接不得带 loader", () => {
    expect(() => createPhoneRegistry([embeddedApp({ loader: undefined })])).toThrow(
      PhoneRegistryError,
    );
    expect(() =>
      createPhoneRegistry([
        embeddedApp({
          kind: "site-link",
          loader: async () => ({ default: () => null, screens: [] }),
        }),
      ]),
    ).toThrow(PhoneRegistryError);
  });

  it("canonical_path 必须是站内绝对路径，外部地址被拒绝", () => {
    expect(() => createPhoneRegistry([embeddedApp({ canonical_path: "https://example.com" })])).toThrow(
      PhoneRegistryError,
    );
  });

  it("id 不允许随展示名变化的中文或大写标识", () => {
    expect(() => createPhoneRegistry([embeddedApp({ id: "测试应用" })])).toThrow(PhoneRegistryError);
    expect(() => createPhoneRegistry([embeddedApp({ id: "DemoApp" })])).toThrow(PhoneRegistryError);
  });

  it("state_version 必须是正整数", () => {
    expect(() => createPhoneRegistry([embeddedApp({ state_version: 0 })])).toThrow(PhoneRegistryError);
  });

  it("加载站点链接或未注册应用都会被拒绝", async () => {
    const registry = createPhoneRegistry([
      embeddedApp({ id: "link-app", kind: "site-link", loader: undefined }),
    ]);
    await expect(registry.load("link-app")).rejects.toThrow(PhoneRegistryError);
    await expect(registry.load("ghost")).rejects.toThrow(PhoneRegistryError);
  });

  it("浏览器环境已就绪：单元测试可以直接使用 DOM", () => {
    const node = document.createElement("div");
    node.textContent = "ok";
    document.body.append(node);
    expect(document.body.textContent).toContain("ok");
  });
});
