/* eslint-disable @next/next/no-img-element -- 正文插图沿用旧站 Markdown 的 <img> 语义（含 title、loading=lazy）。 */
/**
 * Markdown 渲染：节点树 → React 元素。
 *
 * **不使用 `dangerouslySetInnerHTML`**：正文里的 `<script>`、`<img onerror=…>` 等
 * 一律作为文本节点渲染（01 §8）。危险协议的链接在解析阶段已降级为 `#`。
 * 类名与旧站 `md.js` 的输出结构一一对应，样式沿用旧站 `post.css`。
 */

import type { ReactNode } from "react";

import { rnName } from "../text/ransom";
import type { BlockNode, MarkdownResult, TalkLine } from "./blocks";
import { safeUrl, type InlineNode } from "./inline";

function renderInline(nodes: readonly InlineNode[], keyPrefix = "i"): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case "text":
        return node.value;
      case "code":
        return <code key={key}>{node.value}</code>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            {...(node.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {renderInline(node.children, key)}
          </a>
        );
      case "image":
        return (
          <img
            key={key}
            src={node.src}
            alt={node.alt}
            title={node.title ?? undefined}
            loading="lazy"
          />
        );
      default:
        return null;
    }
  });
}

function renderTalkLine(line: TalkLine, index: number): ReactNode {
  return (
    <div className={`say${line.me ? " me" : ""}`} key={index}>
      {line.face ? <img className="face" src={line.face} alt="" loading="lazy" /> : null}
      <div className="say-b">
        <span className="say-n">{rnName(line.who)}</span>
        <p>{renderInline(line.children, `t${index}`)}</p>
      </div>
    </div>
  );
}

function renderBlock(block: BlockNode, index: number): ReactNode {
  const key = `b-${index}`;
  switch (block.kind) {
    case "heading":
      return block.level === 2 ? (
        <h2 id={block.id} key={key}>
          <span className="n">{block.no}</span>
          {renderInline(block.children, key)}
        </h2>
      ) : (
        <h3 id={block.id} key={key}>
          {renderInline(block.children, key)}
        </h3>
      );
    case "paragraph":
      return <p key={key}>{renderInline(block.children, key)}</p>;
    case "list": {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>
      ));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "code":
      return (
        <div className="code" key={key}>
          {block.lang ? <span className="lang">{block.lang}</span> : null}
          <pre>
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case "table":
      return (
        <div className="tbl" key={key}>
          <table>
            <thead>
              <tr>
                {block.head.map((cell, cellIndex) => (
                  <th scope="col" key={cellIndex}>
                    {renderInline(cell, `${key}-h${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell, `${key}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={key} />;
    case "figure":
      return (
        <figure key={key}>
          <img src={safeUrl(block.src)} alt={block.alt} loading="lazy" />
          {block.title ? <figcaption>{block.title}</figcaption> : null}
        </figure>
      );
    case "note":
      return (
        <aside className="note" role="note" key={key}>
          {renderInline(block.children, key)}
        </aside>
      );
    case "talk":
      return (
        <div className="talk" key={key}>
          {block.lines.map(renderTalkLine)}
        </div>
      );
    case "quote":
      return (
        <blockquote key={key}>
          {block.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>{renderInline(paragraph, `${key}-${paragraphIndex}`)}</p>
          ))}
        </blockquote>
      );
    default:
      return null;
  }
}

export function MarkdownView({ result }: { result: MarkdownResult }): ReactNode {
  return <>{result.blocks.map(renderBlock)}</>;
}

export { parseMarkdown } from "./blocks";
export type { BlockNode, MarkdownResult, TocEntry } from "./blocks";
