/**
 * 外链安全与纯文本渲染的兜底逻辑（验收第 2 条）。
 *
 * 这些用例是**纯函数**级别：直接喂 `javascript:` / `data:` 之类的字符串，
 * 断言界面不会把它们变成可点击的链接。
 */

import { describe, expect, it } from "vitest";

import { externalLinkAttributes, isSafeExternalUrl } from "./urls";

describe("可执行 scheme 一律不可用", () => {
  const unsafe = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.com/6f1e",
    "about:blank",
  ];

  for (const value of unsafe) {
    it(`${value.slice(0, 24)} 既不是安全地址，也拿不到锚点属性`, () => {
      expect(isSafeExternalUrl(value)).toBe(false);
      expect(externalLinkAttributes(value)).toBeNull();
    });
  }
});

describe("不完整 / 伪装成外链的写法", () => {
  const rejected = [
    "//evil.example.com/path",
    "example.com",
    "/relative/path",
    "http://user:password@example.com/",
    "https://admin@example.com/",
    "http://localhost:3000/",
    "http://intranet/",
    "http://exa\u0000mple.com/",
  ];

  for (const value of rejected) {
    it(`${JSON.stringify(value)} 不生成链接`, () => {
      expect(externalLinkAttributes(value)).toBeNull();
    });
  }
});

describe("安全地址的属性固定", () => {
  it("保留 href，并强制新窗口 + noopener noreferrer", () => {
    const attributes = externalLinkAttributes("https://example.com/blog?a=1#top");

    expect(attributes).not.toBeNull();
    expect(attributes?.href).toBe("https://example.com/blog?a=1#top");
    expect(attributes?.target).toBe("_blank");
    expect(attributes?.rel).toBe("noopener noreferrer");
  });

  it("接受 IP 字面量与端口", () => {
    expect(externalLinkAttributes("http://192.168.1.10:8080/blog")?.href).toBe(
      "http://192.168.1.10:8080/blog",
    );
  });

  it("空值与空白值返回 null（不抛异常）", () => {
    expect(externalLinkAttributes("")).toBeNull();
    expect(externalLinkAttributes("   ")).toBeNull();
  });
});
