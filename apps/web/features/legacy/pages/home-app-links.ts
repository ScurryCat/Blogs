/**
 * 首页「应用枢纽」变体（C）的入口清单（2026-10-17 · 用户反馈 R4）。
 *
 * 9 个视觉还原界面：8 个手机内置应用（`?phone=<id>` 深链）+ 生活图库（独立页）。
 * 这里只放**服务端安全**的纯数据（图标路径 + 链接），不 import 手机注册表的懒加载器；
 * 与注册表的一致性由 `tests/navigation/home-app-hub.test.tsx` 断言。
 */

export interface HomeAppLink {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  /** 站内链接：手机内应用用 `?phone=<id>`，独立页用真实路径。 */
  href: string;
}

export const HOME_APP_LINKS: readonly HomeAppLink[] = Object.freeze([
  {
    id: "showcase",
    name: "殿堂",
    subtitle: "作品",
    icon: "/assets/legacy/img/app/showcase.png",
    href: "/?phone=showcase",
  },
  {
    id: "gallery",
    name: "图库",
    subtitle: "生活相册",
    icon: "/assets/legacy/img/app/ins.png",
    href: "/gallery",
  },
  {
    id: "velvet",
    name: "天鹅绒",
    subtitle: "技能全书",
    icon: "/assets/legacy/img/app/velvet.png",
    href: "/?phone=velvet",
  },
  {
    id: "metanav",
    name: "导航",
    subtitle: "异世界导航",
    icon: "/assets/legacy/img/app/metanav.png",
    href: "/?phone=metanav",
  },
  {
    id: "coop",
    name: "协助者",
    subtitle: "友链通讯录",
    icon: "/assets/legacy/img/app/coop.png",
    href: "/?phone=coop",
  },
  {
    id: "leisure",
    name: "放课后",
    subtitle: "追番与游戏",
    icon: "/assets/legacy/img/app/leisure.png",
    href: "/?phone=leisure",
  },
  {
    id: "journal",
    name: "手记",
    subtitle: "日记与日历",
    icon: "/assets/legacy/img/app/journal.png",
    href: "/?phone=journal",
  },
  {
    id: "mementos",
    name: "印象空间",
    subtitle: "问题记录",
    icon: "/assets/legacy/img/app/mementos.png",
    href: "/?phone=mementos",
  },
  {
    id: "ins",
    name: "IM",
    subtitle: "图文动态与消息",
    icon: "/assets/legacy/img/app/ins.png",
    href: "/?phone=ins",
  },
]);
