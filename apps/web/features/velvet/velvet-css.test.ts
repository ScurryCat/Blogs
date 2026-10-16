/**
 * T09 两张样式表的隔离性（天鹅绒房间 + 印象空间）。
 *
 * 硬要求有两条，都是「看不出来但会伤到整站」的那一类：
 *
 *  1. **迁移样式表 `styles/legacy/*.css` 是旧站快照，不许往里加东西**
 *     （T02 交付单 §7）。T09 的样式必须待在自己的文件里。
 *  2. **全站红黑变量不变**（验收 5）：天鹅绒房间的冷色（`--v-*`）与印象空间的
 *     暗紫（`--m-*`）都定义在**自己的根类**里，`--red` / `--black` / `--paper`
 *     一个都不许被覆盖 —— 覆盖了就是「进一次技能页，整站换皮」。
 *
 * jsdom 不算样式，因此这类回归只能靠静态检查拦住（与 T08 的做法一致）。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 路径从**本文件所在目录**算起，而不是 `process.cwd()`。
 *
 * 真实踩到过：从仓库根跑 `npx vitest --root apps/web` 时 cwd 是仓库根，
 * `resolve(process.cwd(), "features/...")` 会指向一个不存在的文件，
 * 于是整个测试文件在收集阶段就 ENOENT 失败 —— 看起来像「样式文件没了」。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const VELVET = resolve(HERE, "velvet.css");
const EXPLORATION = resolve(HERE, "../exploration/exploration.css");
const LEGACY = resolve(HERE, "../../styles/legacy/base.css");

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 逐条取选择器（对顶层规则与 `@media` 内的嵌套规则都成立）。 */
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

function offendersIn(css: string, prefix: string): string[] {
  const offenders: string[] = [];
  let insideKeyframes = false;
  for (const raw of selectors(css)) {
    const selector = raw.trim();
    if (selector.length === 0) {
      insideKeyframes = false;
      continue;
    }
    if (selector.startsWith("@")) {
      insideKeyframes = selector.startsWith("@keyframes");
      continue;
    }
    if (insideKeyframes) continue;
    for (const part of selector.split(",")) {
      const candidate = part.trim();
      if (candidate.length === 0) continue;
      if (candidate.startsWith("@")) continue;
      if (!candidate.includes(prefix)) offenders.push(candidate);
    }
  }
  return offenders;
}

describe("velvet.css 的隔离性", () => {
  const css = readFileSync(VELVET, "utf8");

  it("每条规则都带 plv- 前缀", () => {
    expect(offendersIn(css, "plv-")).toEqual([]);
  });

  it("冷色变量定义在 .plv-room 作用域里，不写进 :root", () => {
    const clean = stripComments(css);
    // 变量定义（`--v-ice: …`）必须出现在 `.plv-room {` 块里，而不是 :root 或 html/body。
    const rootBlocks = clean.match(/:root\s*\{[^}]*\}/g) ?? [];
    expect(rootBlocks).toEqual([]);
    expect(clean).toMatch(/\.plv-room\s*\{[^}]*--v-ice/);
  });

  it("不覆盖全站红黑变量（验收 5）", () => {
    const clean = stripComments(css);
    expect(clean).not.toMatch(/--red\s*:/);
    expect(clean).not.toMatch(/--black\s*:/);
    expect(clean).not.toMatch(/--paper\s*:/);
    expect(clean).not.toMatch(/--ink\s*:/);
  });

  it("不定义全局元素级规则，也不 import 别的样式表", () => {
    const clean = stripComments(css);
    expect(clean).not.toMatch(/(^|\})\s*(html|body|img|button|a|p|ul|li|input|select|textarea)\s*\{/m);
    expect(clean).not.toContain("@import");
  });

  it("为减少动态效果准备了覆盖（过渡只写在 no-preference 里）", () => {
    expect(css).toContain("prefers-reduced-motion: no-preference");
  });

  it("为 420px 以下准备了紧凑布局", () => {
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain(".plv-gate");
  });

  it("迁移样式表没有被 T09 改动（旧站快照保持原样）", () => {
    // 只做一次存在性 + 关键内容检查：真正的「逐字节一致」由 T02 的 PROVENANCE 负责。
    expect(existsSync(LEGACY)).toBe(true);
    const legacy = readFileSync(LEGACY, "utf8");
    expect(legacy).toContain("--red: #e5191c");
    expect(legacy).not.toContain("plv-");
  });
});

describe("exploration.css 的隔离性", () => {
  const css = readFileSync(EXPLORATION, "utf8");

  it("每条规则都带 pme- 前缀", () => {
    expect(offendersIn(css, "pme-")).toEqual([]);
  });

  it("暗紫变量定义在 .pme-wrap 作用域里，不写进 :root", () => {
    const clean = stripComments(css);
    expect(clean.match(/:root\s*\{[^}]*\}/g) ?? []).toEqual([]);
    expect(clean).toMatch(/\.pme-wrap\s*\{[^}]*--m-plum/);
  });

  it("不覆盖全站红黑变量（验收 5）", () => {
    const clean = stripComments(css);
    for (const name of ["--red", "--black", "--paper", "--ink"]) {
      expect(clean).not.toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it("有一个例外明确的规则：文本框需要标签化的最小高度", () => {
    // `textarea.pme-input` 是元素 + 类组合，不是裸元素规则；这条断言把例外写清楚，
    // 免得以后有人把「允许」当成「随便写裸选择器」。
    expect(stripComments(css)).toContain("textarea.pme-input");
  });

  it("不定义全局元素级规则，也不 import 别的样式表", () => {
    const clean = stripComments(css);
    expect(clean).not.toMatch(/(^|\})\s*(html|body|img|button|a|p|ul|li|input|select)\s*\{/m);
    expect(clean).not.toContain("@import");
  });

  it("为减少动态效果准备了覆盖", () => {
    expect(css).toContain("prefers-reduced-motion: no-preference");
  });

  it("为 420px 以下准备了紧凑布局", () => {
    expect(css).toContain("@media (max-width: 420px)");
  });
});
