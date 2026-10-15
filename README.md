# Phantom Log

一个 **零框架、零构建** 的 Persona 5 风格个人博客主题。丢进任何静态托管都能直接跑。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 首页（撕纸 Hero + 文章列表） |
| `post.html` | 文章页（预告信头图 + 正文 + 目录） |
| `about.html` / `map.html` / `weather.html` | 档案 / 地图 / 天气 |
| `assets/js/posts.js` | **文章内容在这里**，正文是 Markdown |
| `assets/js/md.js` | Markdown 渲染器（含 `>` 对话、`!!!` 提示块语法，见文件头注释） |
| `assets/js/core.js` | 撕纸字、P5 日历等公共元件 |
| `assets/css/base.css` | Design Token 与字体声明 |

设计语言收在四个变量里：`--red` 唯一强调色、`--black` 底、`--white` 白纸卡片、`--yellow` 链接与提示。

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

必须用 HTTP 服务打开，直接双击 `index.html`（`file://`）会因为 fetch 跨域读不到文章数据。

## 关于素材

- 图像来自 Atlus 官方配布的 P5R 虚拟背景、Steam 商店图与 P5X 官方 Fan Kit（官方许可个人网站使用）
- 字体：撕纸英文字体为社区同人作品；中文标题/署名用[阿里妈妈数黑体](assets/fonts/AlimamaShuHeiTi-LICENSE.md)（Bold，永久免费商用，含完整 6993 字形）
- **音频不在仓库里**（版权原因）。`assets/music/` 和 `assets/clip/` 已被 `.gitignore` 排除，`assets/js/music.js` 里那三首是从 P5R 官方合集视频剪的片段。想让手机里的播放器出声，自己丢音频进 `assets/music/`，再改 `music.js` 的 `title` / `artist` / `src` 三行；不配的话播放器会自动落到「还没有曲子」的空态，不会影响其它功能

版权归 **©ATLUS ©SEGA** 所有，非商业个人使用。
