# v1.1 Plan: Token-Bucket Throttle Rewrite + Modularization

Self-contained context document. If the working session loses context, restore from here: it holds the field data, the reviewer's findings, the design, the open questions to challenge, and the process (including reviewer loops) for the implementation.

## Why v1.1 exists

The v1.0 throttle grew by accretion during live debugging: strike counter, minimum pause, AIMD delay, punished-rate floor, refill-rate learner, MIMD recovery. An adversarial review (Fable, xhigh effort) concluded these four-plus mechanisms partially fight each other and should be replaced by a single token-bucket estimator that models what the server actually does. Verdict was BLOCK with two findings rated blocking.

## Field data (measured against chatgpt.com backend-api, 2026-07-07, one account)

- Fresh window allows a burst of ~45 requests at full speed (4 workers, ~250ms pacing) before the first 429.
- In penalty state, observed accepted paces: samples of 6s, 43s, 46s, 54s, 57s per request across stretches. User manually measured roughly 2-3 requests refilling per minute.
- 429 responses carry NO Retry-After header. Body: `{"detail":"Too many requests"}`. Nothing else usable.
- The quota is account-wide: the ChatGPT web UI itself starts throwing 429 popups when the exporter drains the window (user observed conversations flashing then erroring while browsing during a run).
- The web UI's own traffic also drains the shared budget in the other direction.
- Repeated heavy testing appears to tighten the window (penalty state that persists); after quiet periods behavior seems friendlier. Unconfirmed: whether ~40-55s/req is the permanent policy or a penalty regime.
- Binary file downloads go to signed CDN URLs (files.oaiusercontent.com), which do NOT spend backend-api quota. Only the `files/download/<id>` metadata call does.

## Reviewer findings to honor (from the adversarial review)

1. BLOCKING, stuck-slow: 2%/success decay needed ~177 successes (~2h at penalty pace) to recover after a penalty lifted. Partially fixed in v1.0 with MIMD (30% cut per 10 clean requests), but the reviewer's real fix is the token bucket.
2. BLOCKING, learner only fires on failure: a clean run produces no samples, so the system cannot learn "the server is fine now" except by slow decay. The first burst sample (~1.2s/req) reflects bucket SIZE, not refill rate, and can poison the median.
3. Strike-pause, AIMD raise, and floor triple-punish a single 429 with three different memories on three different clocks (5min strikes, 15min floor, unbounded samples).
4. Token-bucket estimator is strictly better: the server IS a token bucket. Estimate B (burst capacity) and r (refill per minute) from accept/reject observations.
5. Multi-tab: the slot-backlog clamp is per-tab (CONCURRENCY is tab-local), so N tabs can run N times the intended rate. Negative token debt in a shared bucket fixes this naturally.
6. Stale state: epochs/streaks persisting across sessions poison the first samples of the next run. (Fixed in v1.0 with a 10-min epoch expiry; keep that property.)

## The proposed core (reviewer's sketch, ~35 lines)

```js
const TB = "cge:tb";
const tb = () => JSON.parse(localStorage.getItem(TB) ||
  '{"B":40,"r":1.4,"tokens":40,"ts":0}'); // r = tokens per minute
const save = (s) => localStorage.setItem(TB, JSON.stringify(s));

function reserve() {            // returns ms to wait before firing
  const s = tb(), now = Date.now();
  s.tokens = Math.min(s.B, s.tokens + (now - s.ts) * s.r / 60000);
  s.ts = now;
  const wait = s.tokens >= 1 ? 0 : (1 - s.tokens) * 60000 / s.r;
  s.tokens -= 1; save(s);
  return wait + Math.random() * 1000;
}
function on429() {
  const s = tb();
  if (s.tokens > 0) s.r *= 0.7;      // we believed budget existed: r was too optimistic
  s.B = Math.min(s.B, longestAcceptRunSinceLast429()); // accept-run length bounds B
  s.tokens = -2; s.ts = Date.now(); save(s);  // small debt replaces the separate pause
}
function onCleanStretch(accepted, ms) { // ran pinned at tokens~0 without a 429
  const s = tb(); s.r = Math.max(s.r, 0.9 * accepted * 60000 / ms); save(s);
}
```

Key properties to preserve in the real implementation:
- `onCleanStretch` is the upward channel the old design lacked: pinned at empty bucket with no 429 proves r is at least our pace.
- A 429 costs only ~2 tokens of debt, so deliberate probes become cheap: fire at tokens~0.5 every ~5min to bound r from above. This replaces the 65s-times-strikes pause entirely.
- The bucket state is shared cross-tab via localStorage; token debt naturally caps multi-tab overrun (no per-tab CONCURRENCY clamp needed).

## Assumptions to CHALLENGE before implementing (do not skip)

1. Is the server really a token bucket? Test: after a long quiet period, does exactly a burst of ~B requests succeed? Does the accept rate at equilibrium match r regardless of burst pattern? If it's a sliding-window-log instead, the bucket model still approximates it, but B estimation differs.
2. Is r constant, or state-dependent (penalty regimes)? Field data suggests the effective r tightens after abuse. The estimator must adapt DOWN quickly (0.7 multiplier on bad predictions) and UP on evidence (clean stretches). Consider a decaying confidence so old penalties don't anchor r forever.
3. Does the ChatGPT web UI's own traffic need headroom? If the user browses during an export, the exporter should leave some fraction of r unclaimed. Consider a utilization factor (e.g. use 80% of estimated r), possibly exposed in the tuner.
4. Do the `files/download` metadata calls share the same bucket as `conversation/` calls? Probably yes (same backend-api), but verify from logs: if file passes 429 at a different rate, they may have separate buckets per endpoint class.
5. Is per-account localStorage sharing enough, or do we need the account id in the throttle keys too? (Cache is per-account IndexedDB now; throttle state is still global localStorage keys `cge:*`. Two accounts in two tabs of the same profile would share one bucket incorrectly. Decide: key throttle state by accountId as well.)
6. The 1000-item localStorage churn: reserve() writes on every request. At 40s/req this is trivial; verify it stays trivial at burst pace (localStorage sync writes block the main thread).

## Modularization (same release)

Split the single-IIFE `src/export-chatgpt.js` (~1200 lines) into ES modules bundled to one file:

```
src/
  main.js          entry, orchestration of the passes
  ui.js            overlay, taskbar, chips, tuner, ETA, buttons
  throttle.js      token bucket + fetchWithRetry (the new core)
  api.js           session/token, apiGet, CDN binary fetch
  cache.js         per-account IndexedDB (convos, files, meta/list snapshot)
  export/refs.js   extractFileReferences, filename sanitize/dedupe
  export/markdown.js
  export/html.js
  zip.js           buildZipBlob, crc32, verifyZip, sha256 manifest
```

Build: replace terser-only pipeline with esbuild (`esbuild src/main.js --bundle --minify --format=iife`), then URL-encode into the bookmarklet as today. Keep `npm run build:debug` (no minify). The test harness keeps evaluating the BUNDLED artifact, not the modules, so coverage semantics stay identical. Add esbuild as devDependency; keep terser only if esbuild's minification underperforms (it won't matter at this size).

Constraints:
- Everything must still work as a pasted single script (no dynamic imports, no external fetches at runtime).
- The tuner must keep live-editing whatever replaces delay/minPause: expose B, r, tokens, utilization in the tuner, editable.
- Keep the UI features intact: worker chips, per-worker logs, resizable console, ETA (recent-rate based), partial save, clear cache (+confirm +restart), account badge, version tag from package.json.

## Process for the implementation session

1. Read this file, then read `src/export-chatgpt.js` fully. Check `git log --oneline -30` for context since this plan was written.
2. Challenge the assumptions above against any new field data in the git history / README before writing code.
3. Implement modularization FIRST (pure refactor, tests must stay green on the bundle), commit.
4. Implement the token bucket in `throttle.js` behind the same `fetchWithRetry` interface, delete strikes/floor/minPause/AIMD/MIMD/learner code paths, commit.
5. Update the tuner UI to the bucket's parameters.
6. Reviewer loops (mandatory):
   - Spawn a `reviewer` subagent (Fable, xhigh reasoning) on the throttle.js design BEFORE wiring it in: same brief as the v1.0 review, plus this plan file. Argue with its findings, apply what survives.
   - After integration, spawn a second reviewer pass on the full diff (`git diff v1.0.0..HEAD`), focus: regressions in pass structure, cache correctness, cross-tab races, and whether the bucket can still stuck-slow or sawtooth.
   - If either reviewer files a BLOCKING finding, fix and re-review before release.
7. Update the mock-API test harness: teach it a token-bucket server (B=5, r=6/min for test speed) and assert the client converges without a 429 storm (e.g. fewer than N 429s across the run) AND recovers to burst pace after a simulated quiet period.
8. `npm version minor` (syncs VERSION + README headline, tags v1.1.0), push; CI tags, builds, releases.

## State of the repo when this plan was written

- v1.0.0, single-file src, terser build, full test harness in test/exporter.test.mjs (mock API, IndexedDB/localStorage stubs, ZIP integrity + checksum assertions).
- Phased pipeline: pass 1 text (JSON+markdown, file names predetermined), pass 2 files (CDN unthrottled), pass 3 HTML, then sha256 manifest, ZIP build with CRC verify.
- Per-account IndexedDB cache (convos by update_time, files immutable, meta list snapshot 24h).
- CI: test job, security job (npm audit + osv-scanner @v2.3.8), release job (auto-tag on package.json version change, release with bookmarklet.txt + export-chatgpt.js + zip), actions v5, node 24.
- Open tasks besides v1.1: CHANGELOG.md generation via CI; file-queue sidebar with per-session prioritization (needs the modular queue, do after v1.1); regenerate-from-cache-on-restart improvements (markdown from cached JSONs without waiting for list).
