// Buddy's service worker: keeps a copy of the app's own code (never chats, keys or anything from /api/) so Buddy opens
// when your Mac can't be reached, and shows notifications (who and what, if you allowed that on your Mac; private chats
// never).
// The copy is taken whole (every file of one version, or none: chat.html and direct.js always match) when the page says
// your Mac has a new version, and is used only when your Mac doesn't answer: network first, 2.5 s, then the copy (for
// the next 15 s at once); a page your Mac sent gets its direct.js from your Mac too. Nothing else is ever written to
// the cache.
const SHELL = ["/phone", "/direct.js", "/pcm-tap.js", "/manifest.json", "/vendor/tinfoil.mjs",
  "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png"];   // (one to one with SHELL_FILES in buddy_server.py)
const PREFIX = "buddy-shell-";
const KEY = (u) => (["/", "/phone", "/phone/", "/chat.html"].includes(u.pathname) ? "/phone" : u.pathname);
// (memory only: lost when the worker sleeps, which costs at most one 2.5 s wait)
let downUntil = 0, navFromCacheAt = 0, downWhy = null, chain = Promise.resolve(), current = null;

// A fetch that gives up (a hung Mac never holds the worker forever), read whole: a body left unread keeps its
// connection open, and a handful of those would leave none for the rest.
async function timed(url, ms, read) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
    return { r, body: await (read === "json" ? r.json().catch(() => null) : r.blob()) };
  } finally { clearTimeout(t); }
}
async function whole(name) {                          // a cache that holds every shell file (only those are ever served)
  if (!(await caches.has(name))) return false;
  const have = new Set((await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname));
  return SHELL.every((p) => have.has(p));
}
async function currentName() {
  if (current && (await caches.has(current))) return current;
  current = null;
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && (await whole(k))) { current = k; break; }
  return current;
}
// All or nothing: every file fetched first (a 200 from this origin, not redirected; that also rules out a 304), then
// all put into the new cache, and only then the older copies deleted. Any failure keeps the old copy as it was.
async function snapshot(version) {
  const name = PREFIX + version;
  if (await whole(name)) { current = name; return; }
  const got = [];
  for (const p of SHELL) {                            // (one at a time, each kept in memory with its own headers)
    const { r, body } = await timed(p, 60000);
    if (r.status !== 200 || r.type !== "basic" || r.redirected) throw new Error("not a copy of " + p);
    got.push([p, new Response(body, { status: 200, statusText: r.statusText, headers: r.headers })]);
  }
  const again = await timed("/api/version", 10000, "json");   // (your Mac updated again meanwhile: the files may be mixed)
  if (again.r.ok && (!again.body || again.body.version !== version)) throw new Error("the version changed while copying");
  try { const c = await caches.open(name); for (const [p, r] of got) await c.put(p, r); }
  catch (e) { await caches.delete(name).catch(() => {}); throw e; }
  current = name;
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
}
async function cached(key) {
  const name = await currentName();
  return name ? (await (await caches.open(name)).match(key)) || null : null;
}

// A failed copy never fails the install: without a worker, push would stop working for every phone (the page asks for
// a copy again with {type: "refresh"} once it knows the version).
self.addEventListener("install", (e) => e.waitUntil((async () => {
  const j = await timed("/api/version", 10000, "json").then((x) => (x.r.ok ? x.body : null)).catch(() => null);
  const v = (j && typeof j.version === "string" && /^[\w.-]{1,64}$/.test(j.version) && j.version) || "v0";
  try { await snapshot(v); } catch {}
  await self.skipWaiting();
})()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname === "/sw.js"
      || u.searchParams.get("mac") === "1" || !SHELL.includes(KEY(u))) return;   // (the network, exactly as without a worker)
  const nav = req.mode === "navigate";
  e.respondWith(serve(req, KEY(u), nav, nav ? e.resultingClientId : e.clientId));
});
// Pages your Mac sent (not the copy): their direct.js comes from your Mac too, as without a worker, so a page and its
// direct.js never come from two versions. Their other files take the usual race (an SDK that waits on a Mac that
// stopped answering would hold phone mode forever). (Memory only: a worker that slept just decides per request again.)
const fromMac = new Set();
async function serve(req, key, nav, client) {
  if (!nav && key === "/direct.js" && client && fromMac.has(client)) return fetch(req);
  if (Date.now() < downUntil) {                       // your Mac just failed: the copy at once
    const hit = await cached(key);
    if (hit) { if (nav) navFromCacheAt = Date.now(); return hit; }
    return fetch(req);
  }
  const net = fetch(req);
  let timer = 0;
  const first = await Promise.race([
    net.then((r) => (r.status >= 500 ? { why: "5xx", r } : { r }), () => ({ why: "error" })),   // (a 5xx: the tailnet's
    new Promise((ok) => { timer = setTimeout(() => ok({ why: "timer" }), 2500); }),            // front door, Buddy down)
  ]);
  clearTimeout(timer);
  if (!first.why) {                                   // in time: your Mac's answer (never written to the cache)
    if (nav && client) { fromMac.add(client); if (fromMac.size > 50) fromMac.delete(fromMac.values().next().value); }
    return first.r;
  }
  // No answer in 2.5 s doesn't mean it's gone (a cold start over cellular can take longer): the page asks again for
  // longer before it chooses phone mode (downWhy "timer").
  downUntil = Date.now() + 15000;
  if (nav) { navFromCacheAt = Date.now(); downWhy = first.why; }
  const hit = await cached(key);
  if (!hit) return first.r || net;                    // (no copy yet: whatever the network gives)
  net.then((r) => r.body && r.body.cancel()).catch(() => {});   // (an answer that comes too late isn't needed)
  return hit;
}

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "refresh" && typeof d.version === "string" && /^[\w.-]{1,64}$/.test(d.version)) {
    e.waitUntil(chain = chain.then(() => snapshot(d.version)).catch(() => {}));
  } else if (d.type === "up") {                       // the page reached your Mac
    downUntil = navFromCacheAt = 0; downWhy = null;
  } else if (d.type === "info" && e.ports && e.ports[0]) {
    const port = e.ports[0];
    e.waitUntil(currentName().catch(() => null).then((n) => port.postMessage({ version: n ? n.slice(PREFIX.length) : null,
      navFromCacheAt, downUntil, downWhy })));
  }
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "Buddy", {
      body: d.body || "Buddy sent you a message", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      tag: "buddy", renotify: true, data: { url: "/phone" } }),
    self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => ["/phone", "/", "/chat.html"].includes(new URL(c.url).pathname.replace(/(.)\/$/, "$1")));
    return open ? open.focus() : self.clients.openWindow("/phone");
  }));
});
