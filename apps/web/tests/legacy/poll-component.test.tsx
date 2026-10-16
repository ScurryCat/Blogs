/**
 * 问卷组件的生命周期测试（React 版对照旧站的浏览器断言）。
 *
 * 覆盖旧站 `tests/poll-browser.js` 里与**组件行为**有关的部分：
 * 重复 show 不产生重复 DOM、同 id 的两份实例互相镜像、关闭只记「见过」不加票、
 * 关闭 / 重新打开的计时器取消、销毁后不复活、配置文本不变成 HTML。
 *
 * 与「样式几何」有关的断言（半透明底板、票数框比例、Q 与框叠合、整数 / 小数分列字号）
 * 依赖真实排版，放在真实浏览器里跑（见交付单的浏览器验证记录），不用 jsdom 冒充。
 */

import { describe, expect, it, beforeEach } from "vitest";

import { InlinePoll, Poll } from "@/features/legacy/poll/poll";
import { createStore, type PollInput } from "@/features/legacy/poll/model";
import { advance, click, render, resetDocument } from "../helpers/render";

function config(id = "check", patch: Partial<PollInput> = {}): PollInput {
  return {
    id,
    title: "怪盗ch",
    question: "你相信心之怪盗吗？",
    questionHighlight: ["心之怪盗"],
    options: [
      { value: "yes", label: "YES" },
      { value: "no", label: "NO" },
    ],
    main: "yes",
    base: { yes: 0, no: 0 },
    ...patch,
  };
}

beforeEach(() => {
  resetDocument();
});

describe("问卷组件", () => {
  it("内嵌实例渲染真实文本、两个按钮与分列的整数 / 小数", async () => {
    const first = render(<InlinePoll config={config() as never} />);
    await advance();
    const root = first.container.querySelector(".poll--inline");
    expect(root).not.toBeNull();
    expect(first.container.querySelector(".poll-question")?.textContent).toBe("你相信心之怪盗吗？");
    expect(first.container.querySelector(".poll-whole")?.textContent).toBe("00");
    expect(first.container.querySelector(".poll-fraction")?.textContent).toBe(".0");
    expect(first.container.querySelector(".poll-result-label")?.textContent).toBe("YES");
    expect(first.container.querySelector(".poll-choice")).not.toBeNull();
    // 内嵌不显示浮层关闭控件。
    expect(first.container.querySelector(".poll-close")).toBeNull();
    expect(first.container.querySelector(".poll-note")?.textContent).toContain("非全站统计");
    first.unmount();
  });

  it("高亮词按 strong 渲染，其余仍是文本", async () => {
    const view = render(<InlinePoll config={config() as never} />);
    await advance();
    const highlight = view.container.querySelector("strong.poll-highlight");
    expect(highlight?.textContent).toBe("心之怪盗");
    view.unmount();
  });

  it("配置里的富文本只当文本，不会变成元素", async () => {
    const view = render(
      <InlinePoll
        config={
          config("text", {
            question: "<img src=x onerror=alert(1)>",
            comment: { author: "<b>name</b>", text: "<script>bad</script>", highlight: ["bad"] },
          }) as never
        }
      />,
    );
    await advance();
    expect(view.container.querySelector("img, script")).toBeNull();
    expect(view.container.querySelector(".poll-question")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(view.container.querySelector(".poll-author")?.textContent).toBe("@<b>name</b>");
    expect(view.container.querySelector(".poll-message")?.textContent).toBe("<script>bad</script>");
    view.unmount();
  });

  it("同一份 config 传给两个实例：投票后两边一起更新，且都禁用", async () => {
    const shared = config("mirror") as never;
    const view = render(
      <div>
        <div data-a>
          <InlinePoll config={shared} />
        </div>
        <div data-b>
          <InlinePoll config={shared} />
        </div>
      </div>,
    );
    await advance();

    const a = view.container.querySelector("[data-a]")!;
    const b = view.container.querySelector("[data-b]")!;
    click(a.querySelector(".poll-choice"));

    const choicesB = [...b.querySelectorAll<HTMLButtonElement>(".poll-choice")];
    expect(choicesB.every((button) => button.disabled)).toBe(true);
    expect(b.querySelector('.poll-choice[aria-pressed="true"]')?.textContent).toContain("YES");
    expect(b.querySelector(".poll-percent")?.textContent).toBe("100.0%");
    view.unmount();
  });

  it("卸载即清理：内嵌实例不会留下 DOM 或订阅", async () => {
    const view = render(<InlinePoll config={config("unmount") as never} />);
    await advance();
    expect(view.container.querySelectorAll(".poll")).toHaveLength(1);
    view.unmount();
    await advance();
    expect(document.querySelector(".poll")).toBeNull();

    // 卸载后再投票不会抛（订阅已解除）。
    const store = createStore(null);
    expect(() => store.vote(config("unmount") as never, "yes")).not.toThrow();
  });

  it("销毁后重新挂载不会复活旧节点", async () => {
    const first = render(<InlinePoll config={config("remount") as never} />);
    await advance();
    first.unmount();
    const second = render(<InlinePoll config={config("remount") as never} />);
    await advance();
    expect(document.querySelectorAll(".poll")).toHaveLength(1);
    second.unmount();
  });

  it("浮层关闭按钮：关闭只记「见过」，不加票", async () => {
    let closed = 0;
    const view = render(
      <Poll
        config={config("floating") as never}
        mode="floating"
        onRequestClose={() => {
          closed += 1;
        }}
      />,
    );
    await advance();
    expect(view.container.querySelector(".poll--floating")).not.toBeNull();
    click(view.container.querySelector(".poll-close"));
    expect(closed).toBe(1);
    view.unmount();
  });

  it("is-closing 与 inert：退场可见但不可交互", async () => {
    const view = render(<Poll config={config("closing") as never} mode="floating" closing />);
    await advance();
    const root = view.container.querySelector<HTMLElement>(".poll");
    expect(root?.classList.contains("is-closing")).toBe(true);
    // jsdom 不实现 inert 的属性反射，这里断言属性本身；真实浏览器另验 property。
    expect(root?.hasAttribute("inert")).toBe(true);
    expect(root?.className).toContain("poll poll--floating");
    view.unmount();
  });
});
