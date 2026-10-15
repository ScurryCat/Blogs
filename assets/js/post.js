/* =====================================================================
   PHANTOM LOG · post.js —— 文章页：预告信头图 / 正文 / 目录高亮 / 上下篇
   ===================================================================== */
(function () {
  const { esc, rn, rnP5, cal, posts, tagsHtml, url, chrome, md } = window.PL;
  chrome('posts');
  const main = document.getElementById('main');
  const slug = new URLSearchParams(location.search).get('p');
  const i = posts.findIndex((p) => p.slug === slug);

  if (i < 0) {
    document.title = '目标不存在 · PHANTOM LOG';
    main.innerHTML = `<section class="shell lost"><img src="assets/img/morgana-thief.webp" alt="">
      <p class="kick">Target not found</p><h1 class="rn" style="font-size:clamp(34px,6vw,64px);margin:0;font-weight:400">${rn('目标已消失', 5)}</h1>
      <p style="color:var(--dim);margin:0">这篇文章可能被偷走了。回到菜单换个目标吧。</p><a class="btn red" href="index.html#posts"><span>返回宫殿索引</span></a></section>`;
    return;
  }

  const p = posts[i];
  const newer = posts[i - 1]; const older = posts[i + 1];
  const { html, toc } = md(p.content);
  document.title = `${p.title} · PHANTOM LOG`;

  const side = (q, cls, label) => q
    ? `<a class="${cls}" href="${url(q)}"><img src="${q.cover}" alt="" loading="lazy"><span><span class="kick">${label}</span><b>${esc(q.title)}</b></span></a>`
    : `<span class="none">${cls === 'pv' ? 'NO OLDER TARGET' : 'NO NEWER TARGET'}</span>`;

  main.innerHTML = `<header class="ph">
  <div class="ph-bg" aria-hidden="true"><img src="${p.cover}" alt=""></div>
  <div class="shell ph-in">
    <nav class="crumb" aria-label="面包屑"><a href="index.html">HOME</a><span aria-hidden="true">/</span><a href="index.html#posts">PALACE INDEX</a><span aria-hidden="true">/</span><span>${esc(p.category)}</span></nav>
    <div class="ph-card">
      <p class="kick">Calling card · No.${String(p.no).padStart(2, '0')}</p>
      <h1 class="ph-t rnp-t">${rnP5(p.title, p.no * 13)}</h1>
      <div class="ph-meta">${cal(p.date, p.category)}
        <span class="tarot" aria-label="分类 ${esc(p.category)}，塔罗 ${esc(p.arc[1])}"><b aria-hidden="true">${esc(p.arc[0])}</b><span aria-hidden="true">${esc(p.arc[1])}</span></span>
        <span class="read">≈ ${p.min} MIN READ</span>${tagsHtml(p.tags)}</div>
    </div>
  </div>
</header>
<div class="shell post-grid">
  <article class="md" id="article">${html}</article>
  ${toc.length ? `<aside class="toc" aria-label="文章目录"><p class="kick">Contents</p><ol>${toc.filter((t) => t.lv === 2).map((t) => `<li><a href="#${t.id}">${esc(t.t)}</a></li>`).join('')}</ol></aside>` : ''}
</div>
<section class="shell done" aria-label="上下篇">
  <p class="done-t" aria-hidden="true">Mission<span>Complete</span></p>
  <nav class="pn" aria-label="更多文章">${side(older, 'pv', '◂ Older')}${side(newer, 'nx', 'Newer ▸')}</nav>
</section>`;

  /* 阅读进度 + 目录高亮（只算正文区域） */
  document.body.insertAdjacentHTML('afterbegin', '<div class="progress" aria-hidden="true"></div>');
  const bar = document.querySelector('.progress');
  const art = document.getElementById('article');
  const links = [...document.querySelectorAll('.toc a')];
  const heads = links.map((a) => document.getElementById(a.hash.slice(1)));
  let ticking = false;
  function update() {
    ticking = false;
    const r = art.getBoundingClientRect();
    const pr = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    bar.style.setProperty('--p', pr.toFixed(4));
    let on = -1;
    heads.forEach((h, k) => { if (h.getBoundingClientRect().top < innerHeight * .3) on = k; });
    links.forEach((a, k) => a.classList.toggle('on', k === on));
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
})();
