"use client";

/**
 * 首页 HERO 与暂停菜单 —— 旧站 `assets/js/home.js` 上半部分的迁移。
 * 保留悬停 / 聚焦 / ↑↓ 选择与「菜单不在视野里就不劫持方向键」的行为。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { site } from "@/features/legacy/config";
import { rn } from "@/features/legacy/text/ransom";
import { SiteLink } from "@/features/runtime/navigation/site-link";

import type { HomeVariant } from "./home-variant";

/**
 * 首页暂停菜单（第三轮 §2.1 / §1）。
 *
 * 这里与顶部五栏目用**同一套内容职责命名**，不再出现「Palace Index / 宫殿索引」
 * 这个会与作品集混淆的文章列表名；天气退出菜单（保留手机与地图入口）。
 */
const MENU = [
  { href: "/posts", en: "Intel Archive", cn: "情报档案" },
  { href: "/apps/leblanc", en: "Leblanc", cn: "勒布朗" },
  { href: "/showcase", en: "My Palace", cn: "我的殿堂" },
  { href: "/map", en: "Tokyo Roam", cn: "东京漫游" },
  { href: "/about", en: "Dossier", cn: "人物档案" },
] as const;

export function HomeHero({ variant = "a" }: { variant?: HomeVariant } = {}): ReactNode {
  const [active, setActive] = useState(0);
  const itemsRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onArrows = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const element = document.activeElement;
      if (element instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(element.tagName)) return;
      // 菜单不在视野里就不劫持方向键。
      if ((heroRef.current?.getBoundingClientRect().bottom ?? 0) < window.innerHeight * 0.5) return;
      event.preventDefault();
      setActive((current) => {
        const next = (current + (event.key === "ArrowDown" ? 1 : MENU.length - 1)) % MENU.length;
        itemsRef.current[next]?.focus({ preventScroll: true });
        return next;
      });
    };
    window.addEventListener("keydown", onArrows);
    return () => window.removeEventListener("keydown", onArrows);
  }, []);

  return (
    <section className="hero" aria-labelledby="hero-t" ref={heroRef}>
      <div className="hero-slab" aria-hidden="true" />
      <div className="shell hero-in">
        <div className="hero-copy">
          <p className="kick">{"// "}{site.kicker}</p>
          <h1 className="hero-t" id="hero-t">
            <span className="en">
              {site.name} <b>{site.nameB}</b>
            </span>
            <span className="cn rn">{rn(site.nameCn, 7)}</span>
          </h1>
          <p className="hero-lead">{site.lead}</p>
          {variant === "c" ? (
            <div className="hero-cta">
              <SiteLink className="btn" href="/posts" source="top-nav">
                <span>情报档案 ▸</span>
              </SiteLink>
              <SiteLink className="btn red" href="/showcase" source="top-nav">
                <span>我的殿堂 ▸</span>
              </SiteLink>
              <SiteLink className="btn" href="/?phone=home" source="phone-link">
                <span>打开手机 ▸</span>
              </SiteLink>
            </div>
          ) : (
          <nav className="pause" aria-label="快捷菜单">
            <ol>
              {MENU.map((item, index) => (
                <li style={{ "--i": index } as React.CSSProperties} key={item.en}>
                  <SiteLink
                    className={`pm${index === active ? " on" : ""}`}
                    href={item.href}
                    source="top-nav"
                    ref={(node) => {
                      itemsRef.current[index] = node;
                    }}
                    onMouseEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                  >
                    {item.en}
                    <span className="pm-c">{item.cn}</span>
                  </SiteLink>
                </li>
              ))}
            </ol>
            <p className="pause-hint" aria-hidden="true">
              <kbd>↑</kbd>
              <kbd>↓</kbd> SELECT &nbsp; <kbd>ENTER</kbd> CONFIRM
            </p>
          </nav>
          )}
        </div>
        <figure className="hero-art">
          <div className="art-sh">
            <div className="art-frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- 旧站主视觉，固定资源。 */}
              <img
                src={site.heroArt}
                alt="Persona 5 主角 Joker 的特写插画"
                fetchPriority="high"
                width={720}
                height={900}
              />
            </div>
          </div>
          <figcaption className="rn" aria-hidden="true">
            {rn("TAKE YOUR HEART", 3)}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
