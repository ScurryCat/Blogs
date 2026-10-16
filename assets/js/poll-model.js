/* Shared, DOM-free poll rules. A store owns per-ID memory even when storage fails. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PL_POLL_MODEL = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_ID = 'phantom-thieves-belief';
  const LEGACY_KEY = 'pl-poll-v1';
  const empty = () => ({ seen: false, vote: null });
  const copy = state => ({ seen: state.seen, vote: state.vote });
  function text(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Poll ${name} must be nonempty text`);
    return value.trim();
  }
  function highlights(value, name) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new TypeError(`Poll ${name} highlights must be an array`);
    return value.map(item => text(item, `${name} highlight`));
  }
  function normalize(config) {
    if (!config || typeof config !== 'object') throw new TypeError('Poll config is required');
    const id = text(config.id, 'id');
    if (!Array.isArray(config.options) || config.options.length !== 2) {
      throw new TypeError('Poll options must contain exactly two options');
    }
    const options = config.options.map(option => ({
      value: text(option && option.value, 'option value'), label: text(option && option.label, 'option label')
    }));
    if (options[0].value === options[1].value || options[0].label === options[1].label) {
      throw new TypeError('Poll option values and labels must be distinct');
    }
    if (!options.some(option => option.value === config.main)) throw new TypeError('Poll main must be a current option value');
    const base = Object.fromEntries(options.map(option => {
      const count = config.base && config.base[option.value];
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
        throw new TypeError(`Poll base.${option.value} must be a finite nonnegative number`);
      }
      return [option.value, count];
    }));
    const result = { id, title: text(config.title == null ? '怪盗ch' : config.title, 'title'),
      question: text(config.question, 'question'), questionHighlight: highlights(config.questionHighlight, 'question'),
      options, main: config.main, base, comment: null };
    if (config.comment != null) {
      result.comment = { author: text(config.comment.author == null ? '匿名' : config.comment.author, 'comment author'),
        text: text(config.comment.text, 'comment text'), highlight: highlights(config.comment.highlight, 'comment') };
    }
    return result;
  }
  function formatPercent(number) {
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new TypeError('Poll percentage must be between 0 and 100');
    const parts = number.toFixed(1).split('.');
    return parts[0].padStart(2, '0') + '.' + parts[1] + '%';
  }
  function createStore(storage, options = {}) {
    const defaultId = options.defaultId || DEFAULT_ID;
    const memory = new Map();
    const subscribers = new Map();
    const key = id => 'pl-poll-v2:' + encodeURIComponent(id);
    function read(name) {
      try { return storage ? storage.getItem(name) : null; } catch (error) { return null; }
    }
    function write(id, state) {
      try { if (storage) storage.setItem(key(id), JSON.stringify(state)); } catch (error) { /* Memory remains authoritative. */ }
    }
    function parse(raw) {
      try {
        const value = JSON.parse(raw);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      } catch (error) { return null; }
    }
    function stateFor(config) {
      if (!memory.has(config.id)) {
        const raw = read(key(config.id));
        let saved = parse(raw);
        if (raw == null && config.id === defaultId) {
          const legacy = parse(read(LEGACY_KEY));
          if (legacy) {
            saved = { seen: !!legacy.done, vote: legacy.vote };
            write(config.id, saved);
          }
        }
        memory.set(config.id, saved || empty());
      }
      const state = memory.get(config.id);
      const vote = config.options.some(option => option.value === state.vote) ? state.vote : null;
      return { seen: state.seen === true || !!vote, vote };
    }
    function notify(id, state) {
      const listeners = subscribers.get(id);
      if (listeners) [...listeners].forEach(callback => callback(copy(state)));
    }
    function save(config, state) {
      memory.set(config.id, copy(state));
      write(config.id, state);
      notify(config.id, state);
      return copy(state);
    }
    function get(config) { return stateFor(normalize(config)); }
    function markSeen(input) {
      const config = normalize(input), state = stateFor(config);
      return state.seen ? state : save(config, { ...state, seen: true });
    }
    function vote(input, value) {
      const config = normalize(input);
      if (!config.options.some(option => option.value === value)) throw new TypeError('Poll vote must be a current option value');
      const state = stateFor(config);
      return state.vote ? state : save(config, { seen: true, vote: value });
    }
    function reset(input) {
      const config = normalize(input), state = empty();
      memory.set(config.id, state);
      try {
        if (storage) {
          if (config.id === defaultId) storage.removeItem(LEGACY_KEY);
          storage.removeItem(key(config.id));
        }
      } catch (error) {
        // A reset tombstone prevents re-migration if removal is blocked but writing works.
        write(config.id, state);
      }
      notify(config.id, state);
      return copy(state);
    }
    function tally(input) {
      const config = normalize(input), state = stateFor(config);
      const n = Object.fromEntries(config.options.map(option => [option.value,
        config.base[option.value] + (state.vote === option.value ? 1 : 0)]));
      const counts = Object.values(n), total = counts.reduce((sum, count) => sum + count, 0);
      // Scaling also keeps percentages finite when two finite base counts overflow their sum.
      const scale = Math.max(...counts), scaledTotal = scale ? counts.reduce((sum, count) => sum + count / scale, 0) : 0;
      const pct = Object.fromEntries(config.options.map(option => [option.value,
        scaledTotal ? n[option.value] / scale / scaledTotal * 100 : 0]));
      return { n, pct, total };
    }
    function subscribe(id, callback) {
      id = text(id, 'id');
      if (typeof callback !== 'function') throw new TypeError('Poll subscriber must be a function');
      if (!subscribers.has(id)) subscribers.set(id, new Set());
      const listeners = subscribers.get(id);
      listeners.add(callback);
      return () => { listeners.delete(callback); if (!listeners.size) subscribers.delete(id); };
    }
    return { get, markSeen, vote, reset, tally, subscribe };
  }
  return { normalize, formatPercent, createStore };
});
