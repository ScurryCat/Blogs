/**
 * 块级 Markdown 解析（旧站 `assets/js/md.js` 的 `render()` 迁移）。
 *
 * 支持范围与旧站一致：`##` / `###`、段落、`-` / `1.` 列表、围栏代码块、管道表格、
 * `---` 分隔线、独立图片（figure）、`> **名字**：台词`（对话框）与 `!!! 提示框`。
 *
 * 两处扩展语法（对话 / `!!!`）是本站内容里真实使用的写作语法，正文原文是权威数据：
 * 迁移只换渲染器，**不改写正文、不丢弃任何一行**。解析结果里每个块都保留了结构化节点，
 * 因此 `view.tsx` 能把它们渲染成 React 元素，而不是拼 HTML 字符串。
 */

import {
  inlineToText,
  parseInline,
  type InlineNode,
} from "./inline";

export interface TalkLine {
  who: string;
  me: boolean;
  face: string | null;
  children: InlineNode[];
}

export type BlockNode =
  | { kind: "heading"; level: 2 | 3; id: string; no: string | null; children: InlineNode[] }
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "table"; head: InlineNode[][]; body: InlineNode[][][] }
  | { kind: "hr" }
  | { kind: "figure"; src: string; alt: string; title: string | null }
  | { kind: "note"; children: InlineNode[] }
  | { kind: "talk"; lines: TalkLine[] }
  | { kind: "quote"; paragraphs: InlineNode[][] };

export interface TocEntry {
  id: string;
  lv: 2 | 3;
  text: string;
}

export interface MarkdownOptions {
  /** 说话人是否已登记（未登记的名字不是对话框）。 */
  isSpeaker: (name: string) => boolean;
  /** 说话人立绘。 */
  faceOf: (name: string) => string | null;
  /** 说话人里哪些算「我」（显示在右侧）。 */
  me: readonly string[];
}

export interface MarkdownResult {
  blocks: BlockNode[];
  toc: TocEntry[];
}

const FENCE = /^```\s*(\w*)/;
const HEADING = /^(#{2,3})\s+(.+)/;
const HR = /^-{3,}\s*$/;
const FIGURE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
const NOTE = /^!!!\s/;
const QUOTE = /^>\s?/;
const UL = /^[-*]\s/;
const OL = /^\d+\.\s/;
const TALK_LINE = /^(?:\*\*([^*]+)\*\*|([^：:]{1,8}))\s*[：:]\s*(.+)$/;
const BLOCK_START = /^(```|#{2,3}\s|>|\||!!!\s|[-*]\s|\d+\.\s|-{3,}\s*$)/;

function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const current = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return current.startsWith("|") && /^\|?\s*:?-{3,}/.test(next);
}

export function parseMarkdown(source: string, options: MarkdownOptions): MarkdownResult {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: BlockNode[] = [];
  const toc: TocEntry[] = [];
  let index = 0;
  let h2Count = 0;

  const takeWhile = (pattern: RegExp): string[] => {
    const taken: string[] = [];
    while (index < lines.length && pattern.test(lines[index] ?? "")) {
      taken.push(lines[index] ?? "");
      index += 1;
    }
    return taken;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", lang, code: body.join("\n") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = (heading[1] ?? "##").length === 2 ? 2 : 3;
      const text = heading[2] ?? "";
      const id = `s-${toc.length + 1}`;
      index += 1;
      const children = parseInline(text);
      toc.push({ id, lv: level, text: inlineToText(children) });
      if (level === 2) {
        h2Count += 1;
        blocks.push({
          kind: "heading",
          level,
          id,
          no: String(h2Count).padStart(2, "0"),
          children,
        });
      } else {
        blocks.push({ kind: "heading", level, id, no: null, children });
      }
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      index += 1;
      continue;
    }

    const figure = line.match(FIGURE);
    if (figure) {
      index += 1;
      blocks.push({
        kind: "figure",
        src: figure[2] ?? "",
        alt: figure[1] ?? "",
        title: figure[3] ?? null,
      });
      continue;
    }

    if (NOTE.test(line)) {
      const taken = takeWhile(NOTE);
      blocks.push({
        kind: "note",
        children: parseInline(taken.map((row) => row.replace(NOTE, "")).join(" ")),
      });
      continue;
    }

    if (QUOTE.test(line)) {
      const said = takeWhile(QUOTE).map((row) => row.replace(QUOTE, ""));
      const matches = said.map((row) => row.match(TALK_LINE));
      const everySpeaker =
        matches.length > 0 &&
        matches.every((match) => {
          if (!match) return false;
          const who = (match[1] ?? match[2] ?? "").trim();
          return options.isSpeaker(who);
        });
      if (everySpeaker) {
        blocks.push({
          kind: "talk",
          lines: matches.map((match) => {
            const who = ((match?.[1] ?? match?.[2]) ?? "").trim();
            return {
              who,
              me: options.me.includes(who),
              face: options.faceOf(who),
              children: parseInline(match?.[3] ?? ""),
            };
          }),
        });
      } else {
        blocks.push({ kind: "quote", paragraphs: said.map((row) => parseInline(row)) });
      }
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows = takeWhile(/^\|/);
      blocks.push({
        kind: "table",
        head: tableCells(rows[0] ?? "").map((cell) => parseInline(cell)),
        body: rows.slice(2).map((row) => tableCells(row).map((cell) => parseInline(cell))),
      });
      continue;
    }

    if (UL.test(line)) {
      blocks.push({
        kind: "list",
        ordered: false,
        items: takeWhile(UL).map((row) => parseInline(row.replace(UL, ""))),
      });
      continue;
    }

    if (OL.test(line)) {
      blocks.push({
        kind: "list",
        ordered: true,
        items: takeWhile(OL).map((row) => parseInline(row.replace(OL, ""))),
      });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !BLOCK_START.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    if (!paragraph.length) {
      // 落到这里说明某行匹配了块起始但没被上面的分支接住；按旧站行为当普通段落收掉，
      // 保证不丢正文、也不会死循环。
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return { blocks, toc };
}
