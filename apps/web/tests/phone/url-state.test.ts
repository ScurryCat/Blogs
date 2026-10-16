/**
 * 手机 URL 状态（02 §6）：解析、序列化、保留其他参数、返回上一层。
 * URL 是「当前打开什么」的唯一依据，所以这些纯函数必须准确。
 */

import { describe, expect, it } from "vitest";

import {
  buildPhoneUrl,
  isPhoneHome,
  parentPhoneState,
  parsePhoneState,
  withoutPhoneParams,
} from "@/features/phone/url-state";

describe("解析 / 序列化", () => {
  it("没有 phone 参数就是没打开", () => {
    expect(parsePhoneState("")).toBeNull();
    expect(parsePhoneState("?page=2")).toBeNull();
  });

  it("home / 应用 / 详情三种状态都能往返", () => {
    expect(parsePhoneState("?phone=home")).toEqual({ phone: "home", screen: null, item: null });
    expect(parsePhoneState("?phone=ins&screen=detail&item=uuid-1")).toEqual({
      phone: "ins",
      screen: "detail",
      item: "uuid-1",
    });

    const url = buildPhoneUrl("/posts/css-p5-menu", "", { phone: "ins", screen: "detail", item: "abc" });
    expect(url).toBe("/posts/css-p5-menu?phone=ins&screen=detail&item=abc");
    expect(parsePhoneState(url.split("?")[1] ?? "")).toEqual({
      phone: "ins",
      screen: "detail",
      item: "abc",
    });
  });

  it("保留页面原有的其他查询参数，不覆盖别人的状态", () => {
    expect(buildPhoneUrl("/map", "city=tokyo&page=2", { phone: "home", screen: null, item: null })).toBe(
      "/map?city=tokyo&page=2&phone=home",
    );
    expect(withoutPhoneParams("city=tokyo&phone=ins&item=1&page=2")).toBe("city=tokyo&page=2");
  });

  it("关闭手机时去掉全部三个手机参数", () => {
    expect(buildPhoneUrl("/", "phone=ins&screen=feed&item=x&keep=1", null)).toBe("/?keep=1");
    expect(buildPhoneUrl("/", "phone=home", null)).toBe("/");
  });

  it("screen / item 为空时不写进地址", () => {
    expect(buildPhoneUrl("/", "", { phone: "ins", screen: null, item: null })).toBe("/?phone=ins");
  });
});

describe("返回上一层", () => {
  it("详情 → 应用首页 → 桌面 → 关闭", () => {
    const detail = parentPhoneState({ phone: "ins", screen: "detail", item: "abc" });
    expect(detail).toEqual({ phone: "ins", screen: "detail", item: null });

    const feed = parentPhoneState(detail!);
    expect(feed).toEqual({ phone: "ins", screen: null, item: null });

    const home = parentPhoneState(feed!);
    expect(home).toEqual({ phone: "home", screen: null, item: null });
    expect(isPhoneHome(home)).toBe(true);

    // 桌面再往回就是关闭手机（null），不是「跳到别的站点」。
    expect(parentPhoneState(home!)).toBeNull();
  });
});
