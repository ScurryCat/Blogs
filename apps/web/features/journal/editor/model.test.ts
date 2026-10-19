/**
 * 手记编辑页纯逻辑（P5 · C4）。
 *
 * 钉住设计书 §2.4 与契约 §3.3 / §4.5 里最容易写错、也最容易被「实现方便」带偏的规则：
 *  - 日期默认 = 站点时区今天；`?date=` 合法才采用；
 *  - 新建/草稿 → save / publish 两个动作；**已公开 → 只有 update**；
 *  - 「保存」的文案绝不暗示已公开；
 *  - 发布门槛与后端一致（标题 + 正文），本地提前列出阻塞原因；
 *  - 幂等回放不冒充「又保存了一次」。
 */

import { describe, expect, it, vi } from "vitest";
import {
  ACTION_LABELS,
  CONTENT_MAX_CODEPOINTS,
  allowedActionsFor,
  describeCommitSuccess,
  emptyForm,
  expectedTargetVersion,
  formFromData,
  formFromEntry,
  initialDateHint,
  localToday,
  newCommitKey,
  postOptionsWithCurrent,
  publishedEditHint,
  publishBlockersFor,
  resolveInitialDate,
  statusLine,
  targetState,
  toDraftData,
  validateEditorForm,
} from "./model";
import type { JournalAdminEntry } from "../types";

function entry(overrides: Partial<JournalAdminEntry> = {}): JournalAdminEntry {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    entry_date: "2026-10-09",
    title: "公开的一天",
    content_md: "正文。",
    mood: "平静",
    location: "四轩茶屋",
    status: "draft",
    visibility: "private",
    post: null,
    images: [],
    published_at: null,
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    deleted_at: null,
    version: 3,
    public: false,
    shared_media: [],
    ...overrides,
  };
}

describe("日期默认值与 ?date=", () => {
  it("没有 ?date= 时默认站点时区今天（API 给的 today）", () => {
    expect(resolveInitialDate(null, "2026-10-18")).toBe("2026-10-18");
    expect(resolveInitialDate(undefined, "2026-10-18")).toBe("2026-10-18");
  });

  it("?date= 合法时使用日历选中的那一天", () => {
    expect(resolveInitialDate("2026-10-05", "2026-10-18")).toBe("2026-10-05");
  });

  it("?date= 非法（格式/不存在的日期）时回退到今天，不抛错", () => {
    expect(resolveInitialDate("2026-13-01", "2026-10-18")).toBe("2026-10-18");
    expect(resolveInitialDate("2026-02-30", "2026-10-18")).toBe("2026-10-18");
    expect(resolveInitialDate("../../etc/passwd", "2026-10-18")).toBe("2026-10-18");
  });

  it("站点时区的 today 也取不到时才用本机今天", () => {
    const now = new Date(2026, 9, 18, 23, 30);
    expect(resolveInitialDate(null, null, now)).toBe("2026-10-18");
    expect(resolveInitialDate("bad", "bad", now)).toBe("2026-10-18");
    expect(localToday(now)).toBe("2026-10-18");
  });

  it("给用户的日期说明如实区分三种来源", () => {
    expect(initialDateHint("2026-10-05", "2026-10-05", "2026-10-18")).toContain("日历");
    expect(initialDateHint("bad", "2026-10-18", "2026-10-18")).toContain("不是有效日期");
    expect(initialDateHint(null, "2026-10-18", "2026-10-18")).toContain("站点时区");
    expect(initialDateHint(null, "2026-10-18", null)).toContain("本机今天");
  });
});

describe("表单 ↔ 工作草稿数据", () => {
  it("编辑已有内容时如实带出字段与关联文章", () => {
    const form = formFromEntry(
      entry({
        post: {
          id: "22222222-2222-2222-2222-222222222222",
          slug: "hello",
          title: "长文",
          status: "published",
          public: true,
        },
      }),
    );
    expect(form.entry_date).toBe("2026-10-09");
    expect(form.post_id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("工作草稿 data 回填：缺失键回退、null 表示明确不关联", () => {
    const fallback = formFromEntry(entry());
    const restored = formFromData(
      { title: "改过的标题", content_md: "草稿正文", post_id: null },
      fallback,
    );
    expect(restored.title).toBe("改过的标题");
    expect(restored.content_md).toBe("草稿正文");
    expect(restored.post_id).toBeNull(); // 明确取消关联
    expect(restored.entry_date).toBe(fallback.entry_date); // 缺失 → 回退
    expect(restored.mood).toBe(fallback.mood);
  });

  it("toDraftData 用契约 §3.3 的 journal data 键", () => {
    const data = toDraftData({ ...emptyForm("2026-10-18"), title: "标题" });
    expect(Object.keys(data).sort()).toEqual(
      ["content_md", "entry_date", "location", "mood", "post_id", "title"].sort(),
    );
    expect(data.entry_date).toBe("2026-10-18");
    expect(data.post_id).toBeNull();
  });
});

describe("校验与发布门槛", () => {
  it("内容超长按码点计数报错（与后端同一上限）", () => {
    const form = { ...emptyForm("2026-10-18"), content_md: "字".repeat(CONTENT_MAX_CODEPOINTS + 1) };
    expect(validateEditorForm(form).content_md).toContain("20000");
  });

  it("发布门槛与后端一致：缺标题 / 缺正文明说", () => {
    const blank = emptyForm("2026-10-18");
    expect(publishBlockersFor(blank)).toEqual(["还没有标题", "还没有正文"]);
    expect(
      publishBlockersFor({ ...blank, title: "标题", content_md: "正文" }),
    ).toEqual([]);
  });
});

describe("提交动作语义（保存 ≠ 公开）", () => {
  it("新建与正式草稿都允许 save / publish", () => {
    expect(targetState(null)).toBe("new");
    expect(allowedActionsFor(null)).toEqual(["save", "publish"]);
    expect(allowedActionsFor(entry({ status: "draft" }))).toEqual(["save", "publish"]);
  });

  it("已公开内容只有 update（必须以「更新正式内容」提交）", () => {
    const published = entry({ status: "published", visibility: "public", public: true });
    expect(targetState(published)).toBe("published");
    expect(allowedActionsFor(published)).toEqual(["update"]);
    // 按钮文案必须显式说明这是「更新正式内容」
    expect(ACTION_LABELS.update).toContain("更新正式内容");
    expect(ACTION_LABELS.save).toBe("保存草稿");
    expect(ACTION_LABELS.publish).toBe("公开这篇");
  });

  it("提交带上打开时的正式版本；新建为空", () => {
    expect(expectedTargetVersion(null)).toBeNull();
    expect(expectedTargetVersion(entry({ version: 7 }))).toBe(7);
  });

  it("已公开手记有「更新前访客看原版本」的提示；草稿没有", () => {
    expect(publishedEditHint(entry({ status: "published", visibility: "public" }))).toContain(
      "访客看到的仍是原版本",
    );
    expect(publishedEditHint(entry({ status: "draft" }))).toBeNull();
    expect(publishedEditHint(null)).toBeNull();
  });

  it("状态辅助信息区分草稿/已发布与公开/私密，并带正式版本", () => {
    expect(statusLine(null, false)).toContain("仅自己可见");
    expect(statusLine(entry({ status: "draft", version: 4 }), true)).toContain("草稿");
    expect(
      statusLine(entry({ status: "published", visibility: "public", version: 5 }), false),
    ).toContain("已发布 · 公开 · 正式版本 5");
  });
});

describe("提交结果文案（不伪造成功）", () => {
  it("save 永远不暗示已公开（私密）", () => {
    const message = describeCommitSuccess({
      action: "save",
      status: "draft",
      visibility: "private",
      target_version: 1,
      target_id: "e1",
    });
    expect(message).toContain("草稿");
    expect(message).toContain("仅自己可见");
    expect(message).toContain("要公开请单独点「公开这篇」");
    expect(message).not.toContain("访客现在可以看到");
  });

  it("publish / update 说明访客现在看到什么", () => {
    expect(
      describeCommitSuccess({
        action: "publish",
        status: "published",
        visibility: "public",
        target_version: 2,
        target_id: "e1",
      }),
    ).toContain("访客现在可以看到这一篇");
    expect(
      describeCommitSuccess({
        action: "update",
        status: "published",
        visibility: "public",
        target_version: 6,
        target_id: "e1",
      }),
    ).toContain("访客现在看到的是新版本");
  });

  it("幂等回放如实说明是之前的成功，不假装又保存一次", () => {
    const message = describeCommitSuccess({
      action: "save",
      status: "draft",
      visibility: "private",
      target_version: 3,
      target_id: "e1",
      idempotent_replay: true,
    });
    expect(message).toContain("幂等回放");
    expect(message).toContain("之前已经成功");
  });
});

describe("关联文章与幂等键", () => {
  it("当前已关联的文章即使不在公开列表里也保留为可选项", () => {
    const options = postOptionsWithCurrent(
      [{ id: "p2", title: "列表里的文章", slug: "p2" }],
      { id: "p1", title: "很旧的文章", slug: "p1" },
    );
    expect(options[0]).toEqual({ id: "p1", label: "很旧的文章（当前关联）" });
    expect(options.map((option) => option.id)).toEqual(["p1", "p2"]);
  });

  it("commit_key 每次重新生成、不重复，且是服务端可接受的 UUID", () => {
    const first = newCommitKey();
    const second = newCommitKey();
    expect(first).not.toBe(second);
    // 非安全上下文（HTTP 公网 IP）没有 crypto.randomUUID 时也必须是合法 UUID。
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("没有 crypto.randomUUID 时 commit_key 仍是合法 UUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 53 + 7) % 256;
        return bytes;
      },
    });
    try {
      expect(newCommitKey()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
