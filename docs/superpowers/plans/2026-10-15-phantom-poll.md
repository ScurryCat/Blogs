# Phantom Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Chinese-reference HUD to the blog and provide a reusable, per-question-isolated binary poll component.

**Architecture:** Keep classic browser scripts and zero build dependencies. A small model owns validation, tallying and local state; the DOM component owns rendering and lifecycle; scoped CSS owns the HUD appearance. The default question stays in site configuration.

**Tech Stack:** Vanilla JavaScript, CSS/SVG, existing self-hosted fonts, Node built-in test runner, browser verification.

---

## Workspace and boundaries

- User approved working directly in the current project; use branch `codex/phantom-poll`.
- Project: `/Users/v/Documents/ChatGPT/Blog开发/Blogs`.
- Approved spec: `docs/superpowers/specs/2026-10-15-phantom-poll-design.md`.
- Preserve the existing local server on `http://127.0.0.1:8000/`.
- Do not push or create a PR. Do not change unrelated content, music or navigation.
- `.superpowers/` contains review artifacts and must not be published; add it to `.gitignore`.

## Task 1: Deliver the complete reusable poll slice

**Files:**

- Create: `assets/js/poll-model.js` — config validation, formatting, persistence and state.
- Replace: `assets/js/poll.js` — DOM instances, default startup, controls and cleanup.
- Create: `assets/css/poll.css` — isolated HUD styles, scoped tokens and responsive rules.
- Modify: `assets/js/site.js` — migrate only poll configuration to plain text and highlights.
- Modify: `assets/css/chrome.css` — remove the old poll block only.
- Modify: `index.html`, `about.html`, `post.html`, `map.html`, `weather.html`, `guestbook.html` — link poll CSS and load model before renderer.
- Create: `poll-demo.html`, `assets/js/poll-demo.js` — working floating/inline examples with test controls.
- Create: `tests/poll-model.test.cjs` — dependency-free state tests.
- Modify: `README.md`, `.gitignore` — use instructions and exclude design artifacts.

- [x] Write model tests first. Expose the same model from a classic browser global (`PL_POLL_MODEL`) and CommonJS (`module.exports`) for dependency-free tests.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/js/poll-model.js');
const config = () => M.normalize({
  id: 'belief', title: '怪盗ch', question: '你相信心之怪盗吗？',
  options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }],
  base: { yes: 73, no: 927 }, main: 'yes'
});
test('format percentage boundaries without a rounding prefix bug', () => {
  assert.equal(M.formatPercent(0), '00.0%');
  assert.equal(M.formatPercent(7.3), '07.3%');
  assert.equal(M.formatPercent(9.999), '10.0%');
  assert.equal(M.formatPercent(100), '100.0%');
});
test('closing records seen without adding a vote', () => {
  const store = M.createStore(null);
  const c = config();
  store.markSeen(c);
  assert.equal(store.get(c).seen, true);
  assert.equal(store.get(c).vote, null);
  assert.equal(store.tally(c).total, 1000);
});
```

- [x] Run `node --test tests/poll-model.test.cjs` and record the expected missing-feature failure before implementation.
- [x] Add tests for valid config, missing ID, duplicate options, invalid main, negative/nonfinite counts, zero totals, independent question IDs, duplicate voting, persisted refresh, migration from `pl-poll-v1`, default reset, corrupt JSON and blocked/write-failing storage. Test real model behavior; only use a small Storage-compatible in-memory test adapter at the I/O boundary.
- [x] Implement `normalize`, `formatPercent` and `createStore(storage, options)`. The store exposes `get(config)`, `markSeen(config)`, `vote(config,value)`, `reset(config)`, `tally(config)` and a subscription hook for mounted instances. Keep one memory fallback per store so simultaneous instances share state when persistence is unavailable.
- [x] Run the test command again. It must finish with zero failed tests before proceeding to DOM integration.
- [x] Implement `PL.poll.create(config, { mode, container })` returning `show()`, `close()`, `destroy()`. Inline mode requires a container and registers cleanup with `PL.onLeave`; floating mode supports Escape and a close button. Render config text safely, never raw config HTML. `show()` must cancel pending removal; destroyed instances must not resurrect. Keep `PL.poll.show()` and `PL.poll.reset()` for the default poll.
- [x] Use the existing reference Q path as decorative SVG, but use real DOM text for the title, question, options and percentages. Default title has four fixed collage pieces: white 怪 on black, black 盗 on white, white c on black, black h on white. Custom titles remain plain, wrapping DOM text; independent spec review confirmed that only the default title requires collage geometry.
- [x] Use CSS Grid/Flexbox so wrapping questions and comments add height naturally. The Q may be decorative/positioned but cannot cover controls. Percentage has independent digit/percent sizing; allow `100.0%` without clipping. Provide visible keyboard focus, an `aria-live` vote status, and a visible local-demo statistics note. Add a discreet default-question launcher so a dismissed question can be reopened without a console.
- [x] Preserve first-visit startup and the old default record via migration. Read default `PL_SITE.poll` configuration; update it to:

```js
poll: {
  id: 'phantom-thieves-belief', title: '怪盗ch',
  question: '你相信心之怪盗吗？', questionHighlight: ['心之怪盗'],
  options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }],
  main: 'yes', base: { yes: 73, no: 927 },
  comment: { author: '匿名', text: '设网站的人根本脑子有洞', highlight: ['脑子有洞'] }
}
```

- [x] Add poll resources to all six existing HTML entry points. Classic model script precedes poll renderer on initial entry; the existing PJAX shared-script convention stays unchanged. Demo page is directly accessible, not added to main navigation.
- [x] Demo controls must make it possible to test floating reopening, close, reset, destruction, two independent inline polls, a long question and a 100% display through visible UI. Do not add a test-only production API.
- [x] Document copying a new config and mounting inline:

```js
const poll = PL.poll.create({
  id: 'next-article-v1', question: '下一篇想看算法题解吗？',
  questionHighlight: ['算法题解'],
  options: [{ value: 'yes', label: '想看' }, { value: 'no', label: '换个主题' }],
  main: 'yes', base: { yes: 0, no: 0 }
}, { mode: 'inline', container: document.querySelector('#my-poll') });
poll.show();
```

- [x] Run `node --test tests/poll-model.test.cjs`, `node --check` on affected JavaScript and `git diff --check`. Commit only the feature's tracked source/docs/tests. Do not include `.superpowers` files.
- [x] Spec reviewer independently checks the actual implementation against the approved spec and the file boundaries above; fix gaps before code-quality review.
- [x] Code-quality reviewer checks state/lifecycle/security and maintainability after spec compliance passes. Fix important issues before browser acceptance.

## Task 2: Browser acceptance and handoff

- [x] Reload the real website after changes. Confirm the default HUD uses the accepted collage and Q, existing fonts load, and console has no new error.
- [x] At 320, 390, 768 and 1280 pixels, inspect wrapping, focus/close controls, vote bar and percentage. Verify `00.0%`, `07.3%`, `100.0%` and a long Chinese question through demo UI.
- [x] Vote via keyboard, verify repeat voting is unavailable, refresh and confirm persistence. Close and reopen; confirm one DOM instance remains. Destroy and recreate an inline instance via demo controls.
- [x] Test multiple question IDs and identical-ID instances sharing state, and verify default legacy records do not leak into new questions.
- [x] Navigate homepage → about → homepage with the HUD present. Confirm no duplicate poll/launcher and that the music element is preserved.
- [x] Re-run all automated tests and diff checks after any corrections. Save a screenshot of the real applied widget, not the design companion.
- [x] Finish on the local feature branch with no push. Report preview/demo links, key usage location and verification results; offer normal branch integration options without discarding work.

## Verification record

- Feature commit: `e7546de849e43554f84468141fbd26f99226f96a`.
- Model TDD: missing APIs failed first; final 14/14 tests pass (also independently rerun by parent).
- Browser lifecycle TDD: absent create API and keyboard-interactive closing roots failed first; final harness passed API, repeated show, zero tally, mirror synchronization, close/reopen cancellation, destroy, Escape/focus restoration, safe text and leave cleanup.
- Independent browser checks: same-ID Enter vote synchronizes both instances; other IDs remain unvoted; reload preserves choices; destroy/recreate changes inline count 5 → 0 → 5.
- At 320/390/768/1280, all root scroll widths equal layout widths; zero/full percentages and long questions/comments remain within the component. Both self-hosted font families report loaded.
- PJAX demo → home → about → home leaves one floating poll, one launcher, zero orphaned inline polls, and one continuously playing audio element (same source, increasing playback time).
- Spec review found Q/frame separation; parent also reproduced close-button occlusion by the phone tab. Both conditions failed before correction and passed afterward at all four widths, including the original 1280×720 case. Layout fix: `035f069`.
- Final quality review identified a filled entrance animation masking the closing fade. A real-DOM opacity regression failed first, then passed after cancelling the animation only during closing (`58483d3`). The full browser harness was independently rerun and passed afterward; reduced-motion handling and reopening remain covered.
- Spec review: PASS. Final independent code-quality review: APPROVED, no remaining findings.
- Final verification: 14/14 model tests, syntax checks for every site script and browser test, and full feature diff whitespace checks pass. No browser warning/error was logged on the final applied homepage. Actual screenshot saved in the task visualization directory.
- Local branch retained: `codex/phantom-poll`; normal checkout, base `main` at `11640ca`. No merge, push, PR or destructive cleanup performed.
