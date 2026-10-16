"use client";

/**
 * 管理端图片上传（T03 §「管理表单」）。
 *
 * 硬规则（03 §4 / §9.3）：
 *  - 使用**共享媒体服务**（T01 的 `POST /admin/media`），不另写一个上传实现；
 *  - **不能把客户端缩略图预览当作已上传成功**：`URL.createObjectURL` 出来的预览
 *    始终标记为「本地预览 · 尚未上传」，只有服务端返回 `status: "ready"` 的记录
 *    才会变成「已上传」并允许进入草稿；
 *  - 上传失败保留用户选择（可以重试），并显示服务端给的真实原因
 *    （413 太大 / 415 类型不支持 / 422 解码不合法）；
 *  - 组件卸载时取消进行中的上传并释放所有 object URL（验收 §1）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";

import { uploadMomentImage } from "../api";
import type { MediaAdminUpload } from "../types";

export interface UploadedImage {
  mediaId: string;
  alt: string;
  /** 服务端确认的 ready 记录；本地预览与已上传靠它区分。 */
  upload: MediaAdminUpload;
}

export interface MediaUploaderProps {
  csrfToken: string;
  images: readonly UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  disabled?: boolean;
}

interface LocalPreview {
  key: string;
  name: string;
  url: string;
  status: "uploading" | "failed";
  reason?: string;
}

export function MediaUploader({
  csrfToken,
  images,
  onChange,
  disabled = false,
}: MediaUploaderProps): ReactNode {
  const [locals, setLocals] = useState<LocalPreview[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const controllers = useRef<AbortController[]>([]);

  // 卸载：取消在途上传并释放 object URL（没有这一步就会泄漏 blob）。
  useEffect(
    () => () => {
      controllers.current.forEach((controller) => controller.abort());
      controllers.current = [];
    },
    [],
  );
  useEffect(
    () => () => {
      locals.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [locals],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      setNotice(null);
      const accepted: UploadedImage[] = [...images];
      const failed: LocalPreview[] = [];

      for (const file of Array.from(files)) {
        const url = URL.createObjectURL(file);
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        setLocals((previous) => [
          ...previous,
          { key, name: file.name, url, status: "uploading" },
        ]);
        const controller = new AbortController();
        controllers.current.push(controller);
        try {
          const upload = await uploadMomentImage(file, csrfToken, controller.signal);
          if (upload.status !== "ready") {
            // 服务端返回了非 ready：不接受为「已上传」。
            throw new ApiClientError(
              409,
              { code: "CONFLICT", message: "图片尚未处理完成，请重试。", fields: {} },
              null,
            );
          }
          accepted.push({
            mediaId: upload.id,
            // 替代文本默认留空：发布前必须补齐（1–200 码点，03 §5），
            // 这里不替站主编一个假描述。
            alt: "",
            upload,
          });
          setLocals((previous) => previous.filter((item) => item.key !== key));
          URL.revokeObjectURL(url);
          onChange([...accepted]);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const reason =
            error instanceof ApiClientError
              ? error.status === 413
                ? "文件太大（单张上限 8 MiB）"
                : error.status === 415
                  ? "格式不支持（只接受 JPEG / PNG / WebP）"
                  : error.status === 422
                    ? "图片解码失败或像素超限"
                    : error.message
              : "上传失败";
          failed.push({ key, name: file.name, url, status: "failed", reason });
          setLocals((previous) =>
            previous.map((item) =>
              item.key === key ? { ...item, status: "failed", reason } : item,
            ),
          );
        }
      }
      if (failed.length) {
        setNotice(`${failed.length} 张图片没有上传成功，本地预览保留在这里，可以重新选择后重试。`);
      }
    },
    [csrfToken, images, onChange],
  );

  const setAlt = useCallback(
    (mediaId: string, alt: string) => {
      onChange(images.map((image) => (image.mediaId === mediaId ? { ...image, alt } : image)));
    },
    [images, onChange],
  );

  const move = useCallback(
    (index: number, step: number) => {
      const next = [...images];
      const target = index + step;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return;
      next[index] = b;
      next[target] = a;
      onChange(next);
    },
    [images, onChange],
  );

  const remove = useCallback(
    (mediaId: string) => {
      onChange(images.filter((image) => image.mediaId !== mediaId));
    },
    [images, onChange],
  );

  return (
    <section className="ins-admin-upload" aria-label="图片上传与排序">
      <label className="ins-admin-file">
        <span>选择图片（JPEG / PNG / WebP，单张 ≤ 8 MiB）</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      {notice ? (
        <p className="ins-admin-notice" role="alert">
          {notice}
        </p>
      ) : null}

      <ol className="ins-admin-images">
        {images.map((image, index) => (
          <li key={image.mediaId} className="ins-admin-image">
            {/* 管理端缩略图来自 `/api/v1/media/{id}/{variant}`（带授权语义的变体地址）。 */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 见上：媒体端点按请求授权，不走 next/image 的远程优化缓存。 */}
            <img
              src={image.upload.variants.find((variant) => variant.name === "w320.webp")?.url
                ?? image.upload.variants[0]?.url
                ?? ""}
              alt={image.alt || "待填替代文本的图片"}
              width={96}
              height={72}
            />
            <div className="ins-admin-image-body">
              <label>
                <span>替代文本（1–200 字，发布必需）</span>
                <input
                  type="text"
                  value={image.alt}
                  maxLength={200}
                  onChange={(event) => setAlt(image.mediaId, event.target.value)}
                  aria-invalid={image.alt.trim() ? undefined : true}
                />
              </label>
              <p className="ins-admin-image-meta">
                位置 {index + 1} · {image.upload.width}×{image.upload.height} · 已上传（ready）
              </p>
              <div className="ins-admin-image-act">
                <button type="button" className="ins-btn" onClick={() => move(index, -1)} disabled={index === 0}>
                  上移
                </button>
                <button
                  type="button"
                  className="ins-btn"
                  onClick={() => move(index, 1)}
                  disabled={index === images.length - 1}
                >
                  下移
                </button>
                <button type="button" className="ins-btn red" onClick={() => remove(image.mediaId)}>
                  移除
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {locals.length ? (
        <ul className="ins-admin-locals" aria-label="尚未上传成功的本地预览">
          {locals.map((item) => (
            <li key={item.key} className={`ins-admin-local is-${item.status}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 本地 object URL 预览，没有远端地址可优化。 */}
              <img
                src={item.url}
                alt={`${item.name} 的本地预览`}
                width={72}
                height={54}
              />
              <span>
                {item.name} · <strong>本地预览 · 尚未上传</strong>
                {item.reason ? `（${item.reason}）` : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
