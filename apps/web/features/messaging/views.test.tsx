/**
 * 视图组件的行为（T08）。
 *
 * 覆盖的都是「看起来对但会真出事」的点：
 *  - AI 消息必须带可辨识标记，且只在一次生成的第一条上出现；
 *  - 正文与卡片都是**纯文本渲染**，绝不执行任何 HTML；
 *  - 卡片一律用 `SiteLink`（不是裸 `<a>`、不是自己写 onClick 拦截）；
 *  - 输入超限时明确提示且不可发送；首次展开必须解释会发送什么给模型；
 *  - 角色列表**不显示虚构的在线状态**；
 *  - 手机视图遇到非法 item 不执行任意路径。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateScreen = vi.fn();
const openApp = vi.fn();
const toast = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/ins/messages",
  useSearchParams: () => new URLSearchParams(""),
}));

import { Composer } from "./composer";
import { CharacterList } from "./character-list";
import { ConversationView } from "./conversation-view";
import { MESSAGES_TAB, MessagesTabBody } from "./messages-tab";
import { MessagingPhoneView, MESSAGING_APP_SCREENS } from "./phone-view";
import { aiBadgeIndices, type Character, type ConversationView as View, type Limits } from "./types";
import type { ConversationController } from "./use-conversation";
import { InsShell } from "@/features/ins/ins-shell";
import { stubFetch, type FetchStub } from "@/features/ins/test-support";
import type { PhoneHost, PhoneViewProps } from "@/features/phone/types";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
  navigateScreen.mockClear();
  openApp.mockClear();
  toast.mockClear();
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

function host(): PhoneHost {
  return {
    openApp,
    navigateScreen,
    back: vi.fn(),
    close: vi.fn(),
    openSiteContent: vi.fn(),
    toast,
    audio: {
      isPlaying: () => false,
      play: () => undefined,
      pause: () => undefined,
      setVolume: () => undefined,
      getVolume: () => 0.5,
    },
    state: {
      get: (_appId, _key, fallback) => fallback,
      set: () => ({ persisted: true }),
      clear: () => undefined,
    },
  };
}

function phoneProps(overrides: Partial<PhoneViewProps> = {}): PhoneViewProps {
  return { screen: "messages", item: null, mode: "compact", host: host(), ...overrides };
}

const LIMITS: Limits = {
  input_max_codepoints: 1000,
  max_bubbles: 3,
  visitor_daily_requests: 20,
  site_daily_units: 2000,
  site_max_concurrency: 4,
  conversation_max_inflight: 1,
  visitor_session_idle_seconds: 86400,
  conversation_idle_seconds: 86400,
};

function viewPayload(overrides: Partial<View> = {}): View {
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
        attribution: "预设剧情（本站原创同人，不是游戏原文）",
      },
      {
        id: "m2",
        seq: 2,
        origin: "ai",
        text: "先看它现在怎么跑。",
        node_id: "intro",
        choice_id: null,
        cards: [],
        created_at: "2026-10-16T04:00:01Z",
        generation_request_id: "g1",
        is_ai: true,
        attribution: "AI 生成的同人回复",
      },
      {
        id: "m3",
        seq: 3,
        origin: "ai",
        text: "别急着改代码。",
        node_id: "intro",
        choice_id: null,
        cards: [],
        created_at: "2026-10-16T04:00:02Z",
        generation_request_id: "g1",
        is_ai: true,
        attribution: "AI 生成的同人回复",
      },
    ],
    ai: { status: "ok", message: "", provider: "simulator", retryable: false },
    usage: {
      requests_today: 1,
      daily_limit: 20,
      remaining: 19,
      site_settled_units: 1,
      site_daily_units: 2000,
      inflight: 0,
    },
    ...overrides,
  };
}

function controller(view: View | null, overrides: Partial<ConversationController> = {}): ConversationController {
  return {
    phase: view === null ? "missing" : "ready",
    view,
    session: null,
    error: null,
    notice: null,
    pending: "none",
    draft: "",
    setDraft: vi.fn(),
    canSend: true,
    description: "",
    send: vi.fn(),
    choose: vi.fn(),
    resume: vi.fn(),
    restart: vi.fn(),
    clear: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

describe("内容卡片与 AI 标记", () => {
  it("AI 气泡带可辨识标记，且一次生成只标记第一条", () => {
    const view = viewPayload();
    expect([...aiBadgeIndices(view.messages)]).toEqual([1]);
    const ui = render(
      <ConversationView
        controller={controller(view)}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/assets/legacy/img/portrait/futaba.png"
        avatarAlt="双叶头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );
    const badges = ui.container.querySelectorAll(".msg-ai-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toContain("AI");
    ui.unmount();
  });

  it("卡片用 SiteLink 渲染成站内链接，且不执行任何 HTML", () => {
    const view = viewPayload({
      messages: [
        {
          id: "m1",
          seq: 1,
          origin: "ai",
          text: "<b>加粗</b> 与 <script>alert(1)</script>",
          node_id: null,
          choice_id: null,
          cards: [
            {
              kind: "post",
              id: "hello",
              title: "<img src=x onerror=alert(1)>标题",
              summary: "摘要",
              url: "/posts/hello",
            },
          ],
          created_at: "2026-10-16T04:00:00Z",
          generation_request_id: "g1",
          is_ai: true,
          attribution: "AI 生成的同人回复",
        },
      ],
    });
    const ui = render(
      <ConversationView
        controller={controller(view)}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/a.png"
        avatarAlt="头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );

    // 正文按纯文本显示：标签变成可见字符，而不是被解析成节点
    const text = ui.container.querySelector(".msg-text");
    expect(text?.textContent).toContain("<b>加粗</b>");
    expect(ui.container.querySelector("script")).toBeNull();
    expect(ui.container.querySelector("b")).toBeNull();
    expect(ui.container.querySelector("img[src='x']")).toBeNull();

    const card = ui.container.querySelector("a.msg-card");
    expect(card?.getAttribute("href")).toBe("/posts/hello");
    // 卡片文字同样是纯文本
    expect(card?.querySelector(".msg-card-title")?.textContent).toBe(
      "<img src=x onerror=alert(1)>标题",
    );
    expect(card?.querySelector("img")).toBeNull();
    ui.unmount();
  });

  it("剧情暂停时显示「回到话题」，并且不显示任何预设选项", () => {
    const view = viewPayload({
      conversation: {
        ...viewPayload().conversation,
        status: "free",
        paused_node_id: "intro",
      },
      node: {
        id: "intro",
        ending: false,
        resumable: true,
        choices: [],
        resume_text: "哦，回来了。刚才那个问题还算数吗？",
      },
    });
    const local = controller(view);
    const ui = render(
      <ConversationView
        controller={local}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/a.png"
        avatarAlt="头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );
    expect(ui.container.querySelectorAll(".msg-choice")).toHaveLength(1);
    click(ui.container.querySelector(".msg-choice-resume"));
    expect(local.resume).toHaveBeenCalledTimes(1);
    expect(ui.container.textContent).toContain("剧情暂停");
    ui.unmount();
  });

  it("选择选项把 choice id 交给 controller，不在组件里拼请求", () => {
    const local = controller(viewPayload());
    const ui = render(
      <ConversationView
        controller={local}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/a.png"
        avatarAlt="头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );
    const choices = [...ui.container.querySelectorAll<HTMLButtonElement>(".msg-choice")];
    // 前导的「▶」是 CSS 伪元素，textContent 里不会出现
    expect(choices.map((item) => item.textContent)).toEqual(["看看博客作品", "聊聊 ACM"]);
    click(choices[1] ?? null);
    expect(local.choose).toHaveBeenCalledWith("talk-acm");
    ui.unmount();
  });

  it("剧情结束时关闭自由输入并说明原因", () => {
    const view = viewPayload({
      conversation: { ...viewPayload().conversation, status: "finished", can_send: false },
      node: { id: "wrap", ending: true, resumable: false, choices: [], resume_text: null },
    });
    const ui = render(
      <ConversationView
        controller={controller(view, { canSend: false })}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/a.png"
        avatarAlt="头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );
    expect(ui.container.querySelector(".msg-composer-disabled")).not.toBeNull();
    expect(ui.container.textContent).toContain("重新开始");
    expect(ui.container.querySelector("textarea")).toBeNull();
    ui.unmount();
  });

  it("降级提示原样显示，不隐藏也不替换成角色情绪", () => {
    const view = viewPayload({
      ai: {
        status: "visitor_daily_limit",
        message: "自由聊天今天已经用过 20 次，明天再来。预设剧情仍然可以继续。",
        provider: "simulator",
        retryable: false,
      },
    });
    const ui = render(
      <ConversationView
        controller={controller(view, {
          notice: { tone: "warn", text: view.ai.message },
        })}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/a.png"
        avatarAlt="头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );
    const notice = ui.container.querySelector('[data-testid="msg-notice"]');
    expect(notice?.textContent).toContain("预设剧情仍然可以继续");
    // 降级文案说的是服务，不是角色情绪
    for (const forbidden of ["不想", "生气", "离线", "下线"]) {
      expect(notice?.textContent).not.toContain(forbidden);
    }
    ui.unmount();
  });

  it("清除记录需要二次确认（不会一次点击就删掉聊天）", () => {
    const local = controller(viewPayload());
    const ui = render(
      <ConversationView
        controller={local}
        characterName="双叶"
        characterHandle="futaba_okumura"
        avatar="/a.png"
        avatarAlt="头像"
        storyVersion="1.0.0"
        limits={LIMITS}
      />,
    );
    const buttons = [...ui.container.querySelectorAll<HTMLButtonElement>(".msg-btn-quiet")];
    const clearButton = buttons.find((item) => item.textContent?.includes("清除"));
    click(clearButton ?? null);
    expect(local.clear).not.toHaveBeenCalled();
    expect(clearButton?.textContent).toContain("确认清除");
    click([...ui.container.querySelectorAll<HTMLButtonElement>(".msg-btn-quiet")].find((item) =>
      item.textContent?.includes("确认清除"),
    ) ?? null);
    expect(local.clear).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
});

describe("输入区", () => {
  it("默认只显示「自己说一句」，展开后才给输入框与说明", () => {
    const ui = render(
      <Composer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        canSend
        maxCodepoints={1000}
        sending={false}
      />,
    );
    expect(ui.container.querySelector("textarea")).toBeNull();
    const say = ui.container.querySelector(".msg-btn-say");
    click(say);
    expect(ui.container.querySelector("textarea")).not.toBeNull();
    expect(ui.container.textContent).toContain("会发送给模型服务");
    expect(ui.container.textContent).toContain("预设选项不会发送");
    ui.unmount();
  });

  it("按码点计数，超限时提示并禁用发送", () => {
    const ui = render(
      <Composer
        value={"字".repeat(21)}
        onChange={() => undefined}
        onSend={() => undefined}
        canSend
        maxCodepoints={20}
        sending={false}
      />,
    );
    click(ui.container.querySelector(".msg-btn-say"));
    const counter = ui.container.querySelector(".msg-counter");
    expect(counter?.textContent).toContain("21 / 20");
    expect(counter?.classList.contains("over")).toBe(true);
    const send = ui.container.querySelector<HTMLButtonElement>(".msg-btn-send");
    expect(send?.disabled).toBe(true);
    expect(ui.container.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    ui.unmount();
  });

  it("发送中禁用按钮，避免重复点击", () => {
    const ui = render(
      <Composer
        value="你好"
        onChange={() => undefined}
        onSend={() => undefined}
        canSend
        maxCodepoints={1000}
        sending
      />,
    );
    click(ui.container.querySelector(".msg-btn-say"));
    const send = ui.container.querySelector<HTMLButtonElement>(".msg-btn-send");
    expect(send?.disabled).toBe(true);
    expect(send?.textContent).toContain("发送中");
    ui.unmount();
  });

  it("Ctrl/Cmd + Enter 发送", () => {
    const onSend = vi.fn();
    const ui = render(
      <Composer
        value="你好"
        onChange={() => undefined}
        onSend={onSend}
        canSend
        maxCodepoints={1000}
        sending={false}
      />,
    );
    click(ui.container.querySelector(".msg-btn-say"));
    const textarea = ui.container.querySelector("textarea");
    textarea?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(onSend).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
});

describe("角色列表", () => {
  function character(overrides: Partial<Character> = {}): Character {
    return {
      id: "futaba",
      name: "双叶",
      handle: "futaba_okumura",
      tagline: "技术宅 · 项目与算法训练",
      avatar: "/assets/legacy/img/portrait/futaba.png",
      avatar_alt: "双叶的头像",
      story_id: "futaba-noise-and-signal",
      story_version: "1.0.0",
      conversation: null,
      ...overrides,
    };
  }

  it("不显示任何虚构的在线状态或最后在线时间", async () => {
    stub = stubFetch([
      { match: "/messaging/characters", body: [character()] },
    ]);
    const ui = render(<CharacterList />);
    await advance(20);
    const text = ui.container.textContent ?? "";
    expect(text).toContain("双叶");
    expect(text).not.toMatch(/在线|online|刚刚|分钟前|活跃/);
    expect(text).toContain("非官方同人");
    ui.unmount();
  });

  it("真实友链不混进角色列表", async () => {
    stub = stubFetch([
      {
        match: "/messaging/characters",
        body: [
          character(),
          character({
            id: "morgana",
            name: "摩尔加纳",
            handle: "mona_phantom",
            tagline: "向导 · 今天看什么",
            avatar: "/assets/legacy/img/portrait/mona.png",
            avatar_alt: "摩尔加纳的头像",
            story_id: "morgana-first-visit",
          }),
        ],
      },
    ]);
    const ui = render(<CharacterList />);
    await advance(20);
    const roles = [...ui.container.querySelectorAll("a.msg-role")];
    expect(roles).toHaveLength(2);
    // 一律是站内链接（SiteLink 渲染出的真实 href），不是按钮或 onclick
    expect(roles.map((item) => item.getAttribute("href"))).toEqual([
      "/apps/ins/messages/futaba",
      "/apps/ins/messages/morgana",
    ]);
    // 名单里没有任何真实朋友的入口（友链属 COOP / T07）
    for (const role of roles) {
      expect(role.getAttribute("href")).not.toContain("coop");
    }
    expect(ui.container.querySelectorAll("a.msg-role")).toHaveLength(2);
    ui.unmount();
  });

  it("读取失败时给出原因与重试，不伪装成空列表", async () => {
    stub = stubFetch([{ match: "/messaging/characters", status: 500, body: {} }]);
    const ui = render(<CharacterList />);
    await advance(20);
    expect(ui.container.textContent).toContain("读不到角色列表");
    expect(ui.container.querySelector(".msg-btn")).not.toBeNull();
    ui.unmount();
  });

  it("手机里点角色走宿主的 navigateScreen，不整页跳转", async () => {
    stub = stubFetch([{ match: "/messaging/characters", body: [character()] }]);
    const ui = render(<CharacterList linkSource="phone-internal" onOpen={(id) => navigateScreen("conversation", id)} />);
    await advance(20);
    expect(ui.container.querySelector("a.msg-role")).toBeNull();
    click(ui.container.querySelector("button.msg-role"));
    expect(navigateScreen).toHaveBeenCalledWith("conversation", "futaba");
    ui.unmount();
  });
});

describe("手机视图", () => {
  it("screens 只列本模块实现的屏幕", () => {
    expect([...MESSAGING_APP_SCREENS]).toEqual(["messages", "conversation"]);
  });

  it("非法 item 显示「没有这个角色」并且不做任何导航", () => {
    stub = stubFetch([{ match: "/messaging/characters", body: [] }]);
    const ui = render(<MessagingPhoneView {...phoneProps({ screen: "conversation", item: "../x" })} />);
    expect(ui.container.textContent).toContain("没有这个角色");
    expect(navigateScreen).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("列表屏读取角色目录，未调用任何音频接口", async () => {
    stub = stubFetch([{ match: "/messaging/characters", body: [] }]);
    const props = phoneProps();
    const ui = render(<MessagingPhoneView {...props} />);
    await advance(20);
    expect(ui.container.querySelector(".msg-phone-hint")).not.toBeNull();
    expect(props.host.audio.isPlaying).toBeTypeOf("function");
    ui.unmount();
  });
});

describe("INS 页签注入", () => {
  it("页签描述符合组合契约，且不与内置页签冲突", () => {
    expect(MESSAGES_TAB.id).toBe("messages");
    expect(MESSAGES_TAB.order).toBeGreaterThan(20);
    expect(MESSAGES_TAB.isAvailable?.()).toBe(true);
    expect(MESSAGES_TAB.ariaLabel).toContain("角色消息");
  });

  it("注入后消息页签出现并能渲染角色列表", async () => {
    stub = stubFetch([{ match: "/messaging/characters", body: [] }]);
    const ui = render(
      <InsShell renderFeed={() => <p>动态内容</p>} tabContributions={[MESSAGES_TAB]} />,
    );
    const tabs = [...ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["动态", "收藏", "消息"]);

    click(tabs.find((tab) => tab.textContent === "消息") ?? null);
    await advance(20);
    expect(ui.container.querySelector(".msg-role-list")).not.toBeNull();
    // 未接入时不该出现的「敬请期待」也不该因为接入而出现
    expect(ui.container.textContent).not.toContain("敬请期待");
    ui.unmount();
  });

  it("不注入时消息页签完全不出现（未接入就不显示坏按钮）", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const ui = render(<InsShell renderFeed={() => null} />);
    expect(ui.container.textContent).not.toContain("消息");
    ui.unmount();
  });

  it("MessagesTabBody 忽略动态页签的 tag（消息不按标签筛选）", () => {
    stub = stubFetch([{ match: "/messaging/characters", body: [] }]);
    const ui = render(<MessagesTabBody tag="校园" />);
    expect(ui.container.textContent).not.toContain("校园");
    ui.unmount();
  });
});
