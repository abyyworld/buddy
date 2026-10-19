// Buddy for phones end to end on the BUILT site (SPEC3 §16.3 P1): the public copy (publish.sh --tree) built by its own
// scripts/build_pages.py, signed with a test key made here (ssh-keygen, namespace buddy-site) and served under /buddy/ by
// a static server that answers like GitHub Pages (tests/site/e2e/pages.mjs: no CSP header, max-age, ETag). The one test
// change to the tree: web/vendor/tinfoil.mjs is the fake Tinfoil SDK (tests/phonemode/fake_tinfoil.mjs, with its
// .sha256 rewritten so the build takes it), so it is hashed, signed and SRI-pinned like the real one. No Mac anywhere.
// Checks, in Chromium:
//   1. iPhone Safari (not from the Home Screen): only the install gate; no service worker, database, cache or web storage.
//   2. Install: the verified copy is installed (signature, versions, every hash) and takes the page over; the welcome
//      screen; this phone's key, verified in the page through the SDK; a chat with Buddy (the fake SDK streams the reply).
//   3. A character made by the Advisor (one with a minor's looks refused), a chat with her.
//   4. Offline: the reload comes from the verified copy (the site's headers), and everything is still there (her, the
//      chats, the key: no key screen), in a new window too; Settings -> About says what's running and that it's signed.
//   5. Back online, a newer signed release: "Update now" in About applies it; the data is still there after the reload.
//   6. Nothing went to any other host, no /api/ request reached the server, the key never reached the console or plain
//      storage, no page errors.
// Fake data and a fake key only; temp folders only.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node-tools/node_modules node tests/site/e2e/built.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import * as L from "../lib.mjs";
import { pages } from "./pages.mjs";

const require = createRequire(import.meta.url);        // (ESM imports ignore NODE_PATH; require doesn't)
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "sk-FAKE-built-site-0123456789abcdef";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
const BASE = "/buddy/";
let passed = 0, failed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); }
const has = (s, part) => String(s).includes(part);
async function until(fn, ms = 15000, what = "condition") {
  const end = Date.now() + ms; let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error("timed out waiting for " + what + (last instanceof Error ? ": " + last.message : ""));
    await sleep(100);
  }
}
const keyForms = (k) => [k, Buffer.from(k).toString("base64"), encodeURIComponent(k), Buffer.from(k).toString("base64url")];

// ---------- the fake Tinfoil SDK's script (as in tests/solo/e2e) ----------
const CHARS_JSON = JSON.stringify([
  { name: "Maya", tagline: "Climbing coach", persona: "You are Maya, a calm climbing coach in Lisbon.", voice: "cheerful_female",
    appearance: "an adult woman in her early thirties, short dark hair, in a loose hoodie", style: "photo", brain: "advisor",
    life_seed: "Lives in Lisbon.", folders: [], avoid: "" },
  { name: "Tess", tagline: "Too young", persona: "You are Tess.", appearance: "a 16-year-old girl with braces", voice: "neutral_female", folders: [] },
]);
const FAKE = {
  ready: "ok", readyMs: 0, release: "v0.0.38",
  models: { status: 200, data: [{ id: "gemma4-31b", multimodal: true, type: "chat" }, { id: "deepseek-v4-1-flash", multimodal: false, type: "chat" },
    { id: "kimi-k3", multimodal: true, type: "chat" }, { id: "whisper-large-v3-turbo" }, { id: "voxtral-tts" }, { id: "qwen3-tts" }] },
  chat: [
    { when: { stream: false }, status: 200, json: { choices: [{ message: { content: "Here you go:\n" + CHARS_JSON }, finish_reason: "stop" }] } },
    { when: { stream: true }, status: 200, sse: ["Hi there! ", "How are you?"], chunkMs: 10, done: true, finish: "stop" },
  ],
  speech: { pcm: { status: 200, chunks: 4, chunkBytes: 4800 }, wav: { status: 200 } },
  stt: { status: 200, text: "hello there" },
};

// ---------- the site: built from the public copy with the fake SDK in place of the real one ----------
const K = L.keygen("release");
const tree = L.tree(K, { change: (t) => {
  const sdk = join(t, "web", "vendor", "tinfoil.mjs");
  copyFileSync(join(L.REPO, "tests", "phonemode", "fake_tinfoil.mjs"), sdk);
  writeFileSync(sdk + ".sha256", L.sha256(readFileSync(sdk)) + "  tinfoil.mjs\n");
} });
const site1 = L.build(tree, 1, { base: BASE }); L.sign(site1, K);
const site2 = L.build(tree, 2, { base: BASE }); L.sign(site2, K);
check(readFileSync(join(site1, "vendor", "tinfoil.js"), "utf8").includes("__FAKE_TINFOIL__"), "the test site carries the fake SDK");
check(readFileSync(join(L.REPO, "web", "vendor", "tinfoil.mjs"), "utf8").startsWith("// tinfoil@"), "(the repo's own SDK is untouched)");

const srv = await pages(BASE).start();
srv.serve(site1);
const URL_ = srv.origin + BASE;
const browser = await chromium.launch();
const elsewhere = [], errors = [], consoleText = [], relayNotes = [];

async function phone({ ios = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow",
    ...(ios ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}) });
  ctx.on("request", (r) => { const u = new URL(r.url()); if (u.protocol.startsWith("http") && u.origin !== srv.origin) elsewhere.push(r.url()); });
  await ctx.route((u) => u.protocol.startsWith("http") && u.origin !== srv.origin, (r) => r.abort());
  const tlog = [];
  await ctx.exposeBinding("__pmSink", (_s, e) => { tlog.push(e); });
  await ctx.addInitScript(() => {
    const a = [], push = a.push.bind(a);
    a.push = (...xs) => { for (const x of xs) { try { globalThis.__pmSink(JSON.parse(JSON.stringify(x))); } catch {} } return push(...xs); };
    Object.defineProperty(globalThis, "__FAKE_TINFOIL_LOG__", { configurable: true, get: () => a, set: () => {} });
  });
  await ctx.addInitScript((c) => { globalThis.__FAKE_TINFOIL__ = c; }, FAKE);
  const watch = (pg) => {
    pg.on("pageerror", (e) => errors.push("uncaught: " + String((e && e.stack) || e)));
    pg.on("console", (m) => {
      consoleText.push(m.text());
      if (/invalid source: '__RELAY__'/.test(m.text())) relayNotes.push(pg.url());   // (SPEC3 §3.4: a copy from the network
      else if (m.type() === "error" && !/net::ERR_|Failed to load resource/.test(m.text())) errors.push("console: " + m.text());   // keeps it)
    });
  };
  ctx.on("page", watch);
  const page = await ctx.newPage();
  return { ctx, page, tlog };
}
const screen = (page) => page.evaluate(() => (document.getElementById("solov").hidden ? null : [...document.querySelectorAll("#solov > .pbox > div[id^=sv-]")].find((d) => !d.hidden && d.id !== "sv-icon")?.id || "?"));
const started = (page) => until(() => page.evaluate(() => !!window.BuddySolo && window.BuddySolo.ready === true && typeof state === "object" && state.loaded === true).catch(() => false), 20000, "Buddy to start");
const names = (page) => page.evaluate(() => state.chars.map((c) => c.name).join(","));
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll("#msgs .b")].map((b) => b.textContent));
const replyDone = (page) => until(() => page.evaluate(() => !state.busy && !document.querySelector("#msgs .typing")), 15000, "the reply");
const mine = (page) => page.evaluate(() => document.querySelectorAll("#msgs .b.me").length);
async function chatTo(page, char, text) {
  await page.evaluate((c) => setChar(c), char);
  const n = await mine(page);
  await page.fill("#text", text); await page.dispatchEvent("#text", "input"); await page.click("#send");
  await until(async () => (await mine(page)) > n, 10000, "your message on screen");
  await replyDone(page);
}
const info = (page) => page.evaluate(() => window.BuddySite.info());
const T = async (name, fn) => {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e && e.stack) || e).split("\n").slice(0, 4).join("\n     ")); throw e; }
};

let p = null, maya = null;
try {
  await T("iPhone Safari (not from the Home Screen): only the install gate; no worker, database, cache or web storage", async () => {
    const q = await phone({ ios: true });
    await q.page.goto(URL_);
    await until(async () => (await screen(q.page)) === "sv-gate", 10000, "the install gate");
    await sleep(1500);                                 // (time for anything that would start)
    const left = await q.page.evaluate(async () => ({ reg: !!(await navigator.serviceWorker.getRegistration()),
      dbs: (await indexedDB.databases()).map((d) => d.name), caches: await caches.keys(), ls: localStorage.length, ss: sessionStorage.length }));
    check(!left.reg && !left.dbs.length && !left.caches.length && !left.ls && !left.ss, "nothing kept in Safari: " + JSON.stringify(left));
    check(!srv.log.some((x) => /site-manifest|kit\.json|sw\.js/.test(x)), "no worker or kit fetched: " + JSON.stringify(srv.log));
    check(q.tlog.length === 0, "Tinfoil never contacted");
    await q.ctx.close();
  });

  await T("install: the signed release is verified and takes over; the welcome screen; this phone's key, verified; a chat", async () => {
    p = await phone();
    await p.page.goto(URL_);
    await until(() => p.page.evaluate(() => !!navigator.serviceWorker.controller), 20000, "the worker to control the page");
    const i = await until(() => info(p.page), 10000, "the worker's info");
    check(i.v === 1 && i.max === 1 && i.selfHash === L.sha256(readFileSync(join(site1, "sw.js"))), "v1, its signed sw.js: " + JSON.stringify(i));
    check(JSON.stringify(await p.page.evaluate(async () => caches.keys())) === '["buddy-site-v1"]', "one verified cache");
    await started(p.page);
    check((await screen(p.page)) === "sv-welcome", "a fresh phone: welcome (" + (await screen(p.page)) + ")");
    check(p.tlog.length === 0, "nothing contacted Tinfoil before a key was saved");
    await p.page.click("#sv-start");
    await until(async () => (await screen(p.page)) === "sv-key", 10000, "the key screen");
    await p.page.fill("#sv-keyin", KEY); await p.page.click("#sv-go");
    await until(async () => has(await p.page.textContent("#sv-err"), "Verified Tinfoil enclave, release v0.0.38"), 10000, "verified");
    await until(async () => (await screen(p.page)) === null, 10000, "the chat");
    const chk = p.tlog.find((e) => e.kind === "fetch" && e.path === "/v1/chat/completions" && e.json && e.json.max_tokens === 1);
    check(chk && chk.headers.authorization === "Bearer " + KEY, "a 1-token check with this phone's key, through the SDK");
    await chatTo(p.page, "buddy", "hey how was your day");
    check((await bubbles(p.page)).includes("Hi there! How are you?"), "Buddy's reply: " + JSON.stringify(await bubbles(p.page)));
    const sys = p.tlog.filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop().json.messages[0].content;
    check(has(sys, "Your name is Buddy. You are an adult."), "the adult line, from the built kit.json");
  });

  await T("a character: the Advisor writes them (a minor's looks refused); a chat with her", async () => {
    const page = p.page;
    await page.click("#people"); await page.waitForSelector("#chars.open");
    await page.fill("#desc", "a climbing coach and a teen"); await page.click("#create");
    await until(async () => has(await page.textContent("#cstate"), "Say hi to Maya."), 15000, "the character made")
      .catch(async (e) => { throw new Error(e.message + " (it says: " + (await page.textContent("#cstate")) + ")"); });
    check((await names(page)) === "Buddy,Maya", "Maya made, Tess refused: " + (await names(page)));
    maya = await page.evaluate(() => state.chars[1].id);
    await page.evaluate(() => closeAll());
    await chatTo(page, maya, "hi maya");
    const sys = p.tlog.filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop().json.messages[0].content;
    check(has(sys, "You are Maya, a calm climbing coach in Lisbon.\n\nYour name is Maya. You are an adult."), "her persona and the adult line");
  });

  await T("offline: the reload is the verified copy, and everything is still there (her, the chats, the key)", async () => {
    srv.down = true; await p.ctx.setOffline(true);
    const resp = await p.page.reload();
    check(resp && resp.fromServiceWorker(), "the page came from the worker");
    const h = resp.headers();
    check(has(h["content-security-policy"], "script-src 'self';") && has(h["content-security-policy"], "frame-ancestors 'none'") && h["cache-control"] === "no-store", "the site's headers: " + JSON.stringify(h));
    await started(p.page);
    check((await screen(p.page)) === null, "no key screen: the key is still on this phone");
    check(await p.page.evaluate(() => window.BuddySolo.hasKey()), "the key, kept (encrypted)");
    check((await names(p.page)) === "Buddy,Maya", "Maya is still there: " + (await names(p.page)));
    await p.page.evaluate((c) => setChar(c), maya);
    await until(async () => { const b = await bubbles(p.page); return b.includes("hi maya") && b.includes("Hi there! How are you?"); }, 5000, "her chat");
    await p.page.evaluate(() => setChar("buddy"));
    await until(async () => (await bubbles(p.page)).includes("hey how was your day"), 5000, "the chat with Buddy");
    const w = await p.ctx.newPage();                   // a new window, offline too
    await w.goto(URL_);
    await started(w);
    check((await names(w)) === "Buddy,Maya", "a new window offline: " + (await names(w)));
    await w.close();
    await p.page.click("#gear"); await p.page.waitForSelector("#settings.open"); await sleep(300);
    const fp = L.sha256(readFileSync(join(site1, "site-manifest.json"))).slice(0, 16);
    await until(async () => has(await p.page.textContent("#absite"), "Signed by Buddy's release key · manifest " + fp), 5000, "About: signed, the manifest's fingerprint");
    check(has(await p.page.textContent("#abstate"), "Version v1 · public edition"), "About: v1 (from the worker, offline): " + (await p.page.textContent("#abstate")));
    check(has(await p.page.textContent("#absite"), "sw.js " + L.sha256(readFileSync(join(site1, "sw.js"))).slice(0, 16)), "About: the running sw.js");
    check(!(await p.page.isVisible("#ab-update")), "no update waiting");
    await p.page.evaluate(() => closeAll());
  });

  await T("a newer signed release: \"Update now\" in About applies it; everything is still there afterwards", async () => {
    srv.down = false; await p.ctx.setOffline(false);
    srv.serve(site2);
    const c = await p.page.evaluate(() => window.BuddySite.check());
    check(c && c.ok && c.newer === 2, "the check found v2: " + JSON.stringify(c));
    await until(async () => { const r = await p.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting); return r; }, 20000, "v2 waiting");
    await p.page.click("#gear"); await p.page.waitForSelector("#settings.open");
    await until(() => p.page.isVisible("#ab-update"), 5000, "Update now");
    check(has(await p.page.textContent("#absite"), "Update ready (v2)"), "About says v2 is ready");
    const reloaded = p.page.waitForEvent("load", { timeout: 20000 });
    await p.page.click("#ab-update");
    await reloaded;                                    // (Settings closes, so the page is idle and reloads at once)
    await started(p.page);
    await until(async () => (await info(p.page)).v === 2, 15000, "v2 running");
    await until(() => p.page.getByText("Updated to v2").isVisible(), 5000, "the Updated to v2 note");
    check((await names(p.page)) === "Buddy,Maya" && (await screen(p.page)) === null, "the characters and the key are still there");
    check(JSON.stringify(await p.page.evaluate(async () => caches.keys())) === '["buddy-site-v2"]', "only v2's cache");
  });

  await T("nothing went elsewhere: no other host, no /api/ at the server, the key in no console or plain storage", async () => {
    check(elsewhere.length === 0, "other hosts: " + JSON.stringify(elsewhere));
    check(!srv.log.some((x) => x.includes("/api/")), "the server never saw an /api/ path");
    for (const f of keyForms(KEY)) check(!consoleText.some((t) => has(t, f)), "the key isn't in the console");
    const raw = await p.page.evaluate(async () => {
      let out = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      for (const d of await indexedDB.databases()) {
        const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        for (const s of db.objectStoreNames) {
          const rows = await new Promise((ok) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
          out += JSON.stringify(rows, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? Array.from(new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength)).map((b) => String.fromCharCode(b)).join("") : v));
        }
        db.close();
      }
      for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out += r.url;
      return out;
    });
    for (const f of keyForms(KEY)) check(!has(raw, f), "the key isn't readable in storage (" + f.slice(0, 6) + "…)");
    check(errors.length === 0, "no page errors: " + JSON.stringify(errors.slice(0, 5)));
    check(relayNotes.length <= 2, "the literal __RELAY__ only in the two copies from the network (the gate's, the first install's), "
      + "never in one the worker served: " + relayNotes.length);
  });
} catch (e) { /* (reported above) */ }
finally {
  await browser.close();
  srv.server.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed || passed < 6 ? 1 : 0);
