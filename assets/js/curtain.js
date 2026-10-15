/* =====================================================================
   PHANTOM LOG · curtain.js —— 《过场joker拉下帷幕》的矢量还原 · canvas 渲染器
   ---------------------------------------------------------------------
   数据在 curtain-data.js（逐帧矢量轮廓 + 实测时间轴），本文件只负责解码、形变、绘制。
   数据是**懒加载**的：先画页面，idle 或首次交互时才把 32 KB 拉下来（gzip 11 KB），
   所以首屏不为它付钱 —— 和 core.js 预热视频是同一个套路。

   为什么是 canvas 而不是 CSS 关键帧（上一版的做法）：
     1. 上一版只有一个静止姿势，靠 CSS 位移假装在走 —— 实测拿帧 7 的姿势去拟合别的
        帧，等比缩放+平移的最优 IoU 只有 0.38~0.78，姿势是真的在变，骗不过去。
     2. 形变（相邻帧轮廓顶点插值）没有对应的 CSS 能力，只能自己逐帧算。
     3. canvas 用 rAF 驱动，帧率无关（dt 归一化），掉帧只是跳过一点进度、不会失步。

   坐标映射：按「640×360 等比放进视口」映射 —— 桌面铺满宽度，手机整只人可见、
   不变形、居中；红幕与封口是纯色，直接铺满整个视口，不受这个映射影响。
   ===================================================================== */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DATA_SRC = 'assets/js/curtain-data.js';
  /* 内容框 = 整幅源片。曾经设成 500 宽（以为右侧是空的），结果结尾那道斩击
     向右上扫到 x=639 被裁掉了 —— 对账时白区 IoU 只有 0.099。整幅映射才不裁内容。 */
  const CB = { x: 0, y: 0, w: 640, h: 360 };

  let D = null;            // 矢量数据
  let P = null;            // 解码后的姿势缓存
  let el = null, cv = null, ctx = null;
  let raf = 0, dpr = 1, W = 0, H = 0, s = 1, ox = 0, oy = 0;
  let t0 = 0, color = null, loading = false;

  /* ---------------- 解码 ---------------- */
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

  function dec(str) {                       // 有符号 36 进制文本 -> 数字数组
    const out = [];
    let i = 0;
    while (i < str.length) {
      let sign = 1;
      if (str[i] === '-') { sign = -1; i++; }
      let v = 0, any = false;
      while (i < str.length && str[i] !== ',') {
        v = v * 36 + B36.indexOf(str[i]);
        i++; any = true;
      }
      if (any) out.push(sign * v);
      i++;                                   // 跳过逗号
    }
    return out;
  }

  /* delta 串 -> 顶点：每 anchor 点重新写绝对值，避免纯 delta 的随机游走漂移 */
  function pose(tokens, n, q, anchor) {
    const pts = new Float32Array(n * 2);
    let px = 0, py = 0;
    for (let i = 0; i < n; i++) {
      if (i % anchor === 0) {
        px = tokens[i * 2] / q;
        py = tokens[i * 2 + 1] / q;
      } else {
        px += tokens[i * 2] / q;
        py += tokens[i * 2 + 1] / q;
      }
      pts[i * 2] = px; pts[i * 2 + 1] = py;
    }
    return pts;
  }

  function prepare() {
    if (P || !D) return;
    const q = D.q, a = D.anchor;
    P = {
      sil: D.sil.d.map((d, i) => pose(dec(d), D.sil.n ? D.sil.n[i] : 192, q, a)),
      silF: D.sil.f,
      /* 第二块：斗篷被蓝幕切成独立一块的那几帧（f6/f8）。只有两帧、相隔两帧，
         不做形变，交叉淡化就够 */
      sil2: (D.sil2 ? D.sil2.d : []).map((d) => pose(dec(d), 96, q, a)),
      sil2F: D.sil2 ? D.sil2.f : [],
      wave: D.wave.d.map((d) => pose(dec(d), 96, q, a)),
      waveF: D.wave.f,
      white: D.white.d.map((set) => set.map((tok) => {
        if (tok[0] === 's') {                                  // 描边：线宽 + 绝对值点列
          const c = tok.indexOf(':');
          return { stroke: +tok.slice(1, c) / q, pts: dec(tok.slice(c + 1)).map((v) => v / q), stroked: true };
        }
        return { pts: pose(dec(tok.slice(2)), 48, q, a), stroked: false };
      })),
      whiteF: D.white.f
    };
  }

  /* 只在关键帧附近存在的元素（第二块、白色块）走一个包络淡入淡出：
     上一版白色块画完最后一帧还一直留着，f45 那帧原片根本没有白色 —— 就是这个漏的 */
  function envelope(frames, f, pad) {
    if (!frames.length) return 0;
    if (f < frames[0] - pad || f > frames[frames.length - 1] + pad) return 0;
    if (f < frames[0]) return (f - (frames[0] - pad)) / pad;
    const last = frames[frames.length - 1];
    if (f > last) return 1 - (f - last) / pad;
    return 1;
  }

  /* ---------------- 形变 ---------------- */
  /* 相邻两帧轮廓顶点数相同（生成时统一过），直接线性插值 —— 30fps 的原片因此在
     60fps 上是连续形变，而不是跳帧 */
  function blend(a, b, t, out) {
    const n = a.length;
    for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * t;
    return out;
  }

  /* 顶点表 -> Path2D：Catmull-Rom 转三次贝塞尔，闭合。段数决定平滑程度，
     step=1 表示每两个采样点之间一段，够用且不炸 CPU */
  function toPath(pts, step) {
    const n = pts.length / 2, p = new Path2D();
    if (n < 3) return p;
    const at = (i) => [(pts[((i % n) + n) % n * 2]), pts[((i % n) + n) % n * 2 + 1]];
    let [x0, y0] = at(0);
    p.moveTo(x0, y0);
    for (let i = 0; i < n; i += (step || 1)) {
      const [x1, y1] = at(i), [x2, y2] = at(i + 1);
      const [xm1, ym1] = at(i - 1), [x3, y3] = at(i + 2);
      p.bezierCurveTo(
        x1 + (x2 - xm1) / 6, y1 + (y2 - ym1) / 6,
        x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6,
        x2, y2);
    }
    p.closePath();
    return p;
  }

  /* ---------------- 时间轴 ---------------- */
  /* [源起始帧, 源结束帧, 输出起ms, 输出止ms] 分段线性 —— 源帧号是主时钟，
     死时间（21-39 帧那段纯黑）在生成数据时已经压缩过 */
  function frameAt(ms) {
    const T = D.timeline;
    for (let i = 0; i < T.length; i++) {
      const [f0, f1, m0, m1] = T[i];
      if (ms <= m1) return f0 + (f1 - f0) * (m1 === m0 ? 1 : (ms - m0) / (m1 - m0));
    }
    return T[T.length - 1][1];
  }

  /* 找到夹住当前源帧号的两个下标（用于形变插值） */
  function bracket(frames, f) {
    if (f <= frames[0]) return [0, 0, 0];
    for (let i = 1; i < frames.length; i++) {
      if (f <= frames[i]) {
        const t = (f - frames[i - 1]) / (frames[i] - frames[i - 1]);
        return [i - 1, i, t];
      }
    }
    const L = frames.length - 1;
    return [L, L, 0];
  }

  /* ---------------- 尺寸 / 颜色 ---------------- */
  const cssVar = (k, fb) => (getComputedStyle(document.documentElement).getPropertyValue(k) || fb).trim() || fb;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    // 隐藏标签页 / iframe 里 innerWidth 可能是 0，退到文档尺寸，别把画布建成 0×0
    W = innerWidth || document.documentElement.clientWidth || 1;
    H = innerHeight || document.documentElement.clientHeight || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    s = Math.min(W / CB.w, H / CB.h);
    ox = (W - CB.w * s) / 2 - CB.x * s;
    oy = (H - CB.h * s) / 2 - CB.y * s;
  }

  function theme() {
    color = { red: cssVar('--red', '#e5191c'), black: cssVar('--black', '#0a0a0b'), paper: cssVar('--paper', '#f4f1ea') };
  }

  /* ---------------- 绘制 ---------------- */
  const tmp = new Float32Array(192 * 2);

  function draw(fpos) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color.black;                    // 1 黑底：这一层就是「遮盖」
    ctx.fillRect(0, 0, W, H);

    /* 2 红幕：源片 f4 那一帧蓝幕整片铺满，所以这里就是一块铺满视口的纯色。
         它被剪影吃掉的过程，正是原片蓝幕消失的方式 */
    if (fpos < 24) {
      ctx.fillStyle = color.red;
      ctx.fillRect(0, 0, W, H);
    }

    /* 3 封口：一块铺满视口的黑矩形，干两件事：
         a) 高瘦视口里内容带之外会露出「信箱边」，原片蓝幕从 f9 起就不再贴画面上边
            （bbox 的 y0 从 0 变成 40），所以信箱边也该在那时转黑 —— 淡入定在 f8.5→f10；
         b) f20 时剪影只覆盖 99.5%，剩下那点缝也靠它补掉。
       必须在**视口坐标**里铺满整屏：上一版画在内容框里，视口两侧留了红边，
       对账时 f20 的幕色 IoU 直接是 0.000。 */
    if (fpos > 8.5) {
      ctx.globalAlpha = Math.min(1, Math.max(0, (fpos - 8.5) / 1.5));
      ctx.fillStyle = color.black;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    ctx.translate(ox, oy);                          // 以下都在源片坐标系里画
    ctx.scale(s, s);

    /* 4 剪影 */
    const [i0, i1, t] = bracket(P.silF, fpos);
    const a = P.sil[i0], b = P.sil[i1];
    const sil = i0 === i1 ? a : blend(a, b, t, tmp.subarray(0, a.length));
    ctx.fillStyle = color.black;
    ctx.fill(toPath(sil, 1));

    /* 4b 剪影第二块（斗篷被蓝幕切开的那部分） */
    if (P.sil2F.length) {
      const ea = envelope(P.sil2F, fpos, 1.5);
      if (ea > 0.01) {
        const [m0, m1, u] = bracket(P.sil2F, fpos);
        ctx.globalAlpha = ea;
        ctx.fillStyle = color.black;
        if (m0 === m1) ctx.fill(toPath(P.sil2[m0], 1));
        else {
          ctx.globalAlpha = ea * (1 - u); ctx.fill(toPath(P.sil2[m0], 1));
          ctx.globalAlpha = ea * u;       ctx.fill(toPath(P.sil2[m1], 1));
        }
        ctx.globalAlpha = 1;
      }
    }

    /* 5 波浪（原片结尾左下那块涨起再缩没的幕布） */
    if (fpos >= P.waveF[0] - 2 && fpos <= P.waveF[P.waveF.length - 1] + 2) {
      const [j0, j1, u] = bracket(P.waveF, fpos);
      const w0 = P.wave[j0], w1 = P.wave[j1];
      const wv = j0 === j1 ? w0 : blend(w0, w1, u, new Float32Array(w0.length));
      ctx.fillStyle = color.red;
      ctx.fill(toPath(wv, 1));
    }

    /* 6 白色块：手套 / 匕首速度线 / 结尾的斩击。数量与点数逐帧不同，
         所以不做形变，用关键帧交叉淡化；两端由 envelope 负责淡入淡出 */
    const ew = envelope(P.whiteF, fpos, 1.5);
    if (ew > 0.01) {
      const [k0, k1, v] = bracket(P.whiteF, fpos);
      ctx.fillStyle = color.paper;
      ctx.strokeStyle = color.paper;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const paint = (set, alpha) => {
        if (alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        for (const sh of set) {
          if (sh.stroked) {
            ctx.lineWidth = sh.stroke;
            ctx.beginPath();
            ctx.moveTo(sh.pts[0], sh.pts[1]);
            for (let i = 2; i < sh.pts.length; i += 2) ctx.lineTo(sh.pts[i], sh.pts[i + 1]);
            ctx.stroke();
          } else {
            ctx.fill(toPath(sh.pts, 1));
          }
        }
        ctx.globalAlpha = 1;
      };
      if (k0 === k1) paint(P.white[k0], ew);
      else { paint(P.white[k0], ew * (1 - v)); paint(P.white[k1], ew * v); }
    }
  }

  /* ---------------- 播放 ---------------- */
  function tick(now) {
    // 视口变了就地重同步（手机地址栏收放、桌面拖窗口、以及 seek 时视口还是 0 的情况）
    if (innerWidth && (innerWidth !== W || innerHeight !== H)) resize();
    const ms = now - t0;
    draw(frameAt(Math.min(ms, D.total)));
    if (ms < D.total + 60) raf = requestAnimationFrame(tick);
    else raf = 0;
  }

  function build() {
    if (!D || el || !document.body) return;
    el = document.createElement('div');
    el.className = 'jk';
    el.setAttribute('aria-hidden', 'true');
    cv = document.createElement('canvas');
    el.appendChild(cv);
    document.body.appendChild(el);
    ctx = cv.getContext('2d');
    resize(); theme();
  }

  /* 懒加载数据：idle / 首次交互时各试一次，幂等 */
  function warm() {
    if (D || loading) return;
    loading = true;
    const sc = document.createElement('script');
    sc.src = DATA_SRC;
    sc.onload = () => { D = window.PL_CURTAIN; loading = false; prepare(); build(); };
    sc.onerror = () => { loading = false; };
    document.head.appendChild(sc);
  }

  const ready = () => !!(D && P);
  function play() {
    if (reduce || !ready()) return false;
    build();
    t0 = performance.now();
    el.classList.add('on');
    if (!raf) raf = requestAnimationFrame(tick);
    return true;
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (el) el.classList.remove('on');
  }
  /* 调试用：把画面定格在某个输出毫秒（也用来截图验收） */
  function seek(ms) {
    if (!ready()) return false;
    build(); theme();
    el.classList.add('on');
    draw(frameAt(ms));
    return true;
  }

  addEventListener('resize', () => { if (cv) { resize(); if (!raf) stop(); } });

  window.PL = window.PL || {};
  /* debug：当前的坐标映射（源片坐标 -> 画布像素），排查缩放/裁切问题用 */
  const debug = () => ({ W, H, s, ox, oy, dpr });

  window.PL.curtain = { warm, ready, play, stop, seek, debug,
                        get total() { return D ? D.total : 1180; } };

  /* 数据可能已经在页面上（页面直接引了 curtain-data.js、或缓存命中后被别的代码加载过）。
     不认这种情况的话 ready() 永远是 false、画布也不会建 —— 只有走 warm() 才会赋值 D。 */
  if (window.PL_CURTAIN) {
    D = window.PL_CURTAIN;
    prepare();
    if (document.body) build();
    else addEventListener('DOMContentLoaded', build, { once: true });
  }
})();
