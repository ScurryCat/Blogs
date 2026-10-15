/* =====================================================================
   PHANTOM LOG · home.js —— 暂停菜单 / 预告信 / 宫殿索引 / 归档
   ===================================================================== */
(function () {
  const { esc, rn, cal, posts, tagsHtml, url, ticker, chrome } = window.PL;
  const S = window.PL_SITE;
  chrome('home');
  const main = document.getElementById('main');
  const top = posts[0];

  /* ---------- HERO ---------- */
  const menu = [['#latest', 'Calling Card', '预告信'], ['#posts', 'Palace Index', '文章'], ['map.html', 'Tokyo Map', '地图'], ['weather.html', 'Forecast', '天气'], ['about.html', 'Confidant', '关于我']];
  const hero = `<section class="hero" aria-labelledby="hero-t">
  <div class="hero-slab" aria-hidden="true"></div>
  <div class="shell hero-in">
    <div class="hero-copy">
      <p class="kick">// ${esc(S.kicker)}</p>
      <h1 class="hero-t" id="hero-t"><span class="en">${esc(S.name)} <b>${esc(S.nameB)}</b></span><span class="cn rn">${rn(S.nameCn, 7)}</span></h1>
      <p class="hero-lead">${esc(S.lead)}</p>
      <nav class="pause" aria-label="快捷菜单"><ol>${menu.map(([h, en, cn], i) =>
        `<li style="--i:${i}"><a class="pm${i ? '' : ' on'}" href="${h}">${en}<span class="pm-c">${cn}</span></a></li>`).join('')}</ol>
        <p class="pause-hint" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> SELECT &nbsp; <kbd>ENTER</kbd> CONFIRM</p></nav>
    </div>
    <figure class="hero-art"><div class="art-sh"><div class="art-frame"><img src="${S.heroArt}" alt="Persona 5 主角 Joker 的特写插画" fetchpriority="high"></div></div>
      <figcaption class="rn" aria-hidden="true">${rn('TAKE YOUR HEART', 3)}</figcaption></figure>
  </div>
</section>${ticker()}`;

  /* ---------- 预告信：最新一篇 ---------- */
  const card = top ? `<section class="shell cc" id="latest" aria-labelledby="cc-h">
  <header class="sec-h"><span class="no">01</span><h2 id="cc-h"><span class="en">Calling Card</span><span class="cn">最新</span></h2></header>
  <article class="cc-card on-red">
    <a class="cc-art" href="${url(top)}" tabindex="-1" aria-hidden="true"><img src="${top.cover}" alt="" loading="lazy"></a>
    <div class="cc-body">
      <p class="cc-to">TO: 每一位深夜还在读的人</p>
      <h3 class="cc-t rn"><a href="${url(top)}">${rn(top.title, 11)}</a></h3>
      <p class="cc-ex">${esc(top.ex)}</p>
      <div class="cc-meta">${cal(top.date, top.category)}${tagsHtml(top.tags)}</div>
      <p class="cc-sign">— The Phantom Thieves</p>
      <a class="btn" href="${url(top)}"><span>Read it ▸ 阅读全文</span></a>
    </div>
  </article>
</section>` : '';

  /* ---------- 宫殿索引 ---------- */
  const tags = [...new Set(posts.flatMap((p) => p.tags))];
  const count = (t) => posts.filter((p) => p.tags.includes(t)).length;
  const idx = `<section class="shell idx" id="posts" aria-labelledby="idx-h">
  <header class="sec-h"><span class="no">02</span><h2 id="idx-h"><span class="en">Palace Index</span><span class="cn">文章</span></h2>
    <p class="aside" aria-live="polite"><b id="hit">${posts.length}</b> / ${posts.length} TARGETS</p></header>
  <div class="tools">
    <label class="search"><span class="sr-only">搜索文章</span><input id="q" type="search" placeholder="搜索标题 / 标签 / 正文" autocomplete="off"><kbd aria-hidden="true">/</kbd></label>
    <div class="chips" role="group" aria-label="按标签筛选">
      <button class="chip" type="button" data-t="" aria-pressed="true"><span>全部<b>${posts.length}</b></span></button>
      ${tags.map((t) => `<button class="chip" type="button" data-t="${esc(t)}" aria-pressed="false"><span>${esc(t)}<b>${count(t)}</b></span></button>`).join('')}
    </div>
  </div>
  <ol class="rows" id="rows"></ol>
</section>`;

  /* ---------- 归档 ---------- */
  const years = [...new Set(posts.map((p) => p.date.slice(0, 4)))];
  const arc = `<section class="shell arc" id="archive" aria-labelledby="arc-h">
  <header class="sec-h"><span class="no">03</span><h2 id="arc-h"><span class="en">Archive</span><span class="cn">归档</span></h2></header>
  ${years.map((y) => `<div class="arc-y"><p class="arc-yr" aria-hidden="true">${y}</p><ul class="arc-l" aria-label="${y} 年">${posts.filter((p) => p.date.startsWith(y)).map((p) =>
    `<li><a href="${url(p)}"><time datetime="${p.date}">${p.date.slice(5).replace('-', '.')}</time><span>${esc(p.title)}</span><em>${esc(p.category)}</em></a></li>`).join('')}</ul></div>`).join('')}
</section>`;

  main.innerHTML = hero + card + idx + arc;

  /* ---------- 列表渲染 + 筛选 ---------- */
  const rows = document.getElementById('rows');
  const q = document.getElementById('q');
  let tag = '';
  const row = (p) => `<li class="row"><a class="row-a" href="${url(p)}">
    <span class="row-no" aria-hidden="true">${String(p.no).padStart(2, '0')}</span>
    <span class="row-date">${cal(p.date, p.category)}</span>
    <span class="row-main"><span class="row-cat">${esc(p.arc[0])} · ${esc(p.arc[1])} · ${p.min} MIN</span><span class="row-t">${esc(p.title)}</span>
      <span class="row-ex">${esc(p.ex)}</span>${tagsHtml(p.tags)}</span>
    <span class="row-art" aria-hidden="true"><img src="${p.cover}" alt="" loading="lazy"></span></a></li>`;
  function draw() {
    const k = q.value.trim().toLowerCase();
    const hit = posts.filter((p) => (!tag || p.tags.includes(tag)) && (!k || (p.title + p.tags.join(' ') + p.content).toLowerCase().includes(k)));
    document.getElementById('hit').textContent = hit.length;
    rows.innerHTML = hit.length ? hit.map(row).join('')
      : `<li class="empty"><img src="assets/img/morgana-thief.webp" alt="" loading="lazy"><b>一个目标都没找到</b><span>换个关键词，或者点「全部」。</span></li>`;
  }
  q.addEventListener('input', draw);
  document.querySelector('.chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    tag = b.dataset.t;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    draw();
  });
  const onSlash = (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  };
  addEventListener('keydown', onSlash);
  window.PL.onLeave(() => removeEventListener('keydown', onSlash));
  draw();

  /* ---------- 暂停菜单：悬停 / 聚焦 / ↑↓ 选择 ---------- */
  const items = [...document.querySelectorAll('.pm')];
  const heroEl = document.querySelector('.hero');
  const pick = (el) => items.forEach((x) => x.classList.toggle('on', x === el));
  items.forEach((el) => { el.addEventListener('mouseenter', () => pick(el)); el.addEventListener('focus', () => pick(el)); });
  const onArrows = (e) => {
    if (!/^(ArrowUp|ArrowDown)$/.test(e.key) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (heroEl.getBoundingClientRect().bottom < innerHeight * .5) return; // 菜单不在视野里就不劫持方向键
    e.preventDefault();
    const cur = items.findIndex((x) => x.classList.contains('on'));
    const next = items[(cur + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
    pick(next); next.focus({ preventScroll: true });
  };
  addEventListener('keydown', onArrows);
  window.PL.onLeave(() => removeEventListener('keydown', onArrows));
})();
