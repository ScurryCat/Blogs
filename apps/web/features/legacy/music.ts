/**
 * 曲目清单 —— 旧站 `assets/js/music.js` 的 `window.PL_MUSIC` 迁移。
 *
 * 地址沿用**旧站同一个静态路径** `/assets/music/<file>`（旧站 `assets/music/` 已入库三首曲目）：
 *  - 仓库里只有一份音频，不把 15 MB 版权音频再复制进 `apps/web/public`（06 的素材分层要求
 *    不把整套素材库复制进公开镜像）；
 *  - 过渡期旧站静态根本来就在提供这个路径，因此新站接上后立刻能播；
 *  - 生产环境由网关提供 `/assets/music/`（T10 的部署事项，已登记在交付单的集成申请里）。
 *
 * 两种「放不出声」要分清（否则排查会被误导）：
 *  - `EMPTY_MUSIC`：曲目清单为空（克隆下来没写 music.js）；
 *  - `UNAVAILABLE_MUSIC`：清单有曲目、但音频取不到（404 / 网络不通 / 网关没转发该路径）。
 */

import musicJson from "./data/music.json";

export interface MusicTrack {
  title: string;
  artist: string;
  src: string;
}

/** 静态根：与旧站 `assets/music/` 一致，只有一份音频。 */
export const MUSIC_BASE = "/assets/music/";

export const tracks: MusicTrack[] = (musicJson as MusicTrack[]).map((track) => ({
  title: track.title,
  artist: track.artist,
  // 旧站配置里写的是 `assets/music/x.mp3`，这里只换成站点绝对路径，文件名不动。
  src: `${MUSIC_BASE}${track.src.replace(/^assets\/music\//, "").replace(/^assets\//, "")}`,
}));

/** 曲目清单为空（旧站 phone.js 的同一句文案）。 */
export const EMPTY_MUSIC = {
  title: "还没有曲子",
  artist: "把音频放进 assets/music/ 并写进 music.js",
} as const;

/** 有曲目但取不到音频：如实说明原因与检查位置。 */
export const UNAVAILABLE_MUSIC = {
  title: "音频取不到",
  artist: "曲目清单在，但 /assets/music/ 取不到文件：检查该路径是否可访问（部署需转发）。",
} as const;

export const SFX_SRC = "/assets/legacy/sfx/select.mp3";
