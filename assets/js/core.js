/* =====================================================================
   PHANTOM LOG · core.js —— 公共工具：撕纸字 / P5 日历 / 页头页脚 / 转场
   ===================================================================== */
(function () {
  const S = window.PL_SITE;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 撕纸字：同一段文字 + 同一个 seed 永远得到同样的排列（刷新不跳） */
  function rn(text, seed = 1) {
    let h = (seed * 2654435761) >>> 0 || 1;
    const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
    let prev = 0;
    const piece = (ch) => {
      const latin = /[A-Za-z0-9]/.test(ch);
      let k = 1 + Math.floor(rand() * 5);
      if (k === prev) k = (k % 5) + 1;
      prev = k;
      const f = latin ? (rand() < .55 ? 1 : 5) : [2, 3, 4][Math.floor(rand() * 3)];
      const st = `--r:${(rand() * 10 - 5).toFixed(1)}deg;--y:${(rand() * .12 - .06).toFixed(2)}em;--s:${(.9 + rand() * .22).toFixed(2)};--a:${Math.floor(rand() * 10)}%;--b:${Math.floor(rand() * 10)}%`;
      return `<span class="c k${k} f${f}" style="${st}">${esc(ch)}</span>`;
    };
    const vis = (String(text).match(/[A-Za-z0-9'’.-]+|\s+|./gu) || []).map((p) => {
      if (/^\s+$/.test(p)) return '<span class="sp"></span>';
      const html = [...p].map(piece).join('');
      return p.length > 1 ? `<span class="w">${html}</span>` : html;
    }).join('');
    return `<span class="sr-only">${esc(text)}</span><span aria-hidden="true">${vis}</span>`;
  }

  /* p5-ui 的标题方案：每个字一个 span，按它的规则挑出「选中字」上色块，其余保持纯文字，
     每字随机倾斜 ±10°。和 rn() 的区别：rn() 是五套贴纸混排，这个是「少量高亮 + 整体倾斜」。
     颜色走 CSS 变量（--rn-chip / --rn-chip-text / --rn-text），换主题不用改 JS。
     伪随机用种子，保证刷新后同一段标题长得一样（p5-ui 原版用 Math.random，会闪）。 */
  function rnP5(text, seed = 1) {
    const t = String(text);
    const marks = [' ', ',', '，', '.', '。', '!', '！', '?', '？'];
    const sel = {};
    if (!marks.includes(t[1])) sel[1] = 1;
    for (let i = 2; i < t.length; i++) if (!marks.includes(t[i]) && marks.includes(t[i - 2])) sel[i] = 1;
    let h = (seed * 2654435761) >>> 0 || 1;
    const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
    const spans = [...t].map((ch, i) =>
      `<span${sel[i] ? ' class="on"' : ''} style="--d:${(rand() * 20 - 10).toFixed(1)}deg">${esc(ch)}</span>`).join('');
    return `<span class="sr-only">${esc(t)}</span><span class="rnp" aria-hidden="true">${spans}</span>`;
  }

  /* 对话框署名：1:1 照 p5-ui 的 P5Title 组件（title/title.vue 的 getSelectedIdx）。
     原版规则是「第 2 个字上一块黑底；之后再遇到『前两格是空格/标点的字』也上一块」，
     而官方 character.js 把名字写成「姓 名」（'摩尔 加纳' / '佐仓 双叶'），
     两者一叠加，实际效果就是**从第 2 个可见字起隔一个字一块黑底**。
     站内说话人是简称（摩尔加纳 / 双叶 / 我），中间没有那个空格，
     所以这里把规则还原成它的本意：按「可见字」数，第 2、4、6… 个字上黑底。
     字号与倾斜照原版：每字随机 ±10°，用姓名做种子保证刷新不变。 */
  function rnName(text) {
    const t = String(text);
    const marks = [' ', ',', '，', '.', '。', '!', '！', '?', '？', '·', '、'];
    let h = ([...t].reduce((a, c) => a + c.codePointAt(0), 7) * 2654435761) >>> 0 || 1;
    const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
    let vi = -1;
    const spans = [...t].map((ch) => {
      const isMark = marks.includes(ch);
      if (!isMark) vi++;
      const on = !isMark && vi > 0 && vi % 2 === 1;   // 可见字里的第 2、4、6… 个
      return `<span${on ? ' class="on"' : ''} style="--d:${(rand() * 20 - 10).toFixed(1)}deg">${esc(ch)}</span>`;
    }).join('');
    return `<span class="sr-only">${esc(t)}</span><span class="rnp" aria-hidden="true">${spans}</span>`;
  }

  /* 日期 / P5 日历 */
  const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function slotOf(h) {
    if (h < 5) return 'LATE NIGHT'; if (h < 8) return 'EARLY MORNING'; if (h < 12) return 'MORNING';
    if (h < 15) return 'LUNCHTIME'; if (h < 18) return 'AFTER SCHOOL'; return 'EVENING';
  }
  function cal(d, slot) {
    if (typeof d === 'string') d = toDate(d);
    const w = d.getDay();
    return `<time class="cal" datetime="${iso(d)}"><span class="sr-only">${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日</span>` +
      `<span class="cal-md" aria-hidden="true">${d.getMonth() + 1}<s>/</s>${d.getDate()}</span>` +
      `<span class="cal-wd${w % 6 === 0 ? ' we' : ''}" aria-hidden="true">${WD[w]}</span>` +
      `<span class="cal-slot" aria-hidden="true">${esc(slot || slotOf(d.getHours()))}</span></time>`;
  }

  /* 文章：排序、摘要、阅读时长 */
  const strip = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\*\*|__|\*/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  const posts = (window.PL_POSTS || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((p, i, all) => {
    const first = p.content.split('\n').find((l) => l.trim() && !/^(#|>|\||!!!|```|[-*]\s|\d+\.\s)/.test(l)) || '';
    const ex = p.excerpt || strip(first);
    const cjk = (p.content.match(/[㐀-鿿]/g) || []).length;
    const words = (p.content.replace(/[㐀-鿿]/g, ' ').match(/[A-Za-z]+/g) || []).length;
    return { ...p, no: all.length - i, ex: ex.length > 96 ? ex.slice(0, 94) + '…' : ex, min: Math.max(1, Math.round(cjk / 450 + words / 220)), arc: S.arcana[p.category] || ['?', p.category] };
  });
  const tagsHtml = (tags) => `<span class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span>`;
  const url = (p) => `post.html?p=${encodeURIComponent(p.slug)}`;

  function ticker() {
    const one = S.ticker.map((t) => `<span>${esc(t)}&nbsp;&nbsp;<em>★</em>&nbsp;&nbsp;</span>`).join('');
    return `<div class="ticker" aria-hidden="true"><div class="ticker-in">${one}${one}</div></div>`;
  }

  /* pjax 换页前要卸载本页挂的全局监听与计时器（不卸会随每次换页叠加泄漏）。
     页脚本用 PL.onLeave(fn) 登记；元素级监听不用管，随 DOM 一起消失。 */
  const leavers = [];
  const onLeave = (fn) => { if (typeof fn === 'function') leavers.push(fn); };
  const runLeavers = () => {
    while (leavers.length) { try { leavers.pop()(); } catch (e) { /* 卸载失败不该拦住换页 */ } }
  };

  /* 页头 / 页脚 / 交互。
     pjax 换页时会被再调一次（新页面脚本照样写 chrome('about')），所以这里必须幂等：
     骨架只建一次，第二次进来只更新导航高亮。 */
  const NAV = [['index.html#posts', 'Posts', '文章', 'posts'], ['map.html', 'Map', '地图', 'map'],
    ['weather.html', 'Weather', '天气', 'weather'], ['guestbook.html', 'Guestbook', '留言', 'guestbook'],
    ['about.html', 'About', '关于', 'about']];
  let chromed = false;

  function paintNav(page) {
    const hud = document.getElementById('hud');
    if (!hud) return;
    hud.querySelectorAll('.hud-nav a').forEach((a) => {
      if (a.dataset.k === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function chrome(page) {
    if (chromed) { paintNav(page); return; }
    chromed = true;
    const nav = NAV;
    document.body.insertAdjacentHTML('afterbegin', `<a class="skip" href="#main">跳到正文</a>
<header class="hud" id="hud">
  <a class="brand" href="index.html" aria-label="${esc(S.name)} ${esc(S.nameB)} 首页"><span class="b-mark" aria-hidden="true">P</span><span class="b-t" aria-hidden="true">${esc(S.name)}<em>${esc(S.nameB)}</em></span></a>
  <nav class="hud-nav" aria-label="主导航">${nav.map(([h, en, cn, k]) => `<a href="${h}" data-k="${k}"${k === page ? ' aria-current="page"' : ''}>${en}<i>${cn}</i></a>`).join('')}</nav>
  <div class="hud-cal">${cal(new Date())}</div>
</header>`);
    document.body.insertAdjacentHTML('beforeend', `<footer class="foot">${ticker()}
  <div class="shell foot-in">
    <div class="foot-brand"><img src="${S.logo}" alt="Persona 5 Royal" loading="lazy"><p>${S.legal}</p></div>
    <nav class="foot-links" aria-label="页脚导航"><h3 class="kick">Hideout</h3>${nav.map(([h, en]) => `<a href="${h}">${en}</a>`).join('')}</nav>
    <div class="foot-links"><h3 class="kick">Contact</h3>${S.social.map((s) => `<a href="${esc(s.url)}"${/^https?:/.test(s.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(s.k)}</a>`).join('')}</div>
  </div>
  <div class="shell"><div class="foot-legal"><span>${esc(S.copyright)}</span><span>Made with skewX(-10deg)</span></div></div>
</footer>`);

    const hud = document.getElementById('hud');
    const onScroll = () => hud.classList.toggle('solid', scrollY > 30);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();

    /* ---------- 页面转场 ----------
       矢量帷幕（curtain.js）取代了原来那段 28 KB 的 curtain.mp4：形状从素材帧追踪成顶点表，
       零下载、任何 clone 下来都有，省流量模式下也照用。剩下唯一的视频是：
       dive.webm = 进文章。《过场进入异世界》是绿幕，离线抠成 alpha：
         ffmpeg -ss 3.2 -t 0.75 -i 过场进入异世界.mp4 \
           -vf "chromakey=0x48ff00:0.20:0.06,despill=type=green,fps=30,scale=960:540,format=yuva420p" \
           -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 36 -row-mt 1 -an assets/clip/dive.webm
       底衬纯红：视频没下完 / 浏览器不支持 alpha 视频 / 自动播放被拒 → 只看到一次红闪。
       视频懒加载 + 空闲预热；省流量模式 / 减弱动效 / 视频还没下完 → 走矢量帷幕或三色斜切。 */
    const CLIPS = {
      dive: { src: 'assets/clip/dive.webm', rate: 1, wait: 720, cls: 'clip-dive' }
    };
    const conn = navigator.connection;
    // 只在「明确开了省流量」或「2g/slow-2g」时才跳过视频。原先把 3g 也算进去，
    // 结果 Chrome 常把好线路也报成 3g（effectiveType 是按观测吞吐推的），整站转场就静默退化成斜切了。
    // 剩下这一段 120 KB，3g 完全扛得住。
    const cheap = !(conn && (conn.saveData || /^(slow-)?2g$/.test(conn.effectiveType || '')));
    function warmClips() {
      if (reduce || !cheap) return;
      for (const c of Object.values(CLIPS)) {
        if (c.el) continue;
        const el = document.createElement('div');
        el.className = 'clip ' + c.cls;
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<video src="' + c.src + '" muted playsinline preload="auto"></video>';
        document.body.appendChild(el);
        const v = el.firstElementChild;
        c.el = el; c.v = v; c.ok = false;
        // 只要解出第一帧就算可用：canplaythrough 要等「整段都能流畅播」，
        // 网络一般的机器上可能一直不触发，那样转场就永远用不上视频。
        const arm = () => { c.ok = true; };
        v.addEventListener('loadeddata', arm, { once: true });   // readyState ≥ 2
        v.addEventListener('canplaythrough', arm, { once: true });
        v.load();
      }
    }
    // 空闲时先把 dive（120 KB）下好，第一次点文章就能用上
    if (window.requestIdleCallback) requestIdleCallback(warmClips, { timeout: 2500 }); else setTimeout(warmClips, 2000);
    // 兜底：idle 回调不一定触发（标签页在后台、扩展占满主线程…）。
    // 用户第一次交互时补一次，之后的导航就能用上视频；warmClips 本身幂等。
    addEventListener('pointerdown', warmClips, { once: true, capture: true });
    addEventListener('keydown', warmClips, { once: true, capture: true });

    /* ---------- 矢量帷幕：每页都引 curtain-data.js + curtain.js ----------
       纯矢量，一个字节都不下，所以**不加省流量门禁**（这一点和人群过场相反：
       人群要下 228 KB，省流量时得跳过）。play() 恒真，除非图省事禁了动效。 */
    const curtain = window.PL && window.PL.curtain;
    // 时长由数据自己说了算（curtain-data.js 的 total）：改动画不用回来改这里
    const CURTAIN_WAIT = curtain ? curtain.total : 1180;
    if (curtain) curtain.warm();   // 懒加载 32 KB 形状数据（gzip 11 KB），首屏不为它付钱

    /* ---------- 人群过场：只有 map.html 引了 crowd.js ----------
       从地图出发的跳转播《人流转场》的人墙，它比视频转场更「本地」：
       12 张 PNG 跟着仓库走，不依赖 assets/clip/ 里那些被 .gitignore 排除的影像。
       门禁和视频转场一致：省流量模式 / 2g 不下这 228 KB（地图页自己的图已经 620 KB），
       退回矢量帷幕。预热用 idle + 首次交互各一次，warm 幂等。 */
    const crowd = window.PL && window.PL.crowd;
    const CROWD_WAIT = 900; // 黑底淡入 .12s + 人墙走 .78s：够看清是谁在走，又不至于等
    if (crowd && cheap) {
      const warmCrowd = () => crowd.warm();
      if (window.requestIdleCallback) requestIdleCallback(warmCrowd, { timeout: 2500 }); else setTimeout(warmCrowd, 1200);
      addEventListener('pointerdown', warmCrowd, { once: true, capture: true });
      addEventListener('keydown', warmCrowd, { once: true, capture: true });
    }

    /* 站内跳转的优先级：
       1) 地图页出发 → 人群过场（不按目的地分）
       2) 进文章且 dive 视频就绪 → 潜入转场
       3) 其余站内导航 → 矢量帷幕（永远就绪，所以实际上很少落到第 4 步）
       4) 兜底 → CSS 三色斜切 */
    const wipe = document.querySelector('.wipe');
    /* 唯一的跳转出口：有 pjax 就不重载文档（BGM 因此不断），没有就老老实实跳。
       转场已经把屏幕盖住了，所以换页过程用户看不见。 */
    const go = (url) => {
      if (window.PL.pjax) window.PL.pjax.go(url);
      else location.href = url;
    };
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || !wipe || reduce || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.getAttribute('target') || a.hasAttribute('download')) return;
      const u = new URL(a.getAttribute('href'), location.href); // SVG <a> 的 .href 不是字符串，统一读属性
      if (u.origin !== location.origin || !/(\.html|\/)$/.test(u.pathname)) return;
      if (u.pathname === location.pathname && u.search === location.search) return; // 同页锚点：交给浏览器平滑滚动
      e.preventDefault();
      /* 地图页的三种入口（地图上的地点、右侧卡片的「出发」、下方列表）都走这里，
         所以人群过场要放在按目的地分派之前 —— 地图上的地点其实都指向 post.html，
         否则会被 dive 抢走。play() 返回 false 表示图没就绪，继续往下走。 */
      if (page === 'map' && crowd && cheap && crowd.play()) {
        setTimeout(() => { go(u.href); }, CROWD_WAIT);
        return;
      }
      const c = u.pathname.endsWith('post.html') ? CLIPS.dive : null;
      if (c && c.ok && c.el) {
        c.el.classList.add('on');
        try {
          c.v.currentTime = 0; c.v.playbackRate = c.rate;
          const p = c.v.play(); if (p && p.catch) p.catch(() => {});
        } catch (err) { /* 播放被拒：底衬自己顶着 */ }
        setTimeout(() => { go(u.href); }, c.wait);
        return;
      }
      /* 其余站内导航走矢量帷幕。它不需要下载，所以省流量模式下也照用 —— 
         这里正好是原来那段 curtain.mp4 的位置。 */
      if (curtain && curtain.play()) {
        setTimeout(() => { go(u.href); }, CURTAIN_WAIT);
        return;
      }
      wipe.classList.add('go');
      setTimeout(() => { go(u.href); }, 440);
    });
    addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      if (wipe) wipe.classList.remove('go');
      for (const c of Object.values(CLIPS)) if (c.el) c.el.classList.remove('on');
      /* 这两个都必须在 bfcache 恢复时停掉：动画被冻结，但 .on 留在 DOM 上，
         从文章页按后退回来会看到整屏被转场层永久盖住 —— 而且没有任何出口。 */
      if (crowd) crowd.stop();
      if (curtain) curtain.stop();
    });

    /* 转场自检：控制台跑 PL.transitionState()，就能看到为什么某次没播视频转场 */
    if (window.PL) window.PL.transitionState = () => ({
      page, reduce, cheap,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      connection: conn ? { effectiveType: conn.effectiveType, saveData: !!conn.saveData } : null,
      clips: Object.entries(CLIPS).map(([k, c]) => ({
        name: k, created: !!c.el, armed: !!c.ok,
        readyState: c.v ? c.v.readyState : null,
        error: c.v && c.v.error ? c.v.error.code : null
      })),
      crowd: crowd ? { loaded: crowd.ready(), wait: CROWD_WAIT } : null,
      curtain: curtain ? { vector: true, ready: curtain.ready(), wait: CURTAIN_WAIT, total: curtain.total } : null,
      wipePresent: !!wipe
    });
  }

  window.PL = { esc, rn, rnP5, rnName, cal, toDate, posts, tagsHtml, url, ticker, chrome, paintNav, onLeave, runLeavers, reduce, strip };
})();
