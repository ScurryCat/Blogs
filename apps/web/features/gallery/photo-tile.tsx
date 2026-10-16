"use client";

/**
 * 照片图格（T06，07 §5「照片保持自然比例，外层可以有 P5 拼贴边框」）。
 *
 * 硬规则：
 *  - **自然比例**：`<img>` 的 `width` / `height` 直接来自媒体行的真实像素，
 *    浏览器据此在图片加载完成**之前**就留出正确高度 —— 没有布局跳动，也不裁切构图；
 *  - `alt` 必填（后端保证 1–200 码点），缺失时兜到说明或一句明确占位，
 *    **绝不渲染无 alt 的 `<img>`**（ACCEPTANCE §1「图片有 alt」）；
 *  - 加载失败时换成文字占位并**保留日期与说明**，还给一个「重新加载」
 *    （验收 6「图片慢加载与损坏均验证」）；
 *  - 不创建任何音频、不锁 body：这里只有一个 `<button>` + `<img>`。
 */

import { useState, type ReactNode, type Ref } from "react";

import { IMAGE_FAILURE_TEXT } from "./failure";
import { aspectRatio, formatTakenOn, photoAlt, thumbnailUrl, type Photo } from "./types";

export interface PhotoTileProps {
  photo: Photo;
  /** 打开灯箱；不传时图格是纯展示（例如 INS 紧凑视图用不到灯箱）。 */
  onOpen?: (photo: Photo) => void;
  /** 说明下方的补充一行（例如「也出现在动态里」）。 */
  note?: string | null;
  /**
   * 打开按钮的 ref。灯箱关闭时要把焦点还给触发它的图格，
   * 因此由调用方持有 —— 而不是让调用方去 DOM 里 querySelector 找按钮。
   */
  buttonRef?: Ref<HTMLButtonElement>;
}

export function PhotoTile({ photo, onOpen, note, buttonRef }: PhotoTileProps): ReactNode {
  const [failed, setFailed] = useState(false);
  const thumb = thumbnailUrl(photo);
  const ratio = aspectRatio(photo);

  // 失败态里**不能**再放一个 `<button>`：外层（有 `onOpen` 时）已经是 button，
  // 嵌套 button 是无效 HTML 且会触发水合错误。因此失败态只给文字，
  // 重试由「再点一次这张图」承担（有 onOpen 时）或由调用方决定（纯展示时）。
  const image =
    failed || !thumb ? (
      <span className="photo-tile-fallback" data-photo-fallback="">
        {IMAGE_FAILURE_TEXT}
        {onOpen ? <span className="photo-tile-retry">再点一次可以重试</span> : null}
      </span>
    ) : (
      /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求都校验公开引用），next/image 的优化器无法代取；尺寸由 width/height + aspect-ratio 固定。 */
      <img
        className="photo-tile-image"
        src={thumb}
        alt={photoAlt(photo)}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ aspectRatio: String(ratio) }}
      />
    );

  return (
    <figure className="photo-tile" data-media-id={photo.media_id}>
      {onOpen ? (
        <button
          ref={buttonRef}
          type="button"
          className="photo-tile-button"
          onClick={() => onOpen(photo)}
          aria-label={`放大查看：${photoAlt(photo)}`}
        >
          {image}
        </button>
      ) : (
        image
      )}
      <figcaption className="photo-tile-caption">
        <span className="photo-tile-date" data-taken-on={photo.taken_on ? "set" : "empty"}>
          {formatTakenOn(photo.taken_on)}
        </span>
        {photo.caption ? <span className="photo-tile-note">{photo.caption}</span> : null}
        {note ? <span className="photo-tile-note">{note}</span> : null}
      </figcaption>
    </figure>
  );
}
