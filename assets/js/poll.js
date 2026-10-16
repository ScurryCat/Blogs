/* Reusable binary poll HUD. Shared once across PJAX; inline instances clean up on leave. */
(function () {
  'use strict';
  const PL = window.PL = window.PL || {};
  if (PL.poll) return;
  const model = window.PL_POLL_MODEL;
  if (!model) { console.error('Poll: load poll-model.js before poll.js'); return; }
  let storage = null;
  try { storage = window.localStorage; } catch (error) { /* Shared in-page memory works without storage. */ }
  const store = model.createStore(storage);
  const floating = [];
  let serial = 0, defaultPoll = null, launcher = null, defaultOpen = false;
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function highlighted(target, text, phrases) {
    const words = [...new Set(phrases)].sort((a, b) => b.length - a.length);
    let offset = 0;
    while (offset < text.length) {
      let next = text.length, match = '';
      words.forEach(word => {
        const index = text.indexOf(word, offset);
        if (index !== -1 && index < next) { next = index; match = word; }
      });
      target.append(document.createTextNode(text.slice(offset, next)));
      if (!match) break;
      target.append(element('strong', 'poll-highlight', match));
      offset = next + match.length;
    }
  }
  function qDecoration() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-4 -8 166 212');
    svg.setAttribute('class', 'poll-q');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('fill', '#fff');
    path.setAttribute('stroke', '#030303');
    path.setAttribute('stroke-width', '13');
    path.setAttribute('paint-order', 'stroke fill');
    path.setAttribute('fill-rule', 'evenodd');
    // Approved mockup geometry: outlined Q, inner wedge and angular tail.
    path.setAttribute('d', 'M88 2C43-3 15 31 7 79C-1 128 15 168 53 177C68 181 84 181 99 176L127 194L151 165L124 146C143 121 149 92 140 60C132 27 114 5 88 2ZM82 43C65 40 53 52 47 74C40 98 43 122 56 131C64 137 73 137 80 133L68 124L86 96L102 109C107 98 110 86 107 73C103 55 94 45 82 43Z');
    svg.append(path);
    return svg;
  }
  function titleNode(title) {
    const node = element('p', 'poll-title');
    if (title === '怪盗ch') {
      node.setAttribute('aria-label', title);
      ['怪', '盗', 'c', 'h'].forEach((letter, index) => {
        const tile = element('span', 'poll-tile poll-tile--' + index, letter);
        tile.setAttribute('aria-hidden', 'true');
        node.append(tile);
      });
    } else node.textContent = title;
    return node;
  }
  function syncLauncher() { if (launcher) launcher.hidden = defaultOpen; }
  function removeFloating(controller) {
    const index = floating.indexOf(controller);
    if (index !== -1) floating.splice(index, 1);
  }
  function create(input, options = {}) {
    const config = model.normalize(input);
    const mode = options.mode || 'floating';
    if (mode !== 'floating' && mode !== 'inline') throw new TypeError('Poll mode must be floating or inline');
    const container = options.container;
    if (mode === 'inline' && (!container || container.nodeType !== 1 || typeof container.appendChild !== 'function')) {
      throw new TypeError('Inline poll requires a container element');
    }
    const uid = 'pl-poll-' + (++serial);
    let root = null, refs = null, closeTimer = null, destroyed = false, open = false, returnFocus = null;
    let lastVote = store.get(config).vote;
    function render() {
      if (!root || destroyed) return;
      const state = store.get(config), tally = store.tally(config);
      const percent = model.formatPercent(tally.pct[config.main]);
      const [integer, decimal] = percent.slice(0, -1).split('.');
      refs.whole.textContent = integer;
      refs.fraction.textContent = '.' + decimal;
      refs.bar.style.setProperty('--poll-fill', tally.pct[config.main] + '%');
      refs.result.setAttribute('aria-label', `${config.options.find(option => option.value === config.main).label}：${percent}。本地展示，非全站统计`);
      refs.choices.forEach((button, index) => {
        const selected = state.vote === config.options[index].value;
        button.disabled = !!state.vote;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-label', config.options[index].label + (selected ? '，已选择' : ''));
      });
      refs.status.textContent = state.vote
        ? `已记下你这一票：${config.options.find(option => option.value === state.vote).label}` : '';
      if (state.vote && !lastVote && refs.choices.includes(document.activeElement)) refs.status.focus({ preventScroll: true });
      lastVote = state.vote;
    }
    function onClick(event) {
      if (!open || destroyed) return;
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      if (button.classList.contains('poll-close')) close(event.detail === 0);
      else if (button.classList.contains('poll-choice')) store.vote(config, button.dataset.value);
    }
    function onKey(event) {
      if (event.key === 'Escape' && open && floating[floating.length - 1] === controller) {
        event.preventDefault(); close(true);
      }
    }
    function build() {
      root = element(mode === 'floating' ? 'aside' : 'section', 'poll poll--' + mode);
      root.dataset.pollId = config.id;
      root.setAttribute('aria-labelledby', uid + '-question');
      root.setAttribute('aria-describedby', uid + '-note');
      const panel = element('div', 'poll-panel');
      const heading = titleNode(config.title);
      const question = element('p', 'poll-question');
      question.id = uid + '-question';
      highlighted(question, config.question, config.questionHighlight);
      const intro = element('div', 'poll-intro');
      intro.append(heading, question);
      const result = element('div', 'poll-result');
      result.setAttribute('role', 'img');
      const bar = element('div', 'poll-bar');
      bar.setAttribute('aria-hidden', 'true');
      bar.append(element('i', 'poll-fill'), element('span', 'poll-result-label',
        config.options.find(option => option.value === config.main).label));
      const percent = element('b', 'poll-percent');
      percent.setAttribute('aria-hidden', 'true');
      const number = element('span', 'poll-number'), sign = element('span', 'poll-sign', '%');
      const whole = element('span', 'poll-whole'), fraction = element('span', 'poll-fraction');
      number.append(whole, fraction);
      percent.append(number, sign);
      result.append(bar, percent);
      const actions = element('div', 'poll-actions');
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', '选择你的答案');
      const choices = config.options.map(option => {
        const button = element('button', 'poll-choice', option.label);
        button.type = 'button'; button.dataset.value = option.value;
        actions.append(button);
        return button;
      });
      panel.append(qDecoration(), intro, result, actions);
      if (config.comment) {
        const comment = element('p', 'poll-comment');
        const author = element('span', 'poll-author', '@' + config.comment.author);
        const message = element('span', 'poll-message');
        highlighted(message, config.comment.text, config.comment.highlight);
        comment.append(author, message); panel.append(comment);
      }
      const status = element('p', 'poll-status');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true'); status.tabIndex = -1;
      const note = element('p', 'poll-note', '本地展示 · 非全站统计');
      note.id = uid + '-note';
      panel.append(status, note);
      root.append(panel);
      if (mode === 'floating') {
        const button = element('button', 'poll-close', '×');
        button.type = 'button'; button.setAttribute('aria-label', '关闭问卷');
        root.append(button);
      }
      refs = { result, bar, whole, fraction, choices, status };
      root.addEventListener('click', onClick);
    }
    function show() {
      if (destroyed || open) return controller;
      clearTimeout(closeTimer); closeTimer = null;
      if (!root) build();
      root.inert = false;
      root.classList.remove('is-closing');
      const target = mode === 'inline' ? container : document.body;
      if (!target) throw new Error('Poll mount target is not available');
      if (!root.isConnected || root.parentNode !== target) target.appendChild(root);
      open = true;
      if (mode === 'floating') {
        returnFocus = document.activeElement;
        removeFloating(controller); floating.push(controller);
        document.addEventListener('keydown', onKey);
      }
      if (controller === defaultPoll) { defaultOpen = true; syncLauncher(); }
      render();
      return controller;
    }
    function close(keyboard = false) {
      if (destroyed || !open) return controller;
      store.markSeen(config);
      open = false;
      removeFloating(controller);
      document.removeEventListener('keydown', onKey);
      if (controller === defaultPoll) { defaultOpen = false; syncLauncher(); }
      if (keyboard && root.contains(document.activeElement)) {
        const focus = returnFocus && returnFocus.isConnected && !root.contains(returnFocus) ? returnFocus : launcher;
        if (focus && !focus.hidden && typeof focus.focus === 'function') focus.focus({ preventScroll: true });
      }
      root.classList.add('is-closing');
      root.inert = true;
      const closingNode = root;
      closeTimer = setTimeout(() => {
        closingNode.removeEventListener('click', onClick); closingNode.remove();
        if (root === closingNode) { root = null; refs = null; }
        closeTimer = null;
      }, reduced() ? 0 : 220);
      return controller;
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; open = false;
      clearTimeout(closeTimer); closeTimer = null;
      document.removeEventListener('keydown', onKey);
      unsubscribe(); removeFloating(controller);
      if (root) { root.removeEventListener('click', onClick); root.remove(); root = null; refs = null; }
      returnFocus = null;
      if (controller === defaultPoll) { defaultOpen = false; syncLauncher(); }
    }
    const controller = { show, close, destroy };
    const unsubscribe = store.subscribe(config.id, render);
    if (mode === 'inline' && typeof PL.onLeave === 'function') PL.onLeave(destroy);
    return controller;
  }
  const defaultConfig = window.PL_SITE && window.PL_SITE.poll;
  function ensureDefault() {
    if (!defaultConfig) return null;
    if (!defaultPoll) defaultPoll = create(defaultConfig, { mode: 'floating' });
    return defaultPoll;
  }
  PL.poll = {
    create,
    show: () => { const poll = ensureDefault(); if (poll) poll.show(); },
    close: () => { if (defaultPoll) defaultPoll.close(); },
    reset: () => defaultConfig ? store.reset(defaultConfig) : null
  };
  function boot() {
    if (!defaultConfig) return;
    try {
      ensureDefault();
      launcher = element('button', 'poll-launcher', '怪盗ch · 问卷');
      launcher.type = 'button'; launcher.setAttribute('aria-label', '打开怪盗ch本地问卷');
      launcher.addEventListener('click', () => {
        defaultPoll.show();
        const close = document.querySelector('.poll[data-poll-id="phantom-thieves-belief"] .poll-close');
        if (close) close.focus();
      });
      document.body.append(launcher); syncLauncher();
      if (store.get(defaultConfig).seen) return;
      const go = () => { if (!store.get(defaultConfig).seen) defaultPoll.show(); };
      if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 2200 });
      else setTimeout(go, 1600);
    } catch (error) { console.error('Poll: default startup failed', error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
