/**
 * 手机内置模块的形状（T09）。
 *
 * 宿主契约（`features/phone/types.ts`、SHARED-CONTRACTS §4）：
 * `default` 是组件、`screens` 是允许的屏幕、`dispose` 可选。
 * 这里把「交给 T00 登记的模块长什么样」变成可执行断言 ——
 * 少一个导出，宿主在运行时才会报错。
 */

import { describe, expect, it } from "vitest";

import * as explorationApp from "@/features/exploration/phone-app";
import { EXPLORATION_MANIFEST } from "@/features/exploration/phone-manifest";
import * as velvetApp from "@/features/velvet/phone-app";
import { VELVET_MANIFEST } from "@/features/velvet/phone-manifest";

describe("velvet 手机模块", () => {
  it("导出 default 组件与 screens 枚举", () => {
    expect(typeof velvetApp.default).toBe("function");
    expect([...velvetApp.screens]).toEqual(["book", "skill"]);
    expect(typeof velvetApp.dispose).toBe("function");
  });

  it("manifest 是 10 字段，且 id / canonical_path / loader 一致", () => {
    expect(Object.keys(VELVET_MANIFEST).sort()).toEqual(
      [
        "canonical_path",
        "feature_flag",
        "icon",
        "id",
        "kind",
        "loader",
        "name",
        "order",
        "state_version",
        "subtitle",
      ].sort(),
    );
    expect(VELVET_MANIFEST.id).toBe("velvet");
    expect(VELVET_MANIFEST.canonical_path).toBe("/velvet");
    expect(VELVET_MANIFEST.kind).toBe("embedded");
    expect(typeof VELVET_MANIFEST.loader).toBe("function");
    // 图标必须是仓库里真实存在的迁移图标（不新增素材）。
    expect(VELVET_MANIFEST.icon.startsWith("/assets/legacy/img/icon/")).toBe(true);
  });

  it("id 与 slug 规则一致（小写稳定标识）", () => {
    expect(/^[a-z][a-z0-9-]{1,31}$/.test(VELVET_MANIFEST.id)).toBe(true);
  });
});

describe("exploration 手机模块", () => {
  it("导出 default 组件与 screens 枚举", () => {
    expect(typeof explorationApp.default).toBe("function");
    expect([...explorationApp.screens]).toEqual(["records", "record"]);
    expect(typeof explorationApp.dispose).toBe("function");
  });

  it("manifest 指向问题记录的 canonical 地址", () => {
    expect(EXPLORATION_MANIFEST.id).toBe("mementos");
    expect(EXPLORATION_MANIFEST.canonical_path).toBe("/apps/metanav/mementos");
    expect(EXPLORATION_MANIFEST.kind).toBe("embedded");
    expect(EXPLORATION_MANIFEST.icon.startsWith("/assets/legacy/img/icon/")).toBe(true);
  });

  it("两个应用的 id / 图标 / 顺序不冲突（登记时可叠加）", () => {
    expect(VELVET_MANIFEST.id).not.toBe(EXPLORATION_MANIFEST.id);
    // 图标不重复：桌面上两个应用同图标会让读者分不清。
    expect(VELVET_MANIFEST.icon).not.toBe(EXPLORATION_MANIFEST.icon);
    // 顺序不重复（注册表按 order 升序，同值会退化成按 id 排序）。
    expect(VELVET_MANIFEST.order).not.toBe(EXPLORATION_MANIFEST.order);
  });
});
