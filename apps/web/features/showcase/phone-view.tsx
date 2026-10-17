"use client";

/**
 * 我的殿堂的手机视图（T06；第三轮任务书 §4.1 起**只保留作品**）。
 *
 * 宿主契约（`features/phone/types.ts`、02 §4）：
 *  - 只用 `PhoneViewProps` 的四个字段与 `host` 的八项能力；
 *  - **不碰全局 DOM、不锁 body、不新增 `<audio>`、不覆写 history**；
 *  - 非法 `item`（不是 slug）显示「未找到」，**不执行任意路径**；
 *  - 音乐继续播放：本视图不创建、不播放任何音频（验收 4）。
 *
 * 第三轮的职责拆分（任务书 §4.1 / §7.1 N4）：
 *  - `projects` / `project`：作品列表与作品详情（复用 `ProjectCard` 与 `api.ts`）；
 *  - 生活照片不在殿堂里 —— `photos` / `album` 两个**旧屏幕**只做兼容转发：
 *    手机深链 `?phone=showcase&screen=photos` / `&screen=album&item=<slug>` 会被
 *    `host.openSiteContent()` 送到生活图库 `/gallery`（保留目标相册），不会停在
 *    一个已经不存在的「殿堂照片展区」；
 *  - 转发**不带 `intent`**：目的地是图库，不是作品殿堂边界，不能触发异世界过场
 *    （任务书 §6.1）；手机参数也不透传，进入图库后手机壳自然收起。
 *
 * 与独立页共用同一批取数函数（`api.ts`）与同一套展示组件（`ProjectCard`），
 * 因此两处内容一致；完整的筛选 / 分页留在独立页。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import type { PhoneHost, PhoneViewProps } from "@/features/phone/types";

import { galleryAlbumHref, galleryHref } from "@/features/gallery/paths";
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

/**
 * 旧手机照片 / 相册屏幕 → 生活图库地址（纯函数，测试与组件共用）。
 *
 * 返回 `null` 表示这不是图库兼容屏幕（由调用方按作品屏幕处理）。
 * 相册 slug 非法（旧链接被篡改 / 手输）时退回图库首页，而不是把任意值拼进 URL。
 */
export function legacyGalleryTarget(screen: string, item: string | null): string | null {
  if (screen === "photos") return galleryHref();
  if (screen === "album") return isSlug(item) ? galleryAlbumHref(item) : galleryHref();
  return null;
}

export function ShowcasePhoneView({ screen, item, mode, host }: PhoneViewProps): ReactNode {
  // 旧照片 / 相册屏幕：第三轮起殿堂不再有照片展区，全部转发到生活图库。
  const legacyTarget = legacyGalleryTarget(screen, item);
  if (legacyTarget) {
    return <LegacyGalleryForward target={legacyTarget} host={host} />;
  }

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

  return (
    <ProjectsScreen
      onOpenProject={(slug) => host.navigateScreen("project", slug)}
      onOpenFull={() => host.openSiteContent({ destination: SHOWCASE_PATH, source: "phone-link" })}
    />
  );
}

/**
 * 旧手机照片 / 相册深链的转发屏幕。
 *
 * 用 `host.openSiteContent({ destination, source: "phone-link" })` 走宿主的统一导航
 * （应用不自己改 history）—— 不传 `intent`，因此不会播放殿堂过场。
 * `sentRef` 防 StrictMode / 重渲染时重复提交历史。
 */
function LegacyGalleryForward({ target, host }: { target: string; host: PhoneHost }): ReactNode {
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    host.openSiteContent({ destination: target, source: "phone-link" });
  }, [host, target]);

  return (
    <div className="pls-wrap">
      <div className="pls-state" role="status" data-legacy-gallery-forward={target}>
        <p className="pls-state-kicker">GALLERY</p>
        <h2 className="pls-state-title">正在打开生活图库…</h2>
        <p className="pls-state-body">
          照片与相册已经迁入「生活图库」，正在跳转并保留原来的相册与筛选。
        </p>
        <SiteLink href={target} source="phone-link" className="pls-button">
          打开生活图库
        </SiteLink>
      </div>
    </div>
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
        setMessage(classifyFailureMessage(error).message);
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
        const failure = classifyFailureMessage(error, { notFound: true });
        if (failure.notFound) setPhase("missing");
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

/**
 * 作品读取失败的可读文案。
 *
 * 为什么不用 `features/gallery/failure.ts` 的 `classifyFailure`：那个模块归图库
 * （相册语境）；本轮把照片从殿堂拆走后，殿堂不再 import 图库的客户端模块，
 * 只保留「404 → 不存在 / 其它 → 如实显示」两档。
 */
function classifyFailureMessage(
  error: unknown,
  options: { notFound?: boolean } = {},
): { message: string; notFound: boolean } {
  if (error instanceof ApiClientError) {
    if (options.notFound && error.status === 404) {
      return { message: "这件作品不存在或还没有公开。", notFound: true };
    }
    if (error.status >= 500) {
      return { message: `服务暂时不可用（HTTP ${error.status}），请稍后重试。`, notFound: false };
    }
    return { message: error.message || `请求失败（HTTP ${error.status}）`, notFound: false };
  }
  if (error instanceof ApiTransportError) {
    return { message: "连不上接口服务，请检查网络后重试。", notFound: false };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message, notFound: false };
  }
  return { message: "读取作品失败。", notFound: false };
}
