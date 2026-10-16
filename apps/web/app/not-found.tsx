/**
 * 404 页：保留旧站「目标已消失」的语气，但**真的返回 404 状态**。
 * 旧站 `post.html?p=<非法 slug>` 会渲染一页提示并返回 200；新站按 01 §5 的要求
 * 对无效内容返回真正的 404，不统一跳回首页掩盖错误。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { rn } from "@/features/legacy/text/ransom";
import { SiteLink } from "@/features/runtime/navigation/site-link";

export const metadata: Metadata = {
  title: "目标不存在",
};

export default function NotFound(): ReactNode {
  return (
    <section className="shell lost">
      {/* eslint-disable-next-line @next/next/no-img-element -- 旧站空态插图。 */}
      <img src="/assets/legacy/img/morgana-thief.webp" alt="" />
      <p className="kick">Target not found</p>
      <h1 className="rn" style={{ fontSize: "clamp(34px,6vw,64px)", margin: 0, fontWeight: 400 }}>
        {rn("目标已消失", 5)}
      </h1>
      <p style={{ color: "var(--dim)", margin: 0 }}>
        这个地址没有对应的内容。回到菜单换个目标吧。
      </p>
      <SiteLink className="btn red" href="/#posts" source="top-nav">
        <span>返回宫殿索引</span>
      </SiteLink>
    </section>
  );
}
