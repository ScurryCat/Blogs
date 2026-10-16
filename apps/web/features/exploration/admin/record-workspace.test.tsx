/**
 * 问题记录编辑器（T09 · 印象空间；07 §6、验收 3）。
 *
 * 关键断言：
 *  - **工作状态与发布状态是两个独立控件**，界面上写清「改成已解决不会自动发布」；
 *  - 工作状态选「已解决」而结果为空时给出**服务端会拒绝**的提示（而不是静默）；
 *  - 保存带 `If-Match` 与 CSRF；
 *  - 412 时保留未保存的输入。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { RecordWorkspace } from "../admin/record-workspace";
import { makeApiRecord, stubFetch, type FetchStub } from "../test-support";

let stub: FetchStub | null = null;

const CSRF = "csrf-token-for-tests";

/**
 * 记录 ID 从**夹具本身**取，不手写一个「看起来像 UUID」的常量。
 *
 * 真实踩到过：手写的 ID 与 `makeApiRecord` 从 slug 派生的 ID 不一致（后者被截到
 * 36 字符），结果 GET 命中了替身、PATCH 没命中，测试报出的是「界面没显示冲突」——
 * 与真正要验证的 412 处理毫无关系。
 */
const RECORD_ID = String(
  (makeApiRecord() as { id: string }).id ?? "",
);

/**
 * 与后端 `RecordAdminOut` 同形。
 *
 * overrides 交给 `makeApiRecord` 一起派生依赖字段（`work_status_label` /
 * `resolved_at`）—— 先算再被覆盖会得到「状态是调查中、标签写着待探索」的假夹具。
 */
function adminRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeApiRecord({
    background: "过渡遮罩结束后指针事件没有恢复。",
    attempts: "检查了遮罩卸载时机。",
    outcome: "",
    evidence_links: [],
    status: "draft",
    published_at: null,
    created_at: "2026-10-16T04:00:00Z",
    updated_at: "2026-10-16T04:00:00Z",
    version: 2,
    posts: [],
    projects: [],
    ...overrides,
  });
}

function setValue(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("RecordWorkspace", () => {
  it("属性面板把发布状态与工作状态分开显示", async () => {
    stub = stubFetch([
      {
        match: new RegExp(`/admin/exploration/records/${RECORD_ID}$`),
        body: adminRecord({ status: "published", work_status: "investigating" }),
      },
    ]);
    const { container, unmount } = render(
      <RecordWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        recordId={RECORD_ID}
      />,
    );
    await advance(60);
    const meta = container.querySelector(".pme-card-meta")?.textContent ?? "";
    expect(meta).toContain("发布状态：已发布");
    expect(meta).toContain("工作状态：调查中");
    unmount();
  });

  it("明确写出「改成已解决不会自动发布」", async () => {
    stub = stubFetch([
      { match: new RegExp(`/admin/exploration/records/${RECORD_ID}$`), body: adminRecord() },
    ]);
    const { container, unmount } = render(
      <RecordWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        recordId={RECORD_ID}
      />,
    );
    await advance(60);
    expect(container.textContent).toContain("不会自动发布这条记录");
    expect(container.textContent).toContain("发布也不会改变工作状态");
    unmount();
  });

  it("工作状态选「已解决」而结果为空时提示会被服务端拒绝", async () => {
    stub = stubFetch([
      { match: new RegExp(`/admin/exploration/records/${RECORD_ID}$`), body: adminRecord() },
    ]);
    const { container, unmount } = render(
      <RecordWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        recordId={RECORD_ID}
      />,
    );
    await advance(60);
    setValue(container, "[data-record-work-status]", "resolved");
    await advance(10);

    const blocked = container.querySelector("[data-record-outcome-blocked]");
    expect(blocked).not.toBeNull();
    expect(blocked?.textContent).toContain("会被服务端拒绝");
    expect(blocked?.textContent).toContain("必须有实际说明");

    // 补上结果说明后提示消失。
    setValue(container, "[data-record-outcome]", "根因是遮罩卸载晚于指针事件恢复。");
    await advance(10);
    expect(container.querySelector("[data-record-outcome-blocked]")).toBeNull();
    unmount();
  });

  it("保存带 If-Match、CSRF 与完整的工作状态", async () => {
    stub = stubFetch([
      {
        match: `/api/v1/admin/exploration/records/${RECORD_ID}`,
        method: "PATCH",
        body: adminRecord({ version: 3 }),
      },
      { match: new RegExp(`/admin/exploration/records/${RECORD_ID}$`), body: adminRecord() },
    ]);
    const { container, unmount } = render(
      <RecordWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        recordId={RECORD_ID}
      />,
    );
    await advance(60);
    setValue(container, "[data-record-outcome]", "根因找到了。");
    setValue(container, "[data-record-work-status]", "resolved");
    await advance(10);
    click(container.querySelector("[data-record-save]"));
    await advance(60);

    const patch = stub?.requests.find((request) => request.method === "PATCH");
    expect(patch?.headers["if-match"]).toBe('"2"');
    const body = patch?.body as Record<string, unknown>;
    expect(body?.csrf_token).toBe(CSRF);
    expect(body?.work_status).toBe("resolved");
    expect(body?.outcome).toBe("根因找到了。");
    // 发布状态**不在**保存请求里：它是独立动作（发布 / 撤回按钮）。
    expect(body?.status).toBeUndefined();
    unmount();
  });

  it("412 时保留未保存的输入", async () => {
    stub = stubFetch([
      {
        match: `/api/v1/admin/exploration/records/${RECORD_ID}`,
        method: "PATCH",
        status: 412,
        body: {
          error: { code: "VERSION_CONFLICT", message: "版本冲突", fields: {} },
          request_id: "stub",
        },
      },
      { match: new RegExp(`/admin/exploration/records/${RECORD_ID}$`), body: adminRecord() },
    ]);
    const { container, unmount } = render(
      <RecordWorkspace
        csrfToken={CSRF}
        describeError={(error) =>
          (error as { status?: number }).status === 412 ? "内容已在别处更新（版本冲突）。" : "失败"
        }
        isConflict={(error) => (error as { status?: number }).status === 412}
        createMode={false}
        recordId={RECORD_ID}
      />,
    );
    await advance(60);
    setValue(container, "[data-record-outcome]", "我改到一半的结果");
    await advance(10);
    click(container.querySelector("[data-record-save]"));
    await advance(60);

    // 先确认请求真的发出去了，再断言界面（失败时能立刻区分「没发」与「发了但没渲染」）。
    const sent = stub?.requests.map((request) => `${request.method} ${request.url}`) ?? [];
    expect(sent.some((entry) => entry.startsWith("PATCH"))).toBe(true);
    expect(container.querySelector("[data-record-notice]")?.textContent ?? "").toContain("版本冲突");
    expect(container.querySelector("[data-record-conflict]")).not.toBeNull();
    const outcome = container.querySelector("[data-record-outcome]") as HTMLTextAreaElement | null;
    expect(outcome?.value).toBe("我改到一半的结果");
    unmount();
  });

  it("管理端能看到关联的草稿内容并如实标注", async () => {
    stub = stubFetch([
      {
        match: `/api/v1/admin/exploration/records/${RECORD_ID}`,
        body: adminRecord({
          posts: [
            { post_id: "aaaa", slug: "draft-post", title: "还没写完的文章", status: "draft", position: 0 },
          ],
        }),
      },
    ]);
    const { container, unmount } = render(
      <RecordWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        recordId={RECORD_ID}
      />,
    );
    await advance(60);
    // 管理表单里回显的是 UUID，标题由管理列表展示（这里断言 UUID 确实被填进去了）。
    const field = container.querySelector("[data-record-post]") as HTMLInputElement | null;
    expect(field?.value).toBe("aaaa");
    unmount();
  });
});
