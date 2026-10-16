/* =====================================================================
   PHANTOM LOG · crowd.js —— 原始 P5 Crowd 纹理，重新编排的地图出发过场
   原图与 alpha 边界见 assets/img/crowd/original/provenance.json。
   每张图都是不同路人，不是走路帧；三层固定方向、尺寸、透明度与速度。
   位置只由经过的毫秒数决定，刷新率、丢帧与重播不会改变编排。
   ===================================================================== */
(function () {
  const DIR = 'assets/img/crowd/original/';
  const WAIT = 900;
  // 只裁掉透明留白；目标宽高按 alpha 边界的比例计算，原始 PNG 不作修改。
  const SPRITES = [
    ['crowd000_000.pac_0_risultato.png', 108, 316, 306, 708],
    ['crowd000_000.pac_1_risultato.png', 88, 487, 335, 536],
    ['crowd000_000.pac_2_risultato.png', 72, 378, 284, 646],
    ['crowd000_000.pac_3_risultato.png', 116, 424, 278, 599],
    ['crowd001_000.pac_0_risultato.png', 76, 306, 360, 717],
    ['crowd001_000.pac_1_risultato.png', 106, 440, 290, 584],
    ['crowd001_000.pac_2_risultato.png', 77, 400, 336, 624],
    ['crowd001_000.pac_3_risultato.png', 60, 320, 393, 703],
    ['crowd003_000.pac_0_risultato.png', 123, 308, 267, 715],
    ['crowd003_000.pac_1_risultato.png', 100, 388, 312, 635],
    ['crowd003_000.pac_2_risultato.png', 53, 327, 406, 696],
    ['crowd003_000.pac_3_risultato.png', 88, 402, 333, 621]
  ];
  const LAYERS = [
    { alpha: .30, height: .58, width: .18, phoneHeight: .40, phoneWidth: .28, baseline: .72, speed: 62, direction: 1, count: 8, phoneCount: 4, phase: .08 },
    { alpha: .60, height: .82, width: .26, phoneHeight: .58, phoneWidth: .38, baseline: .90, speed: 145, direction: -1, count: 7, phoneCount: 4, phase: .39 },
    { alpha: 1, height: 1.06, width: .36, phoneHeight: .78, phoneWidth: .48, baseline: 1.10, speed: 310, direction: 1, count: 6, phoneCount: 3, phase: .67 }
  ];
  const maxRatio = Math.max(...SPRITES.map(s => s[3] / s[4]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const images = [];
  let el = null, cv = null, ctx = null, lanes = [];
  let raf = 0, active = false, start = 0, w = 0, h = 0, dpr = 1;

  function warm() {
    if (reduce || images.length) return;
    for (const sprite of SPRITES) {
      const image = new Image();
      const entry = { image, decoded: false };
      images.push(entry);
      image.decoding = 'async';
      image.onload = () => {
        const decoded = image.decode ? image.decode() : Promise.resolve();
        decoded.then(() => { entry.decoded = image.naturalWidth > 0; }, () => { entry.decoded = false; });
      };
      image.onerror = () => { entry.decoded = false; };
      image.src = DIR + sprite[0];
    }
  }

  function ready() {
    return images.length === SPRITES.length && images.every(e => e.decoded && e.image.complete && e.image.naturalWidth > 0);
  }

  function build() {
    if (!el) {
      el = document.createElement('div');
      el.className = 'crowd';
      el.setAttribute('aria-hidden', 'true');
      cv = document.createElement('canvas');
      el.appendChild(cv);
      document.body.appendChild(el);
      ctx = cv.getContext('2d');
    }
    return !!ctx;
  }

  function resize() {
    w = Math.max(1, innerWidth); h = Math.max(1, innerHeight);
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const phone = w < 720;
    lanes = LAYERS.map((layer, depth) => {
      const height = phone ? h * layer.phoneHeight : Math.min(h * layer.height, w * layer.width / maxRatio);
      const margin = (phone ? w * layer.phoneWidth : height * maxRatio) + 24;
      const span = w + margin * 2;
      const count = phone ? layer.phoneCount : layer.count;
      return { ...layer, height, margin, span, baseline: h * (phone ? 1.04 : layer.baseline),
        speed: layer.speed * Math.max(.65, w / 1280),
        people: Array.from({ length: count }, (_, i) => {
          const index = (depth * 4 + i) % SPRITES.length;
          // 窄屏逐人限宽，瘦长人物不再被最宽纹理一起压矮；三层都在底边裁切。
          const personHeight = phone ? Math.min(height, w * layer.phoneWidth * SPRITES[index][4] / SPRITES[index][3]) : height;
          return { index, height: personHeight, phase: ((i / count) + layer.phase) % 1, bob: i * 1.7 + depth };
        }) };
    });
  }

  const wrap = (value, span) => ((value % span) + span) % span;
  function draw(now) {
    if (innerWidth !== w || innerHeight !== h || Math.min(devicePixelRatio || 1, 2) !== dpr) resize();
    const elapsed = Math.max(0, now - start) / 1000;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (const lane of lanes) {
      ctx.globalAlpha = lane.alpha;
      for (const person of lane.people) {
        const [, sx, sy, sw, sh] = SPRITES[person.index];
        const width = person.height * sw / sh;
        const x = wrap(person.phase * lane.span + lane.direction * lane.speed * elapsed, lane.span) - lane.margin;
        const y = lane.baseline - person.height + Math.sin(elapsed * 2.4 + person.bob) * 3;
        // 右行层有意镜像，左行层沿用原纹理；不随帧或随机数切换人物。
        ctx.save(); ctx.translate(x + (lane.direction > 0 ? width : 0), y);
        if (lane.direction > 0) ctx.scale(-1, 1);
        ctx.drawImage(images[person.index].image, sx, sy, sw, sh, 0, 0, width, person.height);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!active) return;
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (reduce || !ready()) return false;
    if (active) return true;
    if (!build()) return false;
    resize(); start = performance.now(); active = true;
    draw(start); // 第一帧就铺满黑色背板，不等下一次 rAF。
    el.classList.add('on');
    raf = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    active = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (el) el.classList.remove('on');
  }

  addEventListener('resize', () => { if (active) { resize(); draw(performance.now()); } });
  window.PL = window.PL || {};
  window.PL.crowd = { warm, ready, play, stop, wait: WAIT };
})();
