## v1.0.8 (2026-07-09)

- v1.0.8
- Completion summary as a clean stat list instead of a run-on sentence
- Show filenames in file-pass progress, skip un-downloadable #p_N page pointers
- Drop laggy backdrop blur, assist double-try, phase-aware progress bar and ETA
- Test harness: stubs Node 24 lacks (indexedDB.databases, sessionStorage, storage iteration)
- Test harness: progress diagnostics while waiting for the ZIP
- Test harness: cap injected-429 pause via account-scoped key, raise poll ceiling
- Test harness: window.addEventListener stub
- Reload forensics: heartbeat proves when a run died to a page reload
- Test harness: window/history stubs for SPA capture
- Browser-assist via SPA navigation in the main window, no iframe
- Fail fast on stale 412s, route them directly to browser-assist
- Browser-assist obeys the shared throttle
- Browser-assist pass: harvest stale conversations through the app itself
- Legacy cache migration, stale-conversations report in the ZIP
- Send all discoverable ois1 tokens in x-oai-is-pending-updates
- Send x-oai-is-pending-updates header to unstick 412 conversations
- chore: update CHANGELOG for v1.0.7 [skip ci]

## v1.0.7 (2026-07-08)

- v1.0.7
- README: important notice to use v1.0.7+
- Seed seenIds from the snapshot path so the cache merge cannot duplicate the list
- Process cached conversations first, uncached last
- Export the union of fetched list and cached conversations
- List pagination: page until an empty page, advance by received count
- Test harness: count() on IndexedDB stub
- Guard against truncated conversation lists poisoning the snapshot
- chore: update CHANGELOG for v1.0.6 [skip ci]

## v1.0.6 (2026-07-08)

- v1.0.6
- Treat 412 as retryable with backoff, add recovery sweep for failed conversations
- chore: update CHANGELOG for v1.0.5 [skip ci]

## v1.0.5 (2026-07-08)

- v1.0.5
- Refresh expired session token on 401/403/412 instead of failing conversations
- Add MIT LICENSE, license field in package.json, README section
- README screenshot: v1.0.4 UI with blur, countdown ring, tuner, taskbar
- CHANGELOG contains tagged releases only, drop Unreleased section
- Release CI drops the stale Unreleased section when prepending a version
- Regenerate CHANGELOG with full per-version history back to v1.0.0
- chore: update CHANGELOG for v1.0.4 [skip ci]
- Blur page behind overlay, fix CHANGELOG step on first run

## v1.0.4 (2026-07-08)

- Replace hourglass with countdown ring, badge clears the bar, chips shrink on small screens
- Fix release job: gate on existing release instead of tag

## v1.0.3 (2026-07-08)

- Test harness: recursive canvas context stub for gradient/path calls
- Hourglass redrawn: curved bulbs, volume-accurate pool, rounded caps
- Account badge back at bottom left under the console, migrate legacy samples

## v1.0.2 (2026-07-08)

- Account-scoped throttle keys, UTF-8 zip names, 4GB guard
- Hourglass inside the popup card, sand fill follows the glass geometry
- Account badge moved into the taskbar, skip-wait wakes sleeping workers

## v1.0.1 (2026-07-07)

- Hourglass pause animation, compact tuner readout with per-stretch stats table
- Markdown links files in pass 1, CHANGELOG generation in release CI, v1.1 plan doc
- Markdown generated in the text pass so partial saves are readable
- ETA from recent completion rate instead of whole-run average
- Account-scoped cache, list snapshot for instant resume, account badge
- Tuner: media-style skip-wait and pause/resume buttons
- Tuner: fire-now and hold/release manual controls
- Reviewer fixes: MIMD recovery, floor at proven-too-fast rate, stale epoch expiry

## v1.0.0 (2026-07-07)

- README rewrite with version headline and Fable 5 badge, purge em-dashes, pin osv-scanner action
- Learner samples can only lower the delay, echo of our own pacing no longer ratchets it up
- Fix slot-reservation leak in cross-tab pacer, show next-request countdown in tuner
- README screenshot (redacted), CI on Node 24 LTS
- Phased pipeline (text -> files -> render), CDN fetches unthrottled, CI release automation
- Refill-rate learner, min-pause on first 429, live throttle tuner panel
- Floor the delay at recently-punished rates so decay stops re-triggering 429s
- Multiplicative delay climb on strikes to discover low tolerated rates faster
- IndexedDB cache for conversations and files, human-pace default, UI perf cap
- Add request jitter to avoid metronome pattern
- Throttle chip: pinned rightmost via flex order, styled as status pill
- Rework throttle for sliding-window quotas: strike-based pauses, hover decay
- Version from package.json, CI with dependency audit, taskbar UX improvements
- Add build:debug script for unminified bookmarklet
- ChatGPT conversation exporter with bookmarklet build
