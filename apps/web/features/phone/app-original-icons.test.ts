/**
 * 已审核原版手机桌面图标（交接验收 F2 返工）。
 *
 * 断言：
 *  - 只有 metanav / ins 走原版图标；其余 app 保持适配设计回退（不冒充原版）；
 *  - 图标是仓库内本地静态文件，存在且哈希与素材清单记录一致（来源可追溯）；
 *  - 文件是真 PNG（防止误存 HTML 错误页）。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ORIGINAL_APP_ICONS, originalAppIcon } from "./app-original-icons";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

/** 与 docs/design-references/persona-assets-manifest.csv 一致（改动图标必须同步清单）。 */
const PINNED_SHA256: Record<string, string> = {
  "/assets/legacy/img/app/original/metanav-original.png":
    "549fff0cd0cc744922eb944c345e914536f5a46560c5e9abd501eb0518d88ea0",
  "/assets/legacy/img/app/original/ins-original.png":
    "5ca013fc1233e803988bd377678ffd26dc61cad9519886ade5b1250b50f2801f",
};

describe("已审核原版 App 图标", () => {
  it("只接入 metanav（异世界导航红眼）与 ins（原版消息标识）", () => {
    expect(Object.keys(ORIGINAL_APP_ICONS).sort()).toEqual(["ins", "metanav"]);
    expect(originalAppIcon("metanav")).toBe("/assets/legacy/img/app/original/metanav-original.png");
    expect(originalAppIcon("ins")).toBe("/assets/legacy/img/app/original/ins-original.png");
    expect(originalAppIcon("journal")).toBeUndefined();
    expect(originalAppIcon("__missing__")).toBeUndefined();
  });

  it("图标文件存在、是真 PNG，哈希与素材清单一致", () => {
    for (const [publicPath, expected] of Object.entries(PINNED_SHA256)) {
      const file = path.join(PUBLIC_DIR, publicPath.replace(/^\//, ""));
      expect(existsSync(file), `缺少图标文件：${file}`).toBe(true);
      const bytes = readFileSync(file);
      // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
      expect(ORIGINAL_APP_ICONS[publicPath.includes("/ins-") ? "ins" : "metanav"]).toBe(publicPath);
    }
  });
});
