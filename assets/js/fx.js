/* =====================================================================
   PHANTOM LOG · fx.js —— 怪盗光标 + 菜单音效（移植自 persona5-style-portfolio）
   - 光标：48px × 30 帧横向精灵图，50ms 一帧（原 .ani 速率），悬停可点元素换「手指」
   - 音效：select.mp3；首次点击/按键之后才会出声（浏览器自动播放策略）
   - 页头 ♪ 按钮开关音效，记在 localStorage
   ===================================================================== */
(function () {
  const PL = window.PL;
  const HOT = 'a,button,summary,label[for],select,.pm,.chip,.row-a,[data-sfx]';
  const BLIP = HOT + ',.loc:not(.off)'; // 地图上的地点也当作菜单项：悬停就响
  let soundOn = true;
  try { soundOn = localStorage.getItem('pl-sound') !== 'off'; } catch (e) { /* 无痕模式 */ }

  /* ---------- 音效：两条 <audio> 轮流用，连续悬停不会互相掐断 ----------
     池子等第一次用户手势再建：提前 new Audio(src) 会在页面加载时就抓这个 mp3，
     而它此刻还没被用过，Chrome 会把请求当无用预加载掐掉（控制台留一条 aborted）。
     手势之前浏览器本来就禁止出声，所以推迟到手势时不影响任何表现。 */
  let pool = null, turn = 0, unlocked = false, lastPlay = 0;
  const unlock = () => {
    unlocked = true;
    if (!pool) pool = [0, 1].map(() => { const a = new Audio('assets/sfx/select.mp3'); a.preload = 'auto'; a.volume = .45; return a; });
  };
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });
  function play() {
    const now = performance.now();
    if (!soundOn || !unlocked || !pool || now - lastPlay < 70) return;
    lastPlay = now;
    const a = pool[turn = (turn + 1) % pool.length];
    try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 忽略 */ }
  }

  /* 悬停：只在「进入一个新的可点元素」时响一次 */
  let lastHot = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const hot = e.target.closest && e.target.closest(BLIP);
    if (hot && hot !== lastHot) play();
    lastHot = hot;
  });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest(BLIP)) play(); }, true);
  document.addEventListener('focusin', (e) => { if (unlocked && e.target.matches && e.target.matches(':focus-visible')) play(); });

  /* 页头 ♪ 开关 */
  const hud = document.getElementById('hud');
  if (hud) {
    hud.insertAdjacentHTML('beforeend', '<button class="snd" type="button" aria-pressed="' + soundOn + '" aria-label="菜单音效"><span aria-hidden="true">♪</span></button>');
    const btn = hud.querySelector('.snd');
    btn.addEventListener('click', () => {
      soundOn = !soundOn; btn.setAttribute('aria-pressed', String(soundOn));
      try { localStorage.setItem('pl-sound', soundOn ? 'on' : 'off'); } catch (e) { /* 忽略 */ }
      if (soundOn) { unlock(); lastPlay = 0; play(); }
    });
  }

  /* ---------- 光标：仅精确指针 + 未开减弱动效；第一次移动鼠标前不隐藏系统光标 ---------- */
  function cursor() {
    if (!matchMedia('(pointer: fine)').matches || PL.reduce) return;
    const cur = document.createElement('div');
    cur.id = 'p5-cursor'; cur.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cur);
    let x = -100, y = -100, frame = 0, last = 0, shown = false;
    addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      if (!shown) { shown = true; cur.style.display = 'block'; document.documentElement.classList.add('p5c'); }
      const t = e.target;
      cur.classList.toggle('link', !!(t.closest && t.closest(HOT + ',.loc')));
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { cur.style.display = 'none'; shown = false; document.documentElement.classList.remove('p5c'); });
    addEventListener('blur', () => { cur.style.display = 'none'; shown = false; document.documentElement.classList.remove('p5c'); });
    const tick = (ts) => {
      if (ts - last >= 50) { frame = (frame + 1) % 30; last = ts; cur.style.backgroundPosition = (-frame * 48) + 'px 0'; }
      cur.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  cursor();

  PL.sfx = play;
})();
