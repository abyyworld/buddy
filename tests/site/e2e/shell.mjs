// Buddy for phones' site shell end to end (SPEC3 §16.3 P1a): Playwright Chromium against a static server that answers
// like GitHub Pages (its headers: no CSP, Cache-Control max-age=600, ETag; /buddy -> /buddy/; 404.html for misses), with
// the site under / and under /buddy/. Sites built from the public copy (publish.sh --tree) with its real web/solo/* (the
// engine starts: the welcome screen, its kit.json from the verified copy) and test keys made here. Checks: install (the
// verified copy, the key pinned, registered only once the page is past the install gate), offline load (the page, its
// scripts with SRI, the engine, the SDK module, the site's headers), an /api/ request never reaching the server, an update only to
// a newer signed version, never while a page says a call is on (asked of every open page), the "Updated to vN" note, a
// badly signed or older release refused with the old one kept, and the frame guard. No host but the test server is
// ever contacted.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node-tools/node_modules node tests/site/e2e/shell.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as L from "../lib.mjs";
import { pages } from "./pages.mjs";

const require = createRequire(import.meta.url);        // (ESM imports ignore NODE_PATH; require doesn't)
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); }
async function until(fn, ms = 15000, what = "condition") {
  const end = Date.now() + ms; let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error("timed out waiting for " + what + (last instanceof Error ? ": " + last.message : ""));
    await sleep(100);
  }
}

// ---------- the page side ----------
const info = (page) => page.evaluate(() => window.BuddySite.info());
const reg = (page) => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return r ? { active: !!r.active, waiting: !!r.waiting, installing: !!r.installing } : null;
});
const cacheNames = (page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("buddy-site-")).sort());
const applyDirect = (page) => page.evaluate(async () => {   // ask the waiting worker straight away (not through site.js)
  const r = await navigator.serviceWorker.getRegistration();
  if (!r || !r.waiting) return { none: true };
  return new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => ok(e.data); r.waiting.postMessage({ type: "apply" }, [ch.port2]); });
});
const forceUpdate = (page) => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update().catch(() => null); });
async function settle(page) {                          // no worker installing any more
  await until(async () => { const r = await reg(page); return r && !r.installing; }, 20000, "the install to finish");
}

async function scenario(browser, base) {
  const K = L.keygen("release"), K2 = L.keygen("other");
  const t = L.tree(K);                                 // (the real web/solo/*: Buddy for phones' engine)
  const site = {};
  for (const v of [1, 2, 4, 5]) { site[v] = L.build(t, v, { base }); L.sign(site[v], K); }
  site[3] = L.build(t, 3, { base }); L.sign(site[3], K2);            // signed by another key
  const srv = await pages(base).start();
  srv.serve(site[1]);
  const start = srv.origin + (base === "/" ? "/index.html" : base);   // (chat.html's own "/" -> "/phone" redirect is the
  const ctx = await browser.newContext({ serviceWorkers: "allow" }); //  solo mode's to drop; a fixed path avoids it here)
  const elsewhere = [];
  ctx.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) elsewhere.push(r.url()); });
  await ctx.route((u) => !["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http"), (r) => r.abort());
  let page = await ctx.newPage();
  let controlledFrom = 0;
  const T = async (name, fn) => {
    try { await fn(); passed++; console.log(`ok   [${base}] ${name}`); }
    catch (e) { failed++; console.log(`FAIL [${base}] ${name}\n     ` + String(e && e.stack || e).split("\n").slice(0, 4).join("\n     ")); throw e; }
  };
  try {
    await T("install: the first visit installs the verified copy and the page is taken over", async () => {
      await page.goto(start);
      await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), 20000, "the worker to control the page");
      const i = await until(() => info(page), 10000, "the worker's info");
      check(i.v === 1 && i.max === 1, "v1 running: " + JSON.stringify(i));
      check(i.selfHash === L.sha256(readFileSync(join(site[1], "sw.js"))), "its sw.js hash is the signed one");
      check(i.fingerprint === L.sha256(readFileSync(join(site[1], "site-manifest.json"))).slice(0, 16), "the manifest fingerprint");
      check(JSON.stringify(await cacheNames(page)) === '["buddy-site-v1"]', "one verified cache");
      const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
      check(scope === srv.origin + base, "scope is the site's path: " + scope);
      check(await page.evaluate(() => !!document.querySelector('meta[name="buddy-site"]') && !!window.BuddySolo && !!window.BuddySoloLib.life), "the site's page with web/solo/* loaded (SRI passed)");
      await until(() => page.evaluate(() => window.BuddySolo.ready === true && !document.getElementById("sv-welcome").hidden), 10000, "the engine started (the welcome screen)");
      controlledFrom = srv.log.length;                   // (the first, uncontrolled load is the network's, as on any site)
      const about = await page.evaluate(() => window.BuddySite.about());
      check(about.version === "v1" && about.signed === "Signed by Buddy's release key" && about.note === "", "About: " + JSON.stringify(about));
    });

    await T("offline: the page, its scripts and the SDK come from the verified copy, with the site's headers", async () => {
      srv.down = true;
      const resp = await page.reload();
      check(resp && resp.fromServiceWorker(), "the page came from the worker");
      const h = resp.headers();
      check(h["content-security-policy"].includes("frame-ancestors 'none'") && h["content-security-policy"].includes("script-src 'self';")
        && h["x-content-type-options"] === "nosniff" && h["referrer-policy"] === "no-referrer" && h["cache-control"] === "no-store", "headers: " + JSON.stringify(h));
      await until(() => page.evaluate(() => !!window.BuddySite && window.BuddySolo.ready === true && !document.getElementById("sv-welcome").hidden), 10000, "the scripts and the engine offline");
      check((await info(page)).v === 1, "still v1");
      const sdk = await page.evaluate(async () => { const m = await import(new URL("vendor/tinfoil.js", document.baseURI).href); return Object.keys(m).length > 0; });
      check(sdk, "the SDK module loads offline (as JavaScript, under the CSP)");
      const p2 = await ctx.newPage();
      await p2.goto(start);
      check(await p2.evaluate(() => !!document.querySelector('meta[name="buddy-site"]')), "a new window opens offline too");
      await p2.close();
      srv.down = false;
    });

    await T("an /api/ request (or any other path) never leaves the phone", async () => {
      const before = srv.log.length;
      const r = await page.evaluate(async () => Promise.all(["/api/status", "api/chat", "../elsewhere.js"].map(async (p) => {
        const x = await fetch(p, { method: p === "api/chat" ? "POST" : "GET" }); return [x.status, (await x.json()).error];
      })));
      check(r.every(([s, e]) => s === 404 && e === "not in Buddy for phones"), "local 404s: " + JSON.stringify(r));
      check(!srv.log.slice(before).some((p) => p.includes("api") || p.includes("elsewhere")), "the server saw none of them: " + JSON.stringify(srv.log.slice(before)));
    });

    await T("update: a newer signed version installs and waits; never applied while a page is in a call", async () => {
      srv.serve(site[2]);
      const c = await page.evaluate(() => window.BuddySite.check());
      check(c && c.ok && c.newer === 2, "the check found v2: " + JSON.stringify(c));
      await until(async () => (await reg(page)).waiting, 20000, "v2 to be installed and waiting");
      const i = await info(page);
      check(i.v === 1 && i.pending && i.pending.v === 2, "v1 still runs, v2 is ready: " + JSON.stringify(i));
      check((await page.evaluate(() => window.BuddySite.about())).note.startsWith("Update ready (v2)"), "About says an update is ready");
      await page.evaluate(() => window.BuddySite.setBusy(() => ({ call: true, idle: false })));
      const a = await page.evaluate(() => window.BuddySite.apply());
      check(!a.ok && a.why === "call", "site.js refuses during a call: " + JSON.stringify(a));
      const d = await applyDirect(page);
      check(!d.ok && d.why === "call", "the worker itself refuses while a page says it's in a call: " + JSON.stringify(d));
      const other = await ctx.newPage();                 // another window opening now doesn't apply it either
      await other.goto(start);
      await sleep(1500);
      check((await info(other)).v === 1 && (await reg(page)).waiting, "still v1 everywhere, v2 waiting");
      await other.close();
      await sleep(500);
      check((await info(page)).v === 1, "still v1 after the call went on");
    });

    await T("update: applied once the call is over; one reload, \"Updated to v2\", the old copy dropped", async () => {
      await page.evaluate(() => window.BuddySite.setBusy(() => ({ call: false, idle: true })));
      const reloaded = page.waitForEvent("load", { timeout: 20000 });
      const a = await page.evaluate(() => window.BuddySite.apply());
      check(a.ok, "applied: " + JSON.stringify(a));
      await reloaded;
      await until(async () => (await info(page)).v === 2, 15000, "v2 running");
      await until(() => page.getByText("Updated to v2").isVisible(), 5000, "the Updated to v2 note");
      check(JSON.stringify(await cacheNames(page)) === '["buddy-site-v2"]', "only v2's cache left");
      const i = await info(page);
      check(i.max === 2 && i.selfHash === L.sha256(readFileSync(join(site[2], "sw.js"))), "v2's own hash");
    });

    await T("refused: a release signed by another key (the check, and the browser's own update) keeps v2", async () => {
      srv.serve(site[3]);
      const c = await page.evaluate(() => window.BuddySite.check());
      check(c && !c.ok && c.failed === 3, "the check refused v3: " + JSON.stringify(c));
      const from = srv.log.length;
      await forceUpdate(page);                           // the browser fetches the new sw.js anyway: its install refuses
      await settle(page);
      check(srv.log.slice(from).includes(base + "site-manifest.json"), "the new sw.js really ran its install (it fetched the manifest)");
      const r = await reg(page), i = await info(page);
      check(!r.waiting && i.v === 2 && i.failed && i.failed.v === 3, "v2 kept, nothing waiting: " + JSON.stringify({ r, i }));
      check((await page.evaluate(() => window.BuddySite.about())).note === "An update couldn't be verified (v3); still on v2", "About says so");
      await page.reload();
      check((await info(page)).v === 2, "still v2 after a reload");
    });

    await T("refused: an older signed release (no downgrade)", async () => {
      srv.serve(site[1]);
      const from = srv.log.length;
      await forceUpdate(page);
      await settle(page);
      check(srv.log.slice(from).includes(base + "site-manifest.json"), "the old sw.js really ran its install (it fetched the manifest)");
      const r = await reg(page), i = await info(page);
      check(!r.waiting && i.v === 2 && i.max === 2, "v2 kept: " + JSON.stringify({ r, i }));
      check(JSON.stringify(await cacheNames(page)) === '["buddy-site-v2"]', "v2's cache untouched");
    });

    await T("a launch with a release waiting applies it (site.js, once loaded), every window reloads once", async () => {
      srv.serve(site[4]);
      await page.evaluate(() => window.BuddySite.check());
      await until(async () => (await reg(page)).waiting, 20000, "v4 waiting");
      const other = await ctx.newPage();                 // (another open window: the browser can't switch by itself)
      await other.goto(start);
      await page.reload();                               // a launch with v4 waiting: site.js asks for it
      await until(async () => { const r = await reg(page).catch(() => null); return r && r.active && !r.waiting; }, 30000, "v4 to take over");
      await until(async () => (await info(page).catch(() => null) || {}).v === 4, 20000, "v4 running");
      await until(() => page.getByText("Updated to v4").isVisible(), 10000, "the Updated to v4 note");
      await until(async () => (await info(other).catch(() => null) || {}).v === 4, 20000, "the other window on v4 too");
      await until(() => other.getByText("Updated to v4").isVisible(), 10000, "the note in the other window too");
      check(JSON.stringify(await cacheNames(page)) === '["buddy-site-v4"]', "only v4's cache");
      await other.close();
    });

    await T("the next launch runs the waiting release (the app closed, then opened)", async () => {
      srv.serve(site[5]);
      await page.evaluate(() => window.BuddySite.check());
      await until(async () => (await reg(page)).waiting, 20000, "v5 waiting");
      await page.close();                                // (on a phone: the app is swiped away)
      page = await ctx.newPage();
      await page.goto(start);
      await until(async () => { const r = await reg(page).catch(() => null); return r && r.active && !r.waiting; }, 30000, "v5 to take over");
      await until(async () => (await info(page).catch(() => null) || {}).v === 5, 20000, "v5 running");
      check(JSON.stringify(await cacheNames(page)) === '["buddy-site-v5"]', "only v5's cache");
    });

    await T("nothing was fetched from any other host", async () => {
      check(elsewhere.length === 0, "other hosts: " + JSON.stringify(elsewhere));
      check(!srv.log.slice(controlledFrom).some((p) => p.includes("/api/")), "once installed, the server never saw an /api/ path: "
        + JSON.stringify(srv.log.slice(controlledFrom).filter((p) => p.includes("/api/"))));
    });
  } finally {
    await ctx.close();
    srv.server.close();
  }
  return srv;
}

async function frameGuard(browser) {
  const K = L.keygen("release");
  const site = L.build(L.tree(K), 1); L.sign(site, K);
  const srv = await pages("/buddy/").start();
  srv.serve(site);
  const top = createServer((req, res) => {             // another site that frames Buddy
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><title>framer</title><iframe id="f" src="${srv.origin}/buddy/" width="400" height="400"></iframe>`);
  });
  await new Promise((ok) => top.listen(0, "127.0.0.1", ok));
  const ctx = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await ctx.newPage();
    await page.goto("http://localhost:" + top.address().port + "/");
    const frame = await until(() => page.frames().find((f) => f.url().startsWith(srv.origin)), 10000, "the frame");
    await until(() => frame.evaluate(() => document.body && document.body.textContent === "Open Buddy in its own window."), 10000, "the frame guard");
    check(await frame.evaluate(() => typeof window.BuddyDirect === "undefined" && !document.querySelector("#msgs")), "nothing else ran or rendered in the frame");
    check(await frame.evaluate(async () => !(await navigator.serviceWorker.getRegistration())), "no worker registered from a frame");
    passed++; console.log("ok   [frame] a framed copy stops and says to open Buddy in its own window");
  } catch (e) {
    failed++; console.log("FAIL [frame] " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n     "));
  } finally { await ctx.close(); top.close(); srv.server.close(); }
}

const browser = await chromium.launch();
try {
  for (const base of ["/", "/buddy/"]) {
    try { await scenario(browser, base); } catch (e) { /* (reported; the next base still runs) */ }
  }
  await frameGuard(browser);
} finally { await browser.close(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
