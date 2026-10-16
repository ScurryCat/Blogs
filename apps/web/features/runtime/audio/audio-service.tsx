"use client";

/**
 * 音乐 / 音效服务（01 §4、02 §7）。
 *
 * 硬性约束：
 *  - **全站只有一个音乐 `<audio>` 元素**，由 `AudioProvider` 声明式渲染并常驻根布局：
 *    关手机、切 App、跨站内路由都不停止音乐，也不会再创建第二个播放器。
 *  - **不在模块顶层读 `window` / `localStorage`**：偏好都在 effect 里读取。
 *  - 监听只挂一次，卸载时用 `AbortController` 成对清理（React 重复挂载检查下也保持一份）。
 *  - 偏好版本化读写，同时镜像回旧站键（`pl-vol` / `pl-track` / `pl-music` / `pl-sound`）：
 *    旧站仍是正式站点，用户的记忆不该被迁移抹掉。**不擅自把「已关闭」改成开启。**
 *  - 存储不可用时退化为内存，音乐照常可用（只是记不住偏好）。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { EMPTY_MUSIC, SFX_SRC, UNAVAILABLE_MUSIC, tracks } from "@/features/legacy/music";
import { LocalStateService, readLegacyString, writeLegacyString } from "@/features/runtime/storage";

const TRACK_KEY = "track";
const VOLUME_KEY = "volume";
const MUSIC_KEY = "music";
const SOUND_KEY = "sound";
const NAMESPACE = "site";
/** 自动出声前的淡入时长（旧站 1.2s）。 */
const FADE_MS = 1200;

export const MUSIC_ELEMENT_ATTR = "data-pl-music";

export interface AudioSnapshot {
  /** 曲目清单为空：界面用「还没有曲子」空态，不放假按钮。 */
  empty: boolean;
  /** 清单有曲目但音频取不到（404 / 网络不通）：界面要如实说明，不能和「没有曲子」混为一谈。 */
  unavailable: boolean;
  playing: boolean;
  index: number;
  count: number;
  title: string;
  artist: string;
  volume: number;
  currentTime: number;
  duration: number;
}

export interface AudioDebugInfo {
  /** DOM 里带音乐标记的元素数量，正常恒为 1。 */
  musicElements: number;
  /** DOM 里 `<audio>` 总数（音效池不挂 DOM，因此也不计入）。 */
  totalAudioElements: number;
  src: string;
  playing: boolean;
}

export interface AudioService {
  snapshot(): AudioSnapshot;
  subscribe(listener: () => void): () => void;
  isPlaying(): boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  previous(): void;
  select(index: number): void;
  seek(fraction: number): void;
  setVolume(volume: number): void;
  getVolume(): number;
  soundEnabled(): boolean;
  setSoundEnabled(enabled: boolean): void;
  /** 菜单音效；只在用户手势之后出声（浏览器自动播放策略）。 */
  blip(): void;
  /** 供测试断言：音乐元素数量与当前地址。 */
  debug(): AudioDebugInfo;
}

function legacyKeyFor(key: string): string {
  if (key === VOLUME_KEY) return "pl-vol";
  if (key === TRACK_KEY) return "pl-track";
  if (key === MUSIC_KEY) return "pl-music";
  return "pl-sound";
}

function readPreference<T>(prefs: LocalStateService, key: string, fallback: T): T {
  const scoped = prefs.get<T | null>(NAMESPACE, key, null);
  if (scoped !== null) return scoped;
  const legacy = readLegacyString(legacyKeyFor(key));
  if (legacy === null) return fallback;
  // 迁移一次：写进版本化键，之后只认新键。旧键保留，旧站仍可读。
  prefs.set(NAMESPACE, key, legacy as unknown as T);
  return legacy as unknown as T;
}

interface ServiceOptions {
  onVolume: (volume: number) => void;
  onSound: (enabled: boolean) => void;
}

function createService(
  audio: HTMLAudioElement,
  prefs: LocalStateService,
  signal: AbortSignal,
  options: ServiceOptions,
): AudioService {
  const listeners = new Set<() => void>();
  let index = 0;
  let volume = 0.6;
  /** 曲目清单为空（没有可播的东西）。 */
  const empty = tracks.length === 0;
  /** 有清单但元素报错：音频文件取不到。 */
  let unavailable = false;
  let autoplayDone = false;
  let loadTimer = 0;

  const rawIndex = Number(readPreference<string>(prefs, TRACK_KEY, "0"));
  if (Number.isFinite(rawIndex)) index = Math.min(Math.max(0, Math.trunc(rawIndex)), Math.max(0, tracks.length - 1));
  const rawVolume = Number(readPreference<string>(prefs, VOLUME_KEY, "0.6"));
  if (Number.isFinite(rawVolume)) volume = Math.min(1, Math.max(0, rawVolume));
  // 02 §7：**不擅自把用户记住的「音乐关闭」改成开启**。
  // 读到 off（无论来自版本化键还是旧站 pl-music）就保持静音、不自动出声；
  // 只在用户手势里点了播放才重新出声。这条分支由 tests/runtime/audio.test.tsx 钉住。
  const musicOff = readPreference<string>(prefs, MUSIC_KEY, "on") === "off";
  let soundOn = readPreference<string>(prefs, SOUND_KEY, "on") !== "off";

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const remember = (key: string, value: string) => {
    prefs.set(NAMESPACE, key, value);
    writeLegacyString(legacyKeyFor(key), value);
  };

  const currentTrack = () => tracks[index];

  function syncVolume() {
    audio.volume = volume;
    options.onVolume(volume);
  }

  function load(nextIndex: number, play: boolean) {
    if (!tracks.length) return;
    index = ((nextIndex % tracks.length) + tracks.length) % tracks.length;
    const track = currentTrack();
    if (!track) return;
    audio.src = track.src;
    remember(TRACK_KEY, String(index));
    window.clearTimeout(loadTimer);
    if (play) {
      void audio.play().catch(() => {
        // 被自动播放策略挡下：等下一次手势，不弹错误。
      });
    } else {
      // 换曲后等一下再取元数据：快速连点只请求最后一次，
      // 而且必须确认此刻仍暂停 —— 对正在播的元素调 load() 会把播放掐掉。
      loadTimer = window.setTimeout(() => {
        if (audio.paused) audio.load();
      }, 350);
    }
    notify();
  }

  // 音效池：第一次手势才建；`new Audio()` 不挂 DOM，所以不会污染「音乐元素只有一个」。
  let blipReady = false;
  let blipTurn = 0;
  let blipLast = 0;
  let blipPool: HTMLAudioElement[] = [];
  const unlock = () => {
    if (!blipReady) {
      blipReady = true;
      blipPool = [0, 1].map(() => {
        const element = new Audio(SFX_SRC);
        element.preload = "auto";
        element.volume = 0.45;
        return element;
      });
    }
    autoplay();
  };

  function autoplay() {
    if (autoplayDone || !tracks.length || musicOff || empty || unavailable) return;
    autoplayDone = true;
    if (!audio.src) load(index, false);
    const target = volume;
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        // 1.2 秒淡入：自动出声别吓人一跳。
        // 基准时间取 rAF 自己的时间戳（不要和 performance.now() 混用：两者不同源时
        // 第一帧会算出负进度，setVolume 收到负数会抛 IndexSizeError）；进度与音量都夹紧到合法区间。
        let started = -1;
        const step = (now: number) => {
          if (started < 0) started = now;
          const k = Math.min(1, Math.max(0, (now - started) / FADE_MS));
          audio.volume = Math.max(0, Math.min(1, target * k));
          if (k < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
        remember(MUSIC_KEY, "on");
      })
      .catch(() => {
        // 被策略挡下：恢复音量，等下次手势再试。
        audio.volume = target;
        autoplayDone = false;
      });
  }

  const onEnded = () => load(index + 1, true);
  const onError = () => {
    if (unavailable || !tracks.length) return;
    unavailable = true;
    audio.pause();
    notify();
  };

  audio.addEventListener("play", notify, { signal });
  audio.addEventListener("pause", notify, { signal });
  audio.addEventListener("timeupdate", notify, { signal });
  audio.addEventListener("loadedmetadata", notify, { signal });
  audio.addEventListener("ended", onEnded, { signal });
  audio.addEventListener("error", onError, { signal });
  window.addEventListener("pointerdown", unlock, { once: true, capture: true, signal });
  window.addEventListener("keydown", unlock, { once: true, capture: true, signal });
  window.addEventListener("pl:booted", autoplay, { signal });

  if (tracks.length) load(index, false);
  else notify();
  syncVolume();

  const service: AudioService = {
    snapshot: () => {
      const track = currentTrack();
      return {
        empty: empty || !track,
        unavailable,
        playing: !audio.paused && !audio.ended,
        index,
        count: tracks.length,
        title: empty || !track ? EMPTY_MUSIC.title : unavailable ? UNAVAILABLE_MUSIC.title : track.title,
        artist: empty || !track ? EMPTY_MUSIC.artist : unavailable ? UNAVAILABLE_MUSIC.artist : track.artist,
        volume,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isPlaying: () => !audio.paused && !audio.ended,
    play() {
      if (!tracks.length || empty || unavailable) return;
      void audio.play().then(
        () => remember(MUSIC_KEY, "on"),
        () => undefined,
      );
    },
    pause() {
      audio.pause();
      remember(MUSIC_KEY, "off");
    },
    toggle() {
      if (audio.paused) service.play();
      else service.pause();
    },
    next() {
      load(index + 1, !audio.paused);
    },
    previous() {
      load(index - 1, !audio.paused);
    },
    select(next) {
      load(next, !audio.paused);
    },
    seek(fraction) {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration;
      }
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      syncVolume();
      remember(VOLUME_KEY, String(volume));
      notify();
    },
    getVolume: () => volume,
    soundEnabled: () => soundOn,
    setSoundEnabled(enabled) {
      soundOn = enabled;
      remember(SOUND_KEY, enabled ? "on" : "off");
      options.onSound(enabled);
      notify();
    },
    blip() {
      if (!soundOn || !blipReady) return;
      const now = performance.now();
      if (now - blipLast < 70) return;
      blipLast = now;
      const element = blipPool[blipTurn % blipPool.length];
      blipTurn += 1;
      if (!element) return;
      try {
        element.currentTime = 0;
        void element.play().catch(() => undefined);
      } catch {
        // 音效不是完成操作的唯一反馈，失败即忽略。
      }
    },
    debug: () => ({
      musicElements: document.querySelectorAll(`audio[${MUSIC_ELEMENT_ATTR}]`).length,
      totalAudioElements: document.querySelectorAll("audio").length,
      src: audio.getAttribute("src") ?? "",
      playing: !audio.paused && !audio.ended,
    }),
  };

  return service;
}

interface AudioContextValue {
  service: AudioService | null;
  volume: number;
}

const AudioContext = createContext<AudioContextValue>({ service: null, volume: 0.6 });

export function AudioProvider({ children }: { children: ReactNode }): ReactNode {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [service, setService] = useState<AudioService | null>(null);
  const [volume, setVolume] = useState(0.6);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const controller = new AbortController();
    const prefs = new LocalStateService(1);
    const created = createService(element, prefs, controller.signal, {
      onVolume: setVolume,
      onSound: () => undefined,
    });
    setService(created);
    // 卸载时用 abort 移除本次挂上的全部监听；音乐元素本身由 React 持有。
    return () => controller.abort();
  }, []);

  // 卸载时只清监听；音乐元素由 React 保持，切页不重建、不停止。
  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const value = useMemo<AudioContextValue>(() => ({ service, volume }), [service, volume]);

  return (
    <AudioContext.Provider value={value}>
      {/* 全站唯一的音乐元素：常驻根布局，跨路由不重建。 */}
      <audio ref={audioRef} preload="none" {...{ [MUSIC_ELEMENT_ATTR]: "1" }} />
      {children}
    </AudioContext.Provider>
  );
}

function fallbackSnapshot(): AudioSnapshot {
  return {
    empty: tracks.length === 0,
    unavailable: false,
    playing: false,
    index: 0,
    count: tracks.length,
    title: tracks[0]?.title ?? EMPTY_MUSIC.title,
    artist: tracks[0]?.artist ?? EMPTY_MUSIC.artist,
    volume: 0.6,
    currentTime: 0,
    duration: 0,
  };
}

export function useAudioService(): AudioService | null {
  return useContext(AudioContext).service;
}

/** 订阅音频快照的 hook：服务就绪前返回稳定的空快照（不读 window）。 */
export function useAudioSnapshot(): AudioSnapshot {
  const { service } = useContext(AudioContext);
  const [snapshot, setSnapshot] = useState<AudioSnapshot>(fallbackSnapshot);
  const refresh = useCallback(() => {
    if (service) setSnapshot(service.snapshot());
  }, [service]);
  useEffect(() => {
    // 首帧用空快照（服务端与客户端一致），挂载后一帧再同步真实状态；
    // 之后由 subscribe 推送，不在 effect 里同步 setState。
    const frame = window.requestAnimationFrame(refresh);
    const unsubscribe = service?.subscribe(refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe?.();
    };
  }, [refresh, service]);
  return snapshot;
}

/** 音效开关的订阅式读取（页头 ♪ 按钮用）。 */
export function useSoundEnabled(): boolean {
  const service = useAudioOrDefault();
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const sync = () => setEnabled(service.soundEnabled());
    sync();
    return service.subscribe(sync);
  }, [service]);
  return enabled;
}

/** 没有服务时（SSR / 首次渲染）也能用的空实现。 */
export function useAudioOrDefault(): AudioService {
  const { service } = useContext(AudioContext);
  const fallback = useMemo<AudioService>(
    () => ({
      snapshot: fallbackSnapshot,
      subscribe: () => () => undefined,
      isPlaying: () => false,
      play: () => undefined,
      pause: () => undefined,
      toggle: () => undefined,
      next: () => undefined,
      previous: () => undefined,
      select: () => undefined,
      seek: () => undefined,
      setVolume: () => undefined,
      getVolume: () => 0.6,
      soundEnabled: () => true,
      setSoundEnabled: () => undefined,
      blip: () => undefined,
      debug: () => ({ musicElements: 0, totalAudioElements: 0, src: "", playing: false }),
    }),
    [],
  );
  return service ?? fallback;
}
