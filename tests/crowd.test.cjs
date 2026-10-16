const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/crowd.js'), 'utf8');
const manifestPath = path.join(root, 'assets/img/crowd/original/provenance.json');

// Substitute only the browser's image, DOM, Canvas and animation clock boundaries.
function renderer({ reduce = false, missing = -1, decodeFailure = -1, noContext = false,
  width = 1280, height = 720, dpr = 3 } = {}) {
  let now = 0, next = 1, matrix = [1, 0, 0, 1, 0, 0], stack = [], draws = [];
  const pending = new Map(), listeners = {}, images = [], elements = [], fills = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '', shadowBlur: 0,
    setTransform(a, b, c, d, e, f) { matrix = [a, b, c, d, e, f]; },
    clearRect() {},
    fillRect(...args) { fills.push({ args, color: this.fillStyle, alpha: this.globalAlpha }); },
    save() { stack.push({ matrix: matrix.slice(), alpha: this.globalAlpha }); },
    restore() { const saved = stack.pop(); matrix = saved.matrix; this.globalAlpha = saved.alpha; },
    translate(x, y) { matrix[4] += matrix[0] * x; matrix[5] += matrix[3] * y; },
    scale(x, y) { matrix[0] *= x; matrix[3] *= y; },
    drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh) {
      const ratio = Math.min(sandbox.devicePixelRatio || 1, 2);
      const left = (matrix[4] + matrix[0] * dx) / ratio;
      draws.push({ src: im.src, crop: [sx, sy, sw, sh], x: matrix[0] < 0 ? left - dw : left,
        y: (matrix[5] + matrix[3] * dy) / ratio, width: dw, height: dh,
        alpha: this.globalAlpha, mirror: matrix[0] < 0 });
    }
  };
  function element(tag) {
    const classes = new Set();
    const el = { tagName: tag, children: [], className: '',
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      setAttribute() {}, appendChild(child) { this.children.push(child); },
      getContext: () => noContext ? null : ctx };
    elements.push(el);
    return el;
  }
  class ImageBoundary {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; images.push(this); }
    set src(value) { this._src = value; }
    get src() { return this._src; }
    decode() { return images.indexOf(this) === decodeFailure ? Promise.reject(new Error('decode')) : Promise.resolve(); }
  }
  const sandbox = { window: {}, document: { createElement: element, body: element('body') },
    Image: ImageBoundary, matchMedia: () => ({ matches: reduce }), performance: { now: () => now },
    innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    requestAnimationFrame: fn => { const id = next++; pending.set(id, fn); return id; },
    cancelAnimationFrame: id => pending.delete(id) };
  vm.runInNewContext(source, sandbox, { filename: 'crowd.js' });
  const api = sandbox.window.PL.crowd;
  return { api, images, elements, pending, fills, sandbox,
    async load() {
      api.warm();
      images.forEach((im, i) => {
        im.complete = true; im.naturalWidth = i === missing ? 0 : 512; im.naturalHeight = i === missing ? 0 : 1024;
        if (i === missing) { if (im.onerror) im.onerror(); }
        else if (im.onload) im.onload();
      });
      await Promise.resolve(); await Promise.resolve();
    },
    frame(time) {
      now = time; draws = [];
      const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(time));
      return draws.slice();
    },
    clock(time) { now = time; },
    resize(w, h) { sandbox.innerWidth = w; sandbox.innerHeight = h; if (listeners.resize) listeners.resize(); },
    canvas() { return elements.find(el => el.tagName === 'canvas'); },
    overlay() { return elements.find(el => el.className === 'crowd'); }
  };
}

test('ships twelve distinct original PNGs with recorded hashes and alpha crops', () => {
  assert.ok(fs.existsSync(manifestPath), 'original texture provenance is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(manifest.source, 'https://www.spriters-resource.com/playstation_3/persona5/asset/92512/');
  assert.equal(manifest.sprites.length, 12);
  assert.equal(new Set(manifest.sprites.map(s => s.sha256)).size, 12);
  for (const sprite of manifest.sprites) {
    assert.match(sprite.file, /^crowd(?:000|001|003)_000\.pac_[0-3]_risultato\.png$/);
    const bytes = fs.readFileSync(path.join(path.dirname(manifestPath), sprite.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sprite.sha256);
    assert.deepEqual(sprite.size, [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]);
    const [left, top, right, bottom] = sprite.crop;
    assert.ok(left >= 0 && top >= 0 && right <= sprite.size[0] && bottom <= sprite.size[1]);
    assert.ok(right > left && bottom > top);
  }
});

test('warm is idempotent and requests the original textures', () => {
  const r = renderer(); r.api.warm(); r.api.warm();
  assert.equal(r.images.length, 12);
  assert.ok(r.images.every(im => im.src.startsWith('assets/img/crowd/original/')), 'must load original art');
  assert.equal(new Set(r.images.map(im => im.src)).size, 12);
});

test('readiness requires every image and rejects missing or undecodable art', async () => {
  const r = renderer();
  assert.equal(r.api.ready(), false); assert.equal(r.api.play(), false);
  await r.load(); assert.equal(r.api.ready(), true);
  for (const option of [{ missing: 4 }, { decodeFailure: 2 }]) {
    const failed = renderer(option); await failed.load();
    assert.equal(failed.api.ready(), false); assert.equal(failed.api.play(), false);
    assert.equal(failed.pending.size, 0);
  }
});

test('reduced motion skips loading and playback, and missing Canvas falls back', async () => {
  const reduced = renderer({ reduce: true }); await reduced.load();
  assert.equal(reduced.images.length, 0); assert.equal(reduced.api.play(), false);
  const unavailable = renderer({ noContext: true }); await unavailable.load();
  assert.equal(unavailable.api.play(), false); assert.equal(unavailable.pending.size, 0);
  assert.equal(unavailable.overlay().classList.contains('on'), false);
});

test('exposes a finite normal handoff around 900 milliseconds', () => {
  const { api } = renderer();
  assert.ok(Number.isFinite(api.wait) && api.wait >= 800 && api.wait <= 1000);
});

test('play reuses one Canvas and loop; stop cancels, and replay resets elapsed time', async () => {
  const r = renderer(); await r.load();
  assert.equal(r.api.play(), true);
  const first = r.frame(0);
  assert.equal(r.api.play(), true); assert.equal(r.pending.size, 1);
  assert.equal(r.elements.filter(el => el.tagName === 'canvas').length, 1);
  assert.equal(r.overlay().classList.contains('on'), true);
  assert.notDeepEqual(r.frame(300), first);
  r.api.stop(); r.api.stop();
  assert.equal(r.pending.size, 0); assert.equal(r.overlay().classList.contains('on'), false);
  assert.deepEqual(r.frame(500), []);
  r.clock(1000); r.api.play();
  assert.deepEqual(r.frame(1000), first);
});

test('draws three fixed depth layers, preserving each source crop proportion', async () => {
  const r = renderer(); await r.load(); r.api.play();
  const start = r.frame(0), later = r.frame(100);
  const alphas = [...new Set(start.map(d => d.alpha))];
  assert.equal(alphas.length, 3);
  assert.ok(alphas[0] < alphas[1] && alphas[1] < alphas[2]);
  const heights = alphas.map(a => Math.max(...start.filter(d => d.alpha === a).map(d => d.height)));
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);
  const speeds = alphas.map(a => {
    const i = start.findIndex(d => d.alpha === a && Math.abs(later[start.indexOf(d)].x - d.x) < 100);
    return Math.abs(later[i].x - start[i].x);
  });
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2]);
  assert.deepEqual(start.map(d => d.src), later.map(d => d.src), 'people are not walk-animation frames');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  for (const d of start) {
    const sprite = manifest.sprites.find(s => d.src === 'assets/img/crowd/original/' + s.file);
    assert.ok(sprite, 'every drawn texture must be a recorded original asset');
    const [left, top, right, bottom] = sprite.crop;
    assert.deepEqual(d.crop, [left, top, right - left, bottom - top]);
    assert.ok(Math.abs(d.width / d.height - d.crop[2] / d.crop[3]) < 1e-10);
  }
  assert.ok(r.fills.some(f => f.color === '#000' && f.args[2] === 1280 && f.args[3] === 720));
});

test('absolute elapsed time produces identical positions at 60 and 120 Hz', async () => {
  async function run(times) {
    const r = renderer(); await r.load(); r.api.play(); let last;
    for (const time of times) last = r.frame(time);
    return last;
  }
  assert.deepEqual(await run([0, 100, 200, 300]), await run([0, 50, 100, 150, 200, 250, 300]));
});

test('resize caps DPR, rebuilds finite coordinates, and reduces phone counts and sizes', async () => {
  const r = renderer(); await r.load(); r.api.play(); const desktop = r.frame(0);
  assert.equal(r.canvas().width, 2560); assert.equal(r.canvas().height, 1440);
  r.resize(390, 844); const phone = r.frame(300);
  assert.equal(r.canvas().width, 780); assert.equal(r.canvas().height, 1688);
  assert.ok(phone.length < desktop.length);
  assert.ok(Math.max(...phone.map(d => d.width)) < 390 * .6);
  for (const d of [...phone, ...r.frame(600000)]) {
    assert.ok([d.x, d.y, d.width, d.height].every(Number.isFinite));
    assert.ok(d.x > -1500 && d.x < 1500, 'long waits wrap within the lane span');
  }
});

test('phone depth layers share the bottom crop instead of floating on separate floors', async () => {
  const r = renderer({ width: 390, height: 844 }); await r.load(); r.api.play();
  const people = r.frame(0);
  assert.equal(new Set(people.map(person => person.alpha)).size, 3);
  for (const person of people) {
    assert.ok(person.y < 844, 'each person remains visible above the viewport bottom');
    assert.ok(person.y + person.height >= 844 && person.y + person.height <= 844 * 1.05,
      'all phone figures crop at the same viewport bottom');
    assert.ok(person.width < 390 * .6);
    assert.ok(Math.abs(person.width / person.height - person.crop[2] / person.crop[3]) < 1e-10);
  }
});
