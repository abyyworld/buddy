// Buddy for phones' service worker (web/sw-site.js, as built into sw.js by scripts/build_pages.py) in Node, against a
// fake origin: what the server serves now, Cache Storage, IndexedDB (tests/phonemode/fake_idb.mjs) and open pages.
// Real sites built from the public copy (publish.sh --tree) and signed with test keys made here by ssh-keygen.
// SPEC3 §16.3 P1a: a good signature installs; a bad one, another key, an older or the same version, a missing file, a
// wrong hash, a sw.js that isn't the signed one, another namespace or hash, a manifest for another version or edition
// -> refused, and the old version stays (its cache and its pages); __RELAY__ is filled only with a valid https origin;
// the headers are on every response; never applied while a page says a call is on; WebCrypto without Ed25519 uses
// the pinned noble-ed25519, and without that nothing installs.
//   node tests/site/unit_sw.mjs        (needs zsh, ssh-keygen, python3)
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FakeIDB } from "../phonemode/fake_idb.mjs";
import * as L from "./lib.mjs";

const ORIGIN = "https://site.test", BASE = ORIGIN + "/buddy/";
let passed = 0, failed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); }
async function T(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n     ")); }
}

// ---------- the fake origin ----------
class FakeCaches {                                     // (as the spec says: a Cache already open keeps working after delete())
  constructor() { this.m = new Map(); this.hold = null; }
  async has(n) { return this.m.has(n); }
  async keys() { return [...this.m.keys()]; }
  async delete(n) { return this.m.delete(n); }
  async open(n) {
    if (!this.m.has(n)) this.m.set(n, new Map());
    const c = this.m.get(n), all = this;
    return {
      put: async (u, r) => { if (all.hold) await all.hold(n, String(u)); c.set(String(u), { body: Buffer.from(await r.arrayBuffer()), headers: [...r.headers] }); },
      match: async (u) => { const e = c.get(String(u)); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
      keys: async () => [...c.keys()],
    };
  }
}
class World {
  constructor() { this.served = {}; this.caches = new FakeCaches(); this.idb = new FakeIDB(); this.updates = 0; this.pages = []; this.requests = []; this.offline = false; }
  serve(site) { this.served = L.files(site); return this; }
  fetch = async (input) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    this.requests.push(u.href);
    if (this.offline) throw new TypeError("Failed to fetch");
    if (u.origin !== ORIGIN || !u.pathname.startsWith("/buddy/")) throw new TypeError("not this test's server");
    const b = this.served[u.pathname.slice("/buddy/".length)];
    const r = b ? new Response(b, { status: 200 }) : new Response("Not found", { status: 404 });
    Object.defineProperty(r, "type", { value: "basic" });
    return r;
  };
  meta(k = "site") { const d = this.idb.dump("buddy-site-sw"); return d ? (d.meta.find((m) => m.k === k) || null) : null; }
}
function noEd25519Subtle() {                           // a WebCrypto like Safari 16's: no Ed25519
  const s = webcrypto.subtle;
  return new Proxy(s, { get(t, k) {
    if (k === "importKey") return async (fmt, key, alg, ...rest) => {
      if (String(alg && alg.name || alg).toLowerCase() === "ed25519") throw new DOMException("no", "NotSupportedError");
      return s.importKey(fmt, key, alg, ...rest);
    };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
}
// A worker as the browser would start it from what the server serves now (its sw.js and imported ed25519.js)
function worker(world, { noEd25519 = false, sw = null } = {}) {
  const listeners = {}, w = { listeners, skipped: 0, claimed: 0 };
  const g = {
    location: new URL(BASE + "sw.js"),
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
    registration: { update: async () => { world.updates++; } },
    clients: { matchAll: async () => world.pages, claim: async () => { w.claimed++; } },
    skipWaiting: async () => { w.skipped++; },
    caches: world.caches, indexedDB: world.idb, fetch: world.fetch,
    crypto: { subtle: noEd25519 ? noEd25519Subtle() : webcrypto.subtle, getRandomValues: (a) => webcrypto.getRandomValues(a) },
    importScripts: (...ps) => {
      for (const p of ps) {
        const b = world.served[new URL(p, BASE).pathname.slice("/buddy/".length)];
        if (!b) throw new DOMException("import failed", "NetworkError");
        vm.runInContext(b.toString("utf8"), ctx, { filename: p });
      }
    },
    Response, Request, Headers, URL, TextEncoder, TextDecoder, atob, btoa, MessageChannel, DOMException, setTimeout, clearTimeout,
  };
  g.self = g;
  const ctx = vm.createContext(g);
  vm.runInContext(sw || world.served["sw.js"].toString("utf8"), ctx, { filename: "sw.js" });
  w.g = g;
  return w;
}
const lifecycle = (w, type) => { const e = { p: null, waitUntil(p) { this.p = p; } }; for (const f of w.listeners[type] || []) f(e); return e.p; };
const install = (w) => lifecycle(w, "install");
const activate = (w) => lifecycle(w, "activate");
async function get(w, path, { mode = "no-cors", method = "GET", origin = ORIGIN } = {}) {
  const e = { request: { url: origin + path, method, mode }, r: undefined, respondWith(p) { this.r = p; } };
  for (const f of w.listeners.fetch || []) f(e);
  return e.r === undefined ? null : await e.r;
}
function message(w, data) {
  return new Promise((ok) => {
    const e = { data, ports: [{ postMessage: ok }], waitUntil() {} };
    for (const f of w.listeners.message || []) f(e);
  });
}
async function rejects(p, part) {
  let err = null;
  try { await p; } catch (e) { err = e; }
  check(err, "the install was refused");
  if (part) check(String(err.message).includes(part), "refused because " + part + " (got: " + err.message + ")");
  return err;
}

// ---------- the sites ----------
const K = L.keygen("release"), K2 = L.keygen("other");
const t1 = L.tree(K);                                  // (the public copy's real web/solo/*)
const site1 = L.build(t1, 1); L.sign(site1, K);
const site2 = L.build(t1, 2); L.sign(site2, K);
const site3 = L.build(t1, 3); L.sign(site3, K);
const files1 = L.files(site1);
const FILES = JSON.parse(/^const FILES = (\[.*\]);$/m.exec(files1["sw.js"].toString())[1]);

async function v1World(opts = {}) {                    // v1 installed and running
  const world = new World().serve(site1), w1 = worker(world, opts);
  await install(w1); await activate(w1);
  return { world, w1 };
}
async function stillV1(world, w1, v) {
  const m = world.meta();
  check(m.active === 1 && m.maxVersion === 1, "still on v1 (" + JSON.stringify(m) + ")");
  check(await world.caches.has("buddy-site-v1"), "v1's cache kept");
  check(!(await world.caches.has("buddy-site-v" + v)), "no cache for v" + v);
  const r = await get(w1, "/buddy/app.js");
  check(r && Buffer.from(await r.arrayBuffer()).equals(files1["app.js"]), "v1's files still served");
  const i = await message(w1, { type: "info" });
  check(i.v === 1 && i.failed && i.failed.v === v, "About can say v" + v + " couldn't be verified (" + JSON.stringify(i.failed) + ")");
}
function variant(base, fn) { const d = L.copy(base); fn(d); return d; }

await T("first install: signature checked with the baked-in key, every file kept, the key pinned", async () => {
  const world = new World().serve(site1), w = worker(world);
  await install(w);
  check(w.skipped === 1, "the first install doesn't wait");
  const c = world.caches.m.get("buddy-site-v1");
  check(c && FILES.every((p) => c.has(BASE + p)) && c.size === FILES.length, "exactly the release's files cached");
  for (const p of FILES) check(c.get(BASE + p).body.equals(files1[p]), p + " cached byte for byte");
  for (const p of ["sw.js", "version.json", "404.html", "site-manifest.json"]) check(!c.has(BASE + p), p + " isn't cached");
  check(FILES.includes("solo/engine.js") && FILES.includes("index.html") && FILES.includes("vendor/tinfoil.js"), "the solo engine, page and SDK are kept");
  let m = world.meta();
  check(m.signer === K.b64 && m.pending.v === 1 && !m.active, "signer pinned, v1 pending");
  await activate(w);
  m = world.meta();
  check(m.active === 1 && m.maxVersion === 1 && m.selfHash === L.sha256(files1["sw.js"]), "active v1, its sw.js hash kept");
  check(m.fingerprint === L.sha256(files1["site-manifest.json"]).slice(0, 16), "the manifest's fingerprint kept");
  check(w.claimed === 1, "the open page is taken over");
  check(world.requests.every((u) => u.startsWith(BASE)), "only this site was fetched");
});

await T("serving: the verified copy with the site's headers; /api and other paths never leave; Tinfoil untouched", async () => {
  const { w1 } = await v1World();
  for (const [path, mode] of [["/buddy/", "navigate"], ["/buddy/index.html", "navigate"], ["/buddy/phone", "navigate"], ["/buddy/", "no-cors"]]) {
    const r = await get(w1, path, { mode });
    check(r && r.status === 200, path + " served");
    const html = await r.text();
    check(html.includes('<meta name="buddy-site" content="solo">'), path + " is the site's page");
    const csp = r.headers.get("content-security-policy");
    check(csp.endsWith("; frame-ancestors 'none'") && csp.includes("connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh;"), "CSP header without a relay: " + csp);
    check(!csp.includes("__RELAY__") && !html.includes("__RELAY__"), "no placeholder left once served (" + path + ")");
    check(r.headers.get("x-content-type-options") === "nosniff" && r.headers.get("referrer-policy") === "no-referrer"
      && r.headers.get("permissions-policy") === "camera=(self), microphone=(self), geolocation=()" && r.headers.get("cache-control") === "no-store"
      && r.headers.get("content-type").startsWith("text/html"), "the other headers");
  }
  for (const p of FILES.filter((p) => p !== "index.html")) {
    const r = await get(w1, "/buddy/" + p);
    check(r && r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(files1[p]), p + " from the cache");
    check(r.headers.get("content-security-policy").includes("frame-ancestors 'none'") && r.headers.get("x-content-type-options") === "nosniff", p + " has the headers");
  }
  check((await get(w1, "/buddy/app.js")).headers.get("content-type").startsWith("text/javascript"), "scripts as JavaScript");
  check((await get(w1, "/buddy/vendor/tinfoil.js")).headers.get("content-type").startsWith("text/javascript"), "the SDK as JavaScript");
  for (const p of ["/buddy/api/status", "/api/chat", "/other/thing", "/buddy/404.html", "/buddy/nope.js"]) {
    const r = await get(w1, p);
    check(r && r.status === 404 && (await r.json()).error === "not in Buddy for phones", p + " -> a local 404");
  }
  const post = await get(w1, "/buddy/api/chat", { method: "POST" });
  check(post && post.status === 404, "a POST never leaves");
  for (const p of ["/buddy/version.json", "/buddy/site-manifest.json", "/buddy/site-manifest.json.sig", "/buddy/sw.js"])
    check((await get(w1, p)) === null, p + " goes to the network, fresh");
  check((await get(w1, "/v1/chat/completions", { origin: "https://inference.tinfoil.sh" })) === null, "Tinfoil is never intercepted");
  check((await get(w1, "/v1/x", { origin: "https://relay.example.net" })) === null, "nor the relay");
  const deep = await get(w1, "/buddy/a/b", { mode: "navigate" });
  check(deep.status === 302 && deep.headers.get("location") === BASE, "a deeper path goes to the root");
});

await T("__RELAY__: filled only with a plain https origin, the same in the meta tag and the header", async () => {
  const { world, w1 } = await v1World();
  const page = async () => { const r = await get(w1, "/buddy/", { mode: "navigate" }); return { csp: r.headers.get("content-security-policy"), html: await r.text() }; };
  const ok = await message(w1, { type: "relay", origin: "https://relay.example.net" });
  check(ok.ok && ok.origin === "https://relay.example.net", "a valid relay saved");
  let p = await page();
  check(p.csp.includes("https://inference.tinfoil.sh https://relay.example.net;"), "header has it: " + p.csp);
  check(p.html.includes("https://inference.tinfoil.sh https://relay.example.net; worker-src"), "meta has it");
  check(world.meta("relay").origin === "https://relay.example.net", "kept in the worker's database");
  for (const bad of ["http://relay.example.net", "https://relay.example.net/", "https://relay.example.net/v1", "https://a.test; script-src *",
    "https://a.test 'unsafe-inline'", "https://*.example.net", "https://user@a.test", "https://a.test:99999", "https://A.TEST", "https://localhost",
    "https://a.test\"><script>", "javascript:alert(1)", "relay.example.net", "https://a..test", 42, null]) {
    const r = await message(w1, { type: "relay", origin: bad });
    check(!r.ok, "refused: " + JSON.stringify(bad));
  }
  p = await page();
  check(p.csp.includes("https://relay.example.net;") && !/script-src \*|unsafe-inline'[^;]*connect/.test(p.csp), "the good one stays");
  check((await message(w1, { type: "relay", origin: "https://relay.example.net:8443" })).ok, "a port is fine");
  check((await page()).csp.includes("https://relay.example.net:8443;"), "with its port");
  const w1b = worker(world);                           // (a worker that slept: it reads the database again)
  check((await get(w1b, "/buddy/", { mode: "navigate" })).headers.get("content-security-policy").includes("https://relay.example.net:8443;"), "remembered after a restart");
  check((await message(w1, { type: "relay", origin: "" })).ok, "cleared with \"\"");
  p = await page();
  check(p.csp.includes("https://inference.tinfoil.sh; worker-src") && !p.csp.includes("relay"), "no relay any more");
  await world.idb.dbs.get("buddy-site-sw").stores.get("meta").data.set("relay", { k: "relay", origin: "https://evil.test; script-src *" });
  const w1c = worker(world);
  check(!(await get(w1c, "/buddy/", { mode: "navigate" })).headers.get("content-security-policy").includes("evil"), "a bad value in the database is never used");
});

await T("update: a newer signed version installs, waits, is never applied during a call, then replaces the old", async () => {
  const { world, w1 } = await v1World();
  world.serve(site2);
  const chk = await message(w1, { type: "check" });
  check(chk.ok && chk.newer === 2 && world.updates === 1, "the check found v2 and asked the browser for the new sw.js (" + JSON.stringify(chk) + ")");
  const w2 = worker(world);
  await install(w2);
  check(w2.skipped === 0, "v2 waits while v1 runs");
  check(world.meta().pending.v === 2 && world.meta().active === 1, "v2 pending");
  const old = await get(w1, "/buddy/app.js");
  check(Buffer.from(await old.arrayBuffer()).equals(files1["app.js"]), "the open page still gets v1");
  check((await message(w1, { type: "info" })).pending.v === 2, "info says v2 is ready");
  const before = w1.skipped;                           // (1: its own first install)
  check(!(await message(w1, { type: "apply" })).ok && w1.skipped === before, "the running v1 has nothing to apply");
  world.pages = [{ postMessage: (m, [port]) => port.postMessage({ call: true, idle: false }) }, { postMessage: (m, [port]) => port.postMessage({ call: false, idle: true }) }];
  const during = await message(w2, { type: "apply" });
  check(!during.ok && during.why === "call" && w2.skipped === 0, "refused while a page is in a call");
  world.pages = [{ postMessage: (m, [port]) => port.postMessage({ call: false, idle: true }) }, { postMessage() { /* a page that doesn't answer */ } }];
  const after = await message(w2, { type: "apply" });
  check(after.ok && w2.skipped === 1, "applied once no page is in a call");
  await activate(w2);
  const m = world.meta();
  check(m.active === 2 && m.maxVersion === 2 && m.pending === null && m.selfHash === L.sha256(L.files(site2)["sw.js"]), "v2 active");
  check(!(await world.caches.has("buddy-site-v1")) && (await world.caches.has("buddy-site-v2")), "v1's cache dropped only now");
  world.pages = [];
});

await T("a newer release installing while the older waiting one is applied keeps its cache, and takes over with every file", async () => {
  const { world } = await v1World();
  world.serve(site2);
  const w2 = worker(world); await install(w2);          // v2 waits
  world.serve(site3);
  const w3 = worker(world);
  let release = null;
  const paused = new Promise((ok) => {                  // v3 stops in the middle of keeping its files
    world.caches.hold = async (n) => { if (n !== "buddy-site-v3") return; world.caches.hold = null; ok(); await new Promise((r) => { release = r; }); };
  });
  const i3 = install(w3);
  await paused;
  check((await message(w2, { type: "apply" })).ok, "v2 applied (all pages closed would do the same)");
  await activate(w2);
  check(await world.caches.has("buddy-site-v3"), "v2's activation leaves the newer release's cache alone");
  check(!(await world.caches.has("buddy-site-v1")), "and drops the older one");
  release(); await i3;
  let m = world.meta();
  check(m.active === 2 && m.pending && m.pending.v === 3, "v3 installed and waiting (" + JSON.stringify(m) + ")");
  check((await message(w3, { type: "apply" })).ok, "v3 applied");
  await activate(w3);
  check((await world.caches.has("buddy-site-v3")) && !(await world.caches.has("buddy-site-v2")), "only older caches go");
  const c = world.caches.m.get("buddy-site-v3"), f3 = L.files(site3);
  check(FILES.every((p) => c.has(BASE + p) && c.get(BASE + p).body.equals(f3[p])), "v3's cache whole");
  world.serve(variant(site3, (d) => appendFileSync(join(d, "app.js"), "\n// changed on the host")));
  const r = await get(w3, "/buddy/app.js");
  check(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(f3["app.js"]) && r.headers.get("content-security-policy").includes("frame-ancestors"),
    "the verified copy with its headers, not the host's");
  m = world.meta();
  check(m.active === 3 && m.pending === null && m.selfHash === L.sha256(f3["sw.js"]) && m.fingerprint === L.sha256(f3["site-manifest.json"]).slice(0, 16),
    "About shows v3's own sw.js hash and fingerprint");
});

await T("a newer release that finished installing before the older one's activate ran still waits, and can be applied", async () => {
  const { world } = await v1World();
  world.serve(site2);
  const w2 = worker(world); await install(w2);
  check((await message(w2, { type: "apply" })).ok, "v2 promoted");
  world.serve(site3);
  const w3 = worker(world); await install(w3);          // (v3 installed before v2's activate handler ran)
  await activate(w2);
  let m = world.meta();
  check(m.active === 2 && m.pending && m.pending.v === 3, "v3's pending kept (" + JSON.stringify(m) + ")");
  check((await message(w2, { type: "info" })).pending.v === 3, "About says v3 is ready");
  check((await message(w3, { type: "apply" })).ok, "Update now still works");
  await activate(w3);
  m = world.meta();
  const f3 = L.files(site3);
  check(m.active === 3 && m.maxVersion === 3 && m.selfHash === L.sha256(f3["sw.js"]) && m.fingerprint === L.sha256(f3["site-manifest.json"]).slice(0, 16), "v3's own hashes");
  check((await world.caches.has("buddy-site-v3")) && !(await world.caches.has("buddy-site-v2")) && !(await world.caches.has("buddy-site-v1")), "caches");
});

await T("apply waits while a newer release is still being checked", async () => {
  const { world } = await v1World();
  world.serve(site2);
  const w2 = worker(world); await install(w2);
  w2.g.registration.installing = { state: "installing" };
  const r = await message(w2, { type: "apply" });
  check(!r.ok && w2.skipped === 0, "refused: " + JSON.stringify(r));
  w2.g.registration.installing = null;
  check((await message(w2, { type: "apply" })).ok, "then applied");
});

await T("the cache cleared: checked again from the site before anything is served; never unchecked bytes; offline, a local note", async () => {
  const { world, w1 } = await v1World();
  await world.caches.delete("buddy-site-v1");
  world.serve(variant(site1, (d) => appendFileSync(join(d, "app.js"), "\n// changed on the host")));
  let r = await get(w1, "/buddy/app.js");
  check(r.status === 503 && !Buffer.from(await r.arrayBuffer()).toString().includes("changed on the host"), "a changed file is never served");
  r = await get(w1, "/buddy/", { mode: "navigate" });
  const note = await r.text();
  check(r.status === 503 && note.includes("couldn't check its files") && !note.includes("buddy-site"), "the page: a local note, not the host's page");
  check(r.headers.get("content-security-policy").endsWith("frame-ancestors 'none'") && r.headers.get("x-content-type-options") === "nosniff", "with the headers");
  check(!(await world.caches.has("buddy-site-v1")), "nothing kept from a copy that doesn't match");
  world.serve(site2);                                   // (the site moved on: this release can't be checked from it)
  check((await get(w1, "/buddy/app.js")).status === 503, "another release on the site: refused");
  world.serve(site1);
  r = await get(w1, "/buddy/app.js");
  check(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(files1["app.js"]), "the release's own files, checked, then served");
  const c = world.caches.m.get("buddy-site-v1");
  check(c && FILES.every((p) => c.has(BASE + p) && c.get(BASE + p).body.equals(files1[p])), "and kept again, whole");
  c.delete(BASE + "solo/engine.js");                    // (incomplete)
  world.offline = true;
  r = await get(w1, "/buddy/solo/engine.js");
  check(r.status === 503, "incomplete and offline: not served");
  r = await get(w1, "/buddy/", { mode: "navigate" });
  check(r.status === 200 && (await r.text()).includes('<meta name="buddy-site" content="solo">'), "files still there are served from the cache");
  await world.caches.delete("buddy-site-v1");
  r = await get(w1, "/buddy/", { mode: "navigate" });
  check(r.status === 503 && (await r.text()).includes("couldn't check its files"), "offline with no cache: the local note");
  world.offline = false;
  r = await get(w1, "/buddy/solo/engine.js");
  check(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(files1["solo/engine.js"]), "back online: repaired");
});

const refusals = [
  ["a bad signature (manifest changed after signing)", () => variant(site2, (d) => appendFileSync(join(d, "site-manifest.json"), " ")), "signature doesn't match"],
  ["a damaged signature", () => variant(site2, (d) => { const p = join(d, "site-manifest.json.sig"); const s = readFileSync(p, "utf8").split("\n"); s[3] = s[3].slice(0, 10) + (s[3][10] === "A" ? "B" : "A") + s[3].slice(11); writeFileSync(p, s.join("\n")); }), ""],
  ["signed by another key", () => variant(site2, (d) => L.sign(d, K2)), "another key"],
  ["another key baked into sw.js (and signed by it)", () => { const s = L.build(L.tree(K2), 2); L.sign(s, K2); return s; }, "another signing key"],
  ["another namespace (git)", () => variant(site2, (d) => L.sign(d, K, "git")), "something else"],
  ["sha256 instead of sha512", () => variant(site2, (d) => L.sign(d, K, "buddy-site", ["-O", "hashalg=sha256"])), "unexpected hash"],
  ["a missing file", () => variant(site2, (d) => rmSync(join(d, "kit.json"))), "kit.json couldn't be fetched"],
  ["a missing signature", () => variant(site2, (d) => rmSync(join(d, "site-manifest.json.sig"))), "couldn't be fetched"],
  ["a file that doesn't match its hash", () => variant(site2, (d) => appendFileSync(join(d, "app.js"), "\n// changed")), "app.js doesn't match"],
  ["the solo engine changed", () => variant(site2, (d) => appendFileSync(join(d, "solo", "engine.js"), "\n// changed")), "solo/engine.js doesn't match"],
  ["a sw.js that isn't the signed one", () => variant(site2, (d) => appendFileSync(join(d, "sw.js"), "\n// changed")), "isn't the signed one"],
  ["a manifest for another version", () => variant(site2, (d) => { for (const f of ["site-manifest.json", "site-manifest.json.sig"]) writeFileSync(join(d, f), readFileSync(join(site3, f))); }), "manifest is for v3"],
  ["a manifest that isn't the public edition", () => variant(site2, (d) => {
    const p = join(d, "site-manifest.json"), m = JSON.parse(readFileSync(p, "utf8")); m.edition = "private";
    writeFileSync(p, JSON.stringify(m)); L.sign(d, K); }), "damaged manifest"],
  ["a file the manifest doesn't list", () => variant(site2, (d) => {
    const p = join(d, "site-manifest.json"), m = JSON.parse(readFileSync(p, "utf8")); delete m.files["site.json"];
    writeFileSync(p, JSON.stringify(m)); L.sign(d, K); }), "site.json isn't in the manifest"],
];
for (const [name, make, why] of refusals) {
  await T("refused, v1 kept: " + name, async () => {
    const { world, w1 } = await v1World();
    world.serve(make());
    await rejects(install(worker(world)), why);
    await stillV1(world, w1, 2);
  });
}

await T("no downgrade: an older or the same version, even signed, is refused once v2 ran", async () => {
  const { world } = await v1World();
  world.serve(site2);
  const w2 = worker(world); await install(w2); await message(w2, { type: "apply" }); await activate(w2);
  world.serve(site1);
  await rejects(install(worker(world)), "isn't newer than v2");
  const t2 = L.tree(K, { change: (t) => appendFileSync(join(t, "web", "solo", "engine.js"), "// another build of v2\n") });
  const again = L.build(t2, 2); L.sign(again, K);
  world.serve(again);
  await rejects(install(worker(world)), "isn't newer than v2");
  const m = world.meta();
  check(m.active === 2 && m.maxVersion === 2 && (await world.caches.has("buddy-site-v2")), "v2 kept");
  world.serve(site1);
  const chk = await message(w2, { type: "check" });
  check(chk.ok && chk.newer === null && world.updates === 0, "a check of an older version.json does nothing");
});

await T("the update check reports a bad newer version at once and doesn't ask for it", async () => {
  const { world, w1 } = await v1World();
  world.serve(variant(site2, (d) => L.sign(d, K2)));
  const r = await message(w1, { type: "check" });
  check(!r.ok && r.failed === 2 && world.updates === 0, "refused before the browser fetches it (" + JSON.stringify(r) + ")");
  check(world.meta().failed.v === 2, "kept for About");
  check((await message(w1, { type: "info" })).failed.v === 2, "info says so");
  world.serve(site1);
  const same = await message(w1, { type: "check" });
  check(same.ok && same.newer === null, "nothing newer: nothing to do");
});

await T("WebCrypto without Ed25519: the pinned noble-ed25519 checks the signature", async () => {
  const world = new World().serve(site1), w = worker(world, { noEd25519: true });
  check(w.g.nobleEd25519 && w.g.nobleEd25519.version === "2.3.0", "vendor/ed25519.js loaded");
  await install(w); await activate(w);
  check(world.meta().active === 1, "installed through noble");
  world.serve(variant(site2, (d) => L.sign(d, K2)));
  await rejects(install(worker(world, { noEd25519: true })), "another key");
  world.serve(variant(site2, (d) => appendFileSync(join(d, "site-manifest.json"), " ")));
  await rejects(install(worker(world, { noEd25519: true })), "signature doesn't match");
  world.serve(site2);
  const w2 = worker(world, { noEd25519: true });
  await install(w2);
  check(world.meta().pending.v === 2, "a good update through noble too");
});

await T("no way to check a signature (no Ed25519, no noble): nothing installs", async () => {
  const world = new World().serve(variant(site1, (d) => rmSync(join(d, "vendor", "ed25519.js"))));
  await rejects(install(worker(world, { noEd25519: true })), "can't check signatures");
  check(!(await world.caches.has("buddy-site-v1")) && !world.meta().active && !world.meta().signer, "nothing kept, no key pinned");
});

await T("no database (private browsing, a broken store): nothing installs, so no pin or version check is skipped", async () => {
  const world = new World().serve(site1);
  world.idb = { open() { const r = {}; setTimeout(() => { r.error = new DOMException("no", "UnknownError"); if (r.onerror) r.onerror(); }, 0); return r; } };
  await rejects(install(worker(world)));
  check(!(await world.caches.has("buddy-site-v1")), "nothing cached");
});

await T("the unbuilt source never installs (no version, files or key baked in)", async () => {
  const world = new World().serve(site1);
  await rejects(install(worker(world, { sw: readFileSync(join(L.REPO, "web", "sw-site.js"), "utf8") })), "no signing key");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
