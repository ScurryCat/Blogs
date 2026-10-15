/* =====================================================================
   PHANTOM LOG · guestbook.js —— 留言板页面
   ---------------------------------------------------------------------
   表单 + 列表 + 校验 + 各种状态。存取走 PL.gbStore（见 guestbook-store.js），
   所以后端换成 Supabase 时这个文件不用动。
   本站的规矩：所有插入 DOM 的内容都过 esc()，留言正文按纯文本处理（不渲染 Markdown）。
   ===================================================================== */
(function () {
  const { esc, chrome } = window.PL;
  const S = window.PL_SITE;
  const G = S.guestbook || {};
  const store = window.PL.gbStore;
  chrome('guestbook');

  const main = document.getElementById('main');
  const LIMIT_NAME = G.maxName || 20, LIMIT_TEXT = G.maxText || 500;
  const COOL = (G.cooldown || 30) * 1000;
  const ownerNames = [S.author, 'JOKER', '站主'].filter(Boolean);

  /* 相对时间：刚发出来的留言要让人看到「刚刚」，而不是一串 ISO 时间 */
  function ago(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const card = (m) => {
    const mine = ownerNames.includes((m.name || '').trim());
    return `<li class="gb-i${mine ? ' owner' : ''}">
      <div class="gb-h"><b class="gb-n">${esc(m.name)}</b>${mine ? '<span class="gb-tag">站主</span>' : ''}
        <time class="gb-t" datetime="${esc(m.at)}">${esc(ago(m.at))}</time></div>
      <p class="gb-m">${esc(m.text).replace(/\n/g, '<br>')}</p></li>`;
  };

  main.innerHTML = `<section class="shell gb" aria-labelledby="gb-h">
  <header class="sec-h"><span class="no">01</span>
    <h2 id="gb-h"><span class="en">Guestbook</span><span class="cn">留言</span></h2>
    <p class="aside">LEAVE A TRACE <b>↑</b></p></header>
  <p class="gb-lead">${esc(G.greeting || '留下你的足迹。')}</p>

  <form class="gb-form" novalidate>
    <div class="gb-row">
      <label class="gb-f"><span>名字 <i>必填</i></span>
        <input name="name" type="text" maxlength="${LIMIT_NAME}" autocomplete="nickname"
               placeholder="怎么称呼你？" required></label>
      <label class="gb-f"><span>联系方式 <i>${store.contactStaysLocal ? '只在你自己浏览器里' : '仅站主可见，不会公开'}</i></span>
        <input name="contact" type="text" maxlength="60" autocomplete="email"
               placeholder="邮箱或主页（选填）"></label>
    </div>
    <label class="gb-f"><span>留言 <i>纯文本，最多 ${LIMIT_TEXT} 字</i></span>
      <textarea name="text" rows="5" maxlength="${LIMIT_TEXT}" placeholder="想说什么都行。" required></textarea></label>
    <div class="gb-act">
      <button class="btn red" type="submit"><span>寄出 ▸</span></button>
      <span class="gb-count" aria-live="polite"></span>
    </div>
    <p class="gb-note" role="status" aria-live="polite"></p>
  </form>

  <div class="gb-list-h">
    <p class="kick">// 全部留言</p>
    <button class="gb-reload" type="button">刷新</button>
  </div>
  <ul class="gb-l" aria-live="polite"><li class="gb-empty">读取中…</li></ul>
</section>`;

  const form = main.querySelector('.gb-form');
  const list = main.querySelector('.gb-l');
  const note = main.querySelector('.gb-note');
  const count = main.querySelector('.gb-count');
  const ta = form.elements.text;

  function say(msg, kind) {
    note.textContent = msg || '';
    note.className = 'gb-note' + (kind ? ' ' + kind : '');
  }

  async function load() {
    try {
      const rows = await store.list();
      list.innerHTML = rows.length
        ? rows.map(card).join('')
        : '<li class="gb-empty">还没有留言。要不要当第一个？</li>';
    } catch (e) {
      list.innerHTML = '<li class="gb-empty err">留言读不出来：' + esc(e.message) + '</li>';
    }
  }

  /* 字数提示 + 本地冷却（示例模式下一个浏览器 30 秒只能发一条） */
  ta.addEventListener('input', () => {
    count.textContent = ta.value.length ? `${ta.value.length} / ${LIMIT_TEXT}` : '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const text = ta.value.trim();
    const contact = form.elements.contact.value.trim();
    if (!name) return say('名字还没填。', 'warn');
    if (!text) return say('留言是空的。', 'warn');
    if (text.length > LIMIT_TEXT) return say(`留言超过 ${LIMIT_TEXT} 字。`, 'warn');

    const last = +(localStorage.getItem('pl-gb-last') || 0);
    if (Date.now() - last < COOL) {
      return say(`刚发过一条，${Math.ceil((COOL - (Date.now() - last)) / 1000)} 秒后再来。`, 'warn');
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    say('寄出中…');
    try {
      const row = await store.add({ name, text, contact, page: location.pathname });
      try { localStorage.setItem('pl-gb-last', String(Date.now())); } catch (e2) { /* 忽略 */ }
      form.reset();
      count.textContent = '';
      say(store.mode === 'local'
        ? '已存进你自己的浏览器（示例模式，换设备就看不到）。'
        : '收到了，谢谢。', 'ok');
      await load();
      if (list.firstElementChild) list.firstElementChild.classList.add('fresh');
    } catch (err) {
      say('没寄出去：' + err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  main.querySelector('.gb-reload').addEventListener('click', load);
  load();
})();
