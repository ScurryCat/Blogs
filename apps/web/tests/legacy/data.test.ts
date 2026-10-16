/**
 * 迁移基线的数据一致性测试。
 *
 * 目的：证明「迁移没有改动内容」——
 *  - 8 篇文章的 slug、标题、日期、正文都在（正文原文是权威数据）；
 *  - 25 个地图地点的几何与目的地映射完整，未开放的地点在列表里不出现；
 *  - 旧 URL → 新路由的映射表覆盖旧站 7 条路由；
 *  - 天气码映射与精灵图坐标与旧站一致；
 *  - 留言板默认仍是本机存储。
 */

import { describe, expect, it } from "vitest";

import { site, arcanaOf } from "@/features/legacy/config";
import {
  MAP_VIEWBOX,
  mapLocations,
  openLocations,
  DEFAULT_LOCATION_ID,
  locationImage,
  locationLabel,
} from "@/features/legacy/map";
import { allTags, archiveYears, findPost, postPath, posts, stripMarkdown } from "@/features/legacy/posts";
import { HOME_ANCHORS, LEGACY_ROUTES, legacyHrefToNext } from "@/features/legacy/routes";
import { createLocalStore, createGuestbookStore } from "@/features/legacy/guestbook/store";
import {
  CONDITIONS,
  currentTemperature,
  forecastQuery,
  p5Condition,
  parseDay,
  screenReaderText,
  smallDigitPosition,
  toSnapshot,
  wmoText,
} from "@/features/legacy/weather/model";
import { tracks } from "@/features/legacy/music";

const LEGACY_SLUGS = [
  "phantom-blog-launch",
  "css-p5-menu",
  "tokyo-ten-days",
  "desk-setup-2026",
  "p5r-platinum",
  "snow-country-notes",
  "a11y-checklist",
  "assets-and-credits",
];

describe("文章基线", () => {
  it("8 个 slug 一个不少，且都能按 slug 找到", () => {
    expect(posts).toHaveLength(8);
    expect(posts.map((post) => post.slug).sort()).toEqual([...LEGACY_SLUGS].sort());
    for (const slug of LEGACY_SLUGS) {
      expect(findPost(slug)?.title).toBeTruthy();
      expect(findPost(slug)?.content.length).toBeGreaterThan(200);
    }
    expect(findPost("not-a-post")).toBeNull();
  });

  it("按日期倒序，编号从最新一篇开始递增", () => {
    for (let index = 1; index < posts.length; index += 1) {
      expect(posts[index - 1]!.date >= posts[index]!.date).toBe(true);
    }
    expect(posts[0]!.no).toBe(8);
    expect(posts[7]!.no).toBe(1);
  });

  it("派生字段（摘要 / 阅读时长 / 塔罗）都有值", () => {
    for (const post of posts) {
      expect(post.ex.length).toBeGreaterThan(0);
      expect(post.ex.length).toBeLessThanOrEqual(95);
      expect(post.min).toBeGreaterThanOrEqual(1);
      expect(post.arc[1]).toBeTruthy();
      expect(post.cover.startsWith("/assets/legacy/img/")).toBe(true);
    }
    expect(arcanaOf("TECH")).toEqual(["I", "MAGICIAN"]);
    expect(arcanaOf("NOPE")).toEqual(["?", "NOPE"]);
  });

  it("canonical 路径与标签 / 年份聚合", () => {
    expect(postPath({ slug: "css-p5-menu" })).toBe("/posts/css-p5-menu");
    expect(postPath({ slug: "有 空格" })).toBe("/posts/%E6%9C%89%20%E7%A9%BA%E6%A0%BC");
    expect(allTags().length).toBeGreaterThan(5);
    expect(archiveYears()).toContain("2026");
    expect(stripMarkdown("**粗** 与 `代码` 与 [链接](x)")).toBe("粗 与 代码 与 链接");
  });
});

describe("地图基线", () => {
  it("25 个地点，可前往的都有真实目的地", () => {
    expect(mapLocations).toHaveLength(25);
    expect(openLocations.length).toBeGreaterThan(10);
    for (const location of openLocations) {
      expect(location.to?.href.startsWith("/")).toBe(true);
      expect(location.to?.title).toBeTruthy();
    }
  });

  it("未配置目的地的地点不出现，也没有坏链接", () => {
    const closed = mapLocations.filter((location) => location.to === null);
    expect(closed.length).toBe(25 - openLocations.length);
    for (const location of closed) expect(location.to).toBeNull();
  });

  it("默认选中据点（18），几何与旧站 viewBox 一致", () => {
    expect(DEFAULT_LOCATION_ID).toBe(18);
    expect(MAP_VIEWBOX).toEqual({ width: 1500, height: 990 });
    const home = mapLocations.find((location) => location.id === 18);
    expect(home?.to?.href).toBe("/");
    expect(locationImage(10)).toBe("/assets/legacy/img/map/10_image.png");
    expect(locationLabel(10)).toBe("/assets/legacy/img/map/svg/10_label.svg");
  });

  it("文章型目的地指向 canonical 文章路径，不用旧查询串", () => {
    const postLocation = openLocations.find((location) => location.to?.href.startsWith("/posts/"));
    expect(postLocation).toBeTruthy();
    expect(postLocation?.to?.href).not.toContain("post.html");
  });
});

describe("旧 URL → 新路由", () => {
  it("覆盖旧站全部 7 条路由", () => {
    expect(LEGACY_ROUTES).toHaveLength(9); // 7 条页面 + 2 个锚点变体
    const legacyPaths = LEGACY_ROUTES.map((route) => route.legacy);
    for (const name of [
      "index.html",
      "post.html?p=<slug>",
      "map.html",
      "about.html",
      "weather.html",
      "guestbook.html",
      "poll-demo.html",
    ]) {
      expect(legacyPaths).toContain(name);
    }
  });

  it("站内旧链接按映射表转换，锚点保留", () => {
    expect(legacyHrefToNext("index.html")).toBe("/");
    expect(legacyHrefToNext("index.html#posts")).toBe("/#posts");
    expect(legacyHrefToNext("index.html#archive")).toBe("/#archive");
    expect(legacyHrefToNext("map.html")).toBe("/map");
    expect(legacyHrefToNext("weather.html")).toBe("/weather");
    expect(legacyHrefToNext("about.html")).toBe("/about");
    expect(legacyHrefToNext("guestbook.html")).toBe("/guestbook");
    expect(legacyHrefToNext("post.html?p=css-p5-menu")).toBe("/posts/css-p5-menu");
    expect(legacyHrefToNext("https://example.com/x")).toBe("https://example.com/x");
    expect(legacyHrefToNext("/map")).toBe("/map");
    expect([...HOME_ANCHORS]).toEqual(["posts", "archive", "latest"]);
  });

  it("解析后的地图目的地全部是新站路径（不留旧 HTML 入口）", () => {
    // 原始 site.json 刻意保留旧站写法（便于与旧站逐字段核对），
    // 「转成新站路径」这件事发生在解析层：这里断言解析结果。
    for (const location of openLocations) {
      expect(location.to?.href).not.toContain(".html");
      expect(location.to?.href.startsWith("/")).toBe(true);
    }
    for (const entry of Object.values(site.map)) {
      if (entry.href) expect(legacyHrefToNext(entry.href)).not.toContain(".html");
    }
  });
});

describe("天气模型", () => {
  it("WMO 码映射到 P5 四类天气与中文描述", () => {
    expect(CONDITIONS).toHaveLength(4);
    expect(p5Condition(0)).toBe(0);
    expect(p5Condition(2)).toBe(1);
    expect(p5Condition(45)).toBe(1);
    expect(p5Condition(63)).toBe(2);
    expect(p5Condition(75)).toBe(3);
    expect(p5Condition(86)).toBe(3);
    expect(wmoText(0)).toBe("晴朗");
    expect(wmoText(95)).toBe("雷阵雨");
    expect(wmoText(1234)).toBe(CONDITIONS[p5Condition(1234)]);
  });

  it("精灵图坐标：负号 / 度 / 空位与旧站一致", () => {
    expect(smallDigitPosition(12)).toEqual({ sign: -384, tens: -32, ones: -64 });
    expect(smallDigitPosition(-5)).toEqual({ sign: -352, tens: -384, ones: -160 });
    const current = currentTemperature(7.4);
    expect(current.single).toBe(true);
    expect(current.tens).toBe(-0);
    expect(current.ones).toBe(-7 * 72);
    expect(current.fraction).toBe(-4 * 72);
    expect(currentTemperature(-12.5).negative).toBe(true);
  });

  it("响应转模型：缺字段不抛异常，读屏文本包含城市与温度", () => {
    const snapshot = toSnapshot("东京", {
      timezone: "Asia/Tokyo",
      current: { temperature_2m: 21.4, weather_code: 3 },
      daily: {
        time: ["2026-10-16", "2026-10-17"],
        weather_code: [3, 61],
        temperature_2m_max: [24.1, 22.0],
        temperature_2m_min: [17.2, 16.0],
      },
    });
    expect(snapshot.days).toHaveLength(2);
    expect(snapshot.current.code).toBe(3);
    const text = screenReaderText(snapshot);
    expect(text).toContain("东京现在 21.4°C");
    expect(text).toContain("阴天");
    expect(text).toContain("10月17日");
    expect(parseDay("2026-10-16").getDate()).toBe(16);
    expect(forecastQuery(35.6764, 139.65)).toContain("latitude=35.6764");
    expect(forecastQuery(1, 2)).toContain("timezone=auto");
  });
});

describe("留言板与曲目配置", () => {
  it("默认仍是本机存储，留言不会离开浏览器", async () => {
    expect(site.guestbook.store).toBe("local");
    const store = createGuestbookStore(site.guestbook, window.localStorage);
    expect(store.mode).toBe("local");
    expect(store.contactStaysLocal).toBe(true);
    const row = await store.add({ name: "访客", text: "你好", contact: "a@b.c" });
    expect(row.id.startsWith("l")).toBe(true);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toBe("你好");
  });

  it("本地留言最多保留 200 条", async () => {
    const store = createLocalStore(window.localStorage, () => 1);
    for (let index = 0; index < 205; index += 1) {
      await store.add({ name: "n", text: `t${index}` });
    }
    expect((await store.list()).length).toBe(200);
  });

  it("配置未给 endpoint / key 时不会切到远端", () => {
    const store = createGuestbookStore(
      { ...site.guestbook, store: "remote", endpoint: "", key: "" },
      window.localStorage,
    );
    expect(store.mode).toBe("local");
  });

  it("曲目清单沿用旧站静态路径（音频只保留一份）", () => {
    expect(tracks).toHaveLength(3);
    for (const track of tracks) {
      // 单一来源：与旧站 `assets/music/` 同一个路径（不复制第二份音频）。
      expect(track.src.startsWith("/assets/music/")).toBe(true);
      expect(track.title).toBeTruthy();
    }
  });
});
