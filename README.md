# ChatGPT Exporter

Export **all** your ChatGPT conversations as JSON + Markdown + HTML in a verified ZIP — straight from your browser, no server, no token copy-paste. Works with Business/Team/Enterprise accounts (including SSO/Okta).

Originally forked from [ocombe's exporter gist](https://gist.github.com/ocombe/1d7604bd29a91ceb716304ef8b5aa4b5).

## Features

- **Parallel downloads** — 4 workers, throttled through one shared request pacer
- **Account-wide adaptive rate limiting** — throttle state lives in `localStorage`, so multiple tabs share one pause window; 429s stretch the delay (+2s per event), successes shrink it (−20% each) to recover speed automatically; retries never give up on rate limits
- **Archived chats included** — fetches both the active and archived conversation lists
- **Verified ZIP** — every entry's CRC32 is re-checked after building; the archive ships a `checksums-sha256.txt` manifest (`shasum -a 256 -c` after extraction)
- **Live taskbar** — worker chips with status dots, per-worker consoles, global log, and the current throttle, at the bottom of the screen

## Usage

### Browser console

1. Go to [chatgpt.com](https://chatgpt.com) and log in
2. Open the console (**Cmd+Option+J** on Chrome)
3. Paste the contents of [`src/export-chatgpt.js`](src/export-chatgpt.js) and press Enter

### Bookmarklet

```bash
npm install
npm run build
```

Copy the contents of `dist/bookmarklet.txt` into a new bookmark's URL field, then click the bookmark while on chatgpt.com. (Pasting `javascript:` URLs into the address bar is blocked by browsers — it must be a bookmark click.)

Use `npm run build:debug` to build an unminified bookmarklet for debugging.

## Output

```
chatgpt-export.zip
  json/                  Raw API JSON per conversation
  markdown/              Markdown per conversation (with file links)
  html/                  HTML viewer per conversation (sidebar navigation, highlighted code)
  files/                 Downloaded images, attachments, code-interpreter outputs
  checksums-sha256.txt   SHA-256 of every file in the archive
```

## Development

```bash
npm test
```

The test runs the real script against a mocked ChatGPT API (stubbed DOM, injected 429s) and verifies parallelism, retry behavior, ZIP integrity via `unzip -t`, content correctness, and the checksum manifest.
