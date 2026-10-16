/**
 * Markdown 入口：把站点配置（说话人立绘表）接到解析器上。
 *
 * 正文原文是权威数据；渲染器换代不改内容，也不把旧 renderer 的 HTML 字符串
 * 交给 `dangerouslySetInnerHTML`（01 §8）。
 */

import { isSpeaker, site, speakerFace } from "../config";
import { parseMarkdown, type MarkdownResult } from "./blocks";

export function parseContent(source: string): MarkdownResult {
  return parseMarkdown(source, {
    isSpeaker,
    faceOf: speakerFace,
    me: site.me,
  });
}

export { MarkdownView } from "./view";
export { inlineToText, parseInline, safeUrl } from "./inline";
export type { BlockNode, MarkdownResult, TocEntry, TalkLine } from "./blocks";
export type { InlineNode } from "./inline";
