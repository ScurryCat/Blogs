import { afterEach, describe, expect, it, vi } from "vitest";

import { newUuid } from "./ids";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newUuid", () => {
  it("优先使用 crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
      getRandomValues: () => {
        throw new Error("不应走到 getRandomValues");
      },
    });
    expect(newUuid()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("非安全上下文没有 randomUUID 时回落到合法 UUID v4", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 11) % 256;
        return bytes;
      },
    });
    const value = newUuid();
    expect(value).toMatch(UUID_V4);
    // 不能是 `commit-...` / `ck-...` 这类会被服务端 422 拒绝的字符串。
    expect(value).not.toMatch(/^(commit|ck)-/);
  });

  it("完全没有 crypto 时也不抛错，仍返回 UUID v4", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newUuid()).toMatch(UUID_V4);
  });
});
