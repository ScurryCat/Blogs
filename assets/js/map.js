/* =====================================================================
   PHANTOM LOG · map.js —— 东京地图导航（移植自 Persona5Startpage）
   - 25 个地点：插画 + 标签（黑白 → 选中变红白），选中时插画「呼吸」一下
   - 选中光标：红色菱形 + 青色方框，四个角在小范围里随机抖动（原作用 anime.js，这里手写 rAF）
   - 鼠标悬停 / Tab 聚焦 / 方向键都能选中；右侧档案卡显示目的地
   ===================================================================== */
(function () {
  const { esc, posts, url, chrome, reduce } = window.PL;
  const S = window.PL_SITE;
  chrome('map');
  const NS = 'http://www.w3.org/2000/svg';
  const IMG = 'assets/img/map/';

  /* 每个地点的目的地 */
  const dest = (id) => {
    const d = S.map[id];
    if (!d) return null;
    if (d.post) {
      const p = posts.find((x) => x.slug === d.post);
      return p && { href: url(p), en: p.category, title: p.title, note: p.ex, cover: p.cover, date: p.date };
    }
    return d;
  };
  const locs = window.PL_MAP.map(([id, kanji, roma, lx, ly, lw, lh, cx, cy, cw, ch, kx, ky, ex, ey, rot]) =>
    ({ id, kanji, roma, lx, ly, lw, lh, cx, cy, cw, ch, kx, ky, ex, ey, rot, to: dest(id) }));
  const open = locs.filter((l) => l.to);

  const loc = (l) => {
    const sub = l.to ? (l.to.en || 'POST') : 'CLOSED';
    const body = `<image class="city" href="${IMG}${l.id}_image.png" x="${l.cx}" y="${l.cy}" width="${l.cw}" height="${l.ch}"
        style="transform-origin:${l.cx + l.cw / 2}px ${l.cy + l.ch}px"/>
      <g class="tag">
        <image class="tag-n" href="${IMG}svg/${l.id}_label.svg" x="${l.lx}" y="${l.ly}" width="${l.lw}" height="${l.lh}"/>
        <image class="tag-on" href="${IMG}svg/${l.id}_label_alt.svg" x="${l.lx}" y="${l.ly}" width="${l.lw}" height="${l.lh}"/>
        <text class="kj" x="${l.kx}" y="${l.ky}" transform="rotate(${l.rot} ${l.kx} ${l.ky})" style="font-size:${Math.min(24, (l.lw - 14) / [...l.kanji].length)}px">${esc(l.kanji)}</text>
        <text class="en" x="${l.ex}" y="${l.ey}" transform="rotate(${l.rot} ${l.ex} ${l.ey})" textLength="${Math.min(l.lw - 16, sub.length * 9)}" lengthAdjust="spacingAndGlyphs">${esc(sub)}</text>
      </g>`;
    return l.to
      ? `<a class="loc" href="${esc(l.to.href)}" data-id="${l.id}" aria-label="${esc(l.kanji)}：${esc(l.to.title)}">${body}</a>`
      : `<g class="loc off" data-id="${l.id}" aria-hidden="true">${body}</g>`;
  };

  document.getElementById('main').innerHTML = `<section class="mp shell" aria-labelledby="mp-h">
  <header class="mp-head">
    <div><p class="kick">// Tokyo · 选一个地方出发</p>
      <h1 class="mp-t" id="mp-h">Tokyo <span>Map</span></h1></div>
    <p class="mp-hint" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> MOVE &nbsp; <kbd>ENTER</kbd> GO</p>
  </header>
  <div class="mp-g">
    <div class="mp-board">
      <svg class="mp-svg" viewBox="0 0 1500 990" role="group" aria-label="东京地图：${open.length} 个可前往的地点">
        <image href="${IMG}map.webp" x="0" y="0" width="1500" height="982"/>
        <polygon class="cur-b" points=""/><polygon class="cur-r" points=""/>
        ${locs.map(loc).join('')}
      </svg>
    </div>
    <aside class="mp-card" aria-live="polite"></aside>
  </div>
  <ul class="mp-list" aria-label="地点列表">${open.map((l) => `<li><a href="${esc(l.to.href)}" data-id="${l.id}"><b>${esc(l.kanji)}</b><span>${esc(l.to.title)}</span></a></li>`).join('')}</ul>
</section>`;

  const svg = document.querySelector('.mp-svg');
  const card = document.querySelector('.mp-card');
  const curR = svg.querySelector('.cur-r');
  const curB = svg.querySelector('.cur-b');

  /* ---------- 选中光标：每个角在 34×15 的小框里随机找下一个点，平滑过去 ---------- */
  let anim = null;
  function cursorFor(l) {
    const x = l.lx, y = l.ly, w = l.lw, h = l.lh;
    const ox = x - 17, oy = y - 7.5;
    const red = [[ox, oy + h / 2], [ox + w / 2, oy], [ox + w * 1.2, oy + h / 2], [ox + w / 1.05, oy + h * 1.4]];
    const blue = [[ox + 25, oy + h + 3], [ox + w + 20, oy + h], [ox + w + 25, oy + 10], [ox + 25, oy]];
    const jitter = (c) => c.map(([cx, cy]) => [cx + Math.random() * 34 - 17, cy + Math.random() * 15 - 7.5]);
    const mk = (base, dur) => ({ base, dur, from: jitter(base), to: jitter(base), t0: performance.now() });
    return { r: mk(red, 2000 / 10), b: mk(blue, 2500 / 10), jitter };
  }
  const ease = (t) => t * (2 - t);
  const pts = (a) => a.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  function step(now) {
    if (!anim) return;
    for (const [k, el] of [['r', curR], ['b', curB]]) {
      const s = anim[k];
      let t = (now - s.t0) / s.dur;
      if (t >= 1) { s.from = s.to; s.to = anim.jitter(s.base); s.t0 = now; t = 0; }
      const e = ease(t);
      el.setAttribute('points', pts(s.from.map((p, i) => [p[0] + (s.to[i][0] - p[0]) * e, p[1] + (s.to[i][1] - p[1]) * e])));
    }
    if (!reduce) requestAnimationFrame(step);
  }

  /* ---------- 选中 ---------- */
  let cur = null;
  function select(id, fromKey) {
    const l = locs.find((x) => x.id === id);
    if (!l || !l.to || cur === l) return;
    cur = l;
    svg.querySelectorAll('.loc').forEach((el) => el.classList.toggle('on', +el.dataset.id === id));
    const g = svg.querySelector(`.loc[data-id="${id}"]`);
    svg.appendChild(g); // 选中的地点画在最上层
    svg.insertBefore(curB, g); svg.insertBefore(curR, g);
    const first = !anim;
    anim = cursorFor(l);
    curR.setAttribute('points', pts(anim.r.from)); curB.setAttribute('points', pts(anim.b.from));
    if (first && !reduce) requestAnimationFrame(step);
    const d = l.to;
    card.innerHTML = `<p class="mp-c-k"><b>${esc(l.kanji)}</b><span>${esc(l.roma)}</span></p>
      ${d.cover ? `<img src="${d.cover}" alt="" loading="lazy">` : `<img class="ill" src="${IMG}${l.id}_image.png" alt="">`}
      <p class="kick">${esc(d.en || 'POST')}${d.date ? ' · ' + d.date : ''}</p>
      <h2>${esc(d.title)}</h2><p class="mp-c-n">${esc(d.note || '')}</p>
      <a class="btn red" href="${esc(d.href)}"><span>出发 ▸</span></a>`;
    if (fromKey) { window.PL.sfx && window.PL.sfx(); g.focus({ preventScroll: true }); }
  }
  svg.addEventListener('mouseover', (e) => { const g = e.target.closest('.loc:not(.off)'); if (g) select(+g.dataset.id); });
  svg.addEventListener('focusin', (e) => { const g = e.target.closest('.loc'); if (g) select(+g.dataset.id); });
  document.querySelector('.mp-list').addEventListener('mouseover', (e) => { const a = e.target.closest('a'); if (a) select(+a.dataset.id); });

  /* 方向键：在可前往的地点间按空间方向跳 */
  addEventListener('keydown', (e) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    const c = (l) => [l.lx + l.lw / 2, l.ly + l.lh / 2];
    const [x0, y0] = c(cur);
    let best = null, bs = Infinity;
    for (const l of open) {
      if (l === cur) continue;
      const [x, y] = c(l); const dx = x - x0, dy = y - y0;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 0) continue;
      const score = along + 2.2 * Math.abs(dx * dir[1] + dy * dir[0]);
      if (score < bs) { bs = score; best = l; }
    }
    if (best) select(best.id, true);
  });

  select(18); // 默认停在据点（四軒茶屋）
})();
