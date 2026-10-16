(function () {
  const crowd = window.PL.crowd;
  const status = document.getElementById('readiness');
  const results = document.getElementById('results');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = 0, delayed = 0, checking = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const painted = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const stop = () => {
    clearTimeout(timer); clearTimeout(delayed); crowd.stop();
    status.textContent = reduce ? '减少动态效果：已跳过' : crowd.ready() ? '原始 PNG 已就绪' : 'PNG 尚未就绪';
  };
  async function ready() {
    crowd.warm();
    for (let i = 0; i < 80 && !crowd.ready() && !reduce; i++) await pause(100);
    status.textContent = reduce ? '减少动态效果：已跳过' : crowd.ready() ? '12 张原始 PNG 已就绪' : 'PNG 加载失败或超时';
    return crowd.ready();
  }
  function play(duration) {
    stop();
    if (!crowd.play()) { status.textContent = reduce ? '减少动态效果：已跳过' : '未就绪，播放已安全跳过'; return; }
    status.textContent = '播放中 · 导航交接 ' + crowd.wait + 'ms';
    timer = setTimeout(stop, duration);
  }
  function signature(canvas) {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < pixels.length; i += 124) hash = ((hash * 31) + pixels[i]) | 0;
    return hash;
  }
  async function checks() {
    if (checking) return;
    checking = true; stop(); results.textContent = '';
    const check = (ok, message) => {
      results.textContent += (ok ? 'PASS ' : 'FAIL ') + message + '\n';
      if (!ok) throw new Error(message);
    };
    try {
      if (reduce) { check(crowd.play() === false, '减少动态效果跳过播放'); return; }
      check(await ready(), '全部原图解码就绪');
      const manifest = await (await fetch('assets/img/crowd/original/provenance.json')).json();
      const hashes = await Promise.all(manifest.sprites.map(async sprite => {
        const response = await fetch('assets/img/crowd/original/' + sprite.file);
        if (!response.ok) return false;
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') === sprite.sha256;
      }));
      check(hashes.length === 12 && hashes.every(Boolean), '12 张原始 PNG 加载与 SHA-256 一致');
      check(crowd.play(), '生产渲染器可播放'); await painted();
      const canvas = document.querySelector('.crowd canvas');
      check(document.querySelectorAll('.crowd canvas').length === 1, '仅创建一个 Canvas');
      const first = signature(canvas); await pause(250); await painted();
      check(signature(canvas) !== first, '经过时间后人流发生移动');
      check(crowd.play() && document.querySelectorAll('.crowd canvas').length === 1, '重复播放复用 Canvas');
      crowd.stop(); const stopped = signature(canvas); await pause(120); await painted();
      check(!document.querySelector('.crowd.on'), '停止清理活动遮罩');
      check(signature(canvas) === stopped, '停止后不再绘制');
      check(crowd.play(), '停止后可重播'); await painted();
      check(document.querySelector('.crowd canvas') === canvas, '重播复用同一画布');
      crowd.stop(); check(!document.querySelector('.crowd.on'), '重播后的清理完成');
    } catch (error) {
      results.textContent += '检查中止：' + error.message + '\n';
    } finally { checking = false; stop(); }
  }
  document.getElementById('play').addEventListener('click', () => play(crowd.wait + 100));
  document.getElementById('capture').addEventListener('click', () => {
    stop(); status.textContent = '3 秒后开始，保持播放 5 秒…';
    delayed = setTimeout(() => play(5000), 3000);
  });
  document.getElementById('stop').addEventListener('click', stop);
  document.getElementById('run').addEventListener('click', checks);
  addEventListener('pagehide', stop);
  ready();
})();
