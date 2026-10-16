/**
 * 作品详情（服务端组件，T06；07 §5「作品页回答『你做出了什么』」）。
 *
 * 为什么是服务端组件：作品详情的正文是**已经发布**的静态内容，首屏就该有内容，
 * 不需要客户端空转一圈。唯一的交互件是「攻略记录」入口（`SiteLink`，客户端组件）。
 *
 * 空字段的处理原则（验收 5「正常空内容不靠 3D 场景或假统计填充」）：
 *  - 有内容就显示；
 *  - 没内容就显示一句**明确的说明**（「还没有写关键取舍」），
 *    而不是隐藏整块、也不是塞一句编出来的成果。
 */

import type { ReactNode } from "react";

import { GuideEntry } from "./project-card";
import {
  PROJECT_IMAGE_KIND_LABELS,
  linkKindLabel,
  projectImageAlt,
  projectImageUrl,
  type ProjectDetail,
  type ProjectImage,
  type ProjectImageKind,
} from "./types";

export interface ProjectReadingProps {
  project: ProjectDetail;
}

const SECTION_COPY: readonly { key: keyof ProjectDetail; title: string; empty: string }[] = [
  { key: "role", title: "个人职责", empty: "还没有写个人职责。" },
  { key: "problem", title: "解决的问题", empty: "还没有写要解决的问题。" },
  { key: "tradeoffs", title: "关键取舍", empty: "还没有写关键取舍。" },
  { key: "outcomes", title: "可验证成果", empty: "还没有写可验证的成果。" },
];

export function ProjectReading({ project }: ProjectReadingProps): ReactNode {
  const hero = project.cover ?? project.images[0] ?? null;
  const heroUrl = hero ? projectImageUrl(hero, ["w1280.webp", "w640.webp", "w320.webp"]) : null;
  const gallery = project.images.filter((image) => image.media_id !== hero?.media_id);

  return (
    <article className="pls-wrap pls-detail" data-project-detail={project.slug}>
      <header className="pls-bar">
        <div>
          <p className="pls-kicker">{"// MY PALACE · PROJECT"}</p>
          <h1 className="pls-title">{project.title}</h1>
          <p className="pls-lead">{project.summary || "（还没有写一句话用途）"}</p>
        </div>
        <p className="pls-card-meta">
          {project.maintenance_label || project.maintenance} ·{" "}
          <span data-published-at="">{project.published_at.slice(0, 10)} 发布</span>
        </p>
      </header>

      {heroUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求都校验公开引用）。 */
        <img
          className="pls-hero"
          src={heroUrl}
          alt={projectImageAlt(hero as ProjectImage)}
          width={hero?.width ?? 1280}
          height={hero?.height ?? 720}
        />
      ) : (
        <p className="pls-hero-empty">这件作品还没有效果图。</p>
      )}

      <div className="pls-sections">
        {SECTION_COPY.map((section) => {
          const value = String(project[section.key] ?? "").trim();
          return (
            <section className="pls-section" key={section.key} data-section={section.key}>
              <h3>{section.title}</h3>
              {value ? (
                <p>{value}</p>
              ) : (
                <p className="pls-empty-note" data-section-empty={section.key}>
                  {section.empty}
                </p>
              )}
            </section>
          );
        })}

        <section className="pls-section" data-section="tech_stack">
          <h3>技术栈</h3>
          {project.tech_stack.length > 0 ? (
            <ul className="pls-tech">
              {project.tech_stack.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="pls-empty-note">还没有填技术栈。</p>
          )}
        </section>
      </div>

      <div className="pls-links">
        {project.links.length > 0 ? (
          project.links.map((link) => (
            <a
              key={`${link.kind}-${link.url}`}
              className="pls-link"
              href={link.url}
              rel="noopener noreferrer me"
              target="_blank"
              data-project-link={link.kind}
            >
              {linkKindLabel(link.kind)}：{link.label}
            </a>
          ))
        ) : (
          <p className="pls-empty-note">这件作品还没有公开的仓库或演示地址。</p>
        )}
      </div>

      <section className="pls-guide" data-guide="">
        <h2>攻略记录</h2>
        <p>
          作品页说明**你做出了什么**；专题殿堂解释**你怎么做出来**。只有当前公开的专题
          才会出现在这里 —— 专题撤回后这件作品仍然在，但不会再露出它的标题。
        </p>
        <GuideEntry palace={project.palace} />
      </section>

      {gallery.length > 0 ? (
        <section className="pls-gallery" data-project-gallery-images="">
          <h2>图集</h2>
          <div className="pls-gallery-grid">
            {gallery.map((image) => (
              <ProjectFigure key={`${image.media_id}-${image.position}`} image={image} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="pls-card-meta">
        想看更多作品？<a href="/showcase">回到我的殿堂</a>。
      </p>
    </article>
  );
}

function ProjectFigure({ image }: { image: ProjectImage }): ReactNode {
  const url = projectImageUrl(image);
  const kindLabel = PROJECT_IMAGE_KIND_LABELS[image.kind as ProjectImageKind] ?? image.kind;
  return (
    <figure className="pls-figure" data-figure-media-id={image.media_id}>
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取。 */
        <img
          src={url}
          alt={projectImageAlt(image)}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="pls-figure-fallback">这张图片暂时加载不出来</div>
      )}
      <figcaption>
        {kindLabel}
        {image.caption ? ` · ${image.caption}` : ""}
      </figcaption>
    </figure>
  );
}
