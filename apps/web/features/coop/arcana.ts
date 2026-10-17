/**
 * 阿卡那（塔罗）装饰映射。
 *
 * 任务书第二轮 §4.5：「借用协助关系与阿卡那卡牌的视觉语言」；同时明确
 * 「**装饰性阿卡那元素不得被误解成后端已有的关系数值**」。
 *
 * 因此这里只做两件事：
 *  1. 把站主填的 `arcana` 字符串规整成可展示的「罗马数字 + 英文名 + 中文名」；
 *  2. 认不出的值原样展示（不猜、不编造等级/数值）。
 *
 * 数据来源是站主在管理端手填的分类，不是后端的关系数值表 —— 本模块不读取任何 API。
 */

export interface ArcanaCard {
  /** 罗马数字（0 = 愚者，XXI = 世界）。 */
  numeral: string;
  /** 原作英文名（站主填写值规整后的大写形式）。 */
  en: string;
  /** 中文名，仅作说明。 */
  cn: string;
}

/** P5 的 22 张大阿卡那；英文名沿用原作卡面。 */
const ARCANA: Readonly<Record<string, ArcanaCard>> = Object.freeze({
  FOOL: { numeral: "0", en: "FOOL", cn: "愚者" },
  MAGICIAN: { numeral: "I", en: "MAGICIAN", cn: "魔术师" },
  PRIESTESS: { numeral: "II", en: "PRIESTESS", cn: "女教皇" },
  EMPRESS: { numeral: "III", en: "EMPRESS", cn: "女皇" },
  EMPEROR: { numeral: "IV", en: "EMPEROR", cn: "皇帝" },
  HIEROPHANT: { numeral: "V", en: "HIEROPHANT", cn: "教皇" },
  LOVERS: { numeral: "VI", en: "LOVERS", cn: "恋爱" },
  CHARIOT: { numeral: "VII", en: "CHARIOT", cn: "战车" },
  JUSTICE: { numeral: "VIII", en: "JUSTICE", cn: "正义" },
  HERMIT: { numeral: "IX", en: "HERMIT", cn: "隐者" },
  FORTUNE: { numeral: "X", en: "FORTUNE", cn: "命运" },
  STRENGTH: { numeral: "XI", en: "STRENGTH", cn: "刚毅" },
  HANGED: { numeral: "XII", en: "HANGED", cn: "倒吊" },
  DEATH: { numeral: "XIII", en: "DEATH", cn: "死神" },
  TEMPERANCE: { numeral: "XIV", en: "TEMPERANCE", cn: "节制" },
  DEVIL: { numeral: "XV", en: "DEVIL", cn: "恶魔" },
  TOWER: { numeral: "XVI", en: "TOWER", cn: "塔" },
  STAR: { numeral: "XVII", en: "STAR", cn: "星" },
  MOON: { numeral: "XVIII", en: "MOON", cn: "月" },
  SUN: { numeral: "XIX", en: "SUN", cn: "太阳" },
  JUDGEMENT: { numeral: "XX", en: "JUDGEMENT", cn: "审判" },
  WORLD: { numeral: "XXI", en: "WORLD", cn: "世界" },
});

/** 常见写法差异（站主手填时可能出现）。 */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  HIGH_PRIESTESS: "PRIESTESS",
  PRIESTESS: "PRIESTESS",
  HANGED_MAN: "HANGED",
  HANGEDMAN: "HANGED",
  JUDGMENT: "JUDGEMENT",
  TEMPERANCER: "TEMPERANCE",
  LOVERS: "LOVERS",
  LOVER: "LOVERS",
  FORTUNES: "FORTUNE",
});

/** 把站主填的值规整成查表键：大写、空格/连字符/下划线折叠成单下划线。 */
export function normalizeArcana(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return null;
  return ALIASES[cleaned] ?? cleaned;
}

/**
 * 查阿卡那装饰信息；认不出的值返回 `null`（调用方回退为「原样展示文本」，
 * 不编数字、不补中文名，避免把装饰说成真实数据）。
 */
export function arcanaOf(value: string | null | undefined): ArcanaCard | null {
  const key = normalizeArcana(value);
  if (key === null) return null;
  return ARCANA[key] ?? null;
}

/** 罗马数字顺序（供列表排序；0 在最前）。 */
const NUMERAL_ORDER = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"];

/** 供测试与文档引用的完整列表（22 张，顺序按罗马数字）。 */
export const ARCANA_LIST: readonly ArcanaCard[] = Object.freeze(
  Object.values(ARCANA).sort(
    (left, right) => NUMERAL_ORDER.indexOf(left.numeral) - NUMERAL_ORDER.indexOf(right.numeral),
  ),
);
