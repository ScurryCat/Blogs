#!/usr/bin/env node
/**
 * T02 · 旧站资产/数据迁移工具（可重复运行，幂等）。
 *
 * 旧站（仓库根目录的 `*.html` / `assets/`）是**只读参考**：本工具只读它，
 * 把已审查的静态资源与结构化数据复制/转换到 `apps/web` 内：
 *
 *   assets/js/site.js        -> features/legacy/data/site.json
 *   assets/js/posts.js       -> features/legacy/data/posts.json
 *   assets/js/map-data.js    -> features/legacy/data/map.json
 *   assets/js/music.js       -> features/legacy/data/music.json
 *   assets/js/curtain-data.js-> features/runtime/effects/curtain-data.json   （Joker 帷幕矢量帧）
 *   assets/css/*.css         -> styles/legacy/*.css                          （逐字节 + 来源头注释）
 *   assets/img/**, fonts/**, sfx/** -> public/assets/legacy/**               （逐字节）
 *
 * **有意不复制 `assets/music/*.mp3`**：这三首曲目**已经在仓库根的 `assets/music/` 入库**
 * （`.gitignore` 里有专门说明），再复制一份会在仓库里多出 15 MB 的同一批版权音频，
 * 也与 06「不把整套素材库复制进公开镜像」的要求相悖。
 *
 * 因此曲目清单沿用**旧站同一个静态路径** `/assets/music/<file>`（`features/legacy/music.ts`
 * 的 `MUSIC_BASE`），不写 `/assets/legacy/music/`：这样仓库只有一份音频，
 * 生产环境由网关提供该路径（T10 的部署事项，已登记在 T02-result.md 的集成申请里）。
 * 取不到文件时播放器显示的是 **「音频取不到」**（有清单、取不到），
 * 与「还没有曲子」（清单为空）是两种不同的状态，不要混为一谈。
 *
 * 下面的 `rm(public/assets/legacy/music)` 是**守卫**：万一有人手动把音频复制进来，
 * 重跑本工具会删掉它，保证「只有一份」这条约定不会被悄悄破坏。
 *
 * 用法：node apps/web/tools/legacy-migration/migrate.mjs
 *       node apps/web/tools/legacy-migration/migrate.mjs --assets-only   # 只重跑资源复制+守卫，不写数据 JSON/CSS
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/web/tools/legacy-migration -> apps/web -> apps -> 仓库根 */
const webRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const legacy = (...parts) => path.join(repoRoot, "assets", ...parts);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** 在隔离沙箱里跑旧站的「纯数据」脚本，取回它挂到 window 上的全局量。 */
function loadLegacyGlobal(rel, key) {
  const file = legacy(rel);
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(readFileSync(file, "utf8"), { filename: file }).runInContext(sandbox);
  const value = sandbox[key];
  if (value === undefined) throw new Error(`${rel} 没有设置 window.${key}`);
  // 结构化克隆，避免把沙箱里的对象泄漏到宿主 realm。
  return JSON.parse(JSON.stringify(value));
}

async function writeJson(outPath, value) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** 复制一棵目录树（逐字节），返回文件数。缺目录时返回 0，不报错。 */
async function copyTree(from, to) {
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) count += await copyTree(src, dest);
    else if (entry.isFile()) {
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(src, dest);
      count += 1;
    }
  }
  return count;
}

/**
 * CSS 迁移：除下面这条**唯一**的路径改写外，声明内容零改动。
 * 旧站 CSS 用 `url(../img/...)`（相对 assets/css/），打包后的样式表不再与 assets/ 同级，
 * 因此把相对前缀改成 Next 的静态根 `/assets/legacy/...`；其余字节原样保留。
 */
const CSS_REWRITES = [
  ["url(../img/", "url(/assets/legacy/img/"],
  ["url(../fonts/", "url(/assets/legacy/fonts/"],
  ["url(../sfx/", "url(/assets/legacy/sfx/"],
];

async function copyCss(name) {
  const buffer = await readFile(legacy("css", name));
  const digest = sha256(buffer);
  let text = buffer.toString("utf8");
  let rewrites = 0;
  for (const [from, to] of CSS_REWRITES) {
    const parts = text.split(from);
    rewrites += parts.length - 1;
    text = parts.join(to);
  }
  const header =
    `/* 迁移自旧站 assets/css/${name}（T02）。原文件 sha256=${digest}，\n` +
    `   仅把 ${rewrites} 处 url(../img|fonts|sfx/…) 改写为 /assets/legacy/…（静态根），其余逐字节一致。\n` +
    `   旧站仍是正式站点，本文件不反向影响它；改动请同步更新 apps/web/styles/legacy/PROVENANCE.md。 */\n`;
  const out = path.join(webRoot, "styles", "legacy", name);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, header + text);
  return { name, bytes: buffer.length, rewrites, sha256: digest.slice(0, 12) };
}

const CSS_FILES = [
  "base.css",
  "chrome.css",
  "phone.css",
  "home.css",
  "post.css",
  "map.css",
  "about.css",
  "weather.css",
  "guestbook.css",
  "poll.css",
];

async function main() {
  // `--assets-only`：只重跑静态资源复制与「无明智」守卫，**不**重写
  // `features/legacy/data/*.json` 与旧站 CSS。用于在多人并行开发时验证
  // 「重跑迁移不会把已移除的图片再生成回 public/」，避免覆盖别人正在改的数据。
  const assetsOnly = process.argv.includes("--assets-only");

  const copied = {};
  copied.img = await copyTree(legacy("img"), path.join(webRoot, "public/assets/legacy/img"));
  copied.fonts = await copyTree(legacy("fonts"), path.join(webRoot, "public/assets/legacy/fonts"));
  copied.sfx = await copyTree(legacy("sfx"), path.join(webRoot, "public/assets/legacy/sfx"));
  // 音频有意不复制，见文件头注释。
  await rm(path.join(webRoot, "public/assets/legacy/music"), { recursive: true, force: true });

  // 第三轮 N6 · 不含明智吾郎的活动素材库：以下图片**不得**进入公开目录。
  // 源文件已在仓库根 `assets/` 删除/替换；这里再留一道守卫，避免有人回滚旧源
  // 或手动把文件放回来时又被复制进 `public/`。移除原因、哈希与恢复方式见
  // `docs/design-references/persona-assets-removed.md`。
  // 注意：`crowd/**`（人群过场）不在排除范围，禁止按 `crow` 子串批量删除。
  const EXCLUDED_IMG = ["icon/crow.webp", "band-halftone.jpg"];
  for (const rel of EXCLUDED_IMG) {
    await rm(path.join(webRoot, "public/assets/legacy/img", rel), { force: true });
  }

  if (assetsOnly) {
    console.log(
      `assets-only: img=${copied.img} fonts=${copied.fonts} sfx=${copied.sfx}` +
        `（未重写数据 JSON / CSS）`,
    );
    return;
  }

  const site = loadLegacyGlobal("js/site.js", "PL_SITE");
  const posts = loadLegacyGlobal("js/posts.js", "PL_POSTS");
  const map = loadLegacyGlobal("js/map-data.js", "PL_MAP");
  const music = loadLegacyGlobal("js/music.js", "PL_MUSIC");
  const curtain = loadLegacyGlobal("js/curtain-data.js", "PL_CURTAIN");

  await writeJson(path.join(webRoot, "features/legacy/data/site.json"), site);
  await writeJson(path.join(webRoot, "features/legacy/data/posts.json"), posts);
  await writeJson(path.join(webRoot, "features/legacy/data/map.json"), map);
  await writeJson(path.join(webRoot, "features/legacy/data/music.json"), music);
  await writeJson(
    path.join(webRoot, "features/runtime/effects/curtain-data.json"),
    curtain,
  );

  const css = [];
  for (const name of CSS_FILES) css.push(await copyCss(name));

  const lines = [
    `posts: ${posts.length} 篇`,
    `map: ${map.length} 个地点`,
    `music: ${music.length} 首（音频文件未复制）`,
    `curtain: ${curtain.sil.f.length} 个剪影关键帧 / total=${curtain.total}ms`,
    `assets: img=${copied.img} fonts=${copied.fonts} sfx=${copied.sfx}`,
    `css: ${css.map((c) => `${c.name}(${c.sha256})`).join(" ")}`,
  ];
  console.log(lines.join("\n"));
}

await main();
