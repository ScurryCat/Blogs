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
| `assets/js/poll-model.js` / `poll.js` / `assets/css/poll.css` | 可复用二选一问卷：每题本地状态、浮层/内嵌渲染与独立样式 |
| `poll-demo.html` | 可直接访问的复用示例与操作检查，不加入主导航 |
| `assets/js/pjax.js` | 站内跳转不重载文档（BGM 因此不断、没有白闪）。页脚本用 `data-page` 标记，每次换页重跑；共享脚本只加载一次 |
| `assets/css/base.css` | Design Token 与字体声明 |

设计语言收在四个变量里：`--red` 唯一强调色、`--black` 底、`--white` 白纸卡片、`--yellow` 链接与提示。

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

必须用 HTTP 服务打开，直接双击 `index.html`（`file://`）会因为 fetch 跨域读不到文章数据。

## 部署（nginx）

这个站没有构建步骤，**`git pull` 就是部署** —— nginx 每次都从磁盘读文件，改完即时生效，不需要重启或 reload（reload 只用于配置变更）。

最省事的接法是让 nginx 的 root 直接指向克隆目录：

```nginx
server {
    listen 80;
    server_name 你的域名;
    root /path/to/Blogs;          # 直接指过去，不做任何拷贝
    index index.html;
    etag on;
    add_header Cache-Control "no-cache";                       # HTML 回源校验
    location ~* \.(js|css|png|webp|jpg|svg|woff2?|mp3)$ { expires 1h; }
}
```

习惯同步到 `/var/www/html` 的话，别手工 `cp`，写成一条命令：

```bash
cd /path/to/Blogs && git pull && rsync -a --delete --exclude .git --exclude .gitignore ./ /var/www/html/
```

### 两个容易踩的坑

**一、静态资源被缓存住。** 文件名没有哈希（零构建的代价），所以浏览器一旦按 `max-age` 缓存了 `index.html`，它会连着几天拿旧 HTML 去加载旧 JS，看起来就是「部署没生效」——而服务器上其实早就是新的。对这种站，正确做法是 **HTML 每次回源校验**（上面的 `Cache-Control: no-cache` + ETag，命中就是 304，不浪费流量），静态资源给个短 `expires` 即可，别用 `immutable`。

**二、nginx 服务的不是你 pull 的那个目录。** 以前手工 `cp -r` 过一份的话，之后 pull 更新的是克隆目录、nginx 服务的是那份旧拷贝，两份从此各走各的。一分钟判清：

```bash
cd /path/to/Blogs
sudo nginx -T | grep -nE "root|server_name|listen"                  # nginx 到底读哪
curl -s -o /dev/null -w "pjax.js -> %{http_code}\n" http://127.0.0.1/assets/js/pjax.js   # 200 = 目录对
diff <(curl -s http://127.0.0.1/index.html) index.html && echo "nginx 读的就是这个目录"
```

### 线上是哪个版本

`version.json`（不入库）记录了当前 checkout 的 commit 与写入时间，用一条命令就能问：

```bash
curl -s https://你的域名/version.json
# {"commit":"9e40...","short":"9e40ddc","branch":"main","time":"...","indexSha256":"741a176b88b51820"}
```

`indexSha256` 是 `index.html` 的指纹，和本地 `shasum -a 256 index.html | cut -c1-16` 对一下，就能确认服务器送出的 HTML 就是这份 checkout。

在服务器上装一次钩子，之后每次 `git pull` 自动更新它：

```bash
sh tools/deploy/install-hook.sh
```

注意：`version.json` 会暴露 commit 号与部署时间。站点对公网开放且你在意这点的话，在 nginx 里 `location = /version.json { deny all; }` 或换个不显眼的名字。

## 站内跳转（pjax）

站内链接由 `core.js` 统一接管，转场放完再交给 `pjax.js`：取回目标页 → 换掉 `#main` → `pushState`。这么做有两个直接好处：**BGM 不断**（`<audio>` 是同一个元素，整页重载会把它销毁）、**没有白闪**（转场真正盖住了换页过程）。

写新页面时要遵守两条约定：

1. **页脚本要标 `data-page`**：`<script src="assets/js/xxx.js" data-page></script>`。标了的每次换页都重跑（它负责把内容画进 `#main`），没标的只加载一次（页头页脚、手机挂件、播放器都在这一类，重跑会建两遍）。
2. **页脚本挂的全局监听/计时器要用 `window.PL.onLeave(fn)` 登记卸载**。元素级监听不用管，随 DOM 一起消失；但 `addEventListener` 挂在 window 上的、以及 `setInterval`，不登记就会随每次换页叠加泄漏。参考 `weather.js`（三个计时器）与 `map.js`（全局方向键 + 自续的 rAF）。

任何一步失败（网络、解析、目标页没有 `#main`）都会退回 `location.href` 整页跳转 —— 纯静态站的底子还在，JS 挂了也能用，只是那次音乐会被打断。

## 新增一题问卷

问卷是原生 JS + CSS/SVG，不需要构建或依赖。默认问题在 `assets/js/site.js` 的 `poll` 中配置；首次访问自动显示，关闭后可点击右下角「怪盗ch · 问卷」重新打开。数字按「展示基准 + 本机的一票」计算，不代表全站统计，也不发送网络请求。

已有六个入口页都已加载组件。独立页面需要按这个顺序引用；`base.css` 提供本站的字体与主题，`poll.css` 不依赖 `chrome.css`：

```html
<link rel="stylesheet" href="assets/css/base.css">
<link rel="stylesheet" href="assets/css/poll.css">
<script src="assets/js/poll-model.js"></script>
<script src="assets/js/poll.js"></script>
```

每道新问题使用新的稳定 `id`。`options` 恰好两个，值和标签各自不能重复；`main` 必须是其中一个值，`base` 中对应的数字必须有限且非负。问题、标题和评论全是纯文本，强调词放进数组；无需写 HTML。评论可以省略。

```js
const coffeePoll = {
  id: 'leblanc-coffee-v1',
  title: '怪盗ch',
  question: '今晚要来一杯咖啡吗？',
  questionHighlight: ['咖啡'],
  options: [
    { value: 'coffee', label: '来一杯' },
    { value: 'tea', label: '喝茶吧' }
  ],
  main: 'coffee',
  base: { coffee: 73, tea: 927 },
  comment: { author: '匿名', text: '深夜的咖啡总是很香', highlight: ['很香'] }
};

const floatingPoll = PL.poll.create(coffeePoll, { mode: 'floating' });
floatingPoll.show();
// 可重复调用 show()；close() 仅记为见过，destroy() 彻底释放实例。
floatingPoll.close();
floatingPoll.show();
floatingPoll.destroy();
```

内嵌时先准备容器，再在页面的 `data-page` 脚本中创建：

```html
<div id="coffee-poll"></div>
<script src="assets/js/coffee-page.js" data-page></script>
```

```js
// coffee-page.js：coffeePoll 配置与上例一致。
const inlinePoll = PL.poll.create(coffeePoll, {
  mode: 'inline', container: document.getElementById('coffee-poll')
});
inlinePoll.show();
```

内嵌实例自动通过现有 `PL.onLeave` 登记销毁；没有站点框架的独立页面由调用者在卸载时执行 `destroy()`。同 ID 的实例共享选择并立即同步；不同 ID 的问题互不影响。复用问题时保留 ID，改变题意或选项时换 ID。

默认浮层还提供 `PL.poll.show()`、`PL.poll.close()` 和 `PL.poll.reset()`。reset 只清除默认题的新旧记录并更新已显示的默认实例，不会清除示例或自定义题。旧 `pl-poll-v1` 记录仅迁入默认 ID；关闭与投票分别保存。每题使用 `pl-poll-v2:<编码后的 id>` 存储；存储被禁用、损坏或写入失败时，本页内仍可投票并同步，刷新后是否保留取决于浏览器是否允许写入。

可直接打开 [问卷示例](poll-demo.html)，检查 00.0%、100.0%、长问题和同题镜像，以及显示/关闭/重开/销毁。模型验证使用：

```bash
node --test tests/poll-model.test.cjs
```

通过 HTTP 打开 `tests/poll-browser.html` 并点击「Run browser checks」，可用真实 DOM 检查重复显示、关闭动画重开、销毁、键盘关闭、镜像同步、纯文本渲染和页面卸载。

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
