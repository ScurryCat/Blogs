/* =====================================================================
   PHANTOM LOG · phone.js —— 贴在网页右边的怪盗手机
   外壳：assets/img/phone/frame.webp（原图是蓝底，离线抠成透明，见版权页）
   主页：状态栏 + 音乐播放器 + 六个应用（情报 / 地图 / 天气 / 档案 / 音乐 / 音效）
   曲子清单在 music.js；播放器真的会播，进度条可点可拖动，音量记在 localStorage
   键盘：Tab 能走完所有控件，Esc 收起；打开时焦点进机器，关掉还给边上的小图标
   ===================================================================== */
(function () {
  const PL = window.PL;
  if (!PL) return;
  const MUSIC = window.PL_MUSIC || [];
  const esc = PL.esc;
  const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const APPS = [
    { cn: '情报', en: 'PALACE', g: '▤', href: 'index.html#posts' },
    { cn: '地图', en: 'TOKYO', g: '◈', href: 'map.html' },
    { cn: '天气', en: 'CAST', g: '☂', href: 'weather.html' },
    { cn: '档案', en: 'PROFILE', g: '★', href: 'about.html' },
    { cn: '音乐', en: 'MUSIC', g: '♪', act: 'music' },
    { cn: '音效', en: 'SOUND', g: '◉', act: 'sound' },
  ];

  /* ---------- 边上的小图标 ---------- */
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'pw-tab';
  tab.setAttribute('aria-expanded', 'false');
  tab.setAttribute('aria-controls', 'p5-phone');
  tab.innerHTML = '<span class="g" aria-hidden="true">▯</span><span class="t" aria-hidden="true">PHONE</span>'
    + '<span class="sr-only">打开怪盗手机</span>';
  document.body.appendChild(tab);

  /* ---------- 整机 ---------- */
  const wrap = document.createElement('div');
  wrap.className = 'pw-wrap';
  wrap.hidden = true;
  wrap.innerHTML = `
  <div class="pw-scrim" data-close></div>
  <div class="pw" id="p5-phone" role="dialog" aria-label="怪盗手机" hidden>
    <img class="pw-frame" src="assets/img/phone/frame.webp" alt="" width="880" height="715">
    <div class="pw-screen">
      <header class="pw-status">
        <span class="pw-clk">--:--</span>
        <span class="pw-date"></span>
        <span class="pw-sig" aria-hidden="true">▮▮▮▯</span>
      </header>
      <section class="pw-music" aria-label="音乐播放器">
        <p class="pw-kick">NOW PLAYING</p>
        <h2 class="pw-title">…</h2>
        <p class="pw-artist">…</p>
        <div class="pw-bar" data-seek role="slider" tabindex="0" aria-label="播放进度"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><span class="knob"></span></div>
        <div class="pw-row"><span class="pw-time">0:00 / 0:00</span><span class="pw-idx"></span></div>
        <div class="pw-ctl">
          <button class="pw-btn" type="button" data-act="prev" aria-label="上一首">◀◀</button>
          <button class="pw-btn play" type="button" data-act="play" aria-label="播放">▶</button>
          <button class="pw-btn" type="button" data-act="next" aria-label="下一首">▶▶</button>
          <span class="pw-lab" aria-hidden="true">VOL</span>
        </div>
        <div class="pw-bar vol" data-vol role="slider" tabindex="0" aria-label="音量"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="60"><i></i><span class="knob"></span></div>
      </section>
      <nav class="pw-apps" aria-label="手机应用">
        ${APPS.map((a) => a.href
          ? `<a class="pw-app" href="${esc(a.href)}"><span class="g" aria-hidden="true">${a.g}</span><span class="c">${esc(a.cn)}</span><span class="e">${esc(a.en)}</span></a>`
          : `<button class="pw-app" type="button" data-app="${a.act}"><span class="g" aria-hidden="true">${a.g}</span><span class="c">${esc(a.cn)}</span><span class="e">${esc(a.en)}</span></button>`).join('')}
      </nav>
    </div>
    <button class="pw-close" type="button" data-close aria-label="收起手机">✕</button>
    <audio preload="none"></audio>
  </div>`;
  document.body.appendChild(wrap);

  const phone = wrap.querySelector('\.pw');
  const audio = wrap.querySelector('audio');
  const box = wrap.querySelector('.pw-music');
  const elTitle = wrap.querySelector('.pw-title');
  const elArtist = wrap.querySelector('.pw-artist');
  const elTime = wrap.querySelector('.pw-time');
  const elIdx = wrap.querySelector('.pw-idx');
  const elClk = wrap.querySelector('.pw-clk');
  const elDate = wrap.querySelector('.pw-date');
  const seekBar = wrap.querySelector('[data-seek]');
  const volBar = wrap.querySelector('[data-vol]');
  let loadTimer = 0;
  const playBtn = wrap.querySelector('[data-act="play"]');
  const $ = (s) => wrap.querySelector(s);

  const fmt = (t) => (isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00');
  const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

  /* ---------- 音乐播放器 ---------- */
  let idx = 0, vol = .6, warmed = false;
  try { idx = Math.min(MUSIC.length - 1, Math.max(0, +(read('pl-track') || 0))); vol = Math.min(1, Math.max(0, +(read('pl-vol') || .6))); } catch (e) { /* 忽略 */ }

  function track(i, play) {
    if (!MUSIC.length) return;
    idx = (i + MUSIC.length) % MUSIC.length;
    const t = MUSIC[idx];
    audio.src = t.src;
    elTitle.textContent = t.title;
    elArtist.textContent = t.artist || '';
    elIdx.textContent = (idx + 1) + ' / ' + MUSIC.length;
    try { localStorage.setItem('pl-track', String(idx)); } catch (e) { /* 忽略 */ }
    bar(seekBar, 0);
    elTime.textContent = '0:00 / 0:00';
    if (play) { clearTimeout(loadTimer); audio.play().catch(() => {}); }
    else if (warmed) {
      // 换曲后等一下再取元数据：快速连点只请求最后一次，
      // 而且必须确认此刻仍暂停 —— 对正在播的元素调 load() 会把播放掐掉
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => { if (audio.paused) audio.load(); }, 350);
    }
  }
  function bar(el, pct) {
    el.querySelector('i').style.width = Math.max(0, Math.min(1, pct)) * 100 + '%';
    el.querySelector('.knob').style.left = 'calc(' + Math.max(0, Math.min(1, pct)) * 100 + '% - 3px)';
    el.setAttribute('aria-valuenow', Math.round(Math.max(0, Math.min(1, pct)) * 100));
  }
  function syncVol() { audio.volume = vol; bar(volBar, vol); try { localStorage.setItem('pl-vol', String(vol)); } catch (e) { /* 忽略 */ } }

  audio.addEventListener('play', () => { playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', '暂停'); });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', '播放'); });
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    bar(seekBar, d ? audio.currentTime / d : 0);
    elTime.textContent = fmt(audio.currentTime) + ' / ' + fmt(d);
  });
  audio.addEventListener('ended', () => track(idx + 1, true));
  // 仓库里不带版权音频（见 .gitignore），clone 下来 music/ 是空的。
  // 曲子拉不到时直接落到下面那套「还没有曲子」的空态，别留一个点了没反应的假条目。
  let musicDead = false;
  audio.addEventListener('error', () => {
    if (musicDead || !MUSIC.length) return;
    musicDead = true;
    audio.pause();
    box.classList.add('pw-empty');
    elTitle.textContent = '还没有曲子';
    elArtist.textContent = '把音频放进 assets/music/ 并写进 music.js';
    elIdx.textContent = '';
    elTime.textContent = '0:00 / 0:00';
    bar(seekBar, 0);
  });

  if (!MUSIC.length) {
    box.classList.add('pw-empty');
    elTitle.textContent = '还没有曲子';
    elArtist.textContent = '把音频放进 assets/music/ 并写进 music.js';
    wrap.querySelectorAll('.pw-ctl .pw-btn').forEach((b) => b.setAttribute('disabled', ''));
  } else {
    track(idx, false);
  }
  syncVol();

  wrap.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
    if (act === 'play') { audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
    else if (act === 'prev') track(idx - 1, !audio.paused);
    else if (act === 'next') track(idx + 1, !audio.paused);
    const app = e.target.closest('[data-app]') && e.target.closest('[data-app]').dataset.app;
    if (app === 'music') { audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
    if (app === 'sound') { const b = document.querySelector('#hud .snd'); if (b) b.click(); paintSound(); }
  });
  /* 进度 / 音量：点、拖、方向键都能改 */
  const scrub = (el, apply) => {
    const set = (clientX) => { const r = el.getBoundingClientRect(); apply((clientX - r.left) / r.width); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); set(e.clientX);
      const move = (ev) => set(ev.clientX);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -.05, ArrowRight: .05, ArrowDown: -.05, ArrowUp: .05 }[e.key];
      if (d === undefined) return;
      e.preventDefault(); apply((+el.getAttribute('aria-valuenow')) / 100 + d);
    });
  };
  if (MUSIC.length) {
    scrub(seekBar, (p) => { if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, p)) * audio.duration; });
  }
  scrub(volBar, (p) => { vol = Math.max(0, Math.min(1, p)); syncVol(); });

  /* 音效应用显示当前状态（HUD 上那个 ♪ 是唯一的事实来源） */
  const soundApp = wrap.querySelector('[data-app="sound"]');
  function paintSound() {
    const snd = document.querySelector('#hud .snd');
    soundApp.setAttribute('aria-pressed', String(!snd || snd.getAttribute('aria-pressed') !== 'false'));
  }

  /* ---------- 状态栏时钟 ---------- */
  function clock() {
    const d = new Date();
    elClk.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    elDate.textContent = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + WD[d.getDay()];
  }
  clock();
  setInterval(clock, 20000);

  /* ---------- 开关 ---------- */
  function open() {
    wrap.hidden = false; phone.hidden = false;
    document.documentElement.classList.add('pw-open');
    requestAnimationFrame(() => wrap.classList.add('on'));
    tab.setAttribute('aria-expanded', 'true');
    // 关着的时候不碰网络（隐藏元素上的媒体请求会被浏览器掐掉，白报一堆 aborted）
    if (MUSIC.length && audio.readyState === 0) { audio.preload = 'metadata'; audio.load(); }
    warmed = true;
    paintSound(); clock();
    (playBtn.disabled ? phone.querySelector('.pw-app') : playBtn).focus({ preventScroll: true });
  }
  function close() {
    wrap.classList.remove('on');
    wrap.hidden = true; phone.hidden = true;
    document.documentElement.classList.remove('pw-open');
    tab.setAttribute('aria-expanded', 'false');
    tab.focus({ preventScroll: true });
  }
  tab.addEventListener('click', () => (wrap.hidden ? open() : close()));
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wrap.hidden) { e.preventDefault(); close(); } });

  /* 页面被 bfcache 还原时别留着开着的手机 */
  addEventListener('pageshow', (e) => { if (e.persisted && !wrap.hidden) { wrap.classList.remove('on'); wrap.hidden = true; phone.hidden = true; document.documentElement.classList.remove('pw-open'); tab.setAttribute('aria-expanded', 'false'); } });

  PL.phone = { open, close };
})();
