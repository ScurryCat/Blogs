/**
 * 撕纸字 / P5 标题 / 对话框署名 —— 旧站 `assets/js/core.js` 的 `rn` / `rnP5` / `rnName` 迁移。
 *
 * 迁移原则（01 §8「保留 P5 排版」）：
 *  - **逐位保留原算法**，包括线性同余伪随机与种子，保证刷新后同一段文字排列不变；
 *    旧站用 `Math.random()` 会闪，这里不引入随机。
 *  - 旧实现用字符串拼 HTML + `innerHTML`。这里改成 React 元素，**不拼 HTML 字符串**，
 *    文本一律作为子节点，天然转义（01 §8 要求旧 renderer 的输出不得直接进
 *    `dangerouslySetInnerHTML`）。
 */

import type { ReactNode } from "react";

/** 线性同余伪随机：与旧站 core.js 完全一致（同 seed 同结果）。 */
function seeded(seed: number): () => number {
  let h = (seed * 2654435761) >>> 0 || 1;
  return () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
}

const LATIN = /[A-Za-z0-9]/;

/**
 * 撕纸字：把文本拆成五套贴纸（k1–k5）× 五种字形（f1–f5），每字随机倾斜、下沉与缩放。
 * 返回带 `.sr-only` 原文的可访问结构，与旧站 DOM 形状一致。
 */
export function rn(text: string, seed = 1): ReactNode {
  const rand = seeded(seed);
  let prev = 0;
  let key = 0;

  const piece = (ch: string) => {
    const latin = LATIN.test(ch);
    let k = 1 + Math.floor(rand() * 5);
    if (k === prev) k = (k % 5) + 1;
    prev = k;
    const f = latin ? (rand() < 0.55 ? 1 : 5) : [2, 3, 4][Math.floor(rand() * 3)];
    const style = {
      "--r": `${(rand() * 10 - 5).toFixed(1)}deg`,
      "--y": `${(rand() * 0.12 - 0.06).toFixed(2)}em`,
      "--s": `${(0.9 + rand() * 0.22).toFixed(2)}`,
      "--a": `${Math.floor(rand() * 10)}%`,
      "--b": `${Math.floor(rand() * 10)}%`,
    } as React.CSSProperties;
    key += 1;
    return (
      <span className={`c k${k} f${f}`} style={style} key={key}>
        {ch}
      </span>
    );
  };

  // 与旧站相同的切分：拉丁词 / 数字 / 撇号 / 点 / 连字符 算一个整体，空白单独成节点。
  const parts = String(text).match(/[A-Za-z0-9'’.-]+|\s+|./gu) ?? [];
  const visible: ReactNode[] = [];
  for (const part of parts) {
    key += 1;
    if (/^\s+$/.test(part)) {
      visible.push(<span className="sp" key={key} />);
      continue;
    }
    const chars = [...part].map(piece);
    visible.push(
      part.length > 1 ? (
        <span className="w" key={key}>
          {chars}
        </span>
      ) : (
        chars
      ),
    );
  }

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{visible}</span>
    </>
  );
}

/**
 * p5-ui 的标题方案：少量「选中字」上色块，其余纯文字，每字随机倾斜 ±10°。
 * 选中规则与旧站一致：第 2 个字，以及「前两格是空格 / 标点」的字。
 */
export function rnP5(text: string, seed = 1): ReactNode {
  const value = String(text);
  const marks = [" ", ",", "，", ".", "。", "!", "！", "?", "？"];
  const rand = seeded(seed);
  const chars = [...value];
  const spans = chars.map((ch, i) => {
    let on = false;
    if (!marks.includes(chars[1] ?? "")) on = i === 1;
    if (!on && i >= 2 && !marks.includes(ch) && marks.includes(chars[i - 2] ?? "")) on = true;
    return (
      <span
        key={i}
        className={on ? "on" : undefined}
        style={{ "--d": `${(rand() * 20 - 10).toFixed(1)}deg` } as React.CSSProperties}
      >
        {ch}
      </span>
    );
  });
  return (
    <>
      <span className="sr-only">{value}</span>
      <span className="rnp" aria-hidden="true">
        {spans}
      </span>
    </>
  );
}

const NAME_MARKS = [" ", ",", "，", ".", "。", "!", "！", "?", "？", "·", "、"];

/**
 * 对话框署名：按「可见字」数，第 2、4、6… 个字上黑底。
 * 种子来自姓名码点和，保证同一署名每次刷新长得一样。
 */
export function rnName(text: string): ReactNode {
  const value = String(text);
  let h = ([...value].reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 7) * 2654435761) >>> 0 || 1;
  const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
  let visibleIndex = -1;
  const spans = [...value].map((ch, i) => {
    const isMark = NAME_MARKS.includes(ch);
    if (!isMark) visibleIndex += 1;
    const on = !isMark && visibleIndex > 0 && visibleIndex % 2 === 1;
    return (
      <span
        key={i}
        className={on ? "on" : undefined}
        style={{ "--d": `${(rand() * 20 - 10).toFixed(1)}deg` } as React.CSSProperties}
      >
        {ch}
      </span>
    );
  });
  return (
    <>
      <span className="sr-only">{value}</span>
      <span className="rnp" aria-hidden="true">
        {spans}
      </span>
    </>
  );
}
