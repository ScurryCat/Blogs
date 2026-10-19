/**
 * 客户端随机 id。
 *
 * 为什么单独抽出来：浏览器的 `crypto.randomUUID()` **只在安全上下文可用**
 * （HTTPS 或 localhost）。本站在没有备案/域名时用 `http://<公网 IP>:<端口>`
 * 试用，属于非安全上下文，`randomUUID` 为 `undefined`；而服务端部分 DTO
 * （如 `POST /admin/work-drafts/{id}/commit` 的 `commit_key`）要求标准 UUID。
 * 回落实现必须生成**合法 UUID v4 形状**，不能是 `commit-...` / `ck-...`
 * 这类自定义字符串，否则会被 Pydantic 以 422 拒绝。
 *
 * 用途是幂等键/入口 id，不需要密码学强度；仍然优先用 `crypto.getRandomValues`
 * （非安全上下文也可用），只有在完全没有 crypto 时才退到 Math.random。
 */

function randomBytes(): Uint8Array {
  const cryptoApi = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 0x100);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * 生成标准 UUID v4 字符串（RFC 4122 形状）。
 *
 * 有 `crypto.randomUUID()` 时直接用（HTTPS / localhost）；
 * 否则用 `getRandomValues` 生成并设置 version/variant 位。
 */
export function newUuid(): string {
  const cryptoApi = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = randomBytes();
  // version 4（高 4 位 0100）与 variant 10xx。
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
