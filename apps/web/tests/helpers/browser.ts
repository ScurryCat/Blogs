/**
 * 测试环境的浏览器 API 替身。
 *
 * jsdom 不实现 `matchMedia` 的查询语义，也没有媒体播放；
 * 这里提供**只在测试里使用**的可控替身，避免把 jsdom 的结果当成浏览器结果。
 */

import { vi } from "vitest";

export interface MediaQueryState {
  "(prefers-reduced-motion: reduce)"?: boolean;
  "(pointer: fine)"?: boolean;
}

/** 安装可控的 matchMedia；返回恢复函数。 */
export function mockMatchMedia(state: MediaQueryState = {}): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: Boolean(state[query as keyof MediaQueryState]),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

/** jsdom 没有实现媒体播放：用替身记录调用，不假装真的出声。 */
export function stubMediaPlayback() {
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const load = vi.fn();
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: play,
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: pause,
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, "load", {
    configurable: true,
    writable: true,
    value: load,
  });
  return { play, pause, load };
}
