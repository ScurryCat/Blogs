/**
 * 手机宿主 ins 段（app/globals.css）的静态回归（R3）。
 *
 * 独立验收发现的问题不是「样式不好看」，而是**用样式隐藏了功能**：
 * 手机 ins 段曾把 `.msg-composer`、`.msg-usage`、`.msg-choices-hint`、`.pw-expand`
 * 全部 `display: none`，于是手机里没有自由聊天入口、也没有展开查看。
 *
 * jsdom 不算样式，所以这类回退只能靠静态断言拦住：
 *  - 四个功能选择器不得再出现在任何 `display: none` 的规则里；
 *  - 输入条 / 用量 / 选择提示 / 展开按钮必须有显式的可见规则；
 *  - 会话视图的消息列表必须占满剩余高度，底部控件不得用 absolute/fixed 覆盖输入区；
 *  - 新增规则仍限定在 `.pw-appview[data-phone-app="ins"]` 命名空间内（不污染其他应用/页面）；
 *  - 软键盘与安全区的兜底 CSS 存在（真机行为另行如实标注未验证）。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// vitest 的根目录就是 apps/web（见 vitest.config.mts）。
const GLOBALS_PATH = resolve(process.cwd(), "app/globals.css");
const css = readFileSync(GLOBALS_PATH, "utf8");

/** 去掉注释，避免把注释里的 `display: none` 示例当成真实规则。 */
function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 手机 ins 段：从「IM 聊天界面复刻（2026-10-19）」注释块开始到文件末尾。
 * 这一段之后没有其他组件样式；即使以后追加，也仍然属于手机 ins 的作用域，
 * 所以「到文件末尾」是安全的（若将来拆段，这个测试会因 marker 变化而显式失败）。
 */
const SECTION_MARKER = "IM 聊天界面复刻（2026-10-19）";
const markerIndex = css.indexOf(SECTION_MARKER);
if (markerIndex === -1) {
  throw new Error(`app/globals.css 里找不到手机 ins 段标记：${SECTION_MARKER}`);
}
const commentStart = css.lastIndexOf("/*", markerIndex);
const section = stripComments(css.slice(commentStart === -1 ? markerIndex : commentStart));

interface CssRule {
  selector: string;
  body: string;
}

/** 抓出段内所有「最内层」规则（@media 包裹的规则也会被单独抓到）。 */
function cssRules(input: string): CssRule[] {
  const found: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const selector = (match[1] ?? "").trim();
    const body = match[2] ?? "";
    if (!selector || selector.startsWith("@")) continue;
    found.push({ selector, body });
  }
  return found;
}

const rules = cssRules(section);
const selectorsOf = (rule: CssRule): string[] =>
  rule.selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** 选择器里是否真的提到了某个类（避免 `.msg-composer` 误命中 `.msg-composer-note`）。 */
function mentions(selector: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s>,])${escaped}(?![\\w-])`).test(selector);
}

function rulesMentioning(className: string): CssRule[] {
  return rules.filter((rule) => selectorsOf(rule).some((selector) => mentions(selector, className)));
}

/** 手机端必须可见可操作的功能选择器。 */
const MUST_BE_VISIBLE = [
  ".msg-composer",
  ".msg-usage",
  ".msg-choices-hint",
  ".msg-btn-say",
  ".pw-expand",
] as const;

/** 允许在手机 ins 里隐藏的，只有「参考帧里没有的补充说明」，不是功能。 */
const ALLOWED_HIDDEN_SELECTORS = new Set([
  '.pw-appview[data-phone-app="ins"] .pw-appbar .pw-appname',
  '.pw-appview[data-phone-app="ins"] .msg-thread-id',
  '.pw-appview[data-phone-app="ins"] .msg-sender',
  '.pw-appview[data-phone-app="ins"] .msg-role-intro',
  '.pw-appview[data-phone-app="ins"] .msg-role-tagline',
  '.pw-appview[data-phone-app="ins"] .msg-role-meta',
  '.pw-appview[data-phone-app="ins"] .msg-list-head-note',
]);

const sectionSelectors = rules.flatMap(selectorsOf);

describe("手机 ins 段：自由聊天入口不得再被样式隐藏（R3）", () => {
  it("composer / 用量 / 选择提示 / 展开查看都不在 display:none 的规则里", () => {
    const hiding = rules.filter(
      (rule) =>
        /display\s*:\s*none/.test(rule.body) &&
        selectorsOf(rule).some((selector) =>
          MUST_BE_VISIBLE.some((className) => mentions(selector, className)),
        ),
    );
    expect(hiding).toEqual([]);
  });

  it("手机 ins 段只允许隐藏参考帧外的补充说明（功能控件一律不在隐藏白名单外）", () => {
    const hiddenSelectors = rules
      .filter((rule) => /display\s*:\s*none/.test(rule.body))
      .flatMap(selectorsOf);
    const unexpected = hiddenSelectors.filter((selector) => !ALLOWED_HIDDEN_SELECTORS.has(selector));
    expect(unexpected).toEqual([]);
  });

  it("折叠输入条、发送按钮、用量、选择提示都有显式可见规则", () => {
    const composerRules = rulesMentioning(".msg-composer");
    expect(composerRules.some((rule) => /display\s*:\s*flex/.test(rule.body))).toBe(true);
    expect(
      composerRules.some((rule) => /border-top\s*:\s*2px solid var\(--msg-ink\)/.test(rule.body)),
    ).toBe(true);

    const usageRule = rulesMentioning(".msg-usage").find((rule) =>
      /display\s*:\s*block/.test(rule.body),
    );
    expect(usageRule).toBeTruthy();

    const hintRule = rulesMentioning(".msg-choices-hint").find((rule) =>
      /display\s*:\s*block/.test(rule.body),
    );
    expect(hintRule).toBeTruthy();

    const sayRule = rulesMentioning(".msg-btn-say").find((rule) =>
      /min-height\s*:\s*44px/.test(rule.body),
    );
    expect(sayRule).toBeTruthy();
  });

  it("「展开查看」是 44×44 可点按钮，且点击区不被父级 pointer-events:none 吃掉", () => {
    const expandRules = rulesMentioning(".pw-expand");
    const expandRule = expandRules.find((rule) => /position\s*:\s*absolute/.test(rule.body));
    expect(expandRule).toBeTruthy();
    const body = expandRule?.body ?? "";
    expect(body).toMatch(/pointer-events\s*:\s*auto/);
    expect(body).toMatch(/min-height\s*:\s*44px/);
    expect(body).toMatch(/min-width\s*:\s*44px/);
    expect(body).toMatch(/display\s*:\s*inline-flex/);
  });
});

describe("手机 ins 段：会话布局不与底部控件互相遮挡（R3）", () => {
  it("会话视图撑满屏幕，消息列表占满剩余高度并自己滚动", () => {
    const appRule = rules.find(
      (rule) =>
        mentions(rule.selector, ".msg-app-conversation") &&
        /flex-direction\s*:\s*column/.test(rule.body),
    );
    expect(appRule).toBeTruthy();
    expect(appRule?.body).toMatch(/height\s*:\s*100%/);
    expect(appRule?.body).toMatch(/min-height\s*:\s*0/);
    expect(appRule?.body).toMatch(/overflow\s*:\s*hidden/);

    const listRule = rules.find(
      (rule) =>
        selectorsOf(rule).some(
          (selector) => mentions(selector, ".msg-list") && /\.msg-app-conversation/.test(selector),
        ) && /flex\s*:\s*1 1 auto/.test(rule.body),
    );
    expect(listRule).toBeTruthy();
    expect(listRule?.body).toMatch(/max-height\s*:\s*none/);
    expect(listRule?.body).toMatch(/min-height\s*:\s*0/);
    expect(listRule?.body).toMatch(/overflow-y\s*:\s*auto/);
  });

  it("底部输入/用量/提示/选择区不脱离文档流，不会盖住输入区", () => {
    for (const className of [".msg-composer", ".msg-usage", ".msg-op-hints", ".msg-choices"]) {
      for (const rule of rulesMentioning(className)) {
        expect(rule.body).not.toMatch(/position\s*:\s*(fixed|absolute)/);
      }
    }
    // 输入区、用量提示固定在底部，不参与拉伸（列表才是唯一生长项）。
    const fixedBars = rules.find((rule) => {
      const selector = rule.selector;
      return (
        /\.msg-app-conversation/.test(selector) &&
        mentions(selector, ".msg-composer") &&
        /flex\s*:\s*0 0 auto/.test(rule.body)
      );
    });
    expect(fixedBars).toBeTruthy();
  });

  it("为软键盘与安全区留了兜底（env(safe-area-inset-bottom) / scroll-margin）", () => {
    expect(section).toContain("env(safe-area-inset-bottom)");
    expect(section).toMatch(/padding-bottom\s*:\s*calc\([^)]*env\(safe-area-inset-bottom\)/);
    expect(section).toMatch(/scroll-margin-bottom\s*:\s*calc\([^)]*env\(safe-area-inset-bottom\)/);
  });

  it("手机内恢复自由聊天不靠回退 IM 视觉：消息/头像/选项/wordmark 都不在隐藏规则里", () => {
    for (const className of [".msg-bubble", ".msg-avatar", ".msg-choice", ".msg-logo"]) {
      const hiding = rules.filter(
        (rule) =>
          /display\s*:\s*none/.test(rule.body) &&
          selectorsOf(rule).some((selector) => mentions(selector, className)),
      );
      expect(hiding).toEqual([]);
    }
  });
});

describe("手机 ins 段的命名空间（不回退成全局样式）", () => {
  it("段内每条选择器都以 .pw-appview[data-phone-app=\"ins\"] 开头", () => {
    const offenders = sectionSelectors.filter(
      (selector) => !selector.startsWith('.pw-appview[data-phone-app="ins"]'),
    );
    expect(offenders).toEqual([]);
  });

  it("没有裸元素/全局选择器混进来", () => {
    expect(section).not.toMatch(/(^|\})\s*(html|body|button|a|p|div|textarea|input)\s*\{/m);
  });
});
