(function () {
  'use strict';
  const output = document.getElementById('results');
  const fixtures = document.getElementById('fixtures');
  let controllers = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const config = (id, patch = {}) => ({ id, title: '怪盗ch', question: '你相信心之怪盗吗？',
    questionHighlight: ['心之怪盗'], options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }],
    main: 'yes', base: { yes: 0, no: 0 }, ...patch });
  function make(c, options) {
    const controller = window.PL.poll.create(c, options);
    controllers.push(controller);
    return controller;
  }
  async function run() {
    controllers.forEach(controller => controller.destroy());
    controllers = [];
    fixtures.replaceChildren();
    const lines = [];
    output.textContent = 'Running…';
    try {
      assert(window.PL.poll && typeof window.PL.poll.create === 'function', 'PL.poll.create API is absent');
      lines.push('PASS reusable create API');
      const id = 'browser-check-' + Date.now();
      const a = document.createElement('div'), b = document.createElement('div');
      fixtures.append(a, b);
      const c = config(id), first = make(c, { mode: 'inline', container: a });
      const mirror = make(c, { mode: 'inline', container: b });
      first.show(); first.show(); mirror.show();
      assert(a.querySelectorAll('.poll').length === 1, 'Repeated show duplicated DOM');
      assert(a.querySelector('.poll-percent').textContent === '00.0%', 'Zero result is wrong');
      const q = a.querySelector('.poll-q').getBoundingClientRect();
      const frame = a.querySelector('.poll-bar').getBoundingClientRect();
      assert(q.left < frame.right && q.right > frame.left && q.top < frame.bottom && q.bottom > frame.top,
        'Q decoration does not overlap the result frame');
      lines.push('PASS Q and result frame overlap');
      a.querySelector('.poll-choice').click();
      assert([...b.querySelectorAll('.poll-choice')].every(button => button.disabled), 'Same-ID mirror did not update');
      assert(b.querySelector('.poll-choice[aria-pressed="true"]').textContent.includes('YES'), 'Mirror selection is missing');
      assert(b.querySelector('.poll-percent').textContent === '100.0%', 'Vote result is wrong');
      lines.push('PASS repeat show, zero tally, vote and same-ID mirror');
      first.close(); first.show();
      await wait(300);
      assert(a.querySelectorAll('.poll').length === 1, 'Reopen lost or leaked DOM');
      first.close();
      await wait(100);
      const closing = a.querySelector('.poll');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        assert(!closing, 'Reduced-motion close did not remove content immediately');
      } else {
        assert(closing && Number(getComputedStyle(closing).opacity) < 1,
          'Filled entrance animation prevents the closing fade');
      }
      first.show();
      await wait(300);
      assert(a.querySelectorAll('.poll').length === 1, 'Reopen during fade lost or leaked DOM');
      lines.push('PASS closing fade after entrance and reopening during fade');
      first.close(); first.destroy(); first.show();
      await wait(300);
      assert(!a.querySelector('.poll'), 'Destroyed instance resurrected');
      lines.push('PASS close/reopen timer cancellation and destroy');
      const float = make(config(id + '-float'), { mode: 'floating' });
      float.show();
      const floating = document.querySelector('.poll--floating');
      floating.querySelector('.poll-close').focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(floating.inert, 'Closing content remains keyboard-interactive');
      assert(document.activeElement === document.getElementById('run'), 'Keyboard close did not restore focus');
      await wait(300);
      assert(!document.querySelector('.poll--floating'), 'Escape did not remove floating poll');
      float.show();
      assert(!document.querySelector('.poll--floating').inert, 'Reopened content stayed inert');
      assert([...document.querySelectorAll('.poll--floating .poll-choice')].every(button => !button.disabled), 'Closing counted as a vote');
      float.destroy();
      lines.push('PASS Escape close and close without voting');
      const safe = document.createElement('div'); fixtures.append(safe);
      make(config(id + '-text', { question: '<img src=x onerror=alert(1)>',
        comment: { author: '<b>name</b>', text: '<script>bad</script>', highlight: ['bad'] } }), { mode: 'inline', container: safe }).show();
      assert(!safe.querySelector('img,script'), 'Config text became HTML');
      assert(safe.textContent.includes('<img'), 'Pure question text was lost');
      lines.push('PASS pure text rendering');
      window.leavers.splice(0).forEach(leave => leave());
      assert(!fixtures.querySelector('.poll'), 'Inline leave cleanup failed');
      lines.push('PASS PJAX leave cleanup');
      output.textContent = lines.join('\n') + '\nALL BROWSER CHECKS PASSED';
    } catch (error) {
      output.textContent = lines.join('\n') + '\nFAIL ' + error.message;
    } finally {
      controllers.forEach(controller => controller.destroy());
    }
  }
  document.getElementById('run').addEventListener('click', run);
})();
