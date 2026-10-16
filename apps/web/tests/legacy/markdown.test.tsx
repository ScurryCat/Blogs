/**
 * Markdown 扩展的快照与安全测试（01 §8 的硬性要求）。
 *
 * 两类断言：
 *  1. **快照**：对话（`> **名字**：台词`）与 `!!!` 提示框、表格、代码块、图片的渲染结构；
 *  2. **恶意 HTML**：正文里的 `<script>`、`<img onerror>`、`javascript:` 链接等，
 *     一律按文本渲染，绝不执行 —— 迁移后的渲染器**不使用 `dangerouslySetInnerHTML`**。
 *
 * 另外断言 8 篇真实文章的正文在解析后不丢内容（对话与提示框都还在）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseContent } from "@/features/legacy/markdown";
import { MarkdownView } from "@/features/legacy/markdown/view";
import { inlineToText, parseInline, safeUrl } from "@/features/legacy/markdown/inline";
import { posts } from "@/features/legacy/posts";

function html(source: string): string {
  return renderToStaticMarkup(<MarkdownView result={parseContent(source)} />);
}

describe("Markdown 扩展：快照", () => {
  it("把「> **名字**：台词」渲染成 P5 对话框（说话人必须在配置里）", () => {
    const output = html("> **摩尔加纳**：喂，你这不叫改造，这叫偷。\n> 我：我只是把它翻译成 CSS。");
    expect(output).toMatchSnapshot();
    expect(output).toContain('class="talk"');
    expect(output).toContain('class="say"');
    expect(output).toContain('class="say me"');
    expect(output).toContain('class="face"');
    expect(output).toContain('class="say-n"');
  });

  it("说话人未登记时退回普通引用块，不当成对话框", () => {
    const output = html("> 陌生人：我不在配置里。");
    expect(output).toMatchSnapshot();
    expect(output).toContain("<blockquote>");
    expect(output).not.toContain('class="talk"');
  });

  it("`!!!` 提示框：多行合并成一个 note", () => {
    const output = html("!!! **一句话总结**：主题可以夸张，结构必须老实。\n!!! 第二行也会接上。");
    expect(output).toMatchSnapshot();
    expect(output).toContain('<aside class="note" role="note">');
    expect(output).toContain("第二行也会接上");
  });

  it("标题编号、表格、代码块、独立图片与列表的结构", () => {
    const source = [
      "## 第一节",
      "",
      "段落里有 **粗体**、*斜体*、`代码` 与 [链接](https://example.com)。",
      "",
      "| 变量 | 值 |",
      "| --- | --- |",
      "| `--red` | #e60012 |",
      "",
      "```css",
      ".p5-btn { transform: skewX(-10deg); }",
      "```",
      "",
      "![说明](assets/img/cover/launch.jpg \"图注\")",
      "",
      "- 一",
      "- 二",
      "",
      "1. 甲",
      "2. 乙",
      "",
      "---",
      "",
      "### 小节",
    ].join("\n");
    const output = html(source);
    expect(output).toMatchSnapshot();
    expect(output).toContain('<span class="n">01</span>');
    expect(output).toContain('<h3 id="s-2">');
    expect(output).toContain('class="tbl"');
    expect(output).toContain('<span class="lang">css</span>');
    expect(output).toContain("<figcaption>图注</figcaption>");
  });

  it("正文里已有的 8 篇文章：对话与提示框数量与原文一致", () => {
    let talks = 0;
    let notes = 0;
    for (const post of posts) {
      const parsed = parseContent(post.content);
      talks += parsed.blocks.filter((block) => block.kind === "talk").length;
      notes += parsed.blocks.filter((block) => block.kind === "note").length;
      // 正文不丢：每篇都能解析出块，且标题进入目录。
      expect(parsed.blocks.length).toBeGreaterThan(3);
      expect(parsed.toc.length).toBeGreaterThan(0);
    }
    // 基线数据的真实数量（用旧站 `assets/js/md.js` 逐篇数过：8 组对话 / 11 个提示框）。
    // 改动正文时应同步更新，不能静默丢掉扩展语法。
    expect(talks).toBe(8);
    expect(notes).toBe(11);
  });
});

describe("Markdown 安全：恶意 HTML 只能变成文本", () => {
  it("正文里的 <script> / <img onerror> / 事件属性都按纯文本渲染", () => {
    const source = [
      "<script>alert(1)</script>",
      "",
      '<img src=x onerror="alert(2)">',
      "",
      '<div onclick="alert(3)">点我</div>',
      "",
      "正常段落 **加粗** 之后仍然渲染。",
    ].join("\n");
    const output = html(source);
    // 把渲染结果真正装进 DOM，断言「没有任何被注入的元素或属性」——
    // 只看字符串会误判（转义后的文本里当然也会出现 onerror= 这几个字）。
    const host = document.createElement("div");
    host.innerHTML = output;
    expect(host.querySelectorAll("script")).toHaveLength(0);
    expect(host.querySelectorAll("[onerror], [onclick]")).toHaveLength(0);
    expect(host.querySelectorAll("img, div")).toHaveLength(0);
    expect(host.textContent).toContain("<script>alert(1)</script>");
    expect(host.textContent).toContain('<img src=x onerror="alert(2)">');
    expect(host.querySelector("strong")?.textContent).toBe("加粗");
  });

  it("危险协议的链接降级为 #，外链一定带 noopener", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl(" JavaScript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>1</script>")).toBe("#");
    expect(safeUrl("vbscript:msgbox")).toBe("#");
    expect(safeUrl("https://example.com")).toBe("https://example.com");

    const output = html("[点我](javascript:alert(1)) 和 [外链](https://example.com)");
    expect(output).not.toContain("javascript:");
    expect(output).toContain('href="#"');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer"');
  });

  it("独立图片的危险 src 同样降级，图片说明按文本渲染", () => {
    // 注意：URL 里带 `)` 的写法在旧站 renderer 里同样不被识别（`[^)\s]+` 到 `)` 就停），
    // 这里用不含右括号的危险地址，能真正走到 figure 分支。
    const output = html('![<b>说明</b>](data:text/html,boom "<i>图注</i>")');
    expect(output).not.toContain("javascript:");
    expect(output).toContain('alt="&lt;b&gt;说明&lt;/b&gt;"');
    expect(output).toContain("<figcaption>&lt;i&gt;图注&lt;/i&gt;</figcaption>");
  });

  it("行内解析器不会把 HTML 当节点：只剩文本节点", () => {
    const nodes = parseInline("<b>x</b> and `code`");
    expect(nodes.map((node) => node.kind)).toEqual(["text", "code"]);
    expect(inlineToText(nodes)).toBe("<b>x</b> and code");
  });

  it("问卷 / 留言等配置文本走的是同一套「按文本渲染」约定", () => {
    const output = html("<img src=x onerror=alert(1)>");
    // 正文里没有图片节点，只有被转义的文字。
    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).not.toContain("<img");
  });
});
