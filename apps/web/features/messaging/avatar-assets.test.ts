/**
 * 原版黑白头像静态资源（第二轮任务书 §4.2）。
 *
 * 角色头像改为 P5 游戏 SNS / IM 用的黑白 sprite（`92141-profile-pictures`），
 * 不再对彩色立绘施加灰度滤镜。这里钉住「资源真的在站点公开目录里」——
 * 图 404 时组件不会报错，只会静默空白，所以必须由测试盯住文件本身。
 *
 * 识别与许可记录见 `docs/design-references/icon-mapping.md` §2「IM 黑白头像」。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const PUBLIC_DIR = resolve(process.cwd(), "public/assets/legacy/img/avatar");

/** 从 PNG 的 IHDR 读宽高，不引入图片解码依赖。 */
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24) throw new Error("PNG 太短");
  if (bytes.toString("latin1", 1, 4) !== "PNG") throw new Error("不是 PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("原版黑白头像资源", () => {
  const cases = [
    { file: "futaba.png", side: 117 },
    { file: "mona.png", side: 93 },
  ] as const;

  it.each(cases)("$file 存在于公开目录、是正方形 PNG、体积足够小", ({ file, side }) => {
    const path = resolve(PUBLIC_DIR, file);
    expect(existsSync(path), `${file} 必须存在（否则头像静默 404）`).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.toString("latin1", 1, 4)).toBe("PNG");
    const { width, height } = pngSize(bytes);
    // 透明画布补齐为正方形：容器用 object-fit: cover，非正方会被裁掉头部。
    expect(width).toBe(side);
    expect(height).toBe(side);
    // 原版 sprite 很小，不应出现被"放大后"的大文件。
    expect(bytes.byteLength).toBeLessThan(40 * 1024);
  });

  it("角色卡头像路径指向新的 avatar 目录，而不是旧的彩色立绘", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "../api/app/modules/messaging/characters.py"),
      "utf8",
    );
    expect(source).toContain('/assets/legacy/img/avatar/futaba.png');
    expect(source).toContain('/assets/legacy/img/avatar/mona.png');
    expect(source).not.toContain('/assets/legacy/img/portrait/futaba.png');
    expect(source).not.toContain('/assets/legacy/img/portrait/mona.png');
  });
});
