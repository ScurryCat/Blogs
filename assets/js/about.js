/* =====================================================================
   PHANTOM LOG · about.js —— 怪盗档案 / 五维雷达 / COOP / 年表 / 联络
   ===================================================================== */
(function () {
  const { esc, rn, chrome } = window.PL;
  const S = window.PL_SITE; const A = S.about;
  chrome('about');
  const main = document.getElementById('main');
  const pips = (n, max) => `<span class="pips" aria-hidden="true">${Array.from({ length: max }, (_, k) => `<i${k < n ? ' class="on"' : ''}></i>`).join('')}</span>`;

  /* 五维雷达：SVG，5 条轴，5 级刻度 */
  function radar(stats) {
    const C = 210, R = 150, n = stats.length;
    const pt = (k, r) => { const a = -Math.PI / 2 + k * 2 * Math.PI / n; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    const poly = (f) => stats.map((s, k) => pt(k, f(s)).map((v) => v.toFixed(1)).join(',')).join(' ');
    const rings = [1, 2, 3, 4, 5].map((l) => `<polygon class="ring${l === 5 ? ' o' : ''}" points="${poly(() => R * l / 5)}"/>`).join('');
    const axes = stats.map((_, k) => { const [x, y] = pt(k, R); return `<line class="ax" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>`; }).join('');
    const dots = stats.map((s, k) => { const [x, y] = pt(k, R * s.lv / 5); return `<circle class="dot" cx="${x}" cy="${y}" r="6"/>`; }).join('');
    const labels = stats.map((s, k) => { const [x, y] = pt(k, R + 34); return `<text x="${x}" y="${y}">${esc(s.en)}</text>`; }).join('');
    return `<svg class="radar" viewBox="-40 -10 500 450" role="img" aria-label="五维能力：${stats.map((s) => `${s.cn} ${s.lv} 级`).join('，')}">
      ${rings}${axes}<polygon class="val" points="${poly((s) => R * s.lv / 5)}"/>${dots}${labels}</svg>`;
  }

  main.innerHTML = `<section class="ab-hero" aria-labelledby="ab-t">
  <div class="ab-bg" aria-hidden="true"><img src="${A.bg}" alt=""></div>
  <div class="shell ab-in">
    <div>
      <p class="kick">// Confidant file · ${esc(S.codeName)}</p>
      <h1 class="ab-t" id="ab-t">${esc(S.author.slice(0, -1))}<span>${esc(S.author.slice(-1))}</span></h1>
      <p class="ab-code rn" aria-hidden="true">${rn('信息工程 · ACM · 怪盗', 21)}</p>
      <p class="ab-lead">${esc(A.lead)}</p>
      ${A.intro.map((t) => `<p class="ab-p">${esc(t)}</p>`).join('')}
      <dl class="idcard"><dt>Role</dt><dd>${esc(S.role)}</dd><dt>Base</dt><dd>${esc(S.base)}</dd><dt>Since</dt><dd>${S.startYear}</dd></dl>
    </div>
    <figure class="ab-art"><img src="${A.art}" alt="怪盗装束的 Joker 全身立绘"></figure>
  </div>
</section>

<section class="shell stats" aria-labelledby="st-h">
  <header class="sec-h"><span class="no">01</span><h2 id="st-h"><span class="en">Social Stats</span><span class="cn">五维</span></h2></header>
  <div class="stats-g">${radar(A.stats)}
    <ul class="st-l">${A.stats.map((s) => `<li class="st"><h3>${esc(s.en)}<small>${esc(s.cn)}</small></h3>
      <p><b>Lv.${s.lv} · ${esc(s.rank)}</b>${esc(s.note)}</p>${pips(s.lv, 5)}</li>`).join('')}</ul>
  </div>
</section>

<section class="shell coop" aria-labelledby="co-h">
  <header class="sec-h"><span class="no">02</span><h2 id="co-h"><span class="en">Confidants</span><span class="cn">友链</span></h2>
    <p class="aside">RANK UP <b>↑</b></p></header>
  <ul class="coop-g">${A.coop.map((c, k) => `<li class="co"><a href="${esc(c.url)}" target="_blank" rel="noopener" style="--r:${[-2, 1.5, -1, 2, -1.5, 1][k % 6]}deg">
    <span class="co-top"><b>${esc(c.arcana[0])}</b><span>${esc(c.arcana[1])}</span></span>
    <img src="${c.icon}" alt="" loading="lazy"><h3>${esc(c.name)}</h3><p>${esc(c.note)}</p>
    ${pips(c.rank, 10)}<span class="sr-only">COOP 等级 ${c.rank} / 10</span></a></li>`).join('')}</ul>
</section>

<section class="shell tl" aria-labelledby="tl-h">
  <header class="sec-h"><span class="no">03</span><h2 id="tl-h"><span class="en">Milestones</span><span class="cn">足迹</span></h2></header>
  <ol class="tl-l">${A.timeline.map((t) => `<li class="tl-i"><span class="tl-y">${esc(t.y)}</span><div><h3>${esc(t.h)}</h3><p>${esc(t.p)}</p></div></li>`).join('')}</ol>
</section>

${window.PL_HEATMAP ? `<section class="shell gh" aria-labelledby="gh-h">
  <header class="sec-h"><span class="no">04</span><h2 id="gh-h"><span class="en">Activity</span><span class="cn">活动</span></h2></header>
  <div class="hm-host"></div>
</section>` : ''}

<section class="shell ct" aria-labelledby="ct-h">
  <header class="sec-h"><span class="no">05</span><h2 id="ct-h"><span class="en">Send a Card</span><span class="cn">联络</span></h2></header>
  <div class="ct-box"><p>有想法、发现 Bug、想交换友链——都欢迎来信。回复不一定快，但一定会回。</p>
    <ul class="ct-l">${S.social.map((s) => `<li><a href="${esc(s.url)}"${/^https?:/.test(s.url) ? ' target="_blank" rel="noopener"' : ''}><small>${esc(s.k)}</small><b>${esc(s.v)}</b></a></li>`).join('')}</ul>
  </div>
</section>`;

  /* GitHub 热力图：数据在 heatmap-data.js（构建期抓好的），渲染在 heatmap.js。
     数据缺失时 mount 会直接返回，页面其余部分不受影响。 */
  if (window.PL.heatmap) window.PL.heatmap.mount(main.querySelector('.hm-host'));
})();
