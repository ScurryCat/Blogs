/* =====================================================================
   PHANTOM LOG · pjax.js —— 站内跳转不重载文档
   ---------------------------------------------------------------------
   为什么需要它：BGM 挂在 <audio> 元素上，而整页重载会把它销毁 —— 音乐必然
   断掉、从头开始。改成「取回目标页 → 换掉内容 → pushState」之后，<audio>
   始终是同一个元素，音乐一路不断；顺带没有了白闪，转场也能真正盖住换页过程。

   脚本分两类，靠 HTML 上的 data-page 标记区分：
     · 共享脚本（site/core/phone/music/curtain/poll…）只加载一次，之后不再重跑
       —— 重跑会把页头页脚、手机挂件、播放器又建一遍。
     · 页脚本（home/post/about/map/weather/guestbook）每次换页都要重跑，
       它们负责把内容画进 #main；重跑前会先执行上一页登记的卸载回调。

   任何一步失败（网络、解析、找不到 #main）都退回 location.href ——
   这是一个纯静态站，底子必须还在。
   ===================================================================== */
(function () {
  const LOADED = new Set([...document.querySelectorAll('script[src]')].map((s) => s.src));
  const CSS = new Set([...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href));
  let busy = false, generation = 0, controller = null;

  /* ---------- 资源加载 ---------- */
  /* 注入的 <script> 执行完就摘掉：留着的话每换一次页 body 里就多一个死节点。
     已加载过的地址记在 LOADED 里，不靠 DOM 记。 */
  function inject(src, once) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => { if (once) LOADED.add(el.src); el.remove(); res(); };
      el.onerror = () => { el.remove(); rej(new Error('script ' + src)); };
      document.body.appendChild(el);
    });
  }
  function loadScript(src) {
    return LOADED.has(src) ? Promise.resolve() : inject(src, true);
  }
  function loadCss(href) {
    if (CSS.has(href)) return Promise.resolve();
    return new Promise((res) => {
      const el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = href;
      el.onload = () => { CSS.add(el.href); res(); };
      el.onerror = res;                 // 样式拉不到也别卡住换页
      document.head.appendChild(el);
    });
  }

  /* ---------- 揭开：把转场层收掉，露出新内容 ---------- */
  function unveil() {
    document.querySelectorAll('.clip.on').forEach((el) => {
      el.classList.remove('on');
      const v = el.querySelector('video');
      if (v) { try { v.pause(); } catch (e) { /* 忽略 */ } }
    });
    const w = document.querySelector('.wipe');
    if (w) w.classList.remove('go');
    const PL = window.PL || {};
    if (PL.curtain) PL.curtain.stop();
    if (PL.crowd) PL.crowd.stop();
  }

  /* 后退、bfcache 恢复或转场超时必须取消旧请求。generation 也覆盖已完成 fetch、
     正等待样式 / 脚本的阶段，避免旧结果随后换掉页面或 pushState。 */
  function cancel() {
    generation++;
    if (controller) controller.abort();
    controller = null; busy = false;
    unveil();
  }

  /* ---------- 换页 ---------- */
  async function swap(doc, url, push, token) {
    const PL = window.PL || {};
    const nextMain = doc.getElementById('main');
    if (!nextMain) throw new Error('no #main');

    /* 1) 先把样式与「只加载一次」的库/数据脚本备齐。它们不画内容，可以先跑。
          顺序很讲究：页脚本（data-page）绝不能在这里跑 —— 那时 DOM 还是旧的，
          它们会把内容画进即将被替换掉的 #main 里，然后被覆盖成空白。 */
    const jobs = [];
    const pageScripts = [];
    doc.querySelectorAll('link[rel=stylesheet][href]').forEach((l) => jobs.push(loadCss(l.href)));
    doc.querySelectorAll('script[src]').forEach((s) => {
      if (s.hasAttribute('data-page')) pageScripts.push(s.src);
      else jobs.push(loadScript(s.src));
    });
    await Promise.all(jobs);
    if (token !== generation) return;

    /* 2) 卸载上一页登记的全局监听/计时器，然后才真正换内容与地址 */
    if (PL.runLeavers) PL.runLeavers();
    document.title = doc.title;
    const nd = doc.querySelector('meta[name="description"]');
    const cd = document.querySelector('meta[name="description"]');
    if (nd && cd) cd.setAttribute('content', nd.getAttribute('content'));
    const main = document.getElementById('main');
    main.innerHTML = nextMain.innerHTML;
    if (push) history.pushState({ pjax: true }, '', url.href);

    /* 3) 页脚本在新 #main 上重跑 —— 它们负责把这一页的内容画进去 */
    await Promise.all(pageScripts.map((src) => inject(src, false)));
    if (token !== generation) return;

    /* 4) 内容就位后再滚动 / 移交焦点，最后揭开转场层。
          后退时回到离开前的位置（pushState 之后浏览器不再替你恢复），
          有 hash 则优先那个锚点。 */
    const hash = url.hash ? document.getElementById(url.hash.slice(1)) : null;
    const backY = !push && history.state && typeof history.state.y === 'number' ? history.state.y : null;
    if (hash) hash.scrollIntoView({ block: 'start' });
    else if (backY !== null) scrollTo(0, backY);
    else scrollTo(0, 0);
    main.focus({ preventScroll: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === generation) unveil();
      resolve();
    })));
  }

  async function go(href, opts) {
    const o = opts || {};
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) { location.href = href; return false; }
    if (o.push === false) cancel();             // 历史导航覆盖尚未完成的点选导航
    if (busy) return true;                       // 连点两次：后一次忽略
    busy = true;
    const token = ++generation;
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      /* 记下当前这条历史记录的滚动位置，供后退时还原 */
      if (o.push !== false) {
        try { history.replaceState(Object.assign({}, history.state, { y: Math.round(scrollY) }), '', location.href); }
        catch (e) { /* 忽略 */ }
      }
      const r = await fetch(url.href, { credentials: 'same-origin', signal: controller ? controller.signal : undefined });
      if (token !== generation) return false;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      if (token !== generation) return false;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      await swap(doc, url, o.push !== false, token);
      if (token !== generation) return false;
      busy = false; controller = null;
      return true;
    } catch (e) {
      if (token !== generation) return false;    // 被取消的旧请求不触发整页降级
      busy = false; controller = null;
      unveil();                                  // 先把转场层收掉，再退回整页跳转
      location.href = url.href;
      return false;
    }
  }

  /* 前进 / 后退：再取一次那个地址（静态站没有本地快照，取一次最省心） */
  addEventListener('popstate', () => go(location.href, { push: false }));
  /* 被 bfcache 还原时，转场层可能是开着的，收掉 */
  addEventListener('pageshow', (e) => { if (e.persisted) cancel(); });

  window.PL = window.PL || {};
  window.PL.pjax = { go, unveil, cancel };
})();
