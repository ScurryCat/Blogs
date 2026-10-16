/**
 * 版本化本机状态与手机状态服务（02 §4 / §7）。
 *
 * 关键点：按应用 + `state_version` 分区；存储不可用时**如实返回 `persisted: false`**，
 * 不静默假装保存成功。
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createPhoneStateService } from "@/features/phone/phone-state-service";
import { LocalStateService, createMemoryStorage } from "@/features/runtime/storage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("LocalStateService", () => {
  it("键带命名空间与版本号，读写往返一致", () => {
    const service = new LocalStateService(3);
    expect(service.get("ins", "favorites", [] as string[])).toEqual([]);
    const result = service.set("ins", "favorites", ["a", "b"]);
    expect(result.persisted).toBe(true);
    expect(service.get("ins", "favorites", [] as string[])).toEqual(["a", "b"]);
    expect(window.localStorage.getItem("pl-app:ins:v3:favorites")).toBe(JSON.stringify(["a", "b"]));
  });

  it("不同版本与不同应用互不可见", () => {
    const v1 = new LocalStateService(1);
    const v2 = new LocalStateService(2);
    v1.set("ins", "scroll", 10);
    expect(v2.get("ins", "scroll", 0)).toBe(0);
    expect(v1.get("other", "scroll", 0)).toBe(0);
  });

  it("坏 JSON 回退默认值，不抛异常", () => {
    window.localStorage.setItem("pl-app:site:v1:theme", "{not json");
    const service = new LocalStateService(1);
    expect(service.get("site", "theme", "dark")).toBe("dark");
  });

  it("旧位置 pl-site:<key> 会被迁移一次", () => {
    window.localStorage.setItem("pl-site:theme", JSON.stringify("light"));
    const service = new LocalStateService(1);
    expect(service.get("site", "theme", "dark")).toBe("light");
    expect(window.localStorage.getItem("pl-app:site:v1:theme")).toBe(JSON.stringify("light"));
  });

  it("clear 只清自己的命名空间", () => {
    const service = new LocalStateService(1);
    service.set("ins", "a", 1);
    service.set("other", "a", 1);
    service.clear("ins");
    expect(service.get("ins", "a", null)).toBeNull();
    expect(service.get("other", "a", null)).toBe(1);
  });

  it("存储写入抛异常时返回 persisted: false，内存仍然可用", () => {
    const service = new LocalStateService(1);
    const storage = createMemoryStorage();
    const throwing = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    // 直接验证「不可用时」的语义：把 window.localStorage 换成会抛的实现。
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: throwing,
    });
    try {
      const scoped = new LocalStateService(1);
      const result = scoped.set("ins", "favorites", ["x"]);
      expect(result.persisted).toBe(false);
      // 内存兜底：同一次会话里还能读回来。
      expect(scoped.get("ins", "favorites", [] as string[])).toEqual(["x"]);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("手机状态服务", () => {
  it("按应用的 state_version 分区", () => {
    const service = createPhoneStateService({ versionOf: (appId) => (appId === "ins" ? 2 : 1) });
    service.set("ins", "scroll", 120);
    service.set("nav", "scroll", 9);
    expect(window.localStorage.getItem("pl-app:ins:v2:scroll")).toBe("120");
    expect(window.localStorage.getItem("pl-app:nav:v1:scroll")).toBe("9");
    expect(service.get("ins", "scroll", 0)).toBe(120);
    expect(service.get("nav", "scroll", 0)).toBe(9);
  });

  it("未注册的应用用版本 1，不抛异常", () => {
    const service = createPhoneStateService({ versionOf: () => 1 });
    expect(service.get("ghost", "k", "fallback")).toBe("fallback");
  });
});
