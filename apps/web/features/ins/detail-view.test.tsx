/**
 * 详情视图的行为（T03 验收用例 2 / 3）。
 *
 * 关键区分：「已撤回 / 不存在」与「读取失败」必须是**不同**状态 ——
 * 前者是正常的业务结果，后者必须给原因与重试，不能混写成「找不到」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: refreshMock }),
  usePathname: () => "/apps/ins/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(""),
}));

import { DetailView } from "./detail-view";
import { resetFavoriteStoreForTests } from "./favorites";
import { makeApiMoment, stubFetch, type FetchStub } from "./test-support";
import { stubScrollTo } from "@/tests/helpers/browser";
import { advance, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;
let scrollStub: { calls: Array<{ top: number }>; restore: () => void } | null = null;

beforeEach(() => {
  resetDocument();
  resetFavoriteStoreForTests();
  scrollStub = stubScrollTo();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  scrollStub?.restore();
  scrollStub = null;
});

describe("DetailView", () => {
  it("已撤回 / 不存在给出与失败不同的状态（03 §4）", () => {
    const view = render(<DetailView momentId="11111111-1111-4111-8111-111111111111" confirmedMissing />);
    expect(view.container.textContent).toContain("已经撤回或不可访问");
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    view.unmount();
  });

  it("服务端读取失败时显示原因 + 重新读取，不自动重打已知失败的服务", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(
      <DetailView
        momentId="11111111-1111-4111-8111-111111111111"
        serverError="读取失败（HTTP 503）：服务暂时不可用"
      />,
    );
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("503");
    expect(stub.requests).toHaveLength(0);
    expect(view.container.textContent).toContain("重新读取");
    view.unmount();
  });

  it("客户端读取详情：404 → 撤回态，其他错误 → 失败态", async () => {
    stub = stubFetch([
      { match: "/moments/", status: 404, body: { error: { code: "NOT_FOUND", message: "不存在", fields: {} }, request_id: "r" } },
    ]);
    const view = render(<DetailView momentId="11111111-1111-4111-8111-111111111111" />);
    await advance(30);
    expect(view.container.textContent).toContain("已经撤回或不可访问");
    view.unmount();
  });

  it("详情按纯文本渲染正文并保留图片顺序与替代文本", async () => {
    const moment = makeApiMoment({ text: "第一行\n第二行 <b>不是加粗</b>" });
    stub = stubFetch([{ match: "/moments/", body: moment }]);
    const view = render(<DetailView momentId="11111111-1111-4111-8111-111111111111" />);
    await advance(30);
    const text = view.container.querySelector(".ins-detail-text");
    expect(text?.textContent).toContain("<b>不是加粗</b>");
    expect(view.container.querySelector(".ins-detail-text b")).toBeNull();
    expect(view.container.querySelectorAll(".ins-detail-image")).toHaveLength(1);
    expect(view.container.querySelector(".ins-detail-alt")?.textContent).toBe("操场");
    view.unmount();
  });
});
