/**
 * 管理端别名输入格式：「每行一条 `字段:值`」。
 *
 * 纯函数，便于单测；解析结果直接交给服务端校验（重复 / 超长由服务端 422 指出，
 * 这里只做「这一行根本读不出来」的本地提醒）。
 * 接受半角 `:` 与全角 `：`。
 */

import { PALACE_FIELDS, type PalaceAlias, type PalaceField } from "../types";

export interface ParsedAliases {
  aliases: PalaceAlias[];
  /** 读不出来的原始行（字段名不认识 / 没有值 / 没有分隔符）。 */
  invalid: string[];
}

export function parseAliasLines(text: string): ParsedAliases {
  const aliases: PalaceAlias[] = [];
  const invalid: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const half = line.indexOf(":");
    const full = line.indexOf("：");
    const index = half === -1 ? full : full === -1 ? half : Math.min(half, full);
    if (index === -1) {
      invalid.push(line);
      continue;
    }
    const field = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(PALACE_FIELDS as readonly string[]).includes(field) || !value) {
      invalid.push(line);
      continue;
    }
    aliases.push({ field: field as PalaceField, value });
  }
  return { aliases, invalid };
}

export function formatAliasLines(aliases: readonly PalaceAlias[]): string {
  return aliases.map((alias) => `${alias.field}:${alias.value}`).join("\n");
}
