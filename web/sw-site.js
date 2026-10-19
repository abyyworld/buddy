// Buddy for phones' service worker (the GitHub Pages site only; the Mac's /phone keeps web/sw.js). SPEC3 §3.4-3.7.
// The build (scripts/build_pages.py) bakes in this release's VERSION, the FILES it keeps and SIGNER (the raw Ed25519
// key from the public copy's site-signers) and publishes it as sw.js.
// - Install: fetches site-manifest.json and its signature (no-store) and checks the SSH signature (namespace
//   "buddy-site") with the key pinned at first install (never the one in a newer sw.js), that the manifest is this
//   release and newer than any this phone ran (no downgrade, not even to an older signed release), that this script is
//   the one the manifest names, and every file's SHA-256; only then is the release's cache filled, all or nothing. Any
//   failure throws: the browser keeps the old release, and the reason is kept for Settings -> About.
// - The new release waits until the page asks for it ({type: "apply"}): the page does that only while idle, and it's
//   refused while any open page says a call is on (or while a newer release is still installing). Then older releases'
//   caches go (never a newer one's), and a newer release that finished installing meanwhile still waits.
// - Its cache gone or incomplete (cleared by the browser): this release's files are fetched again and checked as at
//   install (pinned key, this release's manifest naming this sw.js, every hash) before anything is served; if that
//   can't be done (offline, a mismatch), a local "couldn't check Buddy's files" page (503), never unchecked bytes.
// - Cache-first, always: the page and its files come from the verified cache, served with the site's CSP as a header
//   (with this device's relay, checked to be a plain https origin), no framing, nosniff, no referrer, no-store. Other
//   sites (Tinfoil, the relay) are never touched; every other request to this origin gets a local 404, so nothing meant
//   for an /api/ ever leaves the phone. Nothing but the release's own files is ever cached.
// Its own small IndexedDB (buddy-site-sw, store meta): {k: "site", signer, maxVersion, active, selfHash, fingerprint,
// pending, failed} and {k: "relay", origin}. No chats, keys or settings.
"use strict";
const VERSION = 0;                                     // (baked in by scripts/build_pages.py)
const FILES = [];
const SIGNER = "";
const PREFIX = "buddy-site-v";
const NS = "buddy-site";
const BASE = new URL("./", self.location.href);        // (the site's root: sw.js sits there, its scope is ./)
const PAGE = "index.html";
const UPDATE_FILES = ["version.json", "site-manifest.json", "site-manifest.json.sig"];   // (fetched fresh, never kept)
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh __RELAY__; " +
  "worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; " +
  "form-action 'none'; frame-src 'none'";
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json", webmanifest: "application/manifest+json", png: "image/png" };
try { importScripts("vendor/ed25519.js"); } catch (e) { /* (WebCrypto's Ed25519 is used where there is one) */ }

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (buf) => hex(await crypto.subtle.digest("SHA-256", buf));
const url = (p) => new URL(p, BASE).href;
class Refused extends Error {}
const no = (why) => { throw new Refused(why); };

// ---------- the small database ----------
function db() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open("buddy-site-sw", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("meta", { keyPath: "k" }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error || new Error("no database"));
  });
}
async function getMeta(k) {
  const d = await db();
  try {
    return await new Promise((ok, bad) => {
      const g = d.transaction("meta").objectStore("meta").get(k);
      g.onsuccess = () => ok(g.result || null); g.onerror = () => bad(g.error);
    });
  } finally { d.close(); }
}
async function editMeta(k, fn) {                       // read, change and write in one transaction
  const d = await db();
  try {
    return await new Promise((ok, bad) => {
      const tx = d.transaction("meta", "readwrite"), st = tx.objectStore("meta");
      let out = null;
      const g = st.get(k);
      g.onsuccess = () => { out = Object.assign(fn(g.result ? Object.assign({}, g.result) : {}) || {}, { k }); st.put(out); };
      tx.oncomplete = () => ok(out);
      tx.onerror = tx.onabort = () => bad(tx.error || new Error("not saved"));
    });
  } finally { d.close(); }
}

// ---------- SSH signatures (PROTOCOL.sshsig), Ed25519 only ----------
function b64bytes(s) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function reader(u) {
  let i = 0;
  const take = (n) => { if (n < 0 || i + n > u.length) no("a damaged signature"); const s = u.subarray(i, i + n); i += n; return s; };
  return {
    take,
    u32() { const b = take(4); return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0; },
    str() { return take(this.u32()); },
    text() { return new TextDecoder().decode(this.str()); },
    end() { if (i !== u.length) no("a damaged signature"); },
  };
}
function sshString(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0; for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
async function ed25519(pub, sig, data) {
  let key = null;
  try { key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]); } catch (e) { key = null; }
  if (key) return crypto.subtle.verify({ name: "Ed25519" }, key, sig, data);
  const noble = self.nobleEd25519;                     // (Safari before 17: the pinned noble-ed25519)
  if (!noble) no("this browser can't check signatures");
  return noble.verifyAsync(sig, data, pub, { zip215: false });
}
// true only for an armored SSH signature over `message` by exactly `signer` (32 raw bytes), in namespace `ns`, sha512
async function verifySig(armored, message, signer, ns) {
  const m = /^-----BEGIN SSH SIGNATURE-----\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n-----END SSH SIGNATURE-----\s*$/.exec(String(armored));
  if (!m) no("not an SSH signature");
  const r = reader(b64bytes(m[1].replace(/[\r\n]/g, "")));
  if (new TextDecoder().decode(r.take(6)) !== "SSHSIG" || r.u32() !== 1) no("not an SSH signature");
  const pk = reader(r.str());
  if (pk.text() !== "ssh-ed25519") no("not an Ed25519 signature");
  const pub = pk.str(); pk.end();
  if (pub.length !== 32 || !same(pub, signer)) no("signed by another key");
  const namespace = r.str(), reserved = r.str(), alg = r.str(), sigblob = r.str();
  r.end();
  if (new TextDecoder().decode(namespace) !== ns) no("signed for something else");
  if (new TextDecoder().decode(alg) !== "sha512") no("an unexpected hash");
  const s = reader(sigblob);
  if (s.text() !== "ssh-ed25519") no("not an Ed25519 signature");
  const sig = s.str(); s.end();
  if (sig.length !== 64) no("a damaged signature");
  const h = new Uint8Array(await crypto.subtle.digest("SHA-512", message));
  const signed = join(enc.encode("SSHSIG"), sshString(namespace), sshString(reserved), sshString(alg), sshString(h));
  return !!(await ed25519(pub, sig, signed));
}

// ---------- fetching and checking a release ----------
async function get(p) {                                // a file of this site as it is now: 200, not redirected
  const r = await fetch(url(p), { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (r.status !== 200 || r.type !== "basic") no(p + " couldn't be fetched (" + r.status + ")");
  return new Uint8Array(await r.arrayBuffer());
}
// the signed manifest, checked: {man, bytes}; `signer` = base64 of the pinned key
async function signedManifest(signer) {
  const [bytes, sig] = await Promise.all([get("site-manifest.json"), get("site-manifest.json.sig")]);
  if (!(await verifySig(new TextDecoder().decode(sig), bytes, b64bytes(signer), NS))) no("the signature doesn't match");
  let man = null;
  try { man = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { no("a damaged manifest"); }
  if (!man || !Number.isSafeInteger(man.v) || man.v < 1 || man.edition !== "public" || !man.files || typeof man.files !== "object")
    no("a damaged manifest");
  for (const [p, h] of Object.entries(man.files)) if (typeof p !== "string" || !/^[0-9a-f]{64}$/.test(String(h))) no("a damaged manifest");
  return { man, bytes };
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
async function fetchFiles(man) {                       // every file this release keeps, each checked against the manifest
  return Promise.all(FILES.map(async (p) => {
    if (!has(man.files, p)) no(p + " isn't in the manifest");
    const b = await get(p);
    if ((await sha256(b)) !== man.files[p]) no(p + " doesn't match the manifest");
    return [p, b];
  }));
}
async function fill(got) {                             // this release's cache, all or nothing (and checked: still there, whole)
  const name = PREFIX + VERSION;
  await caches.delete(name);                           // (a half-filled one from an earlier try)
  try {
    const c = await caches.open(name);
    for (const [p, b] of got) await c.put(url(p), new Response(b, { headers: { "Content-Type": type(p) } }));
    if (!(await caches.has(name))) no("the release's files couldn't be kept");
    const kept = await caches.open(name);
    for (const [p] of got) if (!(await kept.match(url(p)))) no("the release's files couldn't be kept");
  } catch (e) { await caches.delete(name).catch(() => {}); throw e; }
}
async function install() {
  const meta = (await getMeta("site")) || {};          // (no database: no install, so no pin or version is skipped)
  const signer = meta.signer || SIGNER;                // pinned at first install
  try {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(signer)) no("no signing key");
    if (SIGNER !== signer) no("this release names another signing key (a new key means installing Buddy again)");
    const { man, bytes } = await signedManifest(signer);
    if (man.v !== VERSION) no("the manifest is for v" + man.v);
    if (meta.maxVersion && !(man.v > meta.maxVersion)) no("v" + man.v + " isn't newer than v" + meta.maxVersion);
    const selfHash = await sha256(await get(self.location.href.slice(BASE.href.length)));
    if (!has(man.files, "sw.js") || man.files["sw.js"] !== selfHash) no("this sw.js isn't the signed one");
    await fill(await fetchFiles(man));
    const fingerprint = (await sha256(bytes)).slice(0, 16);
    await editMeta("site", (m) => Object.assign(m, { signer, pending: { v: VERSION, selfHash, fingerprint },
      failed: m.failed && m.failed.v > VERSION ? m.failed : null }));
  } catch (e) {
    const why = e instanceof Refused ? e.message : "it couldn't be checked";
    await editMeta("site", (m) => Object.assign(m, { failed: { v: VERSION, why, at: Date.now() } })).catch(() => {});
    throw e;
  }
  if (!meta.active) await self.skipWaiting();          // first install: there's no older release to wait for
}
const cacheVersion = (k) => { const m = /^buddy-site-v([0-9]{1,9})$/.exec(k); return m ? Number(m[1]) : null; };
async function activate() {
  await editMeta("site", (x) => {
    const p = x.pending && x.pending.v === VERSION ? x.pending : {};
    return Object.assign(x, { active: VERSION, maxVersion: Math.max(x.maxVersion || 0, VERSION),
      selfHash: p.selfHash || x.selfHash || null, fingerprint: p.fingerprint || x.fingerprint || null,
      pending: x.pending && x.pending.v > VERSION ? x.pending : null,      // (a newer release that installed meanwhile still waits)
      failed: x.failed && x.failed.v > VERSION ? x.failed : null });
  });
  for (const k of await caches.keys()) {               // only older releases' caches: a newer one may still be installing
    const v = cacheVersion(k);
    if (v !== null && v < VERSION) await caches.delete(k);
  }
  await self.clients.claim();
}
self.addEventListener("install", (e) => e.waitUntil(install()));
self.addEventListener("activate", (e) => e.waitUntil(activate()));

// ---------- serving ----------
function type(p) { return TYPES[(/\.([a-z]+)$/.exec(p) || [])[1]] || "application/octet-stream"; }
function validRelay(s) {                               // only an https origin (host, maybe a port): nothing that could break the policy
  if (typeof s !== "string" || s.length > 200) return "";
  const m = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?::([0-9]{1,5}))?$/.exec(s);
  if (!m || (m[2] && (+m[2] < 1 || +m[2] > 65535))) return "";
  return s;
}
let relayNow = null;                                   // (memory: read again after the worker sleeps)
async function relay() {
  if (relayNow === null) relayNow = validRelay(((await getMeta("relay").catch(() => null)) || {}).origin);
  return relayNow;
}
const policy = (r) => (r ? CSP.replace("__RELAY__", r) : CSP.replace(" __RELAY__", ""));
function headers(p, r) {
  return { "Content-Type": type(p), "Content-Security-Policy": policy(r) + "; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()", "Cache-Control": "no-store" };
}
async function cached(p) {
  const name = PREFIX + VERSION;
  if (!(await caches.has(name))) return null;
  return (await (await caches.open(name)).match(url(p))) || null;
}
// This release's cache is gone or incomplete (the browser cleared it, or it was never whole): the same files fetched
// again and checked as at install, against the key pinned then and this release's own manifest (the one that names this
// running sw.js), then kept; never served from the network unchecked
let repairing = null;
function repair() {
  if (!repairing) repairing = (async () => {
    const meta = (await getMeta("site")) || {};
    if (!meta.signer || meta.signer !== SIGNER || meta.active !== VERSION) no("this release isn't the one installed here");
    const { man } = await signedManifest(meta.signer);
    if (man.v !== VERSION) no("the site has another release now");
    if (!has(man.files, "sw.js") || (meta.selfHash && man.files["sw.js"] !== meta.selfHash)) no("this sw.js isn't the signed one");
    await fill(await fetchFiles(man));
  })().finally(() => { repairing = null; });
  return repairing;
}
const UNCHECKED = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, " +
  "initial-scale=1\"><title>Buddy</title></head><body style=\"font: 16px system-ui, sans-serif; margin: 40px 16px; text-align: center\">" +
  "<p>Buddy couldn't check its files, so it didn't open them.</p><p>Connect to the internet, then close Buddy and open it again.</p>" +
  "<p><a href=\"./\">Try again</a></p></body></html>";
function unchecked(p) {                                // instead of files that couldn't be checked: never the network's bytes
  if (p === PAGE) return new Response(UNCHECKED, { status: 503, headers: headers(PAGE, "") });
  return new Response("Buddy couldn't check this file.", { status: 503, headers: Object.assign(headers(p, ""), { "Content-Type": "text/plain; charset=utf-8" }) });
}
async function serve(req, p) {
  let hit = await cached(p);
  if (!hit) {
    try { await repair(); hit = await cached(p); } catch (e) { hit = null; }
    if (!hit) return unchecked(p);
  }
  const r = await relay();
  if (p === PAGE) {                                    // the page's own policy gets the same relay as the header
    const html = (await hit.text()).replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*?) ?__RELAY__/, (_, a) => (r ? a + " " + r : a));
    return new Response(html, { status: 200, headers: headers(p, r) });
  }
  return new Response(await hit.arrayBuffer(), { status: 200, headers: headers(p, r) });   // (whole: a body the page never
                                                       // reads to the end would keep this worker busy, and an update waiting)
}
function notHere() {
  return new Response(JSON.stringify({ error: "not in Buddy for phones" }),
    { status: 404, headers: Object.assign(headers("x.json", ""), { "Content-Type": "application/json" }) });
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  let u = null;
  try { u = new URL(req.url); } catch (err) { return; }
  if (u.origin !== self.location.origin) return;       // Tinfoil and the relay: never touched
  let rel = null;
  try { rel = u.pathname.startsWith(BASE.pathname) ? decodeURIComponent(u.pathname.slice(BASE.pathname.length)) : null; }
  catch (err) { rel = null; }
  if (rel !== null && (rel === "sw.js" || UPDATE_FILES.includes(rel)) && req.method === "GET") return;   // (always fresh)
  if (rel === null || (req.method !== "GET" && req.method !== "HEAD")) return e.respondWith(notHere());
  if (req.mode === "navigate") {
    if (FILES.includes(rel)) return e.respondWith(serve(req, rel));
    if (rel.includes("/")) return e.respondWith(Response.redirect(BASE.href, 302));   // (relative links need the root)
    return e.respondWith(serve(req, PAGE));            // the app at the root (or one level down: ./ is still the root)
  }
  if (rel === "") return e.respondWith(serve(req, PAGE));
  if (FILES.includes(rel)) return e.respondWith(serve(req, rel));
  e.respondWith(notHere());
});

// ---------- the page ----------
function ask(client, msg, ms) {                        // a question to an open page, null if it doesn't answer
  return new Promise((ok) => {
    const ch = new MessageChannel(), t = setTimeout(() => ok(null), ms);
    ch.port1.onmessage = (ev) => { clearTimeout(t); ok(ev.data || null); };
    try { client.postMessage(msg, [ch.port2]); } catch (err) { clearTimeout(t); ok(null); }
  });
}
async function inCall() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const said = await Promise.all(list.map((c) => ask(c, { type: "busy?" }, 1500)));
  return said.some((a) => a && a.call);
}
async function info() {
  const m = (await getMeta("site").catch(() => null)) || {};
  return { site: true, v: VERSION, max: m.maxVersion || 0, selfHash: m.selfHash || null, fingerprint: m.fingerprint || null,
    pending: m.pending && m.pending.v > VERSION ? m.pending : null, failed: m.failed && m.failed.v > VERSION ? m.failed : null,
    relay: await relay() };
}
// version.json says a newer release is out: its signed manifest is checked here first (a bad one is reported at
// once), then the browser is asked to fetch the new sw.js, whose install checks everything again
async function check() {
  const m = (await getMeta("site").catch(() => null)) || {};
  const have = Math.max(m.maxVersion || 0, VERSION);
  const vj = JSON.parse(new TextDecoder().decode(await get("version.json")));
  const v = vj && vj.v;
  if (!Number.isSafeInteger(v) || v < 1) no("a damaged version.json");
  if (v <= have) return { ok: true, v: VERSION, newer: null };
  try {
    const { man } = await signedManifest(m.signer || SIGNER);
    if (man.v !== v) no("version.json and the manifest disagree");
  } catch (e) {
    const why = e instanceof Refused ? e.message : "it couldn't be checked";
    await editMeta("site", (x) => Object.assign(x, { failed: { v, why, at: Date.now() } })).catch(() => {});
    return { ok: false, v: VERSION, failed: v, why };
  }
  await self.registration.update();
  return { ok: true, v: VERSION, newer: v };
}
async function apply() {
  const m = (await getMeta("site").catch(() => null)) || {};
  if (m.active === VERSION || !(m.pending && m.pending.v === VERSION)) return { ok: false, why: "nothing to apply" };
  if (self.registration && self.registration.installing) return { ok: false, why: "a newer release is being checked" };
  if (await inCall()) return { ok: false, why: "call" };   // never during a call, on any open page
  self.skipWaiting().catch(() => {});                  // (it takes over once the old release has nothing in hand)
  return { ok: true, v: VERSION };
}
async function setRelay(origin) {
  const o = origin === "" ? "" : validRelay(origin);
  if (origin !== "" && !o) return { ok: false, error: "a relay must be an https origin (host and maybe a port)" };
  await editMeta("relay", () => ({ origin: o }));
  relayNow = o;
  return { ok: true, origin: o };
}
self.addEventListener("message", (e) => {
  const d = e.data || {}, port = e.ports && e.ports[0];
  const reply = (v) => { try { if (port) port.postMessage(v); } catch (err) { /* (the page went away) */ } };
  const run = (p) => e.waitUntil(p.then(reply, (err) => reply({ ok: false, why: err instanceof Refused ? err.message : "failed" })));
  if (d.type === "info") run(info());
  else if (d.type === "check") run(check());
  else if (d.type === "apply") run(apply());
  else if (d.type === "relay") run(setRelay(d.origin));
});
