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
