/* =====================================================================
   PHANTOM LOG · heatmap.js —— GitHub 贡献热力图（数据在 heatmap-data.js）
   ---------------------------------------------------------------------
   数据是构建期抓的（tools/github-heatmap/fetch.py），运行时零外部请求：
   不依赖任何第三方图床/接口，因此能跟着仓库走，也能在墙内正常显示。

   视觉沿用站点的四个变量：空格子是「几乎没有的白板」，有贡献的格子用 --red 加
   不同透明度（四档），最忙的一天额外加一点红色辉光。斜切 -10° 和全站一致。
   ===================================================================== */
(function () {
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const MON = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const date = (s) => new Date(s + 'T00:00:00');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(host) {
    const D = window.PL_HEATMAP;
    if (!D || !host || !D.days.length) return;

    /* 按周分列：第一天先补到它所在的星期，最后一列可能不满 */
    const lead = date(D.days[0][0]).getDay();
    const cells = new Array(lead).fill(null).concat(D.days);
    const weeks = Math.ceil(cells.length / 7);

    /* 月份标签：每月第一次出现的那一列 */
    const labels = [];
    D.days.forEach((d, i) => {
      const dt = date(d[0]);
      if (dt.getDate() <= 7 && (labels.length === 0 || labels[labels.length - 1][1] !== dt.getMonth())) {
        labels.push([Math.floor((i + lead) / 7), dt.getMonth()]);
      }
    });

    const cell = (c, i) => {
      if (!c) return '';
      const [d, lv, n] = c;
      const col = Math.floor(i / 7) + 2, row = (i % 7) + 2;          // +2：第一行放月份，第一列放星期
      return `<i class="hm-c" style="--c:${col};--r:${row};--o:${[0, .22, .45, .72, 1][lv]}" data-d="${d}" data-n="${n}" data-l="${lv}" title="${d}：${n} 次贡献" aria-hidden="true"></i>`;
    };

    const busiest = D.busiest ? `${D.busiest.date}（${D.busiest.count} 次）` : '—';
    host.innerHTML = `<figure class="hm">
  <div class="hm-top">
    <dl class="hm-stat">
      <div><dt>近一年合计</dt><dd><b>${D.total}</b> 次</dd></div>
      <div><dt>有贡献的天</dt><dd><b>${D.active}</b> / ${D.days.length}</dd></div>
      <div><dt>最长连续</dt><dd><b>${D.streak.longest}</b> 天${D.streak.current ? `（当前 ${D.streak.current} 天）` : ''}</dd></div>
      <div><dt>最忙的一天</dt><dd>${esc(busiest)}</dd></div>
    </dl>
    <a class="hm-link" href="https://github.com/${esc(D.user)}" target="_blank" rel="noopener">@${esc(D.user)} ↗</a>
  </div>
  <div class="hm-wrap">
    <div class="hm-grid" role="img"
      aria-label="GitHub 贡献热力图：${D.from} 至 ${D.to} 共 ${D.total} 次贡献，有贡献 ${D.active} 天，最长连续 ${D.streak.longest} 天">
      ${labels.map(([c, m]) => `<span class="hm-mon" style="--c:${c + 2}">${MON[m]}</span>`).join('')}
      ${WD.map((w, r) => (r % 2 ? `<span class="hm-wd" style="--r:${r + 2}">${w}</span>` : '')).join('')}
      ${cells.map(cell).join('')}
    </div>
  </div>
  <figcaption class="hm-foot">
    <span class="hm-legend" aria-hidden="true">少
      ${[0, 1, 2, 3, 4].map((l) => `<i class="hm-c" style="--o:${[0, .22, .45, .72, 1][l]}"></i>`).join('')}多</span>
    <span class="hm-note">数据更新于 ${D.to}${D.active / D.days.length < .05 ? ' · 私密仓库的贡献默认不计入' : ''}</span>
    <span class="hm-swipe" aria-hidden="true">← 左右滑动 →</span>
  </figcaption>
  <div class="hm-tip" role="status" aria-live="polite" hidden></div>
</figure>`;

    /* 悬浮提示：一个自己画的方牌，比浏览器原生的好看，也和全站一致 */
    const grid = host.querySelector('.hm-grid');
    const tip = host.querySelector('.hm-tip');
    const show = (el) => {
      const n = +el.dataset.n, d = el.dataset.d;
      tip.innerHTML = `<b>${n}</b> 次 · ${d}`;
      tip.hidden = false;
      const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
      const x = a.left - b.left + a.width / 2 - tip.offsetWidth / 2;
      tip.style.left = Math.max(0, Math.min(x, b.width - tip.offsetWidth)) + 'px';
      tip.style.top = (a.top - b.top - tip.offsetHeight - 6) + 'px';
    };
    const hide = () => { tip.hidden = true; };
    grid.addEventListener('pointerover', (e) => { const c = e.target.closest('.hm-c[data-d]'); if (c) show(c); });
    grid.addEventListener('pointerout', (e) => { if (e.target.closest('.hm-c[data-d]')) hide(); });
    grid.addEventListener('focusin', (e) => { const c = e.target.closest('.hm-c[data-d]'); if (c) show(c); });
    grid.addEventListener('focusout', hide);
  }

  window.PL = window.PL || {};
  window.PL.heatmap = { mount };
})();
