const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/core.js'), 'utf8');

function navigation({ reduce = false, connection } = {}) {
  let now = 0, next = 1;
  const timers = new Map(), globalEvents = {}, docEvents = {}, elements = [], navigated = [], idle = [];
  const dom = tag => {
    const classes = new Set(), events = {};
    const el = { tag, dataset: {}, children: [], attributes: {}, className: '',
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        contains: c => classes.has(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
      setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; },
      getAttribute(k) { return this.attributes[k] || null; }, hasAttribute(k) { return k in this.attributes; },
      querySelectorAll() { return []; }, appendChild(el) { this.children.push(el); },
      insertAdjacentHTML() {}, addEventListener(t, fn) { events[t] = fn; },
      dispatch(t) { if (events[t]) events[t](); },
      load() {}, play() { this.plays = (this.plays || 0) + 1; return Promise.resolve(); },
      set innerHTML(value) { if (value.startsWith('<video')) this.firstElementChild = dom('video'); }
    };
    elements.push(el); return el;
  };
  const body = dom('body'), hud = dom('header'), wipe = dom('div');
  const sandbox = { window: { PL_SITE: { name: 'P', nameB: 'L', ticker: [], social: [], arcana: {} } },
    document: { body, createElement: dom, getElementById: id => id === 'hud' ? hud : null,
      querySelector: selector => selector === '.wipe' ? wipe : null,
      addEventListener: (type, fn) => { docEvents[type] = fn; } },
    navigator: { connection }, matchMedia: () => ({ matches: reduce }),
    URL, location: { href: 'http://site.test/index.html', origin: 'http://site.test', pathname: '/index.html', search: '' },
    scrollY: 0,
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, fn) => { (globalEvents[type] ||= []).push(fn); },
    requestIdleCallback: fn => idle.push(fn) };
  sandbox.window.requestIdleCallback = sandbox.requestIdleCallback;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'core.js' });
  const PL = sandbox.window.PL;
  let settle;
  PL.pjax = { go: href => { navigated.push(href); return new Promise(resolve => { settle = resolve; }); } };
  const curtain = { total: 1180, warms: 0, plays: 0, stops: 0,
    warm() { this.warms++; }, ready: () => true,
    play() { this.plays++; return true; }, stop() { this.stops++; } };
  PL.curtain = curtain;
  return { PL, curtain, elements, navigated, timers, idle, wipe, sandbox, context, location: sandbox.location,
    crowd(available = true, wait = 937) {
      return PL.crowd = { wait, warms: 0, plays: 0, stops: 0,
        warm() { this.warms++; }, ready: () => available,
        play() { this.plays++; this.active = available; return available; }, stop() { this.stops++; this.active = false; } };
    },
    page(page) {
      sandbox.location.pathname = page === 'home' ? '/index.html' : '/' + page + '.html';
      sandbox.location.href = sandbox.location.origin + sandbox.location.pathname;
      PL.chrome(page);
    },
    event(type, value = {}) { (globalEvents[type] || []).forEach(fn => fn(value)); },
    click(href = 'post.html?p=one', shape = 'card', overrides = {}) {
      const anchor = dom(shape === 'icon' ? 'svg:a' : 'a'); anchor.attributes.href = href;
      const child = dom(shape === 'icon' ? 'image' : shape === 'list' ? 'b' : 'span');
      child.closest = selector => selector === 'a[href]' ? anchor : null;
      // SVGAnimatedString deliberately has no usable href string.
      if (shape === 'icon') anchor.href = { baseVal: href };
      const event = { target: child, button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...overrides };
      docEvents.click(event); return event;
    },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = end;
    },
    armDive() { idle.forEach(fn => fn()); elements.filter(el => el.tag === 'video').forEach(el => el.dispatch('loadeddata')); },
    async finish() { if (settle) settle(true); await Promise.resolve(); await Promise.resolve(); }
  };
}

test('home to PJAX map warms and dispatches the newly loaded crowd', () => {
  const n = navigation(); n.page('home'); const crowd = n.crowd(); n.page('map');
  n.event('pointerdown');
  assert.ok(crowd.warms > 0, 'newly entered map must warm dynamically loaded art');
  assert.equal(n.click().defaultPrevented, true); assert.equal(crowd.plays, 1);
  assert.equal(n.curtain.plays, 0);
  n.tick(crowd.wait); assert.equal(n.navigated.length, 1);
});

for (const shape of ['icon', 'card', 'list']) test('direct map ' + shape + ' uses renderer timing once through PJAX', async () => {
  const n = navigation(); const crowd = n.crowd(); n.page('map');
  n.click('post.html?p=' + shape, shape); n.click('about.html', shape);
  assert.equal(crowd.plays, 1, 'navigation guard precedes repeated playback');
  n.tick(crowd.wait - 1); assert.equal(n.navigated.length, 0);
  n.tick(1); assert.deepEqual(n.navigated, ['http://site.test/post.html?p=' + shape]);
  n.click('weather.html'); n.tick(2000); assert.equal(n.navigated.length, 1, 'guard lasts through pending PJAX');
  await n.finish(); n.page('map'); n.click('about.html'); n.tick(crowd.wait);
  assert.equal(n.navigated.length, 2, 'settled PJAX releases navigation guard');
});

test('map crowd failure bypasses a ready article dive and uses curtain, then CSS fallback', () => {
  const n = navigation(); n.crowd(false); n.page('map'); n.armDive(); n.click();
  assert.equal(n.curtain.plays, 1);
  assert.ok(n.elements.filter(el => el.tag === 'video').every(el => !el.plays));
  n.tick(1180); assert.equal(n.navigated.length, 1);
  const css = navigation(); css.crowd(false); css.curtain.play = () => false; css.page('map'); css.armDive(); css.click();
  assert.equal(css.wipe.classList.contains('go'), true);
  css.tick(440); assert.equal(css.navigated.length, 1);
});

test('non-map article navigation keeps the existing dive priority', () => {
  const n = navigation(); const crowd = n.crowd(); n.page('home'); n.armDive(); n.click();
  assert.equal(crowd.plays, 0); assert.equal(n.curtain.plays, 0);
  assert.equal(n.elements.filter(el => el.tag === 'video')[0].plays, 1);
  n.tick(720); assert.equal(n.navigated.length, 1);
});

test('modified, external, prevented, and same-page links stay with the browser', () => {
  const n = navigation(); const crowd = n.crowd(); n.page('map');
  for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const e = n.click('about.html', 'card', overrides);
    if (!overrides.defaultPrevented) assert.equal(e.defaultPrevented, false);
  }
  assert.equal(n.click('https://external.test/about.html').defaultPrevented, false);
  assert.equal(n.click('map.html#list').defaultPrevented, false);
  assert.equal(crowd.plays, 0); n.tick(2000); assert.equal(n.navigated.length, 0);
});

test('reduced motion uses direct native navigation without warm or transition delays', () => {
  const n = navigation({ reduce: true }); const crowd = n.crowd(); n.page('map'); n.event('pointerdown'); n.armDive();
  assert.equal(n.click().defaultPrevented, false);
  assert.equal(crowd.warms, 0); assert.equal(crowd.plays, 0); assert.equal(n.curtain.plays, 0);
  n.tick(2000); assert.equal(n.navigated.length, 0);
});

for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
  test('constrained connection skips crowd loading and uses curtain: ' + JSON.stringify(connection), () => {
    const n = navigation({ connection }); const crowd = n.crowd(); n.page('map'); n.event('pointerdown'); n.armDive(); n.click();
    assert.equal(crowd.warms, 0); assert.equal(crowd.plays, 0); assert.equal(n.curtain.plays, 1);
  });
}

for (const type of ['popstate', 'pageshow']) test(type + ' cancels the pending handoff and clears active crowd', () => {
  const n = navigation(); const crowd = n.crowd(); n.page('map'); n.click();
  n.event(type, { persisted: true }); n.tick(2000);
  assert.equal(n.navigated.length, 0, 'a delayed click must not override history restoration');
  assert.ok(crowd.stops > 0);
  n.click('about.html'); n.tick(crowd.wait); assert.equal(n.navigated.length, 1);
});

test('a stalled map PJAX handoff has a finite full-page fallback and clears the crowd', () => {
  const n = navigation(); const crowd = n.crowd(); n.page('map'); n.click('about.html');
  n.tick(crowd.wait); assert.equal(n.navigated.length, 1);
  n.tick(15000);
  assert.equal(n.location.href, 'http://site.test/about.html');
  assert.ok(crowd.stops > 0, 'a stalled request cannot leave the black overlay indefinitely');
});

test('successful PJAX and history cancellation both cancel the stalled-handoff fallback', async () => {
  const n = navigation(); n.crowd(); n.page('map'); n.click('about.html'); n.tick(937);
  await n.finish(); n.tick(15000); assert.equal(n.location.href, 'http://site.test/map.html');
  n.page('map'); n.click('weather.html'); n.tick(937); n.event('popstate'); n.tick(15000);
  assert.equal(n.location.href, 'http://site.test/map.html');
});

// Exercise the real router too: cancelling only the 900ms timer does not cancel a fetch already handed off.
const pjaxSource = fs.readFileSync(path.join(__dirname, '../assets/js/pjax.js'), 'utf8');
function router({ blockInline = false } = {}) {
  const events = {}, requests = [], pushes = [], links = [], frames = [], scripts = [];
  const main = { innerHTML: 'map', focus() {} }, location = { href: 'http://site.test/map.html', origin: 'http://site.test', search: '' };
  let cleanups = 0, leavers = 0;
  const PL = { crowd: { stop() { cleanups++; } }, runLeavers() { leavers++; }, posts: [],
    chrome() {}, rn: value => value };
  class ParserBoundary {
    parseFromString(html) {
      return { title: html, getElementById: id => id === 'main' ? { innerHTML: html } : null,
        querySelector: () => null,
        querySelectorAll: selector => {
          if (selector.startsWith('link') && html.includes('styles')) return [{ href: 'http://site.test/deferred.css' }];
          if (selector.startsWith('script') && html.includes('post-page')) return [{ src: 'http://site.test/assets/js/post.js', hasAttribute: k => k === 'data-page', nonce: 'page-nonce' }];
          if (selector.startsWith('script') && html.includes('external-page')) return [{ src: 'https://external.test/page.js', hasAttribute: k => k === 'data-page' }];
          return [];
        } };
    }
  }
  const sandbox = { window: { PL }, URL, URLSearchParams, AbortController, DOMParser: ParserBoundary, location, scrollY: 0,
    history: { state: {}, replaceState(state) { this.state = state; }, pushState(state, _, href) {
      this.state = state; pushes.push(href); location.href = href; location.search = new URL(href).search;
    } },
    document: { querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => main, createElement: tag => ({ tag, dataset: {}, remove() {} }),
      head: { appendChild: link => links.push(link) }, body: { appendChild(script) {
        scripts.push(script);
        if (!script.src && !blockInline) {
          sandbox.document.currentScript = script;
          vm.runInContext(script.textContent, context, { filename: 'inline page script' });
          sandbox.document.currentScript = null;
        }
      } } },
    fetch: (href, options) => new Promise((resolve, reject) => requests.push({ href, options, resolve, reject })),
    scrollTo() {}, requestAnimationFrame: fn => frames.push(fn),
    addEventListener: (type, fn) => { events[type] = fn; } };
  const context = vm.createContext(sandbox);
  vm.runInContext(pjaxSource, context, { filename: 'pjax.js' });
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      const pending = frames.splice(0); pending.forEach(fn => fn());
    }
  };
  return { pjax: PL.pjax, requests, pushes, links, scripts, main, location, document: sandbox.document,
    async resolve(index, body) { requests[index].resolve({ ok: true, text: async () => body }); await flush(); },
    async reject(index) { requests[index].reject(new Error('aborted old request')); await flush(); },
    async back(href = 'http://site.test/index.html') { location.href = href; location.search = new URL(href).search; events.popstate(); await flush(); },
    async external(script, code) { vm.runInContext(code, context, { filename: 'post.js' }); script.onload(); await flush(); },
    async restore() { events.pageshow({ persisted: true }); await flush(); },
    flush, cleanups: () => cleanups, leavers: () => leavers };
}

test('Back during a map fetch aborts it and ignores its late result without a push or hard fallback', async () => {
  const r = router(); const old = r.pjax.go('about.html'); await r.back();
  assert.equal(r.requests.length, 2, 'Back must start its own fetch even while the old navigation is busy');
  assert.equal(r.requests[0].options.signal.aborted, true);
  await r.resolve(1, 'home'); await r.resolve(0, 'obsolete about'); await old;
  assert.equal(r.main.innerHTML, 'home'); assert.deepEqual(r.pushes, []);
  assert.equal(r.location.href, 'http://site.test/index.html');
});

test('Back while old shared CSS loads prevents stale content swap and history push', async () => {
  const r = router(); const old = r.pjax.go('about.html'); await r.resolve(0, 'obsolete styles');
  assert.equal(r.links.length, 1); await r.back();
  assert.equal(r.requests.length, 2, 'Back must supersede a request waiting on styles');
  await r.resolve(1, 'home');
  r.links[0].onload(); await r.flush(); await old;
  assert.equal(r.main.innerHTML, 'home'); assert.deepEqual(r.pushes, []);
  assert.equal(r.leavers(), 1, 'only the current request unloads the live page');
});

test('obsolete request rejection does not unlock or hard-navigate over the current Back request', async () => {
  const r = router(); const old = r.pjax.go('about.html'); await r.back(); await r.reject(0); await old;
  r.pjax.go('weather.html');
  assert.equal(r.requests.length, 2, 'ordinary duplicate navigation remains guarded');
  assert.equal(r.location.href, 'http://site.test/index.html');
  await r.resolve(1, 'home'); assert.equal(r.main.innerHTML, 'home');
});

test('bfcache restoration cancels an active request and reveals the restored page', async () => {
  const r = router(); const old = r.pjax.go('about.html'); await r.restore();
  assert.ok(r.requests[0].options.signal?.aborted, 'restoration must abort the active fetch'); assert.ok(r.cleanups() > 0);
  await r.resolve(0, 'obsolete about'); await old;
  assert.equal(r.main.innerHTML, 'map'); assert.deepEqual(r.pushes, []);
});

const postSource = fs.readFileSync(path.join(__dirname, '../assets/js/post.js'), 'utf8');
test('late real post.js cannot execute over a map restored by Back', async () => {
  const r = router(); const old = r.pjax.go('post.html?p=missing'); await r.resolve(0, 'post-page');
  const external = r.scripts.find(script => script.src?.endsWith('/post.js'));
  const downloaded = r.requests.findIndex(request => request.href.endsWith('/post.js'));
  assert.ok(external || downloaded >= 0, 'the actual page script must be pending');
  await r.back('http://site.test/map.html');
  await r.resolve(r.requests.length - 1, 'restored-map');
  if (external) await r.external(external, postSource);
  else await r.resolve(downloaded, postSource); // Ignore abort at the fetch boundary to prove the execution guard too.
  await old;
  assert.equal(r.main.innerHTML, 'restored-map', 'stale real post.js must not replace restored map with Target not found');
  assert.equal(r.document.title, 'restored-map');
  assert.equal(r.location.href, 'http://site.test/map.html');
});

test('the current real post.js still executes, propagating its CSP nonce', async () => {
  const r = router(); const current = r.pjax.go('post.html?p=missing'); await r.resolve(0, 'post-page');
  const external = r.scripts.find(script => script.src?.endsWith('/post.js'));
  if (external) await r.external(external, postSource);
  else await r.resolve(1, postSource);
  await current;
  assert.match(r.main.innerHTML, /Target not found/);
  assert.equal(r.document.title, '目标不存在 · PHANTOM LOG');
  assert.equal(r.scripts.at(-1).nonce, 'page-nonce');
});

test('CSP-blocked inline execution safely falls back to a full navigation', async () => {
  const r = router({ blockInline: true }); const current = r.pjax.go('post.html?p=missing'); await r.resolve(0, 'post-page');
  assert.equal(r.requests.length, 2, 'page scripts must be downloaded before guarded execution');
  await r.resolve(1, postSource); await current;
  assert.equal(r.location.href, 'http://site.test/post.html?p=missing');
  assert.ok(r.cleanups() > 0, 'CSP failure reveals before fallback');
});

test('page-script execution only trusts same-origin URLs', async () => {
  const r = router(); const current = r.pjax.go('about.html'); await r.resolve(0, 'external-page');
  assert.equal(r.requests.length, 1, 'foreign page script is not downloaded');
  assert.equal(r.scripts.length, 0, 'foreign page script is not executed');
  await current; assert.equal(r.location.href, 'http://site.test/about.html');
});

test('real core and router clean a crowd handoff ignored during a stalled Back request', async () => {
  const n = navigation(); const crowd = n.crowd(); n.page('map');
  const requests = [];
  n.sandbox.document.querySelectorAll = () => [];
  n.sandbox.AbortController = AbortController;
  n.sandbox.fetch = (href, options) => new Promise((resolve, reject) => requests.push({ href, options, resolve, reject }));
  n.sandbox.history = { state: {}, replaceState() {}, pushState() {} };
  vm.runInContext(pjaxSource, n.context, { filename: 'pjax.js' });
  n.location.href = 'http://site.test/index.html'; n.location.pathname = '/index.html';
  n.event('popstate');
  assert.equal(requests.length, 1); assert.equal(requests[0].href, 'http://site.test/index.html');
  n.click('about.html'); assert.equal(crowd.active, true);
  n.tick(crowd.wait); await Promise.resolve(); await Promise.resolve();
  n.tick(15001);
  assert.equal(crowd.active, false, 'an ignored handoff must clean the crowd even when Back never resolves');
  assert.equal(n.PL.transitionState().navigating, false);
  assert.equal(n.timers.size, 0);
  assert.equal(requests.length, 1, 'the in-flight history request remains the only document fetch');
  assert.equal(n.location.href, 'http://site.test/index.html');
});

test('document fetches bypass stale cached HTML for clicks and history navigation', async () => {
  const r = router(); r.pjax.go('about.html');
  assert.equal(r.requests[0].options.cache, 'no-store');
  await r.back(); assert.equal(r.requests[1].options.cache, 'no-store');
});

test('site entrypoints consistently version the changed shared resources for PJAX deduplication', () => {
  for (const page of ['index', 'about', 'post', 'map', 'weather', 'guestbook', 'poll-demo']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page + '.html'), 'utf8');
    for (const [resource, version] of [['assets/css/chrome.css', '1'], ['assets/js/core.js', '2'], ['assets/js/pjax.js', '2']]) {
      assert.ok(html.includes(resource + '?v=map-travel-' + version), page + ' must version ' + resource);
    }
    if (page === 'map') assert.ok(html.includes('assets/js/crowd.js?v=map-travel-2'));
  }
});
