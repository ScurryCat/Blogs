/**
 * 关于页 `/about`（旧站 `about.html` + `assets/js/about.js`）。
 *
 * 五维雷达、COOP 友链、足迹年表、联络方式都按旧站结构与数值迁移（服务端渲染）。
 *
 * 未迁移项：旧站的 GitHub 活动热力图区块（`heatmap.js` + 构建期抓取的
 * `heatmap-data.js`）。该数据是 `tools/github-heatmap/fetch.py` 的产物、需要联网抓取，
 * 本轮**不伪造数据**，因此这一区块不渲染（详见交付单「未验证 / 遗留」）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { site } from "@/features/legacy/config";
import { rn } from "@/features/legacy/text/ransom";

const A = site.about;

/** COOP 卡片的固定倾角序列（旧站同一组值）。 */
const TILT = [-2, 1.5, -1, 2, -1.5, 1];

function pips(count: number, max: number): ReactNode {
  return (
    <span className="pips" aria-hidden="true">
      {Array.from({ length: max }, (_, index) => (
        <i className={index < count ? "on" : undefined} key={index} />
      ))}
    </span>
  );
}

/** 五维雷达：5 条轴、5 级刻度，坐标与旧站一致。 */
function Radar(): ReactNode {
  const stats = A.stats;
  const C = 210;
  const R = 150;
  const count = stats.length;
  const point = (index: number, radius: number): [number, number] => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [C + radius * Math.cos(angle), C + radius * Math.sin(angle)];
  };
  const polygon = (radius: (stat: (typeof stats)[number]) => number): string =>
    stats
      .map((stat, index) =>
        point(index, radius(stat))
          .map((value) => value.toFixed(1))
          .join(","),
      )
      .join(" ");

  return (
    <svg
      className="radar"
      viewBox="-40 -10 500 450"
      role="img"
      aria-label={`五维能力：${stats.map((stat) => `${stat.cn} ${stat.lv} 级`).join("，")}`}
    >
      {[1, 2, 3, 4, 5].map((level) => (
        <polygon
          className={`ring${level === 5 ? " o" : ""}`}
          points={polygon(() => (R * level) / 5)}
          key={level}
        />
      ))}
      {stats.map((_, index) => {
        const [x, y] = point(index, R);
        return <line className="ax" x1={C} y1={C} x2={x} y2={y} key={index} />;
      })}
      <polygon className="val" points={polygon((stat) => (R * stat.lv) / 5)} />
      {stats.map((stat, index) => {
        const [x, y] = point(index, (R * stat.lv) / 5);
        return <circle className="dot" cx={x} cy={y} r={6} key={index} />;
      })}
      {stats.map((stat, index) => {
        const [x, y] = point(index, R + 34);
        return (
          <text x={x} y={y} key={index}>
            {stat.en}
          </text>
        );
      })}
    </svg>
  );
}

export const metadata: Metadata = {
  title: "关于我",
  description: A.lead,
};

export default function AboutPage(): ReactNode {
  return (
    <>
      <section className="ab-hero" aria-labelledby="ab-t">
        <div className="ab-bg" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站背景资源。 */}
          <img src={A.bg} alt="" />
        </div>
        <div className="shell ab-in">
          <div>
            <p className="kick">{"// Confidant file · "}{site.codeName}</p>
            <h1 className="ab-t" id="ab-t">
              {site.author.slice(0, -1)}
              <span>{site.author.slice(-1)}</span>
            </h1>
            <p className="ab-code rn" aria-hidden="true">
              {rn("信息工程 · ACM · 怪盗", 21)}
            </p>
            <p className="ab-lead">{A.lead}</p>
            {A.intro.map((paragraph, index) => (
              <p className="ab-p" key={index}>
                {paragraph}
              </p>
            ))}
            <dl className="idcard">
              <dt>Role</dt>
              <dd>{site.role}</dd>
              <dt>Base</dt>
              <dd>{site.base}</dd>
              <dt>Since</dt>
              <dd>{site.startYear}</dd>
            </dl>
          </div>
          <figure className="ab-art">
            {/* eslint-disable-next-line @next/next/no-img-element -- 旧站立绘资源。 */}
            <img src={A.art} alt="怪盗装束的 Joker 全身立绘" />
          </figure>
        </div>
      </section>

      <section className="shell stats" aria-labelledby="st-h">
        <header className="sec-h">
          <span className="no">01</span>
          <h2 id="st-h">
            <span className="en">Social Stats</span>
            <span className="cn">五维</span>
          </h2>
        </header>
        <div className="stats-g">
          <Radar />
          <ul className="st-l">
            {A.stats.map((stat) => (
              <li className="st" key={stat.en}>
                <h3>
                  {stat.en}
                  <small>{stat.cn}</small>
                </h3>
                <p>
                  <b>
                    Lv.{stat.lv} · {stat.rank}
                  </b>
                  {stat.note}
                </p>
                {pips(stat.lv, 5)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="shell coop" aria-labelledby="co-h">
        <header className="sec-h">
          <span className="no">02</span>
          <h2 id="co-h">
            <span className="en">Confidants</span>
            <span className="cn">友链</span>
          </h2>
          <p className="aside">
            RANK UP <b>↑</b>
          </p>
        </header>
        <ul className="coop-g">
          {A.coop.map((coop, index) => (
            <li className="co" key={coop.name}>
              <a
                href={coop.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ "--r": `${TILT[index % TILT.length] ?? 0}deg` } as React.CSSProperties}
              >
                <span className="co-top">
                  <b>{coop.arcana[0]}</b>
                  <span>{coop.arcana[1]}</span>
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- 旧站图标资源。 */}
                <img src={coop.icon} alt="" loading="lazy" />
                <h3>{coop.name}</h3>
                <p>{coop.note}</p>
                {pips(coop.rank, 10)}
                <span className="sr-only">COOP 等级 {coop.rank} / 10</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="shell tl" aria-labelledby="tl-h">
        <header className="sec-h">
          <span className="no">03</span>
          <h2 id="tl-h">
            <span className="en">Milestones</span>
            <span className="cn">足迹</span>
          </h2>
        </header>
        <ol className="tl-l">
          {A.timeline.map((item) => (
            <li className="tl-i" key={item.h}>
              <span className="tl-y">{item.y}</span>
              <div>
                <h3>{item.h}</h3>
                <p>{item.p}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="shell ct" aria-labelledby="ct-h">
        <header className="sec-h">
          <span className="no">05</span>
          <h2 id="ct-h">
            <span className="en">Send a Card</span>
            <span className="cn">联络</span>
          </h2>
        </header>
        <div className="ct-box">
          <p>有想法、发现 Bug、想交换友链——都欢迎来信。回复不一定快，但一定会回。</p>
          <ul className="ct-l">
            {site.social.map((link) => (
              <li key={link.k}>
                <a
                  href={link.url}
                  {...(/^https?:/.test(link.url)
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  <small>{link.k}</small>
                  <b>{link.v}</b>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
