"use client";

/**
 * 我的殿堂的手机视图（T06）。
 *
 * 宿主契约（`features/phone/types.ts`、02 §4）：
 *  - 只用 `PhoneViewProps` 的四个字段与 `host` 的八项能力；
 *  - **不碰全局 DOM、不锁 body、不新增 `<audio>`、不覆写 history**；
 *  - 非法 `item`（不是 slug）显示「未找到」，**不执行任意路径**；
 *  - 音乐继续播放：本视图不创建、不播放任何音频（验收 4）。
 *
 * 与独立页共用同一批取数函数（`api.ts`）与同一套展示组件（`PhotoTile` / `ProjectCard` /
 * `Lightbox`），因此两处内容一致。**完整**的筛选 / 分组 / 分页留在独立页：
 * 手机里只给「能一眼看完的一屏 + 明确的展开入口」。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { fetchAlbums, fetchWallPhotos } from "@/features/gallery/api";
import { classifyFailure } from "@/features/gallery/failure";
import { Lightbox } from "@/features/gallery/lightbox";
import { PhotoTile } from "@/features/gallery/photo-tile";
import { galleryAlbumHref, galleryHref } from "@/features/gallery/paths";
import type { AlbumSummary, Photo, WallPhoto } from "@/features/gallery/types";
import { fetchProject, fetchProjects } from "./api";
import { trackRequest } from "./inflight";
import { SHOWCASE_PATH, palacePath, projectPath } from "./paths";
import { ProjectCard } from "./project-card";
import type { ProjectDetail, ProjectSummary } from "./types";

/** 与 `phone-app.tsx` 的 `screens` 保持一致；顺序即默认屏优先顺序。 */
export const SHOWCASE_APP_SCREENS = ["projects", "project", "photos", "album"] as const;

/** slug 只允许小写字母 / 数字 / 连字符 —— 与后端的 SLUG_PATTERN 一致。 */
export function isSlug(value: string | null | undefined): value is string {
  return !!value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function ShowcasePhoneView({ screen, item, mode, host }: PhoneViewProps): ReactNode {
  if (screen === "project") {
    if (!isSlug(item)) {
      return (
        <Missing
          title="这件作品不存在"
          body="链接里的编号不是有效的作品 slug。"
          onBack={() => host.navigateScreen("projects")}
        />
      );
    }
    return (
      <ProjectScreen
        slug={item}
        mode={mode}
        onOpenGuide={(slug) => host.openSiteContent({ destination: palacePath(slug), source: "metaverse-entry" })}
        onOpenFull={() => host.openSiteContent({ destination: projectPath(item), source: "phone-link" })}
      />
    );
  }

  if (screen === "photos" || screen === "album") {
    const albumSlug = screen === "album" && isSlug(item) ? item : null;
    if (screen === "album" && !albumSlug) {
      return (
        <Missing
          title="这个相册不存在"
          body="链接里的名字不是有效的相册 slug。"
          onBack={() => host.navigateScreen("photos")}
        />
      );
    }
    return (
      <PhotosScreen
        albumSlug={albumSlug}
        onOpenFull={(slug) =>
          host.openSiteContent({ destination: slug ? galleryAlbumHref(slug) : galleryHref(), source: "phone-link" })
        }
      />
    );
  }

  return (
    <ProjectsScreen
      onOpenProject={(slug) => host.navigateScreen("project", slug)}
      onOpenFull={() => host.openSiteContent({ destination: SHOWCASE_PATH, source: "phone-link" })}
    />
  );
}

function Missing({
  title,
  body,
  onBack,
}: {
  title: string;
  body: string;
  onBack: () => void;
}): ReactNode {
  return (
    <div className="pls-wrap">
      <div className="pls-state" role="status">
        <p className="pls-state-kicker">NOT FOUND</p>
        <h2 className="pls-state-title">{title}</h2>
        <p className="pls-state-body">{body}</p>
        <button type="button" className="pls-button" onClick={onBack}>
          回到列表
        </button>
      </div>
    </div>
  );
}

function ProjectsScreen({
  onOpenProject,
  onOpenFull,
}: {
  onOpenProject: (slug: string) => void;
  onOpenFull: () => void;
}): ReactNode {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const release = trackRequest(controller);
    void (async () => {
      try {
        const page = await fetchProjects({ limit: 12 }, controller.signal);
        setProjects(page.items);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("failed");
        setMessage(classifyFailure(error).message);
      } finally {
        release();
      }
    })();
    return () => controller.abort();
  }, []);

  if (phase === "loading") {
    return (
      <p className="pls-card-meta" role="status">
        正在读取作品…
      </p>
    );
  }
  if (phase === "failed") {
    return (
      <div className="pls-state" role="status">
        <p className="pls-state-body">{message}</p>
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="pls-state" role="status">
        <p className="pls-state-title">还没有公开的作品</p>
        <p className="pls-state-body">这里不显示占位卡片，也不编造成果。</p>
      </div>
    );
  }

  return (
    <div className="pls-wrap">
      {/*
        卡片本身是 `SiteLink`（真实 `<a href>`），在手机里点击会走**站点跳转**。
        外面的按钮用 `onClickCapture` 在捕获阶段拦住并改成宿主换屏：这样
        键盘 / 新标签页 / 爬虫仍然看到真实链接，而普通点击留在手机里（02 §6）。
        刻意不用嵌套 `<button>`：那会产生无效的交互元素嵌套。
      */}
      <div className="pls-grid" onClickCapture={(event) => {
        const target = event.target as HTMLElement | null;
        const link = target?.closest("a[data-project]");
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        const slug = link.getAttribute("data-project");
        if (slug) onOpenProject(slug);
      }}>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
      <p className="pls-more-row">
        <button type="button" className="pls-button" onClick={onOpenFull}>
          在完整页面里看作品
        </button>
      </p>
    </div>
  );
}

function ProjectScreen({
  slug,
  mode,
  onOpenGuide,
  onOpenFull,
}: {
  slug: string;
  mode: PhoneViewProps["mode"];
  onOpenGuide: (slug: string) => void;
  onOpenFull: () => void;
}): ReactNode {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const release = trackRequest(controller);
    void (async () => {
      try {
        const loaded = await fetchProject(slug, controller.signal);
        setProject(loaded);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const failure = classifyFailure(error);
        if (failure.kind === "not_found") setPhase("missing");
        else {
          setPhase("failed");
          setMessage(failure.message);
        }
      } finally {
        release();
      }
    })();
    return () => controller.abort();
  }, [slug]);

  if (phase === "loading") {
    return (
      <p className="pls-card-meta" role="status">
        正在读取作品…
      </p>
    );
  }
  if (phase === "missing") {
    return (
      <div className="pls-state" role="status">
        <p className="pls-state-kicker">NOT FOUND</p>
        <h2 className="pls-state-title">这件作品不存在或还没有公开</h2>
      </div>
    );
  }
  if (phase === "failed" || !project) {
    return (
      <div className="pls-state" role="status">
        <p className="pls-state-body">{message ?? "读取作品失败。"}</p>
      </div>
    );
  }

  return (
    <article className="pls-wrap">
      <p className="pls-kicker">{"// MY PALACE"}</p>
      <h2 className="pls-title">{project.title}</h2>
      <p className="pls-lead">{project.summary}</p>
      <p className="pls-card-meta">
        {project.maintenance_label} · {mode === "expanded" ? "展开视图" : "手机视图"}
      </p>

      <div className="pls-sections">
        {project.role ? (
          <section className="pls-section">
            <h3>个人职责</h3>
            <p>{project.role}</p>
          </section>
        ) : null}
        {project.tradeoffs ? (
          <section className="pls-section">
            <h3>关键取舍</h3>
            <p>{project.tradeoffs}</p>
          </section>
        ) : null}
        {project.outcomes ? (
          <section className="pls-section">
            <h3>可验证成果</h3>
            <p>{project.outcomes}</p>
          </section>
        ) : null}
      </div>

      <section className="pls-guide">
        <h2>攻略记录</h2>
        {project.palace ? (
          <button
            type="button"
            className="pls-guide-entry"
            onClick={() => onOpenGuide(project.palace?.slug ?? "")}
          >
            查看攻略记录：{project.palace.title}
          </button>
        ) : (
          <p className="pls-empty-note">
            还没有公开的攻略记录（专题未发布或已撤回时不会显示标题）。
          </p>
        )}
      </section>

      <p className="pls-more-row">
        <button type="button" className="pls-button" onClick={onOpenFull}>
          在完整页面里打开
        </button>
      </p>
    </article>
  );
}

function PhotosScreen({
  albumSlug,
  onOpenFull,
}: {
  albumSlug: string | null;
  onOpenFull: (slug: string | null) => void;
}): ReactNode {
  const [photos, setPhotos] = useState<readonly WallPhoto[]>([]);
  const [albums, setAlbums] = useState<readonly AlbumSummary[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const controllers = useRef<AbortController[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    controllers.current.push(controller);
    const release = trackRequest(controller);
    void (async () => {
      try {
        const [albumPage, photoPage] = await Promise.all([
          fetchAlbums({ limit: 12 }, controller.signal),
          fetchWallPhotos(
            { scope: albumSlug ? "album" : "global", album: albumSlug, limit: 24 },
            controller.signal,
          ),
        ]);
        setAlbums(albumPage.items);
        setPhotos(photoPage.items);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("failed");
        setMessage(classifyFailure(error).message);
      } finally {
        release();
      }
    })();
    return () => controller.abort();
  }, [albumSlug]);

  const flat: Photo[] = useMemo(() => photos.map((item) => item.photo), [photos]);
  const open = useCallback(
    (photo: Photo) => {
      const index = flat.findIndex((candidate) => candidate.media_id === photo.media_id);
      if (index >= 0) setLightbox(index);
    },
    [flat],
  );

  if (phase === "loading") {
    return (
      <p className="plg-group-meta" role="status">
        正在读取照片…
      </p>
    );
  }
  if (phase === "failed") {
    return (
      <div className="plg-state" role="status">
        <p className="plg-state-body">{message}</p>
      </div>
    );
  }
  if (flat.length === 0) {
    return (
      <div className="plg-state" role="status">
        <p className="plg-state-title">这个相册还没有照片</p>
        <p className="plg-state-body">没有占位图，也没有编造的张数。</p>
      </div>
    );
  }

  return (
    <div className="plg-wrap">
      <div className="plg-filters" aria-label="相册">
        <button
          type="button"
          className="plg-chip"
          aria-pressed={albumSlug === null}
          onClick={() => onOpenFull(null)}
        >
          全部（完整页）
        </button>
        {albums.map((album) => (
          <button
            key={album.id}
            type="button"
            className="plg-chip"
            aria-pressed={albumSlug === album.slug}
            onClick={() => onOpenFull(album.slug)}
          >
            {album.title}（{album.photo_count}）
          </button>
        ))}
      </div>
      <div className="plg-masonry">
        {flat.map((photo) => (
          <PhotoTile key={`${photo.media_id}-${photo.position}`} photo={photo} onOpen={open} />
        ))}
      </div>
      <p className="plg-group-meta">筛选、分组与分页在完整照片墙里。</p>

      {lightbox !== null ? (
        <Lightbox
          photos={flat}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          hasHost
        />
      ) : null}
    </div>
  );
}
