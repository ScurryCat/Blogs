/**
 * 东京地图目的地 —— **单一配置**（任务书 §2.3「本轮固定默认值」）。
 *
 * 准则：
 *  - 地图图标、右侧「出发」按钮、下方地点列表三个入口都读这一份（经
 *    `features/legacy/map.ts` 解析成 `location.to`），不允许再写三份 switch / 映射表；
 *  - 13 个开放地点与任务书 §2.3 表格一一对应，其余地点保持**未开放**（无假链接）；
 *  - 目的地一律是新站真实路由，**不再绑定任何具体文章 slug**；
 *  - 这是网站主题映射，不宣称是原游戏各地点的实际功能；
 *  - 上野（作品殿堂）带 `intent: "enter-showcase"`，与顶部「作品」链接一致：
 *    显式声明「主动跨入殿堂边界」，过场由共享协调器决定，不改 href / 历史。
 *
 * 地图形状、地名与坐标在 `features/legacy/data/map.json`，本文件只改目的地图层，
 * 不改变地图图形与位置。
 */

import type { NavigationIntent } from "@/features/phone/types";

export interface MapDestinationConfig {
  /** `map.json` 里的地点 id（几何与地名仍以那份数据为准）。 */
  locationId: number;
  /** 新站目的地路径（可带查询串）。 */
  href: string;
  /** 地标小字（SVG 标签里的英文短名）。 */
  en: string;
  /** 右侧档案卡标题：说明这里是什么内容。 */
  title: string;
  /** 右侧档案卡说明：解释栏目内容，不编造游戏内功能。 */
  note: string;
  /** 可选导航意图（目前只有主动进入作品殿堂）。 */
  intent?: NavigationIntent;
}

/**
 * 13 个开放地点。顺序与任务书 §2.3 表格一致（与地图坐标无关）。
 */
export const MAP_DESTINATIONS: readonly MapDestinationConfig[] = [
  {
    locationId: 18, // 四軒茶屋 Yongen-Jaya
    href: "/apps/leblanc",
    en: "LIFE",
    title: "生活 · 勒布朗",
    note: "生活汇总：手记、INS、放课后与图库的摘要都在这里，也能去留言。",
  },
  {
    locationId: 12, // 渋谷 Shibuya
    href: "/apps/ins",
    en: "INS",
    title: "生活 · INS 动态",
    note: "图片优先的当下图文近况；发布仍至少一张图片，不写成第二套长文章。",
  },
  {
    locationId: 0, // 青山一丁目 Aoyama-Itchome
    href: "/apps/journal",
    en: "JOURNAL",
    title: "生活 · 手记",
    note: "按天记录的经历与感受：日期、标题、摘要，存档式列表与日历定位。",
  },
  {
    locationId: 15, // 神保町 Jinbocho
    href: "/posts",
    en: "POSTS",
    title: "情报档案 · 文章",
    note: "完整文章索引：搜索、分类与归档都在这里，长期查找从这一站出发。",
  },
  {
    locationId: 6, // 上野 Ueno
    href: "/showcase",
    en: "SHOWCASE",
    title: "作品 · 我的殿堂",
    note: "我做出的项目、职责与关键取舍；配图不再混入生活照片。",
    intent: "enter-showcase",
  },
  {
    locationId: 23, // 三浦海岸 Miura Beach
    href: "/gallery",
    en: "GALLERY",
    title: "生活 · 图库",
    note: "相册组织、照片墙展示的生活图库；照片墙不单独上传或发布。",
  },
  {
    locationId: 7, // 秋葉原 Akihabara
    href: "/apps/leisure?screen=game",
    en: "GAME",
    title: "放课后 · 游戏",
    note: "在玩的游戏与进度记录；不编造等级、游玩时长或成绩。",
  },
  {
    locationId: 3, // 池袋 Ikebukuro
    href: "/apps/leisure?screen=anime",
    en: "ANIME",
    title: "放课后 · 追番",
    note: "在追的番剧与进度记录；与游戏共用放课后入口。",
  },
  {
    locationId: 19, // 六本木 Roppongi
    href: "/apps/coop",
    en: "COOP",
    title: "COOP · 友链",
    note: "真实友链通讯录；关于页也保留清楚入口，不新建第二套友链系统。",
  },
  {
    locationId: 8, // 浅草 Asakusa
    href: "/posts?view=archive",
    en: "ARCHIVE",
    title: "文章归档",
    note: "按年份排好的全部文章，直接打开归档视图。",
  },
  {
    locationId: 9, // 井の頭公園 Inokashira Park
    href: "/weather",
    en: "WEATHER",
    title: "天气",
    note: "出门之前先看看东京的天气；天气保留手机与地图入口，不占顶部栏目。",
  },
  {
    locationId: 10, // 明治神宮 Meiji Shrine
    href: "/guestbook",
    en: "GUESTBOOK",
    title: "留言",
    note: "生活页与地图都能到达的留言入口；这里没有算法，只有人。",
  },
  {
    locationId: 13, // 永田町 Nagatacho
    href: "/about",
    en: "ABOUT",
    title: "关于 · 人物档案",
    note: "五维、真实友链、足迹与联络方式；友链由 COOP 承担。",
  },
];

/** 13 个开放地点的 id（地图列表 / 图标 / 出发统一由解析结果决定，不另存一份）。 */
export const OPEN_MAP_LOCATION_IDS: readonly number[] = MAP_DESTINATIONS.map(
  (destination) => destination.locationId,
);

/** 按地点 id 取目的地；未开放返回 `null`（地图渲染为不可点、不进列表）。 */
export function findMapDestination(locationId: number): MapDestinationConfig | null {
  return MAP_DESTINATIONS.find((destination) => destination.locationId === locationId) ?? null;
}
