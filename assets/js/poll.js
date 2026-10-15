/* =====================================================================
   PHANTOM LOG · poll.js —— 右下角的「怪盗ch」问卷（首次进站弹一次）
   ---------------------------------------------------------------------
   样式照游戏里那张投票截图做：圆形 Q 徽章 + 「怪盗ch」撕纸标题 + 问题
   + 带红条的票数条 + 底下一条匿名评论。

   票数是**本地装饰**：基准值写在 site.js 的 poll.base 里，访客投的一票只在他
   自己浏览器里叠加（localStorage）。也就是说这个百分比不是真实统计 —— 它和游戏
   里那个 07.3% 一样是布景。机器可读的地方（aria-label / title）如实写了这一点，
   视觉上保持入戏。要接真实统计的话，把 tally() 换成一次 fetch 即可。
   ===================================================================== */
(function () {
  const S = window.PL_SITE;
  const C = S && S.poll;
  if (!C) return;
  const KEY = 'pl-poll-v1';           // { done: 1, vote: 'yes' }
  let box = null;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 隐私模式：只当次有效 */ } }
  };

  /* 票数：基准 + 本地那一票 */
  function tally() {
    const st = store.get();
    const out = {};
    for (const k of Object.keys(C.options)) out[k] = C.base[k] || 0;
    if (st.vote && out[st.vote] !== undefined) out[st.vote] += 1;
    const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
    return { n: out, pct: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v / total * 100])), total };
  }

  const fmt = (p) => (p < 10 ? '0' : '') + p.toFixed(1) + '%';

  function build() {
    const st = store.get();
    const t = tally();
    const main = C.options[C.main] ? C.main : Object.keys(C.options)[0];
    box = document.createElement('aside');
    box.className = 'poll';
    box.setAttribute('role', 'complementary');
    box.setAttribute('aria-label',
      `${C.title} 本地问卷（票数仅为本站设定的装饰值，不是真实统计）：${C.q}`);
    box.innerHTML = `
  <span class="poll-q" aria-hidden="true">Q</span>
  <div class="poll-body">
    <p class="poll-ch" aria-hidden="true"><span>${window.PL.esc(C.title.slice(0, -2))}</span><em>${window.PL.esc(C.title.slice(-2))}</em></p>
    <p class="poll-t">${C.qHtml || window.PL.esc(C.q)}</p>
    <div class="poll-mid">
      <div class="poll-bar"${st.done ? '' : ' role="group" aria-label="投票"'}>
        <i class="poll-fill" style="--p:${t.pct[main].toFixed(1)}%"></i>
        ${Object.entries(C.options).map(([k, label]) =>
          st.done ? `<span class="poll-b done">${window.PL.esc(label)}</span>`
                  : `<button class="poll-b" type="button" data-k="${k}">${window.PL.esc(label)}</button>`).join('')}
      </div>
      <b class="poll-pc">${fmt(t.pct[main])}</b>
    </div>
    <p class="poll-c"><span class="poll-at">@${window.PL.esc(C.by)}</span><span class="poll-msg">${C.commentHtml || window.PL.esc(C.comment)}</span></p>
  </div>
  <button class="poll-x" type="button" aria-label="关闭问卷">×</button>`;
    document.body.appendChild(box);

    box.querySelector('.poll-x').addEventListener('click', close);
    box.querySelectorAll('.poll-b[data-k]').forEach((b) => b.addEventListener('click', () => vote(b.dataset.k)));
  }

  function vote(k) {
    const st = store.get();
    st.done = 1; st.vote = k;
    store.set(st);
    render();
  }

  function render() {
    if (!box) return;
    const st = store.get();
    const t = tally();
    const main = C.options[C.main] ? C.main : Object.keys(C.options)[0];
    box.querySelector('.poll-fill').style.setProperty('--p', t.pct[main].toFixed(1) + '%');
    box.querySelector('.poll-pc').textContent = fmt(t.pct[main]);
    const bar = box.querySelector('.poll-bar');
    bar.removeAttribute('role');
    bar.querySelectorAll('.poll-b').forEach((el) => {
      if (el.tagName === 'BUTTON') {
        const sp = document.createElement('span');
        sp.className = 'poll-b done';
        sp.textContent = el.textContent;
        el.replaceWith(sp);
      }
    });
    box.querySelector('.poll-c').classList.add('voted');
  }

  function close() {
    const st = store.get();
    st.done = 1;                        // 关掉也算「见过」，不再打扰
    store.set(st);
    if (box) { box.classList.add('out'); setTimeout(() => box && box.remove(), 260); box = null; }
  }

  function show(force) {
    if (!C) return;
    if (!force && store.get().done) return;
    if (box) return;
    build();
    requestAnimationFrame(() => box && box.classList.add('in'));
  }

  /* 首次进站弹一次：等页面稳定（idle / 首次交互）再弹，别和入场动画抢注意力 */
  function boot() {
    const st = store.get();
    if (st.done) return;
    const go = () => show(false);
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2200 }); else setTimeout(go, 1600);
  }

  addEventListener('keydown', (e) => { if (e.key === 'Escape' && box) close(); });

  window.PL = window.PL || {};
  window.PL.poll = {
    show: () => show(true),
    reset: () => { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
