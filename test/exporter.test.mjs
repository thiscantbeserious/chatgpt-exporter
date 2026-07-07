// Harness: stub browser globals, mock ChatGPT API, run the exporter, verify the ZIP.
import { readFileSync } from "fs";
import { webcrypto } from "crypto";

const N_CONVOS = 12;
const requestLog = [];
let inFlight = 0, maxInFlight = 0;
let served429 = false;

// ── DOM stubs ─────────────────────────────────────────────────────────
const uiState = { done: null, error: null };
function fakeEl() {
  return {
    style: {}, textContent: "", innerHTML: "",
    querySelector: () => fakeEl(),
    addEventListener: () => {},
    appendChild: () => {},
    append: () => {},
    insertBefore: () => {},
    closest: () => fakeEl(),
    getBoundingClientRect: () => ({ bottom: 0 }),
    get parentElement() { return fakeEl(); },
    offsetHeight: 150,
    click() { this.clicked = true; downloadedZipHref = this.href; },
    set download(v) { zipName = v; },
  };
}
let zipName = null, downloadedZipHref = null, zipBlob = null;
globalThis.document = {
  createElement: (tag) => {
    const el = fakeEl();
    if (tag === "a") {
      el.click = function () { downloadedZipHref = this.href; };
    }
    return el;
  },
  body: { appendChild: () => {} },
  getElementById: () => null,
  addEventListener: () => {},
  activeElement: null,
};
globalThis.window = { innerHeight: 900 };
// in-memory IndexedDB stub: same API shape, backed by Maps
const idbStores = { convos: new Map(), files: new Map(), meta: new Map() };
function idbReq(result) { const r = { result }; setImmediate(() => r.onsuccess?.()); return r; }
globalThis.indexedDB = {
  open: () => {
    const r = {
      result: {
        objectStoreNames: { contains: (s) => s in idbStores },
        createObjectStore: () => {},
        transaction: (store) => ({
          objectStore: (s = store) => ({
            get: (k) => idbReq(idbStores[s].get(k)),
            put: (v, k) => idbStores[s].set(k, v),
            clear: () => idbStores[s].clear(),
          }),
          set oncomplete(f) { setImmediate(f); },
          onerror: null,
        }),
      },
    };
    setImmediate(() => { r.onupgradeneeded?.(); r.onsuccess?.(); });
    return r;
  },
};
globalThis.URL.createObjectURL = (blob) => { zipBlob = blob; return "blob:fake"; };
globalThis.URL.revokeObjectURL = () => {};
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => lsStore.get(k) ?? null,
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");

// ── Mock API ──────────────────────────────────────────────────────────
function convoPayload(i) {
  const uid = `msg-u-${i}`, aid = `msg-a-${i}`;
  return {
    title: i === 3 ? null : `Conversation ${i} <"quoted"/slash>`,
    create_time: 1700000000 + i,
    mapping: {
      root: { parent: null, children: [uid], message: null },
      [uid]: { parent: "root", children: [aid], message: {
        author: { role: "user" }, content: { content_type: "text", parts: [`Question ${i}`] }, metadata: {} } },
      [aid]: { parent: uid, children: [], message: {
        author: { role: "assistant" }, content: { content_type: "text", parts: [`Answer ${i} with **markdown**`] },
        metadata: i === 2 ? { attachments: [{ id: `file-att-${i}`, name: `doc ${i}.pdf` }] } : {} } },
    },
  };
}

globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  requestLog.push(u);
  const json = (obj, status = 200, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => obj,
    text: async () => JSON.stringify(obj ?? ""),
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });

  if (u === "/api/auth/session") return json({ accessToken: "tok" });

  if (u.startsWith("/backend-api/conversations?")) {
    const offset = Number(new URLSearchParams(u.split("?")[1]).get("offset"));
    const items = Array.from({ length: Math.max(0, Math.min(100, N_CONVOS - offset)) },
      (_, k) => ({ id: `convo-id-${(offset + k).toString().padStart(4, "0")}`, title: offset + k === 3 ? null : `Conversation ${offset + k} <"quoted"/slash>` }));
    return json({ items, total: N_CONVOS });
  }

  if (u.startsWith("/backend-api/conversation/")) {
    const i = Number(u.slice(-4));
    // one transient 429 to exercise the retry path
    if (i === 5 && !served429) { served429 = true; return json({}, 429, { "retry-after": "1" }); }
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // slower than the pacer interval so overlap (parallelism) is observable
    await new Promise((r) => setTimeout(r, 3000));
    inFlight--;
    return json(convoPayload(i));
  }

  if (u.startsWith("/backend-api/files/download/")) {
    return json({ download_url: "https://files.example/x", file_name: "doc.pdf" });
  }
  if (u.startsWith("https://files.example/")) {
    return json(null, 200, { "content-type": "application/pdf" });
  }

  throw new Error(`Unmocked URL: ${u}`);
};

// ── Run the exporter ──────────────────────────────────────────────────
const src = readFileSync(process.argv[2], "utf8");
await eval(`(async () => { ${src} })`)();
// the exporter is itself an async IIFE; poll until the ZIP lands (429 recovery can take a while)
for (let waited = 0; !zipBlob && waited < 180000; waited += 500) {
  await new Promise((r) => setTimeout(r, 500));
}

// ── Assertions ────────────────────────────────────────────────────────
import { strict as assert } from "assert";
assert.ok(zipBlob, "ZIP blob was created and download triggered");

const buf = Buffer.from(await zipBlob.arrayBuffer());
assert.equal(buf.readUInt32LE(0), 0x04034b50, "ZIP starts with local file header magic");

// EOCD record present, entry count matches
const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
assert.ok(eocdOffset > 0, "EOCD found");
const entryCount = buf.readUInt16LE(eocdOffset + 8);
// 12 json + 12 md + 12 html + 1 attachment file + 1 checksum manifest = 38
assert.equal(entryCount, 38, `expected 38 zip entries, got ${entryCount}`);

// Verify readable by a real unzip
import { writeFileSync } from "fs";
import { execSync } from "child_process";
writeFileSync("/tmp/test-export.zip", buf);
const listing = execSync("unzip -l /tmp/test-export.zip").toString();
for (const dir of ["json/", "markdown/", "html/", "files/"]) {
  assert.ok(listing.includes(dir), `zip contains ${dir}`);
}
execSync("cd /tmp && rm -rf test-export-out && unzip -q test-export.zip -d test-export-out");
const integrity = execSync("unzip -t /tmp/test-export.zip").toString();
assert.ok(integrity.includes("No errors detected"), "zip integrity OK");

// Markdown content sane
const md = execSync("cat '/tmp/test-export-out/markdown/Conversation 2 _'*.md").toString();
assert.ok(md.includes("Answer 2 with **markdown**"), "markdown content present");
assert.ok(md.includes("doc.pdf"), "attachment link present in md");

// HTML pass ran over all successes and escaped titles
const html = execSync("cat '/tmp/test-export-out/html/Conversation 7 _'*.html").toString();
assert.ok(html.includes("&lt;&quot;quoted&quot;/slash&gt;"), "title escaped in html");
assert.ok(html.includes("sidebar-item"), "sidebar rendered");

// Checksum manifest verifies against extracted files
const shaOut = execSync("cd /tmp/test-export-out && shasum -a 256 -c checksums-sha256.txt 2>&1 | grep -cv ': OK$' || true").toString().trim();
assert.equal(shaOut, "0", `all checksum lines OK (${shaOut} failures)`);

// Concurrency actually happened, 429 retried
assert.ok(maxInFlight >= 2, `parallel downloads observed (max in flight: ${maxInFlight})`);
assert.ok(served429, "429 path exercised");
const convoFetches = requestLog.filter((u) => u.includes("/backend-api/conversation/")).length;
assert.equal(convoFetches, N_CONVOS + 1, "each convo fetched once + 1 retry");

console.log(`ALL PASS, ${entryCount} entries, max in-flight ${maxInFlight}, 429 retried, zip valid`);
process.exit(0);
