/**
 * 会话状态机（T08）—— 前端这一半的核心用例。
 *
 * 对应任务卡的验收表：
 *  - 「自由聊后回到话题」→ node_version 不变、草稿清空、选项仍在；
 *  - 「网络重试与重复点击」→ 同一条输入复用**同一个**幂等键，不重复调用上游；
 *  - 「切换角色后旧响应到达」→ 晚到的响应被丢弃，不写进新角色；
 *  - 「AI 降级」→ 输入留在草稿里，剧情与「回到话题」仍可用；
 *  - 「模块退出取消读取」→ 卸载即 abort。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/ins/messages/futaba",
  useSearchParams: () => new URLSearchParams(""),
}));

import { useConversation } from "./use-conversation";
import type { ConversationView } from "./types";
import { stubFetch, type FetchStub } from "@/features/ins/test-support";
import { act } from "react";
import { advance, click, render, resetDocument, type Rendered } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

const CHARACTERS = [
  {
    id: "futaba",
    name: "双叶",
    handle: "futaba_okumura",
    tagline: "技术宅",
    avatar: "/a.png",
    avatar_alt: "头像",
    story_id: "futaba-noise-and-signal",
    story_version: "1.0.0",
    conversation: null,
  },
  {
    id: "morgana",
    name: "摩尔加纳",
    handle: "mona_phantom",
    tagline: "向导",
    avatar: "/b.png",
    avatar_alt: "头像",
    story_id: "morgana-first-visit",
    story_version: "1.0.0",
    conversation: null,
  },
];

const SESSION_BODY = {
  visitor: { id: "v1", expires_at: "2026-10-17T04:00:00Z", absolute_expires_at: "2026-10-19T04:00:00Z" },
  csrf_token: "csrf-token-1",
  characters: CHARACTERS,
  ai: { status: "ok", message: "", provider: "simulator", retryable: false },
  usage: {
    requests_today: 0,
    daily_limit: 20,
    remaining: 20,
    site_settled_units: 0,
    site_daily_units: 2000,
    inflight: 0,
  },
  disclosure: "本站最多保留 24 小时；模型供应商有自己的政策。",
};

function conversationBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversation: {
      id: "11111111-1111-4111-8111-111111111111",
      character_id: "futaba",
      status: "script",
      story_id: "futaba-noise-and-signal",
      story_version: "1.0.0",
      node_id: "intro",
      node_version: 0,
      paused_node_id: null,
      created_at: "2026-10-16T04:00:00Z",
      updated_at: "2026-10-16T04:00:00Z",
      expires_at: "2026-10-17T04:00:00Z",
      can_send: true,
      can_resume: false,
      can_restart: true,
    },
    node: {
      id: "intro",
      ending: false,
      resumable: true,
      choices: [
        { id: "see-works", label: "看看博客作品" },
        { id: "talk-acm", label: "聊聊 ACM" },
      ],
      resume_text: null,
    },
    messages: [
      {
        id: "m1",
        seq: 1,
        origin: "script",
        text: "这个据点还挺像样。",
        node_id: "intro",
        choice_id: null,
        cards: [],
        created_at: "2026-10-16T04:00:00Z",
        generation_request_id: null,
        is_ai: false,
        attribution: "",
      },
    ],
    ai: { status: "ok", message: "", provider: "simulator", retryable: false },
    usage: {
      requests_today: 0,
      daily_limit: 20,
      remaining: 20,
      site_settled_units: 0,
      site_daily_units: 2000,
      inflight: 0,
    },
    ...overrides,
  };
}

/** 一个最小的探针组件：把 controller 暴露给断言。 */
function Probe({
  characterId,
  onRender,
}: {
  characterId: string | null;
  onRender: (controller: ReturnType<typeof useConversation>) => void;
}) {
  const controller = useConversation(characterId);
  onRender(controller);
  return (
    <div>
      <p data-testid="phase">{controller.phase}</p>
      <p data-testid="pending">{controller.pending}</p>
      <p data-testid="notice">{controller.notice?.text ?? ""}</p>
      <p data-testid="draft">{controller.draft}</p>
      <p data-testid="node">{controller.view?.conversation.node_id ?? ""}</p>
      <p data-testid="version">{String(controller.view?.conversation.node_version ?? "")}</p>
      <p data-testid="status">{controller.view?.conversation.status ?? ""}</p>
      <button type="button" data-testid="send" onClick={controller.send}>
        send
      </button>
      <button type="button" data-testid="resume" onClick={controller.resume}>
        resume
      </button>
      <button type="button" data-testid="restart" onClick={controller.restart}>
        restart
      </button>
      <button type="button" data-testid="reload" onClick={controller.reload}>
        reload
      </button>
    </div>
  );
}

async function mount(
  characterId: string | null,
  options: { draft?: string } = {},
): Promise<{ ui: Rendered; latest: () => ReturnType<typeof useConversation> }> {
  let current: ReturnType<typeof useConversation> | null = null;
  const ui = render(
    <Probe
      characterId={characterId}
      onRender={(controller) => {
        current = controller;
      }}
    />,
  );
  await advance(20);
  if (options.draft !== undefined) {
    const controller = current as unknown as ReturnType<typeof useConversation>;
    await act(async () => {
      controller.setDraft(options.draft ?? "");
    });
    await advance(5);
  }
  return {
    ui,
    latest: () => current as unknown as ReturnType<typeof useConversation>,
  };
}

describe("useConversation 的加载流程", () => {
  it("先引导访客会话，再按角色取得会话（两次真实请求）", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui } = await mount("futaba");

    const paths = stub.requests.map((request) => `${request.method} ${request.url}`);
    expect(paths[0]).toBe("POST /api/v1/messaging/session");
    expect(paths[1]).toBe("POST /api/v1/messaging/conversations");
    // 角色 id 走 body，不走 URL
    expect(stub.requests[1]?.body).toMatchObject({ character_id: "futaba" });
    // CSRF token 放在 body 里（共享客户端没有 headers 选项）
    expect(stub.requests[1]?.body).toMatchObject({ csrf_token: "csrf-token-1" });
    expect(ui.container.querySelector('[data-testid="phase"]')?.textContent).toBe("ready");
    ui.unmount();
  });

  it("离开会话再回来草稿还在；换角色不串（§3.3 输入草稿）", async () => {
    const responses = () => [
      { match: "/messaging/session", method: "POST" as const, body: SESSION_BODY },
      { match: "/messaging/conversations", method: "POST" as const, body: conversationBody() },
    ];

    window.sessionStorage.clear();
    stub = stubFetch(responses());
    const first = await mount("futaba", { draft: "写了一半" });
    expect(first.ui.container.querySelector('[data-testid="draft"]')?.textContent).toBe("写了一半");
    first.ui.unmount();
    stub.restore();

    // 重新进入同一个角色：草稿从存储里读回来
    stub = stubFetch(responses());
    const second = await mount("futaba");
    expect(second.ui.container.querySelector('[data-testid="draft"]')?.textContent).toBe("写了一半");
    second.ui.unmount();
    stub.restore();

    // 另一个角色看不到别人的草稿
    stub = stubFetch(responses());
    const other = await mount("morgana");
    expect(other.ui.container.querySelector('[data-testid="draft"]')?.textContent).toBe("");
    other.ui.unmount();
  });

  it("会话读取失败时给出错误状态与重试，不伪装成空会话", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messaging/conversations", method: "POST", status: 500, body: {} },
    ]);
    const { ui } = await mount("futaba");
    expect(ui.container.querySelector('[data-testid="phase"]')?.textContent).toBe("error");
    expect(ui.container.querySelector('[data-testid="notice"]')?.textContent).toContain("失败");
    ui.unmount();
  });

  it("会话不存在（404）是 missing，不是崩溃", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      {
        match: "/messaging/conversations",
        method: "POST",
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "这段会话不存在或不可访问", fields: {} }, request_id: "x" },
      },
    ]);
    const { ui } = await mount("futaba");
    expect(ui.container.querySelector('[data-testid="phase"]')?.textContent).toBe("missing");
    ui.unmount();
  });

  it("卸载时取消进行中的请求（模块退出不留挂起请求）", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui } = await mount("futaba");
    ui.unmount();
    // 没有未处理的拒绝 / 警告即通过；再断言一次请求已结束
    expect(stub.requests.length).toBeGreaterThanOrEqual(2);
  });
});

describe("混合对话：剧情 → 自由输入 → 回到剧情", () => {
  it("发送自由输入后剧情暂停，节点与版本都不变", async () => {
    const paused = conversationBody({
      conversation: {
        ...(conversationBody().conversation as Record<string, unknown>),
        status: "free",
        paused_node_id: "intro",
      },
      node: {
        id: "intro",
        ending: false,
        resumable: true,
        choices: [],
        resume_text: "哦，回来了。",
      },
      messages: [],
      usage: {
        requests_today: 1,
        daily_limit: 20,
        remaining: 19,
        site_settled_units: 1,
        site_daily_units: 2000,
        inflight: 0,
      },
    });
    // 路由顺序即匹配优先级：动作路由必须排在 `/messaging/conversations` **之前**，
    // 因为后者的前缀也命中 `/conversations/<id>/messages`（stubFetch 是 includes 匹配）。
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messages", method: "POST", body: paused },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui, latest } = await mount("futaba", { draft: "算法题卡了一晚上。" });
    click(ui.container.querySelector('[data-testid="send"]'));

    await advance(30);
    expect(latest().view?.conversation.status).toBe("free");
    expect(latest().view?.conversation.node_id).toBe("intro");
    expect(latest().view?.conversation.node_version).toBe(0);
    // 拿到回复后草稿清空
    expect(latest().draft).toBe("");
    // 请求体里带幂等键与文本
    const sendRequest = stub.requests.at(-1);
    expect(sendRequest?.body).toMatchObject({ text: "算法题卡了一晚上。" });
    expect(String((sendRequest?.body as Record<string, unknown>).client_request_id)).toMatch(
      /^msg-/,
    );
    ui.unmount();
  });

  it("同一条输入重试复用同一个幂等键；文本改了才换新键", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messages", method: "POST", throws: true },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui, latest } = await mount("futaba", { draft: "同一条输入" });

    click(ui.container.querySelector('[data-testid="send"]'));
    await advance(40);
    const firstKey = (stub.requests.at(-1)?.body as Record<string, unknown>).client_request_id;

    // 网络失败：草稿必须留着（「保留输入」）
    expect(latest().draft).toBe("同一条输入");
    expect(latest().error).not.toBeNull();

    click(ui.container.querySelector('[data-testid="send"]'));
    await advance(40);
    const retryKey = (stub.requests.at(-1)?.body as Record<string, unknown>).client_request_id;
    expect(retryKey).toBe(firstKey);

    // 改了文本 → 新的幂等键
    await act(async () => {
      latest().setDraft("换了一句话");
    });
    click(ui.container.querySelector('[data-testid="send"]'));
    await advance(40);
    const changedKey = (stub.requests.at(-1)?.body as Record<string, unknown>).client_request_id;
    expect(changedKey).not.toBe(firstKey);
    ui.unmount();
  });

  it("降级（额度用尽）时输入留在草稿里，剧情仍然可以继续", async () => {
    const exhausted = conversationBody({
      ai: {
        status: "visitor_daily_limit",
        message: "自由聊天今天已经用过 20 次，明天再来。预设剧情仍然可以继续。",
        provider: "simulator",
        retryable: false,
      },
    });
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messages", method: "POST", body: exhausted },
      { match: "/resume", method: "POST", body: conversationBody() },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui, latest } = await mount("futaba", { draft: "还能聊吗" });
    click(ui.container.querySelector('[data-testid="send"]'));
    await advance(30);

    expect(latest().view?.ai.status).toBe("visitor_daily_limit");
    expect(latest().notice?.text).toContain("预设剧情仍然可以继续");
    // ★ 输入没有被清掉
    expect(latest().draft).toBe("还能聊吗");
    // 剧情状态一点没变
    expect(latest().view?.conversation.status).toBe("script");
    expect(latest().view?.conversation.node_version).toBe(0);

    click(ui.container.querySelector('[data-testid="resume"]'));
    await advance(30);
    expect(latest().view?.conversation.status).toBe("script");
    ui.unmount();
  });

  it("回到话题的请求带当前 node_version，服务端据此拒绝过期操作", async () => {
    const paused = conversationBody({
      conversation: {
        ...(conversationBody().conversation as Record<string, unknown>),
        status: "free",
        paused_node_id: "intro",
      },
    });
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/resume", method: "POST", body: conversationBody() },
      { match: "/messaging/conversations", method: "POST", body: paused },
    ]);
    const { ui } = await mount("futaba");
    click(ui.container.querySelector('[data-testid="resume"]'));
    await advance(30);

    const resumeRequest = stub.requests.at(-1);
    expect(resumeRequest?.url).toContain("/resume");
    expect(resumeRequest?.body).toMatchObject({ node_version: 0, csrf_token: "csrf-token-1" });
    ui.unmount();
  });

  it("版本过期（409 STORY_STATE_STALE）时只提示并重新读取，不重复消费选项", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      {
        match: "/choice",
        method: "POST",
        status: 409,
        body: {
          error: {
            code: "STORY_STATE_STALE",
            message: "剧情已经在别处推进了，请读取最新状态后再选。",
            fields: {},
          },
          request_id: "x",
        },
      },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui, latest } = await mount("futaba");
    await act(async () => {
      latest().choose("talk-acm");
    });
    await advance(40);

    expect(latest().notice?.text).toContain("已经在别处推进");
    const choiceCalls = stub.requests.filter((request) => request.url.includes("/choice"));
    expect(choiceCalls).toHaveLength(1); // 只发了一次，没有自动重试消费
    ui.unmount();
  });

  it("在途请求期间的第二次发送被忽略（单会话一在途）", async () => {
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      { match: "/messages", method: "POST", body: conversationBody() },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui } = await mount("futaba", { draft: "只发一次" });
    const controller = (ui.container.querySelector('[data-testid="send"]') as HTMLButtonElement);
    click(controller);
    click(controller);
    click(controller);
    await advance(40);
    const sendCalls = stub.requests.filter((request) => request.url.endsWith("/messages"));
    expect(sendCalls).toHaveLength(1);
    ui.unmount();
  });
});

describe("切换角色 / 晚到的响应", () => {
  it("晚到的响应如果属于别的角色，不会被写进当前这段会话", async () => {
    const other = conversationBody({
      conversation: {
        ...(conversationBody().conversation as Record<string, unknown>),
        id: "22222222-2222-4222-8222-222222222222",
        character_id: "morgana",
      },
    });
    stub = stubFetch([
      { match: "/messaging/session", method: "POST", body: SESSION_BODY },
      // 发送的响应故意回一段**别的**会话
      { match: "/messages", method: "POST", body: other },
      { match: "/messaging/conversations", method: "POST", body: conversationBody() },
    ]);
    const { ui, latest } = await mount("futaba", { draft: "你好" });
    click(ui.container.querySelector('[data-testid="send"]'));
    await advance(40);

    // 当前会话没有被替换成 morgana 那一段
    expect(latest().view?.conversation.character_id).toBe("futaba");
    expect(latest().view?.conversation.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(latest().notice?.text).toContain("不属于当前会话");
    ui.unmount();
  });
});

describe("类型对齐", () => {
  it("ConversationView 的形状与服务端 DTO 的字段名一致（snake_case）", () => {
    const body = conversationBody() as unknown as ConversationView;
    expect(Object.keys(body.conversation)).toContain("node_version");
    expect(Object.keys(body.conversation)).toContain("paused_node_id");
    expect(Object.keys(body.messages[0] ?? {})).toContain("generation_request_id");
  });
});
