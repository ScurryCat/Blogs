/**
 * 滚动位置记忆（任务书 §4.1「切换详情后返回列表时恢复浏览位置」/ §8.5「状态保持要有测试」）。
 *
 * 这里测的是**行为**而不是实现细节：
 *  - 按标签分键，不同筛选不会串位；
 *  - 列表就绪后才恢复（过早恢复会被后续布局顶回去）；
 *  - 恢复一次即消费掉（返回只用一次），可用 `consume: false` 保留；
 *  - 卸载时记下当前位置，供「详情 → 返回」；
 *  - 存储不可用时安静降级，不阻断阅读。
 */

import { act, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { phoneScrollContainer, scrollContainerFor, scrollKey, useFeedScrollRestore } from "./scroll-memory";
import { stubScrollTo } from "@/tests/helpers/browser";
import { advance, render, resetDocument } from "@/tests/helpers/render";

type View = ReturnType<typeof render>;

function Probe({
  storageKey,
  ready = true,
  consume = true,
  enabled = true,
}: {
  storageKey: string;
  ready?: boolean;
  consume?: boolean;
  enabled?: boolean;
}): ReactNode {
  useFeedScrollRestore(storageKey, ready, { enabled, consume });
  return <div data-probe="" />;
}

function setScrollY(value: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

let views: View[] = [];
let scroll: ReturnType<typeof stubScrollTo>;

function mount(ui: ReactNode): View {
  const view = render(ui);
  views.push(view);
  return view;
}

beforeEach(() => {
  resetDocument();
  views = [];
  window.sessionStorage.clear();
  setScrollY(0);
  scroll = stubScrollTo();
});

afterEach(() => {
  for (const view of views.splice(0).reverse()) view.unmount();
  scroll.restore();
  window.sessionStorage.clear();
});

describe("scrollKey：按标签分键", () => {
  it("无标签 / 空标签 / 纯空白都落到同一个「全部」键", () => {
    expect(scrollKey(null)).toBe(scrollKey(""));
    expect(scrollKey("   ")).toBe(scrollKey(null));
  });

  it("不同标签得到不同的键（筛选之间不串位）", () => {
    expect(scrollKey("日记")).not.toBe(scrollKey("随笔"));
    expect(scrollKey("日记")).not.toBe(scrollKey(null));
  });
});

describe("useFeedScrollRestore：恢复与记录", () => {
  it("列表就绪后恢复保存的位置，并且只恢复一次（消费掉）", async () => {
    const key = scrollKey(null);
    window.sessionStorage.setItem(key, "480");
    mount(<Probe storageKey={key} />);
    await advance();
    expect(scroll.calls).toEqual([{ top: 480 }]);
    // 恢复后记录被消费，再次挂载不会又跳一次
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("未就绪时不恢复；就绪之后才恢复", async () => {
    const key = scrollKey(null);
    window.sessionStorage.setItem(key, "260");
    const view = mount(<Probe storageKey={key} ready={false} />);
    await advance();
    expect(scroll.calls).toEqual([]);

    act(() => {
      view.root.render(<Probe storageKey={key} ready />);
    });
    await advance();
    expect(scroll.calls).toEqual([{ top: 260 }]);
  });

  it("consume: false 时保留记录（下次进入还能用）", async () => {
    const key = scrollKey(null);
    window.sessionStorage.setItem(key, "120");
    mount(<Probe storageKey={key} consume={false} />);
    await advance();
    expect(scroll.calls).toEqual([{ top: 120 }]);
    expect(window.sessionStorage.getItem(key)).toBe("120");
  });

  it("卸载时把当前滚动位置写回去，供「详情 → 返回」使用", async () => {
    const key = scrollKey("日记");
    const view = mount(<Probe storageKey={key} />);
    await advance();
    setScrollY(320);
    act(() => {
      view.unmount();
    });
    expect(window.sessionStorage.getItem(key)).toBe("320");
  });

  it("enabled: false 时既不恢复也不记录（服务端渲染 / 关闭状态）", async () => {
    const key = scrollKey(null);
    window.sessionStorage.setItem(key, "99");
    const view = mount(<Probe storageKey={key} enabled={false} />);
    await advance();
    expect(scroll.calls).toEqual([]);
    setScrollY(50);
    act(() => {
      view.unmount();
    });
    expect(window.sessionStorage.getItem(key)).toBe("99");
  });
});

describe("useFeedScrollRestore：存储不可用时安静降级", () => {
  it("sessionStorage 抛异常时不影响挂载与卸载", async () => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!;
    const originalSet = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")!;
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value: () => {
        throw new Error("隐私模式");
      },
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value: () => {
        throw new Error("配额已满");
      },
    });
    try {
      const view = mount(<Probe storageKey={scrollKey(null)} />);
      await advance();
      expect(scroll.calls).toEqual([]);
      act(() => {
        view.unmount();
      });
      expect(view.container.isConnected).toBe(false);
    } finally {
      Object.defineProperty(Storage.prototype, "getItem", original);
      Object.defineProperty(Storage.prototype, "setItem", originalSet);
    }
  });
});

describe("滚动容器判定：手机里滚的是 .pw-screen，不是窗口", () => {
  it("列表在 .pw-screen 内时，容器是那个元素；不在手机里时回退到 window", () => {
    const screen = document.createElement("div");
    screen.className = "pw-screen";
    const list = document.createElement("section");
    screen.appendChild(list);
    document.body.appendChild(screen);

    expect(phoneScrollContainer(list)).toBe(screen);
    expect(scrollContainerFor(list)).toBe(screen);

    const outside = document.createElement("section");
    document.body.appendChild(outside);
    expect(phoneScrollContainer(outside)).toBeNull();
    // 在 jsdom 里 window 就是全局对象本身
    expect(scrollContainerFor(outside)).toBe(window);
  });
});

describe("useFeedScrollRestore：在手机滚动容器里工作", () => {
  function PhoneProbe({ storageKey }: { storageKey: string }): ReactNode {
    const listRef = useRef<HTMLDivElement | null>(null);
    useFeedScrollRestore(storageKey, true, {
      enabled: true,
      consume: true,
      containerRef: listRef,
    });
    return (
      <div className="pw-screen">
        <div ref={listRef} data-probe="" />
      </div>
    );
  }

  it("恢复写到容器的 scrollTop（窗口不动），卸载时也从容器读回", async () => {
    const key = scrollKey(null);
    window.sessionStorage.setItem(key, "640");
    const view = mount(<PhoneProbe storageKey={key} />);
    await advance();

    const container = view.container.querySelector<HTMLElement>(".pw-screen")!;
    // 恢复写的是容器，不是窗口
    expect(container.scrollTop).toBe(640);
    expect(scroll.calls).toEqual([]);

    // 卸载时从容器读当前位置写回存储
    container.scrollTop = 275;
    act(() => {
      view.unmount();
    });
    expect(window.sessionStorage.getItem(key)).toBe("275");
  });
});
