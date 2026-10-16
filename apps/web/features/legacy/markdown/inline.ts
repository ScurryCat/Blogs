/**
 * 行内 Markdown 解析（旧站 `assets/js/md.js` 的 `inline()` 迁移）。
 *
 * 与旧实现的两点**有意的差别**：
 *  1. 旧实现先做 HTML 转义、再在转义后的字符串上跑正则，最后把结果拼成 HTML 字符串
 *     交给 `innerHTML`。这里改成生成**行内节点树**，由 React 渲染成元素，
 *     文本始终是子节点 —— 旧 renderer 的字符串结果不再进入 `dangerouslySetInnerHTML`
 *     （01 §8 的硬性要求）。
 *  2. 危险协议的链接统一降级成 `#`（与旧站 `safe()` 一致），并且外链一定带
 *     `rel="noopener noreferrer"`。
 *
 * 支持的语法与旧站一致：`` `代码` ``、`![说明](图 "图注")`、`[文字](链接)`、`**粗**`、`*斜*`。
 */

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; external: boolean; children: InlineNode[] }
  | { kind: "image"; src: string; alt: string; title: string | null };

const DANGEROUS = /^\s*(?:javascript|data|vbscript):/i;

/** 危险协议降级为 `#`；其余原样。 */
export function safeUrl(url: string): string {
  return DANGEROUS.test(url) ? "#" : url;
}

export function isExternal(url: string): boolean {
  return /^https?:/i.test(url);
}

interface LinkTarget {
  url: string;
  title: string | null;
  /** `)` 之后的下标。 */
  end: number;
}

/** 从 `(` 开始读一个链接目标：`(url)`、`(url "标题")`、`(url '标题')`。 */
function readLinkTarget(source: string, openParen: number): LinkTarget | null {
  if (source[openParen] !== "(") return null;
  let i = openParen + 1;
  let url = "";
  while (i < source.length && !/[\s)]/.test(source[i] ?? "")) {
    url += source[i];
    i += 1;
  }
  if (!url) return null;
  let title: string | null = null;
  while (i < source.length && /\s/.test(source[i] ?? "")) i += 1;
  const quote = source[i];
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, i + 1);
    if (close === -1) return null;
    title = source.slice(i + 1, close);
    i = close + 1;
    while (i < source.length && /\s/.test(source[i] ?? "")) i += 1;
  }
  if (source[i] !== ")") return null;
  return { url, title, end: i + 1 };
}

/** 行内代码：`code`，内容不能为空、不能含反引号（与旧站一致）。 */
function readCode(source: string, start: number): { value: string; end: number } | null {
  const close = source.indexOf("`", start + 1);
  if (close === -1 || close === start + 1) return null;
  return { value: source.slice(start + 1, close), end: close + 1 };
}

function readEmphasis(
  source: string,
  start: number,
  marker: string,
): { value: string; end: number } | null {
  const close = source.indexOf(marker, start + marker.length);
  if (close === -1) return null;
  const value = source.slice(start + marker.length, close);
  if (!value) return null;
  // 旧正则要求强调内容里不出现 `*`，且首字符不是空白。
  if (value.includes("*") || /^\s/.test(value)) return null;
  return { value, end: close + marker.length };
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < source.length) {
    const char = source[i] ?? "";

    if (char === "`") {
      const code = readCode(source, i);
      if (code) {
        flush();
        nodes.push({ kind: "code", value: code.value });
        i = code.end;
        continue;
      }
    }

    if (char === "!" && source[i + 1] === "[") {
      const altEnd = source.indexOf("]", i + 2);
      if (altEnd !== -1 && source[altEnd + 1] === "(") {
        const target = readLinkTarget(source, altEnd + 1);
        if (target) {
          flush();
          nodes.push({
            kind: "image",
            src: safeUrl(target.url),
            alt: source.slice(i + 2, altEnd),
            title: target.title,
          });
          i = target.end;
          continue;
        }
      }
    }

    if (char === "[") {
      const labelEnd = source.indexOf("]", i + 1);
      if (labelEnd !== -1 && source[labelEnd + 1] === "(") {
        const target = readLinkTarget(source, labelEnd + 1);
        if (target) {
          flush();
          const href = safeUrl(target.url);
          nodes.push({
            kind: "link",
            href,
            external: isExternal(href),
            children: parseInline(source.slice(i + 1, labelEnd)),
          });
          i = target.end;
          continue;
        }
      }
    }

    if (char === "*" && source[i + 1] === "*") {
      const strong = readEmphasis(source, i, "**");
      if (strong) {
        flush();
        nodes.push({ kind: "strong", children: parseInline(strong.value) });
        i = strong.end;
        continue;
      }
    }

    if (char === "*" && source[i - 1] !== "*") {
      const em = readEmphasis(source, i, "*");
      if (em) {
        flush();
        nodes.push({ kind: "em", children: parseInline(em.value) });
        i = em.end;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes;
}

/** 行内节点树的纯文本（供目录、摘要与测试使用）。 */
export function inlineToText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.value;
        case "image":
          return node.alt;
        default:
          return inlineToText(node.children);
      }
    })
    .join("");
}
