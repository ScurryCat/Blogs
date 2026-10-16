const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modelPath = path.join(__dirname, '../assets/js/poll-model.js');
const model = fs.existsSync(modelPath) ? require(modelPath) : {};
const config = (patch = {}) => ({
  id: 'phantom-thieves-belief', title: '怪盗ch', question: '你相信心之怪盗吗？',
  questionHighlight: ['心之怪盗'],
  options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }],
  main: 'yes', base: { yes: 73, no: 927 }, ...patch
});
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
const key = id => 'pl-poll-v2:' + encodeURIComponent(id);

test('exports the shared model API', () => {
  for (const name of ['normalize', 'formatPercent', 'createStore']) {
    assert.equal(typeof model[name], 'function', `${name} must be implemented`);
  }
});

test('normalizes copies without treating text as HTML', () => {
  const input = config({ id: ' custom ', question: '<img src=x onerror=alert(1)>',
    comment: { text: '<b>hello</b>', highlight: ['hello'] } });
  const result = model.normalize(input);
  assert.equal(result.id, 'custom');
  assert.equal(result.question, input.question);
  assert.equal(result.comment.author, '匿名');
  result.options[0].label = 'changed';
  result.base.yes = 2;
  assert.equal(input.options[0].label, 'YES');
  assert.equal(input.base.yes, 73);
});

test('rejects invalid IDs, option values and labels, main and base counts', () => {
  const invalid = [
    [{ id: '' }, /id/i], [{ id: 4 }, /id/i],
    [{ options: [] }, /two|两个/i],
    [{ options: [{ value: 'yes', label: 'YES' }, { value: 'yes', label: 'NO' }] }, /distinct|重复/i],
    [{ options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'YES' }] }, /distinct|重复/i],
    [{ options: [{ value: '', label: 'YES' }, { value: 'no', label: 'NO' }] }, /value/i],
    [{ main: 'missing' }, /main/i], [{ base: { yes: -1, no: 0 } }, /base/i],
    [{ base: { yes: Infinity, no: 0 } }, /base/i], [{ base: { yes: NaN, no: 0 } }, /base/i],
    [{ base: { yes: '73', no: 0 } }, /base/i], [{ question: '' }, /question/i],
    [{ questionHighlight: [''] }, /highlight/i]
  ];
  for (const [patch, error] of invalid) assert.throws(() => model.normalize(config(patch)), error);
});

test('formats after rounding and pads only the integer part', () => {
  for (const [number, expected] of [[0, '00.0%'], [7.3, '07.3%'], [9.999, '10.0%'], [100, '100.0%']]) {
    assert.equal(model.formatPercent(number), expected);
  }
});

test('zero total gives zero counts and percentages', () => {
  const result = model.createStore(null).tally(config({ base: { yes: 0, no: 0 } }));
  assert.deepEqual(result, { n: { yes: 0, no: 0 }, pct: { yes: 0, no: 0 }, total: 0 });
});

test('closing marks seen without adding a vote', () => {
  const store = model.createStore(storage());
  const c = config();
  assert.deepEqual(store.get(c), { seen: false, vote: null });
  assert.deepEqual(store.markSeen(c), { seen: true, vote: null });
  assert.equal(store.tally(c).total, 1000);
});

test('accepts one current option and rejects unknown values', () => {
  const store = model.createStore(storage());
  const c = config();
  assert.throws(() => store.vote(c, 'maybe'), /option|value/i);
  assert.deepEqual(store.vote(c, 'yes'), { seen: true, vote: 'yes' });
  assert.deepEqual(store.vote(c, 'no'), { seen: true, vote: 'yes' });
  assert.equal(store.tally(c).n.yes, 74);
  assert.equal(store.tally(c).total, 1001);
});

test('separates IDs and persists across store creation', () => {
  const disk = storage();
  const a = config({ id: 'one / 中文' }), b = config({ id: 'two' });
  const first = model.createStore(disk);
  first.vote(a, 'no');
  assert.deepEqual(first.get(b), { seen: false, vote: null });
  assert.ok(disk.data.has(key(a.id)));
  assert.equal(model.createStore(disk).get(a).vote, 'no');
});

test('legacy records migrate only to the default ID, including dismissed records', () => {
  const disk = storage({ 'pl-poll-v1': JSON.stringify({ done: 1, vote: 'yes' }) });
  const store = model.createStore(disk);
  assert.deepEqual(store.get(config({ id: 'new-question' })), { seen: false, vote: null });
  assert.deepEqual(store.get(config()), { seen: true, vote: 'yes' });
  assert.ok(disk.data.has(key(config().id)));
  const dismissed = model.createStore(storage({ 'pl-poll-v1': '{"done":1}' }));
  assert.deepEqual(dismissed.get(config()), { seen: true, vote: null });
});

test('default reset removes legacy and new records without touching other IDs', () => {
  const disk = storage({ 'pl-poll-v1': '{"done":1,"vote":"yes"}' });
  const store = model.createStore(disk);
  const other = config({ id: 'other' });
  store.vote(other, 'no');
  store.get(config());
  assert.deepEqual(store.reset(config()), { seen: false, vote: null });
  assert.equal(disk.data.has('pl-poll-v1'), false);
  assert.equal(disk.data.has(key(config().id)), false);
  assert.equal(model.createStore(disk).get(config()).vote, null);
  assert.equal(store.get(other).vote, 'no');
});

test('corrupt JSON and invalid saved votes fall back safely', () => {
  for (const raw of ['{broken', 'null', '[]', '{"seen":true,"vote":"missing"}']) {
    const store = model.createStore(storage({ [key(config().id)]: raw }));
    assert.equal(store.get(config()).vote, null);
    store.vote(config(), 'no');
    assert.equal(store.get(config()).vote, 'no');
  }
});

test('absent, blocked-method and read/write-failing storage retain shared memory state', () => {
  const blocked = {};
  Object.defineProperty(blocked, 'getItem', { get() { throw new Error('blocked'); } });
  const writeFail = storage();
  writeFail.setItem = () => { throw new Error('quota'); };
  for (const disk of [null, blocked, writeFail, {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }
  }]) {
    const store = model.createStore(disk);
    store.markSeen(config());
    store.vote(config(), 'yes');
    assert.equal(store.get(config()).vote, 'yes');
    assert.equal(store.tally(config()).total, 1001);
    store.reset(config());
    assert.deepEqual(store.get(config()), { seen: false, vote: null });
  }
});

test('simultaneous same-ID subscribers receive safe snapshots and unsubscribe', () => {
  const store = model.createStore(null);
  const c = config(), calls = [], mirror = [];
  const off = store.subscribe(c.id, state => { calls.push(state); state.vote = 'no'; });
  const offMirror = store.subscribe(c.id, state => mirror.push(state));
  store.vote(c, 'yes');
  assert.equal(mirror[0].vote, 'yes');
  assert.equal(store.get(c).vote, 'yes');
  const snapshot = store.get(c);
  snapshot.vote = 'no';
  assert.equal(store.get(c).vote, 'yes');
  off(); off(); offMirror();
  store.reset(c);
  assert.equal(calls.length, 1);
  assert.equal(mirror.length, 1);
});

test('same-ID configurations cannot revive a vote for a removed option', () => {
  const store = model.createStore(null);
  store.vote(config(), 'yes');
  const changed = config({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    base: { a: 0, b: 0 }, main: 'a' });
  assert.equal(store.get(changed).vote, null);
  assert.equal(store.tally(changed).total, 0);
});
