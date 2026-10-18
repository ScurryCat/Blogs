/**
 * 共享图片选择器（P5 第一批 · C3）统一入口。
 *
 * 契约（P5-C0 集成契约 §4.3）：C4 与后续页面只 import 这里的名字，
 * 不直接依赖内部文件路径，避免选择器内部拆分时破坏调用方。
 *
 * ```tsx
 * import { MediaPickerDialog, MediaThumb, type PickedImage } from "@/features/media-picker";
 * ```
 */

export { MediaPickerDialog, type MediaPickerDialogProps } from "./media-picker-dialog";
export { MediaThumb, type MediaThumbProps } from "./media-thumb";
export {
  listAdminMedia,
  getAdminMedia,
  uploadMedia,
  describeMediaError,
  describeMediaUploadError,
  MediaUploadRejected,
  isApiClientError,
  isTransportError,
  type ListAdminMediaOptions,
  type MediaAdminPage,
  type UploadMediaOptions,
} from "./api";
export {
  ADMIN_MEDIA_PATH,
  HEIC_UNSUPPORTED_MESSAGE,
  LOCAL_PREVIEW_NOTE,
  MEDIA_ALT_MAX_CODEPOINTS,
  MEDIA_PICKER_ALT_HINT,
  MEDIA_PICKER_DEFAULT_MAX,
  MEDIA_PICKER_PAGE_SIZE,
  MEDIA_UPLOAD_ACCEPT,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_UPLOAD_MIME_TYPES,
  PUBLIC_REFERENCE_BADGE,
  PUBLIC_REFERENCE_WARNING,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_FORMAT_MESSAGE,
  codepointLength,
  isAltValid,
  isHeicFile,
  isMediaReady,
  isPubliclyReferenced,
  mediaMetaLabel,
  mediaSizeLabel,
  mediaStatusLabel,
  mediaVariantUrl,
  mergeMediaPages,
  normalizePickedImages,
  toPickedImages,
  validateImageFile,
  type MediaAdminOut,
  type MediaPickerItem,
  type MediaPickerMedia,
  type PickedImage,
} from "./types";
