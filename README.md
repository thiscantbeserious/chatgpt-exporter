# ChatGPT Exporter v1.0.1

[![CI](https://github.com/thiscantbeserious/chatgpt-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/thiscantbeserious/chatgpt-exporter/actions/workflows/ci.yml)
[![Co-authored with Claude Fable 5](https://img.shields.io/badge/co--authored%20with-Claude%20Fable%205-c15f3c)](https://www.anthropic.com/news/claude-fable-5-mythos-5)

Export every ChatGPT conversation you have as JSON, Markdown and HTML in a verified ZIP. Runs entirely in your browser as a bookmarklet or console paste. No server, no token copy-paste, no dependencies at runtime. Works with Business/Team/Enterprise accounts including SSO.

The hard part is not the export, it is the undocumented account-wide rate limit that ChatGPT enforces on its backend API. This exporter ships a self-tuning throttle that measures the server's real tolerated rate, stops on the first 429, learns from every stretch between rate limits, and persists everything it downloaded in IndexedDB so a restart never re-spends quota on data you already have.

![ChatGPT Exporter running: progress popup, taskbar with worker chips and log console, live throttle tuner, ETA clock and partial-save buttons](docs/screenshot.png)

## Features

- Parallel workers paced through one shared, account-wide request budget
- Adaptive throttle: learns the refill rate from observed 429s, floors at punished rates, recovers automatically when the penalty lifts
- Cross-tab coordination via localStorage, so several tabs share one pause window and one pacer
- IndexedDB cache for conversations and files: restarts are free, edited chats refresh automatically
- Text first: all conversation JSONs are secured before any file downloads start
- Archived chats included
- Verified ZIP: every entry's CRC32 is re-checked after building, plus a `checksums-sha256.txt` manifest
- Live taskbar: worker chips with per-worker consoles, resizable log, throttle pill with pause countdown, ETA clock, partial save and cache clear buttons
- Live throttle tuner: click the throttle pill to edit delay and minimum pause mid-run and watch the learner's samples

## Usage

### Bookmarklet

Grab `bookmarklet.txt` from the [latest release](https://github.com/thiscantbeserious/chatgpt-exporter/releases), or build it yourself:

```bash
npm install
npm run build
```

Paste the contents of `dist/bookmarklet.txt` into a new bookmark's URL field, then click the bookmark while on [chatgpt.com](https://chatgpt.com). Browsers block `javascript:` URLs in the address bar, so it must be a bookmark click.

`npm run build:debug` produces an unminified bookmarklet for debugging.

### Browser console

Paste the contents of [`src/export-chatgpt.js`](src/export-chatgpt.js) into the console (Cmd+Option+J) while on chatgpt.com.

## Output

```
chatgpt-export.zip
  json/                  Raw API JSON per conversation
  markdown/              Markdown per conversation with file links
  html/                  HTML viewer per conversation with sidebar navigation
  files/                 Images, attachments, code interpreter outputs
  checksums-sha256.txt   SHA-256 of every file in the archive
```

## Development

```bash
npm test          # mock-API harness: parallelism, 429 retries, ZIP integrity, checksums
npm run audit     # dependency vulnerability scan
npm version patch # bump version, sync it into the source, tag; CI releases on push
```

Releases are automated: when the version in `package.json` changes on `main`, CI tags it and publishes a GitHub release with the bookmarklet, the plain script and a ZIP of both.

## Credits

Originally based on [ocombe's exporter gist](https://gist.github.com/ocombe/1d7604bd29a91ceb716304ef8b5aa4b5). Rebuilt and extended in pair-programming sessions with Claude Fable 5.
