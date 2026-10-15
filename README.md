# Phantom Log

一个 **零框架、零构建** 的 Persona 5 风格个人博客主题。丢进任何静态托管都能直接跑。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 首页（撕纸 Hero + 文章列表） |
| `post.html` | 文章页（预告信头图 + 正文 + 目录） |
| `about.html` / `map.html` / `weather.html` | 档案 / 地图 / 天气 |
| `guestbook.html` | 留言板。存取走 `guestbook-store.js` 这层 adapter，默认存在访客本地（示例模式）；接 Supabase 时改 `site.js` 的 `guestbook.store` 即可，页面代码不用动 |
| `assets/js/posts.js` | **文章内容在这里**，正文是 Markdown |
| `assets/js/md.js` | Markdown 渲染器（含 `>` 对话、`!!!` 提示块语法，见文件头注释） |
| `assets/js/core.js` | 撕纸字、P5 日历等公共元件 |
| `assets/js/poll.js` | 右下角的「怪盗ch」问卷，首次进站弹一次；票数是本地装饰（`site.js` 的 `poll.base`） |
| `assets/js/pjax.js` | 站内跳转不重载文档（BGM 因此不断、没有白闪）。页脚本用 `data-page` 标记，每次换页重跑；共享脚本只加载一次 |
| `assets/css/base.css` | Design Token 与字体声明 |

设计语言收在四个变量里：`--red` 唯一强调色、`--black` 底、`--white` 白纸卡片、`--yellow` 链接与提示。

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

必须用 HTTP 服务打开，直接双击 `index.html`（`file://`）会因为 fetch 跨域读不到文章数据。

## 站内跳转（pjax）

站内链接由 `core.js` 统一接管，转场放完再交给 `pjax.js`：取回目标页 → 换掉 `#main` → `pushState`。这么做有两个直接好处：**BGM 不断**（`<audio>` 是同一个元素，整页重载会把它销毁）、**没有白闪**（转场真正盖住了换页过程）。

写新页面时要遵守两条约定：

1. **页脚本要标 `data-page`**：`<script src="assets/js/xxx.js" data-page></script>`。标了的每次换页都重跑（它负责把内容画进 `#main`），没标的只加载一次（页头页脚、手机挂件、播放器都在这一类，重跑会建两遍）。
2. **页脚本挂的全局监听/计时器要用 `window.PL.onLeave(fn)` 登记卸载**。元素级监听不用管，随 DOM 一起消失；但 `addEventListener` 挂在 window 上的、以及 `setInterval`，不登记就会随每次换页叠加泄漏。参考 `weather.js`（三个计时器）与 `map.js`（全局方向键 + 自续的 rAF）。

任何一步失败（网络、解析、目标页没有 `#main`）都会退回 `location.href` 整页跳转 —— 纯静态站的底子还在，JS 挂了也能用，只是那次音乐会被打断。

## 留言板接后端

默认 `guestbook.store: 'local'`：留言只存在访客自己的浏览器里（页面上也这么写了）。要变成真实共享的留言板，按 `assets/js/guestbook-store.js` 顶部注释里的 SQL 建好 Supabase 表（含 RLS 与**列级权限**——联系方式那一列不让匿名读者读到），把 `endpoint` / `key` 填进 `site.js` 的 `guestbook` 块，再把 `store` 改成 `'remote'`。

anon key 是公开的（就放在前端），所以**权限必须靠 RLS**，别把它当密码用。

## 数据刷新

关于页的 GitHub 热力图数据是**构建期抓的**（`assets/js/heatmap-data.js`），所以运行时零外部请求，也不依赖任何第三方图床：

```bash
python3 tools/github-heatmap/fetch.py      # 默认抓 ScurryCat 最近一年
```

公开贡献日历只统计「提交到默认分支 / PR / issue」，**私有仓库的贡献默认不计入**。若活跃都在私有仓库，去 GitHub → Settings → Public profile 勾上 `Include private contributions on my profile` 再重跑（只显示等级与次数，不泄露仓库名）。

## 关于素材

- 图像来自 Atlus 官方配布的 P5R 虚拟背景、Steam 商店图与 P5X 官方 Fan Kit（官方许可个人网站使用）
- 字体：撕纸英文字体为社区同人作品；中文标题/署名用[阿里妈妈数黑体](assets/fonts/AlimamaShuHeiTi-LICENSE.md)（Bold，永久免费商用，含完整 6993 字形）
- 地图页出发时的**人群过场**（`assets/js/crowd.js` + `assets/img/crowd/*.png`）移植自社区 Vue 组件库 p5-ui（npm 包名 `p5-ui`）的 canvas 组件，12 帧路人图共 228 KB，跟着仓库走
- 对话框里「我」的立绘取自官方画集 `p5artbook-020` 右页的正面线稿，本地抠底成透明 PNG（`tools/portrait-crop/`），11 KB
- 站内导航的**帷幕转场**（`assets/js/curtain.js` + `curtain-data.js`）是《过场joker拉下帷幕》的矢量复刻：逐帧追踪轮廓成顶点表，渲染时对相邻帧做顶点插值（形变），canvas + rAF 逐帧绘制。数据懒加载（40 KB，gzip 13 KB），生成脚本在 `tools/curtain/`
- **音频在仓库里**：手机播放器的三首（`Beneath the Mask` / `Beneath the Mask -rain-` / `星と僕らと`）随仓库分发，合计 17 MB，是 **128 kbps 转码版**（原始 320 kbps 每首 10–16 MB，做背景音乐太重；要换回原质就替换文件，`music.js` 不用改）。这三首是 Lyn 演唱、©ATLUS 的商业发行曲，**公开仓库等于公开分发**；不想要就删掉 `assets/music/*.mp3`，播放器会自动落到「还没有曲子」空态。官方过场影像（`assets/clip/`）仍然不进仓库
- **BGM 跨页不断**：站内跳转走 `pjax.js`（换文档内容而不重载），`<audio>` 始终是同一个元素，所以音乐不会被打断或从头开始。只有兜底退回整页跳转时（取不到目标页）才会重来
- **开站自动播放**：默认放数组第一首（`Beneath the Mask`）。浏览器不给没有手势的页面出声，所以借开场画面被点掉那一下；开场被跳过时会先尝试一次、失败则等页面上的第一次交互。访客主动暂停过就不再自动播（记在 `pl-music`），把想默认播的那首挪到数组第一位即可

版权归 **©ATLUS ©SEGA** 所有，非商业个人使用。
