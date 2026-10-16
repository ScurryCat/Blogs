/**
 * 本包样式表的隔离性（T08）。
 *
 * 硬要求（T02 交付单 §7）：迁移样式表 `styles/legacy/*.css` 是旧站快照，不许往里加东西；
 * 新样式必须待在**自己的作用域**里。这里把「自己的作用域」变成可执行断言：
 * 除了 `@media` / `@keyframes` 这类允许的顶层块，每一条选择器都必须以 `.msg-` 开头。
 *
 * 理由不是洁癖：一条裸的 `img { … }` 或 `button { … }` 会改掉**整站**的外观，
 * 而单测里看不出来（jsdom 不算样式）。这类回归只有靠静态检查拦住。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// vitest 的根目录就是 apps/web（见 vitest.config.mts），因此用 cwd 相对路径最稳。
const CSS_PATH = resolve(process.cwd(), "features/messaging/messaging.css");
const css = readFileSync(CSS_PATH, "utf8");

/** 去掉注释，避免把注释里的示例选择器当成真实规则。 */
function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 逐条取选择器。
 *
 * 只按 `}` 切块再取 `{` 之前的部分 —— 对顶层规则与 `@media` 内的嵌套规则都成立
 * （`@media (...) { .a { ... } }` 切出来的第一段是 `@media (...) `，第二段是 `.a `）。
 */
function selectors(input: string): string[] {
  const clean = stripComments(input);
  const found: string[] = [];
  for (const chunk of clean.split("}")) {
    const head = chunk.split("{")[0];
    if (!head) continue;
    found.push(head.trim());
  }
  return found;
}

describe("messaging.css 的隔离性", () => {
  it("每条规则都限定在 .msg- 命名空间下", () => {
    const offenders: string[] = [];
    let insideKeyframes = false;
    for (const raw of selectors(css)) {
      const selector = raw.trim();
      if (selector.length === 0) {
        insideKeyframes = false;
        continue;
      }
      if (selector.startsWith("@")) {
        // at-rule：@media 内部的选择器会在下一轮继续被检查；
        // @keyframes 的帧（`0%` / `from`）没有选择器语义，跳过。
        insideKeyframes = selector.startsWith("@keyframes");
        continue;
      }
      if (insideKeyframes) continue;
      for (const part of selector.split(",")) {
        const candidate = part.trim();
        if (candidate.length === 0) continue;
        // at-rule 的“尾巴”（例如 `@media (…)` 之后的残留）不参与判断。
        if (candidate.startsWith("@")) continue;
        if (!candidate.startsWith(".msg-")) offenders.push(candidate);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("不定义全局元素级规则（img / button / body 之类）", () => {
    const clean = stripComments(css);
    expect(clean).not.toMatch(/(^|\})\s*(html|body|img|button|a|p|ul|li|textarea|input)\s*\{/m);
  });

  it("不 import 任何其他样式表（避免把全站样式拖进来）", () => {
    expect(stripComments(css)).not.toContain("@import");
  });

  it("定义了减少动态效果的覆盖", () => {
    expect(css).toContain("prefers-reduced-motion");
  });

  it("为 480px 以下准备了单列布局", () => {
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain(".msg-thread-bar");
    expect(css).toContain(".msg-list");
  });
});
