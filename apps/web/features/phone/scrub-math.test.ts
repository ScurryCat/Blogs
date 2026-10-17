/**
 * 斜屏滑杆的投影数学（任务书 §3.1：滑杆计算要考虑屏幕变换）。
 *
 * `localPointOf` 把指针位置换算成「条内局部坐标」：x 是条上的比例，y 是相对中线的偏移。
 * 桌面端手机屏幕被透视贴到斜面上，条本身还带 `skewX` —— 所以**轴向与高度向并不垂直**。
 * 早期版本直接按「垂直」投影，端点处 y 会漂到 1.4+ 被容差拒掉（实测：中间能拖、两端拖不动）。
 * 这里的用例就是钉住那次修复。
 */

import { describe, expect, it } from "vitest";

import { localPointOf } from "./phone-music-card";

/** 用中心点 + 宽高构造一个「标记元素」的视觉矩形（零尺寸标记也是这么读的）。 */
function marker(centerX: number, centerY: number): DOMRect {
  return new DOMRect(centerX, centerY, 0, 0);
}

describe("localPointOf：轴的换算", () => {
  it("水平条：中点 → (0.5, 0.5)，两端 → x 0 / 1", () => {
    const left = marker(100, 300);
    const right = marker(500, 300);
    const top = marker(300, 250); // 条高 100，顶边在中线上方 50

    expect(localPointOf(left, right, top, 300, 300)).toEqual({ x: 0.5, y: 0.5 });
    expect(localPointOf(left, right, top, 100, 300)?.x).toBeCloseTo(0, 6);
    expect(localPointOf(left, right, top, 500, 300)?.x).toBeCloseTo(1, 6);
  });

  it("轴倾斜（旋转）时，沿轴取点的 y 仍然≈0.5", () => {
    const left = marker(100, 320);
    const right = marker(500, 280);
    const top = marker(300, 200);

    const q = localPointOf(left, right, top, 200, 310); // 轴上 25% 处
    expect(q?.x).toBeCloseTo(0.25, 2);
    expect(q?.y).toBeCloseTo(0.5, 2);
  });

  it("**高度向与轴向不垂直**（条自身的 skewX）时，轴上的点仍必须是 y≈0.5", () => {
    // 这是第 2 轮踩过的坑：高度向量带沿轴分量时，直接投影会把端点 y 算到 1.4+。
    // 轴：(0,100) → (100,80)；顶部标记偏到 (60,30)，使其与轴向明显不垂直。
    const left = marker(0, 100);
    const right = marker(100, 80);
    const top = marker(60, 30);

    for (const f of [0, 0.2, 0.5, 0.8, 1]) {
      const x = 0 + (100 - 0) * f;
      const y = 100 + (80 - 100) * f;
      const point = localPointOf(left, right, top, x, y);
      expect(point?.x, `f=${f} 的 x`).toBeCloseTo(f, 2);
      expect(point?.y, `f=${f} 的 y（不垂直时仍应贴中线）`).toBeCloseTo(0.5, 2);
    }
  });

  it("中线以上 y<0.5、以下 y>0.5（方向不能反）", () => {
    const left = marker(100, 300);
    const right = marker(500, 300);
    const top = marker(300, 250);
    expect(localPointOf(left, right, top, 300, 280)?.y).toBeLessThan(0.5);
    expect(localPointOf(left, right, top, 300, 320)?.y).toBeGreaterThan(0.5);
  });

  it("退化输入返回 null（两个标记重合时不做除法）", () => {
    const same = marker(100, 100);
    expect(localPointOf(same, same, marker(100, 50), 100, 100)).toBeNull();
    // 顶部标记与中线重合（高度为 0）也返回 null
    const left = marker(0, 100);
    const right = marker(100, 100);
    expect(localPointOf(left, right, marker(50, 100), 50, 100)).toBeNull();
  });
});
