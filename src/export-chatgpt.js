// ── ChatGPT Conversation Exporter ────────────────────────────────────
// Paste this into your browser console while on chatgpt.com
// It will export all conversations as JSON + Markdown + HTML in a ZIP file.
// ─────────────────────────────────────────────────────────────────────

(async () => {
  const VERSION = "v1.0.0";
  const API = "/backend-api";
  const PAGE_SIZE = 100;
  const DELAY = 1200; // base ms between requests, account-wide — human-ish pace; the site shares this quota
  const CONCURRENCY = 4; // parallel conversation downloads; 429s are retried with backoff
  const DEVICE_ID = crypto.randomUUID();

  const HEADERS = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Oai-Device-Id": DEVICE_ID,
    "Oai-Language": "en-US",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Shared progress state for the ETA clock and partial-save button
  const stats = { done: 0, total: 0, startedAt: 0, entries: null };
  let requestRestart = null; // set once the download pass starts

  // ── UI overlay ──────────────────────────────────────────────────────

  document.getElementById("chatgpt-exporter-overlay")?.remove(); // stale overlay from a previous run
  const overlay = document.createElement("div");
  overlay.id = "chatgpt-exporter-overlay";
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;
      display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
      <div style="background:#1e293b;border-radius:16px;padding:40px;max-width:500px;width:90%;color:#e2e8f0;box-shadow:0 25px 50px rgba(0,0,0,0.4)">
        <h2 style="margin:0 0 8px;font-size:20px;color:#f8fafc">ChatGPT Exporter <span id="cge-version" style="font-size:12px;color:#64748b;font-weight:normal"></span></h2>
        <p id="cge-status" style="color:#94a3b8;font-size:14px;margin:0 0 20px">Starting...</p>
        <div style="width:100%;height:8px;background:#334155;border-radius:4px;overflow:hidden;margin-bottom:8px">
          <div id="cge-bar" style="height:100%;background:#3b82f6;border-radius:4px;transition:width 0.3s;width:0%"></div>
        </div>
        <p id="cge-detail" style="color:#64748b;font-size:13px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></p>
      </div>
    </div>
    <div id="cge-taskbar" style="position:fixed;left:0;right:0;bottom:0;z-index:100000;background:#0f172a;border-top:1px solid #334155;
      font-family:ui-monospace,Menlo,monospace;box-shadow:0 -10px 30px rgba(0,0,0,0.5)">
      <pre id="cge-log" style="display:none;margin:0;height:150px;overflow-y:auto;background:#020617;border-bottom:1px solid #1e293b;padding:8px 16px;font-size:11px;line-height:1.5;color:#94a3b8;white-space:pre-wrap;word-break:break-all"></pre>
      <div id="cge-chips" style="display:flex;gap:8px;align-items:center;padding:8px 16px;overflow-x:auto"></div>
    </div>
    <div id="cge-eta" style="position:fixed;top:12px;right:12px;z-index:100000;background:#0f172a;border:1px solid #334155;border-radius:8px;
      padding:8px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#cbd5e1;text-align:right;box-shadow:0 4px 16px rgba(0,0,0,0.4)">ETA —</div>
    <div style="position:fixed;top:12px;left:12px;z-index:100000;display:flex;gap:8px">
      <button id="cge-partial" style="background:#1e293b;border:1px solid #334155;border-radius:8px;
        padding:8px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#cbd5e1;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.4)">⬇ save partial (0)</button>
      <button id="cge-clearcache" style="background:#1e293b;border:1px solid #7f1d1d;border-radius:8px;
        padding:8px 14px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#fca5a5;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.4)">✕ clear cache</button>
    </div>`;
  document.body.appendChild(overlay);

  const ui = {
    status: overlay.querySelector("#cge-status"),
    bar: overlay.querySelector("#cge-bar"),
    detail: overlay.querySelector("#cge-detail"),
    chipsEl: overlay.querySelector("#cge-chips"),
    logEl: overlay.querySelector("#cge-log"),
    chips: {}, // key -> {el, dot, label, buffer}
    activeLogKey: null,
    set(status, pct, detail) {
      if (status) this.status.textContent = status;
      if (pct != null) this.bar.style.width = pct + "%";
      if (detail) this.detail.textContent = detail;
    },
    // Taskbar chip: colored dot + label. Click toggles that chip's log view —
    // except the throttle chip, which is a pure status display pinned right.
    chip(key, name) {
      if (this.chips[key]) return this.chips[key];
      const el = document.createElement("div");
      el.style.cssText = "display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;background:#1e293b;border:1px solid #334155;font-size:12px;color:#cbd5e1;cursor:pointer;white-space:nowrap;flex-shrink:0;max-width:280px;user-select:none";
      const dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#64748b;flex-shrink:0";
      const label = document.createElement("span");
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis";
      label.textContent = name;
      el.append(dot, label);
      if (key === "throttle") {
        // status pill, not a session chip: always rightmost, visually distinct
        el.style.order = "99";
        el.style.marginLeft = "auto";
        el.style.cursor = "default";
        el.style.background = "transparent";
        el.style.border = "1px solid #475569";
        el.style.color = "#e2e8f0";
        el.style.fontWeight = "600";
      } else {
        el.style.order = key === "global" ? "0" : "1"; // LOG first, workers after
        el.addEventListener("click", () => this.showLog(key));
      }
      this.chipsEl.appendChild(el);
      const chip = { el, dot, label, buffer: "" };
      this.chips[key] = chip;
      return chip;
    },
    // color: green=working, yellow=waiting/throttled, red=paused/error, gray=idle
    setChip(key, name, text, color) {
      const c = this.chip(key, name);
      c.label.textContent = text;
      c.dot.style.background = { green: "#22c55e", yellow: "#eab308", red: "#ef4444", gray: "#64748b" }[color] || "#64748b";
    },
    showLog(key) {
      if (this.activeLogKey === key && this.logEl.style.display !== "none") {
        this.logEl.style.display = "none";
        this.chips[key].el.style.background = "#1e293b";
        this.activeLogKey = null;
        return;
      }
      for (const [k, c] of Object.entries(this.chips)) if (k !== "throttle") c.el.style.background = "#1e293b";
      this.activeLogKey = key;
      this.chips[key].el.style.background = "#334155";
      this.logEl.style.display = "block";
      this.logEl.textContent = this.chips[key].buffer || "(no output yet)";
      this.logEl.scrollTop = this.logEl.scrollHeight;
    },
    logTo(key, name, msg) {
      const c = this.chip(key, name);
      const time = new Date().toTimeString().slice(0, 8);
      c.buffer += `[${time}] ${msg}\n`;
      // Cap the buffer — re-rendering an ever-growing <pre> janks the page on long runs
      if (c.buffer.length > 200000) c.buffer = c.buffer.slice(-100000);
      if (this.activeLogKey === key) {
        this.logEl.textContent = c.buffer;
        this.logEl.scrollTop = this.logEl.scrollHeight;
      }
    },
    worker(id, text, color) {
      this.setChip(`w${id}`, `W${id + 1}`, `W${id + 1} ${text}`, color || "green");
    },
    workerLog(id, msg) {
      this.logTo(`w${id}`, `W${id + 1}`, msg);
      this.logTo("global", "LOG", `[W${id + 1}] ${msg}`);
    },
    log(msg) {
      this.logTo("global", "LOG", msg);
    },
    done(msg) {
      this.status.textContent = msg;
      this.bar.style.width = "100%";
      this.bar.style.background = "#22c55e";
      this.detail.textContent = "You can close this overlay by clicking anywhere.";
      overlay.querySelector("div").style.cursor = "pointer";
      overlay.addEventListener("click", () => overlay.remove());
    },
    error(msg) {
      this.status.textContent = msg;
      this.bar.style.background = "#ef4444";
      this.detail.textContent = "Click anywhere to close.";
      overlay.addEventListener("click", () => overlay.remove());
    },
  };
  // fixed chip order: global log first; throttle chip is created last so its
  // margin-left:auto pins it to the far right of the bar.
  ui.setChip("global", "LOG", "LOG", "gray");
  overlay.querySelector("#cge-version").textContent = VERSION;
  ui.log(`Exporter ${VERSION} started`);

  // ── Console resize handle ───────────────────────────────────────────
  // Drag the top edge of the log panel; capped at the popup's lower edge.
  {
    const logEl = ui.logEl;
    const grip = document.createElement("div");
    grip.style.cssText = "height:6px;cursor:ns-resize;background:#1e293b;border-bottom:1px solid #334155";
    logEl.parentElement.insertBefore(grip, logEl);
    let drag = null;
    grip.addEventListener("mousedown", (e) => {
      drag = { y: e.clientY, h: logEl.offsetHeight };
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const popupBottom = overlay.querySelector("#cge-status").closest("div").getBoundingClientRect().bottom;
      const maxH = window.innerHeight - popupBottom - 60; // stop at popup's lower edge
      logEl.style.height = Math.max(60, Math.min(drag.h + (drag.y - e.clientY), maxH)) + "px";
    });
    document.addEventListener("mouseup", () => (drag = null));
  }

  // ── Get token ───────────────────────────────────────────────────────

  ui.set("Getting session token...");
  let token;
  try {
    const session = await fetch("/api/auth/session").then((r) => r.json());
    token = session.accessToken;
    if (!token) throw new Error("No accessToken in session");
  } catch (e) {
    ui.error("Failed to get session token. Are you logged in?");
    return;
  }

  // ── API helper ──────────────────────────────────────────────────────

  // Shared adaptive throttle (AIMD): every 429 raises the global delay between
  // requests, every success decays it back down. State lives in localStorage so
  // ALL tabs running the exporter share ONE pause window and ONE request pacer —
  // the server rate-limits per account, not per tab.
  const LS_PAUSE = "cge:pausedUntil", LS_DELAY = "cge:delayMs", LS_SLOT = "cge:nextSlot";
  const LS_429S = "cge:429s", LS_OK = "cge:okSinceLimit";
  const lsNum = (k) => Number(localStorage.getItem(k)) || 0;
  const getDelay = () => Math.max(DELAY, lsNum(LS_DELAY) || DELAY);
  const setDelay = (v) => localStorage.setItem(LS_DELAY, Math.round(v));
  const getPause = () => lsNum(LS_PAUSE);

  // The server limit is a sliding-window quota (a burst spends the budget and
  // is paid off for minutes), so 429 events within the window count as strikes
  // and stretch the pause — the quota needs refill time, not just a delay.
  function recordStrike() {
    const now = Date.now();
    const arr = JSON.parse(localStorage.getItem(LS_429S) || "[]").filter((t) => now - t < 300000);
    arr.push(now);
    localStorage.setItem(LS_429S, JSON.stringify(arr));
    return arr.length; // strikes in the last 5 min
  }

  // Live throttle ticker: pinned to the far right of the taskbar, pure status
  // (no click console). Counts down pause seconds; reflects other tabs' state too.
  setInterval(() => {
    const pauseLeft = getPause() - Date.now();
    if (pauseLeft > 0) {
      ui.setChip("throttle", "throttle", `PAUSED ${Math.ceil(pauseLeft / 1000)}s — ${Math.round(getDelay())}ms/req`, "red");
    } else {
      const d = getDelay();
      ui.setChip("throttle", "throttle", `${Math.round(d)}ms/req`, d > DELAY * 4 ? "yellow" : "green");
    }
  }, 250);

  // ETA clock (top right): based on observed throughput so far, which already
  // includes every pause and throttle we actually hit — no rate model needed.
  const etaEl = overlay.querySelector("#cge-eta");
  setInterval(() => {
    if (!stats.total || !stats.done || !stats.startedAt) return;
    const elapsed = Date.now() - stats.startedAt;
    const remaining = (elapsed / stats.done) * (stats.total - stats.done);
    const fmt = (ms) => {
      const m = Math.round(ms / 60000);
      return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    };
    const doneAt = new Date(Date.now() + remaining);
    etaEl.textContent = `${stats.done}/${stats.total} — ~${fmt(remaining)} left (ETA ${doneAt.toTimeString().slice(0, 5)})`;
  }, 1000);

  // Partial save (top left): zips whatever is downloaded so far, any time.
  const partialBtn = overlay.querySelector("#cge-partial");
  setInterval(() => {
    if (stats.entries) partialBtn.textContent = `⬇ save partial (${stats.done})`;
  }, 1000);
  partialBtn.addEventListener("click", () => {
    if (!stats.entries?.length) return;
    ui.log(`Partial save: zipping ${stats.entries.length} entries (${stats.done} conversations)`);
    const blob = buildZipBlob(stats.entries);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chatgpt-export-partial-${stats.done}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  });


  // Cross-tab pacer: reserve the next request slot in localStorage. Two tabs
  // can rarely race for the same slot; worst case is one extra request, which
  // the backoff absorbs. ponytail: a lock-free reservation, real locking needs a SharedWorker.
  async function throttle() {
    while (true) {
      const pauseWait = getPause() - Date.now();
      if (pauseWait > 0) { await sleep(Math.min(pauseWait, 5000) + Math.random() * 1000); continue; }
      const now = Date.now();
      const slot = Math.max(now, lsNum(LS_SLOT));
      // ±25% jitter: evenly-metronomed requests are bot-obvious and can align
      // with the window edge; humans are bursty-irregular.
      localStorage.setItem(LS_SLOT, slot + getDelay() * (0.75 + Math.random() * 0.5));
      if (slot > now) await sleep(slot - now);
      if (Date.now() < getPause()) continue; // a pause started while we waited
      return;
    }
  }
  async function fetchWithRetry(url, options = {}) {
    // Retries 429/5xx forever — the export never gives up on rate limits, it
    // just keeps stretching the pause (10s steps, capped at 5 min).
    for (let i = 0; ; i++) {
      await throttle();
      const resp = await fetch(url, options);
      if (resp.ok) {
        // Hover at the discovered equilibrium: tiny decay (2%), and only after
        // a clean streak — an aggressive decay re-pokes the limit every few
        // requests and turns the run into a 429 sawtooth.
        const okStreak = lsNum(LS_OK) + 1;
        localStorage.setItem(LS_OK, okStreak);
        if (okStreak >= 10) setDelay(Math.max(DELAY, getDelay() * 0.98));
        return resp;
      }
      if (resp.status === 429 || resp.status >= 500) {
        // Every in-flight request (across all tabs) sees the same rate-limit
        // event; only the first escalates, the rest just honor the pause.
        if (Date.now() >= getPause()) {
          localStorage.setItem(LS_OK, 0);
          const strikes = recordStrike();
          // Multiplicative climb: additive steps need many strike-pause cycles
          // to reach a low tolerated rate; ×1.5 discovers it in 2-3 strikes.
          const d = Math.min(Math.max(getDelay() * 1.5, getDelay() + 2000), 60000);
          setDelay(d);
          const retryAfterRaw = resp.headers.get("Retry-After");
          const retryAfter = parseInt(retryAfterRaw) * 1000;
          // Repeated strikes inside the window mean the quota is drained —
          // wait longer for refill instead of nibbling at it every 30s.
          const backoff = Math.min(retryAfter || 30000 * strikes, 300000);
          const body = await resp.text().catch(() => "");
          ui.log(`HTTP ${resp.status} details — Retry-After: ${retryAfterRaw ?? "(none)"}, body: ${body.slice(0, 200) || "(empty)"}`);
          localStorage.setItem(LS_PAUSE, Date.now() + backoff);
          ui.set(null, null, `Rate limited (HTTP ${resp.status}), pausing ${Math.round(backoff / 1000)}s...`);
          ui.log(`HTTP ${resp.status} — strike ${strikes} in 5min window, pause ${Math.round(backoff / 1000)}s (all tabs), delay now ${Math.round(d)}ms`);
        }
        continue;
      }
      // 4xx like 412/404: permanent for this URL, retrying won't help
      throw new Error(`HTTP ${resp.status}`);
    }
  }

  async function apiGet(path) {
    const resp = await fetchWithRetry(`${API}/${path}`, {
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    });
    return resp.json();
  }

  // ── IndexedDB cache ─────────────────────────────────────────────────
  // Conversations AND downloaded files persist across runs/reloads, so a
  // restart spends zero rate-limit quota on anything already fetched.
  const idb = await new Promise((resolve) => {
    const req = indexedDB.open("chatgpt-exporter-cache", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("convos");
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { ui.log("IndexedDB unavailable — running without cache"); resolve(null); };
  });
  const cacheGet = (store, key) => new Promise((resolve) => {
    if (!idb) return resolve(undefined);
    const req = idb.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  const cachePut = (store, key, value) => new Promise((resolve) => {
    if (!idb) return resolve();
    const tx = idb.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = tx.onerror = () => resolve();
  });
  let cacheHits = 0, fileCacheHits = 0;

  // Clear cache: confirmed, wipes IndexedDB, then restarts the download from #1.
  overlay.querySelector("#cge-clearcache").addEventListener("click", async () => {
    if (!confirm("Clear the exporter cache and re-download everything from scratch?")) return;
    if (!idb) return ui.log("No cache to clear (IndexedDB unavailable)");
    await Promise.all(["convos", "files"].map((s) => new Promise((resolve) => {
      const tx = idb.transaction(s, "readwrite");
      tx.objectStore(s).clear();
      tx.oncomplete = tx.onerror = () => resolve();
    })));
    cacheHits = 0; fileCacheHits = 0;
    ui.log("Cache cleared — restarting download from #1 in 3s...");
    await sleep(3000);
    if (requestRestart) requestRestart();
    else ui.log("Download not started yet — nothing to restart, fresh fetch will happen naturally");
  });

  // Cached conversation fetch: reuse when the conversation hasn't been
  // updated since we cached it (update_time from the list endpoint).
  async function getConversation(cid, listUpdateTime) {
    const cached = await cacheGet("convos", cid);
    if (cached && (!listUpdateTime || cached.cachedUpdateTime >= listUpdateTime)) {
      cacheHits++;
      return cached.convo;
    }
    const convo = await apiGet(`conversation/${cid}`);
    await cachePut("convos", cid, { convo, cachedUpdateTime: listUpdateTime || 0 });
    return convo;
  }

  async function apiFetchBinary(url) {
    const resp = await fetchWithRetry(url);
    const data = new Uint8Array(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "";
    return { data, contentType };
  }

  const MIME_TO_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
    "image/webp": ".webp", "image/svg+xml": ".svg", "application/pdf": ".pdf",
    "text/plain": ".txt", "text/html": ".html", "text/csv": ".csv",
    "application/json": ".json", "application/zip": ".zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };

  // ── File references ─────────────────────────────────────────────────

  function extractFileReferences(convo) {
    const refs = [];
    const seen = new Set();
    const mapping = convo.mapping || {};

    for (const node of Object.values(mapping)) {
      const msg = node.message;
      if (!msg) continue;

      if (msg.content?.parts) {
        for (const part of msg.content.parts) {
          if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
            const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
            if (match && !seen.has(match[1])) {
              seen.add(match[1]);
              refs.push({
                fileId: match[1],
                filename: part.metadata?.dalle?.prompt ? "dalle_image.png" : "image.png",
                type: "image",
              });
            }
          }
        }
      }

      if (msg.metadata?.attachments) {
        for (const att of msg.metadata.attachments) {
          if (att.id && !seen.has(att.id)) {
            seen.add(att.id);
            refs.push({ fileId: att.id, filename: att.name || "attachment", type: "attachment" });
          }
        }
      }

      if (msg.metadata?.citations) {
        for (const cit of msg.metadata.citations) {
          const fileId = cit.metadata?.file_id || cit.file_id;
          const title = cit.metadata?.title || cit.title || "citation";
          if (fileId && !seen.has(fileId)) {
            seen.add(fileId);
            refs.push({ fileId, filename: title, type: "citation" });
          }
        }
      }
    }
    return refs;
  }

  async function downloadFile(fileId, fallbackName) {
    // Files are immutable per fileId — cache hit needs no freshness check.
    const cached = await cacheGet("files", fileId);
    if (cached) { fileCacheHits++; return cached; }
    const meta = await apiGet(`files/download/${fileId}`);
    if (!meta.download_url) throw new Error("No download_url");
    const { data, contentType } = await apiFetchBinary(meta.download_url);
    let filename = meta.file_name || fallbackName || fileId;
    // Add extension from content-type if missing
    if (!filename.includes(".") && contentType) {
      const mime = contentType.split(";")[0].trim();
      const ext = MIME_TO_EXT[mime];
      if (ext) filename += ext;
    }
    const result = { filename, data };
    await cachePut("files", fileId, result);
    return result;
  }

  function deduplicateFilename(name, usedNames) {
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 1;
    while (usedNames.has(`${base}_${i}${ext}`)) i++;
    const deduped = `${base}_${i}${ext}`;
    usedNames.add(deduped);
    return deduped;
  }

  function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80) || "untitled";
  }

  function stripCitations(str) {
    return str.replace(/\u3010[^\u3011]*\u3011/g, "");
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Fetch conversation list ─────────────────────────────────────────

  ui.set("Fetching conversation list...");
  let conversations = [];
  const seenIds = new Set();
  try {
    // The list endpoint excludes archived chats by default; fetch both.
    for (const archived of [false, true]) {
      let offset = 0;
      while (true) {
        const data = await apiGet(`conversations?offset=${offset}&limit=${PAGE_SIZE}&is_archived=${archived}`);
        const items = data.items || [];
        if (!items.length) break;
        for (const it of items) {
          if (!seenIds.has(it.id)) { seenIds.add(it.id); conversations.push(it); }
        }
        const total = data.total || 0;
        ui.set(`Fetching ${archived ? "archived" : "active"} list... ${conversations.length} total`);
        offset += PAGE_SIZE;
        if (offset >= total) break;
      }
      ui.log(`${archived ? "Archived" : "Active"} list done: ${conversations.length} conversations so far`);
    }
  } catch (e) {
    ui.error(`Failed to fetch conversations: ${e.message}`);
    return;
  }

  if (!conversations.length) {
    ui.done("No conversations found.");
    return;
  }

  ui.set(`Found ${conversations.length} conversations. Downloading...`);

  // ── Pass 1: Download conversations + files ──────────────────────────

  const zipEntries = [];
  let failed = 0;
  let totalFiles = 0;
  let failedFiles = 0;
  let done = 0;
  const total = conversations.length;
  const downloaded = new Array(total); // { fname, title, convo, fileMap }, in list order
  stats.total = total;
  stats.startedAt = Date.now();
  stats.entries = zipEntries; // live reference — partial save zips whatever is here

  async function processConversation(i, workerId) {
    const { id: cid, title: rawTitle, update_time: updateTime } = conversations[i];
    const title = rawTitle || "Untitled";
    const fname = `${sanitize(title)}_${cid.slice(0, 8)}`;
    ui.worker(workerId, `#${i + 1} ${title.slice(0, 30)}`, "green");
    ui.workerLog(workerId, `start #${i + 1} "${title.slice(0, 60)}"`);

    try {
      const convo = await getConversation(cid, updateTime ? Date.parse(updateTime) || Number(updateTime) : 0);
      const jsonStr = JSON.stringify(convo, null, 2);

      // Extract and download file references
      const fileRefs = extractFileReferences(convo);
      const fileMap = {};
      const usedNames = new Set();

      for (const ref of fileRefs) {
        totalFiles++;
        try {
          const { filename: dlName, data } = await downloadFile(ref.fileId, ref.filename);
          const actualName = deduplicateFilename(dlName || ref.filename, usedNames);
          zipEntries.push({ path: `files/${fname}/${actualName}`, data });
          fileMap[ref.fileId] = `../files/${fname}/${actualName}`; // pacing handled by throttle()
        } catch (e) {
          failedFiles++;
          ui.workerLog(workerId, `file ${ref.fileId} failed (${e.message}) in "${title.slice(0, 40)}"`);
        }
      }

      const mdStr = toMarkdown(convo, fileMap);
      zipEntries.push({ path: `json/${fname}.json`, data: jsonStr });
      zipEntries.push({ path: `markdown/${fname}.md`, data: mdStr });

      downloaded[i] = { fname, title, convo, fileMap };
      ui.workerLog(workerId, `done #${i + 1}${fileRefs.length ? ` (${fileRefs.length} files)` : ""}`);
    } catch (e) {
      failed++;
      ui.worker(workerId, `#${i + 1} FAILED`, "red");
      ui.workerLog(workerId, `FAILED #${i + 1} "${title.slice(0, 40)}": ${e.message}`);
    }

    done++;
    stats.done = done;
    const pct = Math.round((done / total) * 100);
    ui.set(`Downloading ${done} of ${total} (${pct}%)`, pct, title);
  }

  // Worker pool: CONCURRENCY conversations in flight at once. A cache-clear
  // resets `next` to 0 — in-flight items finish, then workers sweep from #1
  // (already-done indices refill zipEntries/downloaded from the fresh fetch).
  let next = 0;
  requestRestart = () => {
    next = 0;
    done = 0;
    failed = 0;
    zipEntries.length = 0;
    downloaded.fill(undefined);
    stats.done = 0;
    stats.startedAt = Date.now();
    ui.log("Restarting download pass from #1 (cache is empty, full re-fetch)");
  };
  ui.log(`Starting ${Math.min(CONCURRENCY, total)} workers for ${total} conversations`);
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, total) }, async (_, w) => {
      while (next < total) await processConversation(next++, w);
      ui.worker(w, "idle", "gray");
    })
  );
  requestRestart = null; // pool has drained; too late to restart
  ui.log(`Download pass done: ${total - failed} ok, ${failed} failed`);

  // ── Pass 2: Generate HTML with sidebar ──────────────────────────────

  ui.set("Generating HTML pages...", 100);
  const succeededConvos = downloaded.filter(Boolean);
  const allConvos = succeededConvos.map((d) => ({ fname: d.fname, title: d.title }));

  for (const d of succeededConvos) {
    const htmlStr = toHtml(d.convo, d.fileMap, allConvos, d.fname);
    zipEntries.push({ path: `html/${d.fname}.html`, data: htmlStr });
  }

  // ── Checksum manifest ───────────────────────────────────────────────
  // WebCrypto has no MD5; SHA-256 manifest lets you `shasum -a 256 -c` after extraction.

  ui.set("Computing checksums...", 100);
  const enc = new TextEncoder();
  const manifestLines = [];
  for (const e of zipEntries) {
    const bytes = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    manifestLines.push(`${hex}  ${e.path}`);
  }
  zipEntries.push({ path: "checksums-sha256.txt", data: manifestLines.join("\n") + "\n" });

  // ── Build ZIP, verify integrity, download ───────────────────────────

  ui.set("Creating ZIP archive...", 100);

  let zipBlob;
  for (let attempt = 1; ; attempt++) {
    zipBlob = buildZipBlob(zipEntries);
    ui.set("Verifying archive integrity...", 100);
    if (await verifyZip(zipBlob, zipEntries.length)) break;
    if (attempt >= 3) {
      ui.error("Archive verification failed after 3 attempts. Aborting download.");
      return;
    }
    ui.set(`Archive verification failed, rebuilding (attempt ${attempt + 1})...`, 100);
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = "chatgpt-export.zip";
  a.click();
  URL.revokeObjectURL(a.href);

  const succeeded = total - failed;
  let doneMsg = `Done! Exported ${succeeded}/${total} conversations.`;
  if (failed) doneMsg += ` (${failed} failed)`;
  if (totalFiles) doneMsg += ` ${totalFiles - failedFiles}/${totalFiles} files downloaded.`;
  if (cacheHits || fileCacheHits) doneMsg += ` (${cacheHits} conversations + ${fileCacheHits} files from cache)`;
  ui.done(doneMsg);

  // ── Markdown converter ──────────────────────────────────────────────

  function toMarkdown(convo, fileMap = {}) {
    const title = convo.title || "Untitled";
    const ct = convo.create_time;
    let dateStr = "";
    if (ct) dateStr = new Date(ct * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

    const lines = [`# ${title}`, ""];
    if (dateStr) lines.push(`*${dateStr}*\n`);

    const mapping = convo.mapping || {};
    const rootId = Object.keys(mapping).find((k) => mapping[k].parent == null);

    if (rootId) {
      const queue = [rootId];
      while (queue.length) {
        const nid = queue.shift();
        const node = mapping[nid] || {};
        const msg = node.message;
        if (msg?.content?.parts) {
          const role = msg.author?.role || "unknown";
          // Skip system, tool, and non-text assistant messages from markdown
          if (role === "system" || role === "tool") { queue.push(...(node.children || [])); continue; }
          const contentType = msg.content?.content_type || "text";
          if (role === "assistant" && contentType !== "text") { queue.push(...(node.children || [])); continue; }
          const textParts = [];

          for (const part of msg.content.parts) {
            if (typeof part === "string") {
              textParts.push(part);
            } else if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
              const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
              if (match && fileMap[match[1]]) {
                textParts.push(`![image](${fileMap[match[1]]})`);
              } else {
                textParts.push("[image]");
              }
            } else {
              textParts.push(JSON.stringify(part));
            }
          }

          if (msg.metadata?.attachments) {
            for (const att of msg.metadata.attachments) {
              if (att.id && fileMap[att.id]) {
                textParts.push(`\n📎 [${att.name || "attachment"}](${fileMap[att.id]})`);
              }
            }
          }

          const text = stripCitations(textParts.join("\n")).trim();
          if (text) {
            lines.push(`## ${role.charAt(0).toUpperCase() + role.slice(1)}\n\n${text}\n`);
          }
        }
        queue.push(...(node.children || []));
      }
    }

    return lines.join("\n");
  }

  // ── HTML converter ──────────────────────────────────────────────────

  function toHtml(convo, fileMap = {}, allConversations = [], currentFname = "") {
    const title = escapeHtml(convo.title || "Untitled");
    const ct = convo.create_time;
    let dateStr = "";
    if (ct) dateStr = new Date(ct * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

    const messages = [];
    const mapping = convo.mapping || {};
    const rootId = Object.keys(mapping).find((k) => mapping[k].parent == null);

    if (rootId) {
      const queue = [rootId];
      while (queue.length) {
        const nid = queue.shift();
        const node = mapping[nid] || {};
        const msg = node.message;
        if (msg?.content?.parts) {
          const role = msg.author?.role || "unknown";
          const contentType = msg.content?.content_type || "text";
          if (role === "system") { queue.push(...(node.children || [])); continue; }

          const isInternal = role === "tool" ||
            (role === "assistant" && contentType !== "text") ||
            (role === "user" && contentType === "user_editable_context");

          const textParts = [];
          const imageParts = [];

          for (const part of msg.content.parts) {
            if (typeof part === "string") {
              textParts.push(part);
            } else if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
              const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
              if (match && fileMap[match[1]]) imageParts.push(fileMap[match[1]]);
            }
          }

          const attachments = [];
          if (msg.metadata?.attachments) {
            for (const att of msg.metadata.attachments) {
              if (att.id && fileMap[att.id]) {
                attachments.push({ name: att.name || "attachment", path: fileMap[att.id] });
              }
            }
          }

          const text = stripCitations(textParts.join("\n")).trim();
          if (text || imageParts.length || attachments.length) {
            messages.push({ role, text, images: imageParts, attachments, isInternal, contentType });
          }
        }
        queue.push(...(node.children || []));
      }
    }

    const LOGO = '<svg viewBox="0 0 41 41" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835A9.964 9.964 0 0 0 18.306.5a10.079 10.079 0 0 0-9.614 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 7.516 3.35 10.078 10.078 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813ZM22.498 37.886a7.474 7.474 0 0 1-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 0 0 .655-1.134V19.054l3.366 1.944a.12.12 0 0 1 .066.092v9.299a7.505 7.505 0 0 1-7.49 7.496ZM6.392 31.006a7.471 7.471 0 0 1-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 0 0 1.308 0l9.724-5.614v3.888a.12.12 0 0 1-.048.103l-8.051 4.649a7.504 7.504 0 0 1-10.24-2.744ZM4.297 13.62A7.469 7.469 0 0 1 8.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 0 0 .654 1.132l9.723 5.614-3.366 1.944a.12.12 0 0 1-.114.012L7.044 23.86a7.504 7.504 0 0 1-2.747-10.24Zm27.658 6.437-9.724-5.615 3.367-1.943a.121.121 0 0 1 .114-.012l8.048 4.648a7.498 7.498 0 0 1-1.158 13.528V21.36a1.293 1.293 0 0 0-.647-1.132v-.17Zm3.35-5.043c-.059-.037-.162-.099-.236-.141l-7.965-4.6a1.298 1.298 0 0 0-1.308 0l-9.723 5.614v-3.888a.12.12 0 0 1 .048-.103l8.05-4.645a7.497 7.497 0 0 1 11.135 7.763Zm-21.063 6.929-3.367-1.944a.12.12 0 0 1-.065-.092v-9.299a7.497 7.497 0 0 1 12.293-5.756 6.94 6.94 0 0 0-.236.134l-7.965 4.6a1.294 1.294 0 0 0-.654 1.132l-.006 11.225Zm1.829-3.943 4.33-2.501 4.332 2.5v5l-4.331 2.5-4.331-2.5V18Z" fill="currentColor"/></svg>';

    const INTERNAL_LABELS = {
      multimodal_text: "File context", code: "Code", execution_output: "Output",
      computer_output: "Output", tether_browsing_display: "Web browsing",
      system_error: "Error", text: "Tool output",
    };

    const messagesHtml = messages.map((m) => {
      if (m.isInternal) {
        const label = INTERNAL_LABELS[m.contentType] || "Internal context";
        const b64 = btoa(unescape(encodeURIComponent(m.text)));
        return `<details class="thinking"><summary>${label}</summary><div class="thinking-content md-content" dir="auto" data-md="${b64}"></div></details>`;
      }

      const roleClass = m.role === "user" ? "user" : "assistant";
      let content = "";

      if (m.role === "user") {
        content = `<div class="bubble" dir="auto">${escapeHtml(m.text).replace(/\n/g, "<br>")}</div>`;
      } else {
        const b64 = btoa(unescape(encodeURIComponent(m.text)));
        content = `<div class="avatar">${LOGO}</div><div class="content"><div class="md-content" dir="auto" data-md="${b64}"></div></div>`;
      }

      if (m.images.length) {
        content += `<div class="images">${m.images.map((s) => `<a href="${escapeHtml(s)}" target="_blank"><img src="${escapeHtml(s)}" alt="image" loading="lazy"></a>`).join("")}</div>`;
      }
      if (m.attachments.length) {
        content += `<div class="attachments">${m.attachments.map((a) => `<a class="attachment" href="${escapeHtml(a.path)}" target="_blank"><span class="att-icon">📎</span><span class="att-name">${escapeHtml(a.name)}</span></a>`).join("")}</div>`;
      }

      return `<div class="message ${roleClass}">${content}</div>`;
    }).join("\n");

    const sidebarItems = allConversations.map((c) => {
      const cls = c.fname === currentFname ? "sidebar-item active" : "sidebar-item";
      return `<a class="${cls}" href="${c.fname}.html" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</a>`;
    }).join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release/build/styles/github-dark.min.css">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: #ffffff; color: #0d0d0d;
    line-height: 1.65; font-size: 16px;
    display: flex; height: 100vh;
  }
  .sidebar {
    width: 260px; min-width: 260px; height: 100vh;
    background: #f9f9f9; border-right: 1px solid #e5e5e5;
    overflow-y: auto; padding: 16px 0;
    flex-shrink: 0; position: sticky; top: 0;
  }
  .sidebar-header {
    padding: 8px 16px 16px; font-size: 14px; font-weight: 600;
    color: #6b6b6b; border-bottom: 1px solid #e5e5e5; margin-bottom: 8px;
  }
  .sidebar-item {
    display: block; padding: 8px 16px; font-size: 13px;
    color: #0d0d0d; text-decoration: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    border-radius: 8px; margin: 2px 8px;
  }
  .sidebar-item:hover { background: #ececec; }
  .sidebar-item.active { background: #e5e5e5; font-weight: 600; }
  .sidebar-toggle {
    display: none; position: fixed; top: 12px; left: 12px; z-index: 100;
    background: #f4f4f4; border: 1px solid #e5e5e5; border-radius: 8px;
    width: 36px; height: 36px; cursor: pointer;
    align-items: center; justify-content: center; font-size: 20px;
  }
  @media (max-width: 768px) {
    .sidebar {
      position: fixed; left: -280px; z-index: 99;
      transition: left 0.2s; box-shadow: 2px 0 8px rgba(0,0,0,0.1);
    }
    .sidebar.open { left: 0; }
    .sidebar-toggle { display: flex; }
    .main { margin-left: 0 !important; }
  }
  .main { flex: 1; overflow-y: auto; }
  .header {
    max-width: 768px; margin: 0 auto; padding: 32px 24px 16px;
    border-bottom: 1px solid #e5e5e5;
  }
  .header h1 { font-size: 22px; font-weight: 600; }
  .header .date { font-size: 13px; color: #6b6b6b; margin-top: 4px; }
  .chat { max-width: 768px; margin: 0 auto; padding: 24px; }
  .message { margin-bottom: 24px; }
  .message.user { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .message.user .bubble {
    background: #f4f4f4; border-radius: 18px; padding: 10px 16px;
    max-width: 85%; white-space: pre-wrap; word-break: break-word;
  }
  .message.user .images { width: 100%; display: flex; justify-content: flex-end; }
  .message.assistant { display: flex; gap: 12px; align-items: flex-start; }
  .message.assistant .avatar {
    width: 28px; height: 28px; border-radius: 50%;
    background: #00a67e; color: #fff;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; margin-top: 2px;
  }
  .message.assistant .content { flex: 1; min-width: 0; }
  .message.assistant .content h1,
  .message.assistant .content h2,
  .message.assistant .content h3 { margin: 16px 0 8px; font-weight: 600; }
  .message.assistant .content h1 { font-size: 20px; }
  .message.assistant .content h2 { font-size: 18px; }
  .message.assistant .content h3 { font-size: 16px; }
  .message.assistant .content p { margin: 8px 0; }
  .message.assistant .content ul,
  .message.assistant .content ol { margin: 8px 0; padding-left: 24px; }
  .message.assistant .content li { margin: 4px 0; }
  .message.assistant .content a { color: #1a7f64; }
  .message.assistant .content code {
    background: #f0f0f0; border-radius: 4px; padding: 2px 5px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 14px;
  }
  .message.assistant .content pre { margin: 12px 0; border-radius: 8px; overflow: hidden; }
  .message.assistant .content pre code {
    display: block; background: #0d0d0d; color: #f8f8f2;
    padding: 16px; overflow-x: auto; border-radius: 0;
    font-size: 13px; line-height: 1.5;
  }
  .code-block { position: relative; }
  .code-block .copy-btn {
    position: absolute; top: 8px; right: 8px;
    background: #333; border: none; color: #999; cursor: pointer;
    font-size: 12px; padding: 4px 10px; border-radius: 4px;
    opacity: 0; transition: opacity 0.2s;
  }
  .code-block:hover .copy-btn { opacity: 1; }
  .code-block .copy-btn:hover { color: #fff; background: #555; }
  .images img { max-width: 100%; border-radius: 8px; margin: 4px 0; display: block; cursor: pointer; }
  .images img:hover { opacity: 0.9; }
  .message.user .images img { max-width: 300px; }
  .attachments { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
  .attachment {
    display: inline-flex; align-items: center; gap: 8px;
    background: #f4f4f4; border: 1px solid #e5e5e5; border-radius: 8px;
    padding: 8px 12px; text-decoration: none; color: #0d0d0d; font-size: 14px;
  }
  .attachment:hover { background: #ececec; }
  .att-icon { font-size: 16px; }
  .att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }

  .thinking {
    margin-bottom: 24px; border-left: 3px solid #d4d4d4;
    padding-left: 16px; font-size: 14px;
  }
  .thinking summary {
    color: #8e8e8e; font-style: italic; cursor: pointer;
    padding: 4px 0; user-select: none;
  }
  .thinking summary:hover { color: #555; }
  .thinking-content {
    color: #6b6b6b; padding: 8px 0; font-style: italic;
  }
  .thinking-content p, .thinking-content li { color: #6b6b6b; }
  .thinking-content pre code { opacity: 0.7; }
  .thinking-content h1, .thinking-content h2, .thinking-content h3 {
    color: #6b6b6b; font-size: 15px;
  }
</style>
</head>
<body>
<button class="sidebar-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">&#9776;</button>
<nav class="sidebar">
  <div class="sidebar-header">Conversations</div>
  ${sidebarItems}
</nav>
<div class="main">
  <div class="header">
    <h1>${title}</h1>
    ${dateStr ? `<div class="date">${dateStr}</div>` : ""}
  </div>
  <div class="chat">
  ${messagesHtml}
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release/build/highlight.min.js"><\/script>
<script>
document.addEventListener('DOMContentLoaded', () => {
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });

  const renderer = new marked.Renderer();
  renderer.code = function({ text, lang }) {
    const highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang }).value
      : hljs.highlightAuto(text).value;
    return '<div class="code-block"><button class="copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.querySelector(\\'code\\').textContent);this.textContent=\\'Copied!\\';setTimeout(()=>this.textContent=\\'Copy\\',1500)">Copy</button>'
      + '<pre><code class="hljs">' + highlighted + '</code></pre></div>';
  };
  marked.use({ renderer });

  document.querySelectorAll('.md-content').forEach(el => {
    const md = decodeURIComponent(escape(atob(el.dataset.md)));
    el.innerHTML = marked.parse(md);
  });

  const active = document.querySelector('.sidebar-item.active');
  if (active) active.scrollIntoView({ block: 'center', behavior: 'instant' });
});
<\/script>
</body>
</html>`;
  }

  // ── Minimal ZIP builder (store, no compression) ─────────────────────

  function buildZipBlob(entries) {
    const te = new TextEncoder();
    const parts = [];
    const cdParts = [];
    let offset = 0;

    for (const entry of entries) {
      const pathBytes = te.encode(entry.path);
      const dataBytes = typeof entry.data === "string" ? te.encode(entry.data) : entry.data;
      const crc = crc32(dataBytes);

      // Local file header (30 bytes)
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(8, 0, true); // store
      lh.setUint32(14, crc, true);
      lh.setUint32(18, dataBytes.length, true);
      lh.setUint32(22, dataBytes.length, true);
      lh.setUint16(26, pathBytes.length, true);

      parts.push(new Uint8Array(lh.buffer), pathBytes, dataBytes);

      // Central directory entry (46 bytes)
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(10, 0, true); // store
      cd.setUint32(16, crc, true);
      cd.setUint32(20, dataBytes.length, true);
      cd.setUint32(24, dataBytes.length, true);
      cd.setUint16(28, pathBytes.length, true);
      cd.setUint32(42, offset, true);

      cdParts.push(new Uint8Array(cd.buffer), pathBytes);

      offset += 30 + pathBytes.length + dataBytes.length;
    }

    const cdSize = cdParts.reduce((s, p) => s + p.length, 0);

    // End of central directory (22 bytes)
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);

    return new Blob([...parts, ...cdParts, new Uint8Array(eocd.buffer)], {
      type: "application/zip",
    });
  }

  // Re-parse the built ZIP and recompute every entry's CRC32 against its header.
  async function verifyZip(blob, expectedEntries) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const view = new DataView(buf.buffer);
      let offset = 0;
      let count = 0;
      while (offset + 30 <= buf.length && view.getUint32(offset, true) === 0x04034b50) {
        const crcExpected = view.getUint32(offset + 14, true);
        const size = view.getUint32(offset + 18, true);
        const nameLen = view.getUint16(offset + 26, true);
        const dataStart = offset + 30 + nameLen;
        if (dataStart + size > buf.length) return false;
        if (crc32(buf.subarray(dataStart, dataStart + size)) !== crcExpected) return false;
        offset = dataStart + size;
        count++;
      }
      return count === expectedEntries;
    } catch {
      return false;
    }
  }

  function crc32(buf) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
})();
