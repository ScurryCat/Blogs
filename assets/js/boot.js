/* =====================================================================
   PHANTOM LOG · boot.js —— 开屏（怪盗入城）
   移植自 p5-blog 的开机动画：红底网点斜切入场 + AOA 立绘 + 撕纸大标题 +
   「Press Enter to start」+ 读条；点击 / Enter / Esc 关闭。
   sessionStorage 记一次，同一会话内跨页面只播一遍；跟随系统减少动态偏好直接跳过。
   ===================================================================== */
(function () {
  const S = window.PL_SITE || {};
  const PL = window.PL;

  /* 广播「开场结束」：音乐自动播放要借这个真实手势（浏览器不允许无手势出声）。
     开场被跳过时（同会话第二次、或系统减弱动效）也要广播一次 —— 那时没有手势，
     自动播放会失败并安静地留着，等页面上第一次交互再补上。 */
  function fireBooted() {
    try { dispatchEvent(new Event('pl:booted')); } catch (e) { /* 忽略 */ }
  }

  if (PL && PL.reduce) { fireBooted(); return; }        /* 减少动态：不播 */
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fireBooted(); return; }
  let booted = null;
  try { booted = sessionStorage.getItem('pl-booted'); } catch (e) { /* 读不到就当没播过 */ }
  if (booted) { fireBooted(); return; }

  const el = document.createElement('div');
  el.id = 'boot';
  el.innerHTML =
    '<div class="boot-dots" aria-hidden="true"></div>' +
    '<div class="boot-stripes" aria-hidden="true"></div>' +
    '<img class="boot-aoa" src="assets/img/joker-aoa.png" alt="" aria-hidden="true">' +
    (S.logo ? '<img class="boot-logo" src="' + S.logo + '" alt="' + (S.name || 'PHANTOM LOG') + '">' : '') +
    '<div class="boot-inner">' +
      '<div class="boot-kicker">' + (S.kicker || 'Take your time') + '</div>' +
      '<h1 class="boot-title rn" id="boot-title"></h1>' +
      '<div class="boot-sub" aria-hidden="true"><span>Press</span><span class="kbd">Enter</span><span>to start</span></div>' +
      '<div class="boot-bar" aria-hidden="true"><i></i></div>' +
    '</div>' +
    '<button class="boot-skip" type="button">点击任意处进入</button>';
  document.body.appendChild(el);
  document.body.classList.add('boot-lock');

  /* 标题用站点自己的撕纸字（rn：五套贴纸混排，同 seed 刷新不跳） */
  const title = el.querySelector('#boot-title');
  const name = S.nameCn || (S.name + ' ' + (S.nameB || '')) || 'PHANTOM LOG';
  title.innerHTML = (PL && PL.rn) ? PL.rn(name, 9) : name;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    try { sessionStorage.setItem('pl-booted', '1'); } catch (e) { /* 记不住就每次都播 */ }
    document.body.classList.remove('boot-lock');
    el.classList.add('out');
    /* 关屏音效：在用户手势里播，绕开自动播放策略 */
    try {
      const a = new Audio('assets/sfx/select.mp3');
      a.volume = .45;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 忽略 */ }
    setTimeout(() => el.remove(), 560);
    removeEventListener('keydown', onKey, true);
    /* 广播「已开场」：音乐自动播放借这个真实手势（浏览器不允许无手势出声） */
    fireBooted();
  }
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); close(); }
  }
  addEventListener('keydown', onKey, true);
  el.addEventListener('click', close);
})();
