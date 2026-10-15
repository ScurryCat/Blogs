/* =====================================================================
   PHANTOM LOG · weather.js —— P5 天气预报（移植自 Persona5-Weather-Forecast）
   - 精灵图与排版沿用原作（叠层日期数字、星期、天气图标三帧动画、温度数字）
   - 数据换成 Open-Meteo：免费、无需 API Key、支持 CORS
   - 城市：默认 site.js 的 weather；可搜索城市或用定位，选择记在 localStorage
   ===================================================================== */
(function () {
  const { esc, chrome, reduce } = window.PL;
  const S = window.PL_SITE;
  chrome('weather');
  const KEY = 'pl-weather-city';
  const COND = ['晴', '多云', '雨', '雪'];
  const WD_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /* WMO 天气码 → P5 的四种天气：0 晴 1 云 2 雨 3 雪 */
  const p5 = (c) => (c <= 1 ? 0 : c <= 48 ? 1 : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 3 : 2);
  const wmoCn = (c) => ({ 0: '晴朗', 1: '大致晴朗', 2: '局部多云', 3: '阴天', 45: '雾', 48: '冻雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪', 95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴伴冰雹' }[c] || COND[p5(c)]);

  /* ---------- 精灵图小零件（尺寸与原作一致） ---------- */
  const stack = (cls) => ['top', 'mid', 'base'].map((k) => `<i class="${cls} ${k}"></i>`).join('');
  /* 精灵图只有装饰作用，真正的数字在 #wx-sr 里念给读屏 */
  const dateBox = (month) => `<div class="db" aria-hidden="true"><div class="dbi">${month ? `<div class="sp-mo">${stack('mo')}</div>` : ''}
    <div class="sp-d t">${stack('dg')}</div><div class="sp-d o">${stack('dg')}</div>
    <i class="sp-wd"></i><i class="sp-card"></i><i class="sp-wx"></i></div></div>`;
  const small = (k) => `<span class="mm ${k}"><i class="s"></i><i class="t"></i><i class="o"></i><i class="deg"></i></span>`;
  const maxmin = () => `<div class="mmx" aria-hidden="true"><i class="mm-bg"></i>${small('hi')}${small('lo')}</div>`;

  document.getElementById('main').innerHTML = `<section class="wx" aria-labelledby="wx-h">
  <div class="wx-bg" aria-hidden="true"><img class="day" src="assets/img/weather/city-day.jpg" alt=""><img class="night" src="assets/img/weather/city-night.jpg" alt=""></div>
  <div class="shell wx-in">
    <header class="wx-head">
      <div class="wx-town"><h1 id="wx-h" class="wx-city">…</h1><p class="wx-clock"><span id="wx-time">--:--</span></p></div>
      <form class="wx-find" id="wx-find" role="search">
        <label class="sr-only" for="wx-q">搜索城市</label>
        <input id="wx-q" type="search" placeholder="换个城市：上海 / Osaka" autocomplete="off">
        <button class="btn" type="submit"><span>搜索</span></button>
        <button class="btn red" type="button" id="wx-geo"><span>定位</span></button>
      </form>
    </header>
    <p class="wx-msg" id="wx-msg" role="status">正在读取天气…</p>
    <div class="wx-today" id="wx-today">${dateBox(true)}
      <div class="cur-col">
        <div class="cur" aria-hidden="true"><i class="cur-bg"></i><i class="c s"></i><i class="c t"></i><i class="c o"></i><i class="c dot"></i><i class="c f"></i><i class="c deg"></i></div>
        ${maxmin()}
      </div>
    </div>
    <p class="sr-only" id="wx-sr"></p>
    <ol class="wx-week" id="wx-week" aria-label="未来四天">${[0, 1, 2, 3].map(() => `<li class="wk">${dateBox(false)}${maxmin()}<span class="wk-cn"></span></li>`).join('')}</ol>
    <p class="wx-src">数据：Open-Meteo（每 30 分钟刷新） · 天气精灵图 ©ATLUS，界面移植自 caffi-nate / Persona5-Weather-Forecast</p>
  </div>
</section>`;

  const $ = (s, r = document) => r.querySelector(s);
  const pos = (el, x, y) => { el.style.backgroundPosition = `${x}px ${y}px`; };

  /* 叠层精灵：同一列，三行分别是 top / mid / base */
  function setStack(box, idx, w, h) { box.querySelectorAll('i').forEach((el, r) => pos(el, -idx * w, -r * h)); }
  function setDate(root, d, withMonth) {
    if (withMonth) setStack($('.sp-mo', root), d.getMonth(), 120, 120);
    const dd = d.getDate();
    setStack($('.sp-d.t', root), Math.floor(dd / 10), 100, 150);
    setStack($('.sp-d.o', root), dd % 10, 100, 150);
    const wd = (d.getDay() + 6) % 7; // 精灵图从周一开始
    pos($('.sp-wd', root), -(wd % 3) * 191, -Math.floor(wd / 3) * 74);
  }
  /* 小号温度：32px 一格；320 = °，352 = 负号，384 = 空 */
  function setSmall(el, v) {
    const n = Math.round(v); const a = Math.abs(n);
    pos($('.s', el), n < 0 ? -352 : -384, 0);
    pos($('.t', el), a >= 10 ? -Math.floor(a / 10) % 10 * 32 : -384, 0);
    pos($('.o', el), -(a % 10) * 32, 0);
  }
  /* 大号当前温度：72px 一格；704 = °，768 = 小数点，832 = 负号 */
  function setCur(v) {
    const a = Math.round(Math.abs(v) * 10) / 10;
    const root = $('.cur');
    const t = Math.floor(a / 10) % 10, o = Math.floor(a) % 10, f = Math.round((a - Math.floor(a)) * 10) % 10;
    root.classList.toggle('neg', v < 0); root.classList.toggle('one', a < 10);
    pos($('.c.t', root), -t * 72, 0); pos($('.c.o', root), -o * 72, 0); pos($('.c.f', root), -f * 72, 0);
  }

  /* 天气图标三帧动画：全局一个计时器 */
  let frame = 0;
  const icons = () => document.querySelectorAll('.sp-wx[data-c]');
  function drawIcons() { icons().forEach((el) => pos(el, -el.dataset.c * 75, -frame * 72)); }
  const iconTimer = reduce ? 0 : setInterval(() => { frame = (frame + 1) % 3; drawIcons(); }, 1000);

  /* 时钟 + 昼夜（按所选城市的当地时间） */
  let tz = undefined;
  function clock() {
    const now = new Date();
    const f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).formatToParts(now);
    const get = (k) => (f.find((p) => p.type === k) || {}).value || '';
    const h24 = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now);
    $('#wx-time').textContent = `${get('hour').padStart(2, '0')}:${get('minute')}${get('dayPeriod').toLowerCase()}`;
    document.querySelector('.wx').classList.toggle('is-night', h24 >= 18 || h24 < 6);
  }
  const clockTimer = setInterval(clock, 1000 * 15);

  /* ---------- 数据 ---------- */
  const msg = (t, bad) => { const m = $('#wx-msg'); m.textContent = t; m.hidden = !t; m.classList.toggle('bad', !!bad); };
  let city = S.weather;
  try { city = JSON.parse(localStorage.getItem(KEY)) || city; } catch (e) { /* 用默认 */ }
  const ymd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  async function load(c, boom) {
    city = c;
    $('.wx-city').textContent = c.city;
    msg('正在读取天气…');
    try {
      const q = `latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
      const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      tz = d.timezone; clock();
      const days = d.daily.time.map((t, k) => ({ date: ymd(t), code: d.daily.weather_code[k], hi: d.daily.temperature_2m_max[k], lo: d.daily.temperature_2m_min[k] }));
      const today = $('#wx-today');
      setDate(today, days[0].date, true);
      $('.sp-wx', today).dataset.c = p5(d.current.weather_code);
      setCur(d.current.temperature_2m);
      setSmall($('.mm.hi', today), days[0].hi); setSmall($('.mm.lo', today), days[0].lo);
      document.querySelectorAll('.wk').forEach((li, k) => {
        const day = days[k + 1]; if (!day) return;
        setDate(li, day.date, false);
        $('.sp-wx', li).dataset.c = p5(day.code);
        setSmall($('.mm.hi', li), day.hi); setSmall($('.mm.lo', li), day.lo);
        $('.wk-cn', li).textContent = `${WD_CN[(day.date.getDay() + 6) % 7]} · ${wmoCn(day.code)}`;
      });
      drawIcons();
      $('#wx-sr').textContent = `${c.city}现在 ${d.current.temperature_2m}°C，${wmoCn(d.current.weather_code)}。今天最高 ${Math.round(days[0].hi)}°，最低 ${Math.round(days[0].lo)}°。` +
        days.slice(1).map((x) => `${x.date.getMonth() + 1}月${x.date.getDate()}日 ${wmoCn(x.code)}，${Math.round(x.lo)}° 到 ${Math.round(x.hi)}°`).join('；') + '。';
      msg('');
      const wx = document.querySelector('.wx');
      wx.classList.add('ready');
      if (boom && !reduce) { wx.classList.remove('shake'); void wx.offsetWidth; wx.classList.add('shake'); }
    } catch (e) {
      msg('天气没读出来：网络不通或 Open-Meteo 暂时不可用。稍后刷新，或换个城市再试。', true);
    }
  }

  /* 搜索城市（Open-Meteo 地理编码） */
  $('#wx-find').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#wx-q').value.trim(); if (!name) return;
    msg(`正在查找「${name}」…`);
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=${encodeURIComponent(name)}`);
      const j = await r.json();
      const g = j.results && j.results[0];
      if (!g) { msg(`没找到「${name}」。试试城市的正式名称，比如「上海」或「Osaka」。`, true); return; }
      const c = { city: g.name, lat: g.latitude, lon: g.longitude };
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (err) { /* 忽略 */ }
      $('#wx-q').value = '';
      load(c, true);
    } catch (err) { msg('城市查询失败：网络不通。稍后再试。', true); }
  });

  /* 浏览器定位（只在 https 或 localhost 下可用） */
  $('#wx-geo').addEventListener('click', () => {
    if (!navigator.geolocation) { msg('这个浏览器不支持定位。直接搜索城市吧。', true); return; }
    msg('正在定位…');
    navigator.geolocation.getCurrentPosition((p) => {
      const c = { city: '我的位置', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) };
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (err) { /* 忽略 */ }
      load(c, true);
    }, () => msg('没拿到位置：可能拒绝了定位权限，或页面不是 https。直接搜索城市吧。', true), { timeout: 10000 });
  });

  clock();
  load(city, true);
  const refreshTimer = setInterval(() => load(city, false), 30 * 60 * 1000);
  window.PL.onLeave(() => { [iconTimer, clockTimer, refreshTimer].forEach(clearInterval); });
})();
