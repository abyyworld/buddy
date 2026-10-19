// Helpers for phone mode's browser tests (Playwright Chromium + tests/phonemode/fake_mac.py + the fake Tinfoil SDK).
// Fake data and a fake key only; nothing here reaches Tinfoil or reads anything real.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);   // (ESM imports ignore NODE_PATH; require doesn't)
export const { chromium } = require("playwright");
export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..", "..");
export const KEY = "sk-FAKE-0123456789abcdef";            // obviously fake; checked to go nowhere but Tinfoil's header
export const SHELL = ["/phone", "/direct.js", "/pcm-tap.js", "/manifest.json", "/vendor/tinfoil.mjs",
  "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png"];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const FAKE = {
  ready: "ok", readyMs: 0, release: "v0.0.38",
  models: { status: 200, data: [{ id: "gemma4-31b", multimodal: true, type: "chat" }, { id: "deepseek-v4-1-flash", multimodal: false, type: "chat" },
    { id: "kimi-k3", multimodal: true, type: "chat" }, { id: "whisper-large-v3-turbo" }, { id: "voxtral-tts" }, { id: "qwen3-tts" }] },
  chat: [
    { when: { image: true, stream: false }, status: 200, json: { choices: [{ message: { content: "A red square on white." } }] } },
    { when: { stream: false }, status: 200, json: { choices: [{ message: { content: "Hi" } }] } },
    { when: { stream: true }, status: 200, sse: ["Hi there! ", "How are you?"], chunkMs: 20, done: true, finish: "stop" },
  ],
  speech: { pcm: { status: 200, chunks: 4, chunkBytes: 4800 }, wav: { status: 200 } },
  stt: { status: 200, text: "hello there" },
};
export const fake = (over) => Object.assign(JSON.parse(JSON.stringify(FAKE)), over || {});

// ---------- the fake Mac ----------
export async function startMac(args = []) {
  const p = spawn(process.env.PYTHON || "python3", ["-B", join(HERE, "..", "fake_mac.py"), ...args], { stdio: ["ignore", "pipe", "inherit"] });
  const info = await new Promise((ok, no) => {
    let buf = "";
    p.stdout.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { ok(JSON.parse(buf.slice(0, i))); } catch (e) { no(e); } } });
    p.on("exit", (c) => no(new Error("fake_mac.py exited " + c)));
  });
  const ctl = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${info.control}${path}`, body === undefined ? {} : { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
    return r.json();
  };
  return Object.assign(info, {
    proc: p, url: `http://127.0.0.1:${info.port}`, ctl,
    mode: (m) => ctl("/mode", m),
    log: (since = 0) => ctl("/log?since=" + since),
    thread: () => ctl("/thread"),
    state: () => ctl("/state"),
    stop: () => new Promise((ok) => { if (p.exitCode !== null) return ok(); p.once("exit", ok); p.kill("SIGTERM"); }),
  });
}

// ---------- the browser ----------
export function fakeAudio() {                            // 1 s silence, 1.5 s of 220 Hz at -12 dBFS, 3 s silence
  const rate = 48000, n = Math.round(rate * 5.5), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate; b.writeInt16LE(t >= 1 && t < 2.5 ? Math.round(Math.sin(2 * Math.PI * 220 * t) * 0.25 * 32767) : 0, 44 + i * 2); }
  const d = mkdtempSync(join(tmpdir(), "buddy-pm-")), f = join(d, "voice.wav"); writeFileSync(f, b);
  process.on("exit", () => rmSync(d, { recursive: true, force: true }));   // (gone with the test run)
  return f;
}
export async function launch() {
  return chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeAudio()}`, "--autoplay-policy=no-user-gesture-required"] });
}
// A phone: its own browser profile (storage, service worker), the fake SDK's script and a log of what it was asked.
export async function phone(browser, mac, cfg = FAKE) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow", hasTouch: false });
  await ctx.grantPermissions(["microphone", "notifications"], { origin: mac.url });
  const tlog = [], errors = [];
  await ctx.exposeBinding("__pmSink", (_s, e) => { tlog.push(e); });
  await ctx.addInitScript(() => {
    const a = [], push = a.push.bind(a);
    a.push = (...xs) => { for (const x of xs) { try { globalThis.__pmSink(JSON.parse(JSON.stringify(x))); } catch {} } return push(...xs); };
    Object.defineProperty(globalThis, "__FAKE_TINFOIL_LOG__", { configurable: true, get: () => a, set: () => {} });
  });
  await ctx.addInitScript((c) => { globalThis.__FAKE_TINFOIL__ = c; }, cfg);
  const page = await ctx.newPage();
  const watch = (pg) => {
    pg.on("pageerror", (e) => errors.push("uncaught: " + String(e && e.stack || e)));
    pg.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  };
  watch(page); ctx.on("page", watch);
  return { ctx, page, tlog, errors, mac,
    async setFake(c) { await ctx.addInitScript((x) => { globalThis.__FAKE_TINFOIL__ = x; }, c); for (const p of ctx.pages()) await p.evaluate((x) => { globalThis.__FAKE_TINFOIL__ = x; }, c).catch(() => {}); },
    close: () => ctx.close() };
}

// ---------- waiting ----------
export async function until(fn, ms = 10000, what = "condition") {
  const end = Date.now() + ms; let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}` + (last instanceof Error ? ": " + last.message : ""));
    await sleep(100);
  }
}
export const inPage = (page, fn, arg) => page.evaluate(fn, arg);
export const isPM = (page) => page.evaluate(() => document.documentElement.classList.contains("phonemode")).catch(() => false);
// the page has booted: its conversation loaded, or (your Mac away, no phone mode) its first poll failed
export const booted = (page, ms = 15000) => until(() => page.evaluate(() => typeof state === "object" && (state.loaded === true || state.offline === true)).catch(() => false), ms, "the page to load");

// pair this phone with the fake Mac (code 123456) and wait for the chat
export async function pair(p) {
  const { page, mac } = p;
  await page.goto(mac.url + "/phone");
  await page.waitForSelector("#pairv:not([hidden])", { timeout: 15000 });
  await page.fill("#pv-code", "123456");
  await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click("#pv-go")]);
  await booted(page);
}
export async function openSettings(page) {
  if (!(await page.evaluate(() => document.getElementById("settings").classList.contains("open")))) await page.click("#gear");
  await page.waitForSelector("#settings.open");
  await sleep(150);
}
export async function closeSheets(page) { await page.evaluate(() => closeAll()); }
// Settings -> Phone mode on (the kit comes along while the Mac answers), and this phone's key
export async function phoneModeOn(p, key = KEY) {
  const { page } = p;
  await openSettings(page);
  await page.click("#pmode");
  await until(() => page.evaluate(() => BuddyDirect.enabled() && BuddyDirect.have().kit), 15000, "phone mode on with a kit");
  if (key) {
    await page.waitForSelector("#pmbox:not([hidden])");
    await page.fill("#pm-key", key); await page.click("#pm-save");
    await until(() => page.evaluate(() => BuddyDirect.have().key), 5000, "the key saved");
  }
  await closeSheets(page);
}
// the service worker's copy of the app, taken whole for the page's version
export async function shellCached(page, ms = 15000) {
  return until(() => page.evaluate(async (shell) => {
    if (!navigator.serviceWorker.controller || !state.version) return false;
    const name = "buddy-shell-" + state.version;
    if (!(await caches.has(name))) { navigator.serviceWorker.controller.postMessage({ type: "refresh", version: state.version }); return false; }
    const keys = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
    return shell.every((s) => keys.includes(s)) ? name : false;
  }, SHELL), ms, "the shell snapshot");
}
// reload and wait until the page has booted (in whichever mode)
export async function reload(page, ms = 20000) {
  await page.evaluate(() => { window.__notReloaded = 0; });
  await page.reload({ waitUntil: "domcontentloaded", timeout: ms });
  await booted(page, ms);
}

// ---------- what the phone keeps ----------
export async function dump(page) {
  return page.evaluate(async () => {
    const conv = (v, d = 0) => {
      if (d > 30) return null;
      if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) { const u = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return { $bytes: u.length, b64: btoa(s) }; }
      if (typeof CryptoKey !== "undefined" && v instanceof CryptoKey) return { $cryptoKey: v.algorithm.name, extractable: v.extractable };
      if (Array.isArray(v)) return v.map((x) => conv(x, d + 1));
      if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = conv(x, d + 1); return o; }
      return v;
    };
    const out = { idb: null, ls: {}, ss: {}, caches: {} };
    for (let i = 0; i < localStorage.length; i++) out.ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    for (let i = 0; i < sessionStorage.length; i++) out.ss[sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
    if ((await indexedDB.databases()).some((d) => d.name === "buddy-phone")) {
      const db = await new Promise((ok, no) => { const r = indexedDB.open("buddy-phone"); r.onupgradeneeded = () => r.transaction.abort(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }).catch(() => null);
      if (db) {
        out.idb = {};
        for (const name of db.objectStoreNames) out.idb[name] = conv(await new Promise((ok) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }));
        db.close();
      }
    }
    for (const n of await caches.keys()) {
      const c = await caches.open(n); out.caches[n] = [];
      for (const r of await c.keys()) { const res = await c.match(r); out.caches[n].push({ url: r.url, body: await res.text() }); }
    }
    return out;
  });
}
export const idbHas = (page) => page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === "buddy-phone"));
export async function outbox(page) { const d = await dump(page); return ((d.idb && d.idb.outbox) || []).sort((a, b) => a.seq - b.seq); }
export async function meta(page, k) { const d = await dump(page); return ((d.idb && d.idb.meta) || []).find((x) => x.k === k) || null; }
export async function setMeta(page, rec) {
  await page.evaluate(async (rec) => {
    const db = await new Promise((ok, no) => { const r = indexedDB.open("buddy-phone"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    await new Promise((ok, no) => { const t = db.transaction("meta", "readwrite"); t.objectStore("meta").put(rec); t.oncomplete = ok; t.onerror = () => no(t.error); });
    db.close();
  }, rec);
}
// the key, its base64 and URL-encoded forms (none may reach the Mac; in Tinfoil's log only as the Authorization header)
export const keyForms = (k = KEY) => [k, Buffer.from(k).toString("base64"), encodeURIComponent(k), Buffer.from(k).toString("base64url")];

// ---------- sending ----------
export async function type(page, text) { await page.fill("#text", text); await page.dispatchEvent("#text", "input"); }
export async function send(page, text) {
  await type(page, text);
  await page.click("#send");
}
export const replyDone = (page, ms = 15000) => until(() => page.evaluate(() => !state.busy && !document.querySelector("#msgs .typing")), ms, "the reply");
export const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll("#msgs .b")].map((b) => ({
  cls: b.className, text: b.textContent, id: b.dataset.id || "" })));
export const tinfoilFetches = (tlog, path) => tlog.filter((e) => e.kind === "fetch" && (!path || e.path === path));
export const lastChat = (tlog) => tinfoilFetches(tlog, "/v1/chat/completions").filter((e) => e.json && e.json.stream).pop();
export const pick = async (page, char) => { await page.evaluate((c) => setChar(c), char); };
