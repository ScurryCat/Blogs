# Map Travel Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the map's community crowd collage with a deterministic, layered transition using original P5 Crowd textures, without breaking navigation, BGM, reduced-motion behavior or the existing poll.

**Architecture:** Keep the existing `PL.crowd` Canvas component and PJAX handoff. Replace only its resources and animation, and repair the shared navigation dispatcher so it uses the current page and dynamically loaded crowd component rather than first-page closures. No video, new dependency, router rewrite or animation framework.

**Tech Stack:** Classic JavaScript, Canvas 2D, CSS, Node's built-in test runner, existing local HTTP server and integrated browser.

**Approved design:** `docs/superpowers/specs/2026-10-16-map-travel-transition-design.md`.

**Working constraints:** User chose the existing checkout. Branch `codex/phantom-poll`. Five existing poll-related dirty files must remain untouched. Do not push, merge or create a PR. Local commits must stage only this task's files.

## Task 1: Original-texture crowd renderer and map dispatch

These changes are one coupled unit: the renderer's timing and the dispatcher's handoff must agree.

**Files**

- Modify `assets/js/crowd.js`: loading, time-based layered rendering and lifecycle.
- Modify `assets/js/core.js`: current-page tracking, dynamic crowd lookup, duplicate-navigation guard and map-only fallback.
- Modify `assets/css/chrome.css`: crowd entrance/exit and active interaction blocking.
- Modify `README.md`: actual source and limits of the reconstructed transition.
- Add `assets/img/crowd/original/`: selected original PNGs plus a provenance manifest.
- Add `tests/crowd.test.cjs`: runtime behavior and original-asset integrity.
- Add `tests/map-transition.test.cjs`: dispatch behavior using the real shared core script with minimal DOM/clock boundaries.
- Add `tests/crowd-browser.html` and `tests/crowd-browser.js`: isolated visible playback and browser acceptance checks. Do not change the existing poll harness.

- [x] **Step 1 — Capture baseline and resource metadata.** Run `node --test tests/poll-model.test.cjs` and `git status --short`. Inspect original PNG alpha bounds and select approximately 12 distinct people from `crowd000_000.pac_0..3`, `crowd001_000.pac_0..3` and `crowd003_000.pac_0..3`. These suffixes are different people, not sequential walk frames. Copy original bytes rather than generating or editing art. Record filenames, source archive URL, SHA-256 and crop bounds in the provenance manifest.

- [x] **Step 2 — Write failing renderer tests.** Execute the real `crowd.js` in a Node VM, substituting only unavailable browser boundaries (Image decode, Canvas drawing, DOM nodes and rAF clock). Assert: original-directory image URLs; one-time warm; readiness and missing-image rejection; reduced-motion skip; finite `wait` supplied to navigation; idempotent play; stop cancels all scheduled drawing; replay resets the timeline; layer alpha/size/speed differ; original image aspect ratios are preserved; matching timestamps produce matching positions at 60 and 120Hz; resize rebuilds backing size without invalid coordinates. Do not add test-only production methods.

The scheduling test should use elapsed timestamps, not frame counts:

```js
const sixty = runFrames([0, 100, 200, 300]);
const fast = runFrames([0, 50, 100, 150, 200, 250, 300]);
assert.deepEqual(sixty.lastDraw, fast.lastDraw);
```

`runFrames` is a test-local helper that invokes the callbacks captured by the VM's rAF boundary; `lastDraw` contains recorded Canvas destination coordinates at the final timestamp.

- [x] **Step 3 — Write failing navigation tests.** Invoke the real `PL.chrome('home')`, attach the crowd API afterward, call `PL.chrome('map')`, and dispatch a genuine-shaped internal link event. Assert that the dynamically loaded crowd plays and its `wait` controls a single navigation. Cover direct map entry, icon/card/list anchor shapes, repeated clicks before handoff, map-to-article with a ready dive clip but unavailable crowd, non-map article dispatch, modified/external/same-page links, reduced-motion skip, and popstate cancellation of pending timers.

- [x] **Step 4 — Run the new tests before production edits.** Run `node --test tests/crowd.test.cjs tests/map-transition.test.cjs`. Confirm failures refer to missing original resources, elapsed-time choreography, dynamic dispatch or guard behavior; repair test setup errors rather than counting them as the red phase.

- [x] **Step 5 — Replace the renderer and copy selected resources.** Keep the public warm/ready/play/stop API and add the navigation timing value, e.g. `wait: 900`. Draw a black full-viewport backing and three fixed layers (small/dim/slow background, medium middle, large/bright/fast foreground). Crop only transparent margins using recorded bounds, preserving each person's aspect ratio. Use fixed lane direction/phase rather than random placement or cycling people as animation frames. Remove purple glow. Use `performance.now() - start` for positions; reuse the same Canvas and cancel rAF on stop. Use approximately 900ms playback plus a short CSS exit, holding the overlay until PJAX unveils.

Elapsed-time position calculation can stay local to the renderer:

```js
const travel = elapsedMs / 1000 * layer.speed;
const x = laneStart + layer.direction * travel;
```

Wrap lanes over their full span when needed so a delayed network response does not empty the frame. Limit DPR to 2. At narrow widths reduce count and person dimensions rather than stretching a desktop scene.

- [x] **Step 6 — Repair navigation at the existing responsible layer.** Track the latest page passed to `chrome()` even when chrome is already built. Resolve `window.PL.crowd` at map warm/play time, not only at first chrome creation. Set a navigation guard before scheduling the handoff and clear it after the actual PJAX promise settles. Cancel pending timers on history navigation/page restoration. Use the renderer's `wait`; if a map crowd cannot play, fall through to curtain/CSS, not the article's dive clip. Keep non-map dispatch semantics intact. Use the existing PJAX unveil cleanup; no second router or audio element.

The page-tracking seam is deliberately small:

```js
let currentPage = '';
function chrome(page) {
  currentPage = page;
  if (chromed) { paintNav(page); return; }
  // Existing one-time chrome construction remains here.
}
```

The implementation must also warm the newly available crowd after entering the map via PJAX; a page-name fix alone is insufficient.

- [x] **Step 7 — Make all new tests green.** Run `node --test tests/crowd.test.cjs tests/map-transition.test.cjs tests/poll-model.test.cjs`, syntax-check changed JavaScript, then `git diff --check`. Confirm test assertions exercise runtime choices and coordinates, not only source strings.

- [x] **Step 8 — Add the browser harness and source notes.** Provide visible “播放人群转场” and “停止” controls using the production component. Show readiness and checks for one Canvas, movement across time, PNG loads, stop/replay and layer cleanup. Give the main agent a clear screenshot path/view to capture. In README distinguish original extracted texture artwork from reconstructed choreography; do not claim exact original timing.

- [x] **Step 9 — Self-review and commit only task files.** Inspect the diff against the approved design. Confirm all PNGs in the manifest match source bytes and every referenced URL exists inside `Blogs`. Stage explicit paths only. Commit with `feat: rebuild map travel with original P5 crowd sprites`. Report changed files, red/green evidence and any caveat to the controller.

## Final acceptance and independent review

- [x] Spec reviewer inspects the complete change against the approved design; resolve material gaps before quality review.
- [x] Quality reviewer checks navigation races, PJAX lifetime, timing, resize, asset loading and test quality; resolve important findings and re-review.
- [x] In the integrated browser, verify direct map entry and homepage → map → destination. Click an SVG icon, the card's “出发”, and a location-list link on separate trips; verify correct final URL and no remaining `.crowd.on`.
- [x] Verify back/forward and active audio element continuity. Do not alter persistent user preferences to test reduced-motion; use an isolated test environment for that branch.
- [x] Inspect roughly 390px and 1280px viewport widths, reset viewport override afterward, and capture a real rendered transition screenshot. Keep a map preview as the deliverable.
- [x] Run all Node tests, JavaScript syntax checks and `git diff --check` again. Record results here. Preserve the five unrelated poll dirty files. No push or merge.

## Verification record

Baseline: 14 poll-model tests passed; Python HTTP server listening on 127.0.0.1:8000. Original textures are RGBA with transparent backgrounds; the four `pac` suffixes inspected are different characters, not frames.

Final acceptance (2026-10-16):

- Main-agent fresh run: `node --test tests/*.test.cjs` — 50 passed, 0 failed. Changed JavaScript syntax checks, working diff checks and committed-range whitespace checks passed.
- Independent spec and quality reviews both approved source commit `1a5469e4`. Reviews caught and verified fixes for stale page-script execution after Back and an ignored handoff during a pending history request.
- Live browser: homepage → PJAX map → SVG 六本木 icon → about; map card “出发” → home; location-list 新宿区 → Tokyo article. Each map entrance showed `.crowd.on` with one Canvas, reached the correct URL and cleared the overlay.
- Back/forward restored the proper map/article with one HUD and no active crowd. Playing audio continued from 27.82s to 28.84s through a card navigation, and continued past 60s through history navigation; restored the test tab's original paused state afterward.
- Actual layout checked at 1280×800 and 390×844. Phone figures share the bottom crop; desktop composition is unchanged by phone refinement. Temporary viewport override reset and test tab closed.
- Original PNG hashes, real browser drawing paths/crops and three distinct layer alphas passed the browser harness. Harness rejects stale renderers instead of accepting an old cached crowd.
- Local preview updated to `http://127.0.0.1:8000/map.html?preview=map-travel-final`, with core/crowd/PJAX `map-travel-2` imports and only one HUD.
- Screenshots saved outside the repository: `map-travel-final.jpg` and `map-travel-phone.jpg` in the chat visualization directory.
- The five preexisting poll-related files remain uncommitted and untouched by this task. Map work is locally committed; nothing pushed or merged.
