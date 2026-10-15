/* =====================================================================
   PHANTOM LOG · crowd.js —— 人群过场（移植自 p5-ui 的 canvas 组件 crowd.vue）
   ---------------------------------------------------------------------
   原作是常驻背景：12 帧 512×1024 的线描路人（透明 PNG），复制成 24 个实例，
   一半镜像，从两边对着走，纵向在 0–20px 之间缓慢浮动，黑底 + 紫色辉光。
   这里拿来当**转场**用，所以比原作多两件事：

   1. fill —— 原作是 x = 宽度 + i*100 慢慢走进来（当背景正合适，当转场要等太久）；
      转场起播时就把人摊满屏幕，第一帧就是「人墙」。
   2. 用 rAF 的 dt 归一化到 60fps 推进 —— 原作按帧递减，120Hz 屏上会快一倍。

   保留的原作细节（别顺手改掉，改了就不像 P5 了）：
   - 镜像那一半用 ctx.scale(-1,1) + translate(-w,0)，屏幕位置是 w - x，
     所以 x 递减时它们**向右**走 —— 是双向人流，不是单向。
   - 每个实例的步长与浮动速度都带随机，避免整片人墙齐步走。
   - 最后那层 shadowBlur=100 / #8360c3 / rgba(0,0,0,.2) 是原作的辉光，不是滤镜。

   素材：assets/img/crowd/crowd0-11.png（12 张共 228 KB，取自 p5-ui）。
   尺寸不是照抄的：原作在 1440 宽上是一堵人墙，在 390 宽的手机上一个人占满整屏。
   现在的数字（人像高度、人数、铺开跨度）是按离线渲染出来的帧逐个核对定的，
   要调就改 spawn() 里那四个量，改完把 390 / 1440 两个宽度各渲一帧看一眼。
   调用方见 core.js 的转场调度：只在 map.html 上加载，从地图出发时优先于 dive/curtain。
   ===================================================================== */
(function () {
  const FRAMES = 12;
  const DIR = 'assets/img/crowd/';
  const GLOW = '#8360c3';           // 原作辉光色
  const OVERLAY = 'rgba(0,0,0,.2)'; // 原作盖在黑底上的那层
  const BOB = 20;                   // 纵向浮动上限（原作 y 在 0–20 之间）
  const BASE = 2;                   // 原作 step 基数：实际步长 = BASE + rand*BASE
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const imgs = [];                  // 12 张预加载图
  let el = null, cv = null, ctx = null;
  let list = [];                    // 24 个实例
  let raf = 0, dpr = 1, w = 0, h = 0, prev = 0;

  /* 预加载：幂等，core.js 在 idle 和首次交互时各调一次 */
  function warm() {
    if (imgs.length) return;
    for (let i = 0; i < FRAMES; i++) {
      const im = new Image();
      im.decoding = 'async';
      im.src = DIR + 'crowd' + i + '.png';
      imgs.push(im);
    }
  }

  /* 12 张全部解码完成才算就绪；没就绪时 play() 返回 false，调用方退回斜切 */
  function ready() {
    return imgs.length === FRAMES && imgs.every((im) => im.complete && im.naturalWidth > 0);
  }

  /* 建画布。dpr 上限 2：线描图在高分屏上不放大就是糊的，再高只是白烧 GPU */
  function build() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'crowd';
    el.setAttribute('aria-hidden', 'true');
    cv = document.createElement('canvas');
    el.appendChild(cv);
    document.body.appendChild(el);
    ctx = cv.getContext('2d');
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后一律用 CSS 像素坐标画
  }

  /* 摊人：屏幕位置均匀铺在 [-0.15w, span*w]，右侧还留人继续入场。
     镜像的那些屏幕位置是 w - x，所以要把目标位置换算回传参 x。

     人像尺寸是被离线渲染核对过的：原作把每个人画成 (高度/2, 高度)，在 1440 宽上
     是一堵人墙（好看），在 390 宽的手机上一个人就占满整屏、完全不像人群。
     所以窄屏降到 0.8h 并底对齐（脚踩画面底部），390→1440 之间线性过渡，不跳变。 */
  function spawn() {
    const narrow = w < 720;
    const n = narrow ? 16 : FRAMES * 2;              // 窄屏 16 人：再少就稀稀拉拉，再多糊成一块白
    const span = w * (narrow ? 2.4 : 2.6);
    const k = Math.min(Math.max((w - 390) / 1050, 0), 1); // 390 宽 → 0，1440 宽 → 1
    const fh = h * (.8 + .2 * k), fw = fh / 2, anchor = h - fh;
    const pairs = n / 2;                             // 窄屏用不满 12 张，按比例摊开取样
    list = [];
    for (let i = 0; i < n; i++) {
      const at = -0.15 * w + (i / (n - 1)) * span;   // 想要的屏幕位置
      const mirror = i % 2 === 0;
      list.push({
        img: imgs[Math.floor((i >> 1) * FRAMES / pairs) % FRAMES],
        x: mirror ? w - at : at,
        y: anchor + BOB,
        anchor, fw, fh, mirror, up: true,
        step: (BASE + Math.random() * BASE) * Math.max(w / 1280, .55),
        stepY: .2 + Math.random() * .2
      });
    }
  }

  function frame(now) {
    // 视口变了就地重同步：手机上地址栏收放、桌面拖窗口，以及 resize 事件漏掉的情况。
    // 不同步的话背板尺寸和 CSS 尺寸（100%×100%）对不上，人像会被拉伸变形。
    if (innerWidth !== w || innerHeight !== h) { resize(); spawn(); }
    const dt = Math.min((now - prev) / 16.667, 2) || 1; // 归一化到 60fps，卡顿时不跳帧
    prev = now;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    for (const it of list) {
      if (!it.img.complete || !it.img.naturalWidth) continue;
      it.x -= it.step * dt;
      // 走出画面就从另一侧重新入场（转场只跑 1 秒，这是给偶发的长停留兜底）
      const out = it.mirror ? it.x > w + it.fw : it.x < -it.fw;
      if (out) it.x = it.mirror ? -it.fw - Math.random() * w * .4 : w + Math.random() * w * .4;
      // 纵向浮动：在 anchor 与 anchor+20 之间往返，到顶就换向
      if (it.up) { if (it.y - it.stepY * dt >= it.anchor) it.y -= it.stepY * dt; else it.up = false; }
      else { if (it.y + it.stepY * dt <= it.anchor + BOB) it.y += it.stepY * dt; else it.up = true; }

      ctx.save();
      if (it.mirror) { ctx.scale(-1, 1); ctx.translate(-w, 0); }
      ctx.drawImage(it.img, 0, 0, it.img.naturalWidth, it.img.naturalHeight, it.x, it.y, it.fw, it.fh);
      ctx.restore();
    }

    ctx.save();
    ctx.shadowBlur = 100;
    ctx.fillStyle = OVERLAY;
    ctx.shadowColor = GLOW;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    raf = requestAnimationFrame(frame);
  }

  /* 起播。返回 true 表示这一帧已经盖住了，调用方负责过 wait 毫秒后跳转。
     reduce 或图没就绪 → 返回 false，让 core.js 走它原来的兜底链路。 */
  function play() {
    if (reduce || !ready()) return false;
    if (raf) return true;            // 已经在跑：连点两次不要重建
    build();
    resize();
    spawn();
    el.classList.add('on');
    prev = performance.now();
    raf = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (el) el.classList.remove('on');
  }

  /* 转场中途用户旋转屏幕 / 拉伸窗口：重建背板尺寸，人墙按新宽度重排 */
  addEventListener('resize', () => {
    if (!raf) return;
    resize();
    spawn();
  });

  window.PL = window.PL || {};
  window.PL.crowd = { warm, ready, play, stop };
})();
