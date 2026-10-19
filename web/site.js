// Buddy for phones (the GitHub Pages site only; the build puts it first in the page's <head>, the Mac never loads it):
// the shell's part of the page. SPEC3 §3.4-3.6.
// - Refuses to run inside a frame (the page's policy can't say frame-ancestors in a meta tag): loading stops and the
//   page only says to open Buddy in its own window.
// - Registers the site's service worker (sw.js next to this file, scope ./) and talks to it: an update check at launch
//   and every 6 hours while open; a release that finished installing waits, and is applied at the next launch (before
//   anything else starts) or with apply() ("Update now"), never while the page says a call is on; then one reload and a
//   short "Updated to vN" note. The first registration waits for the page's start() (chat.html calls it once past the
//   install gate: nothing at all is stored in iPhone Safari before Buddy runs from the Home Screen, SPEC3 §5.1); where
//   the worker already runs this page, it goes ahead at once.
// - window.BuddySite for the rest of the page: start(), info() / about() (version, manifest fingerprint, sw.js hash, and
//   a note and the release number when an update couldn't be verified or is ready; null before start()), check(),
//   apply(), setBusy(fn) (fn() -> {call, idle}: what the page is doing; the worker asks every open page before it
//   applies), relay(origin) (sync's relay for the policy, an https origin or ""), and "buddy-site" events on window
//   ({type: "ready"|"updated"|"failed", v}).
// No storage but two content-free sessionStorage entries (version numbers: before an update's reload, and the release
// last tried at launch); no console output.
"use strict";
(function () {
  const framed = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
  if (framed) {
    try { window.stop(); } catch (e) { /* (the next scripts are refused by app.js too) */ }
    const body = document.createElement("body"), p = document.createElement("p");
    p.textContent = "Open Buddy in its own window.";
    body.append(p);
    document.documentElement.replaceChildren(document.createElement("head"), body);
    window.BuddySite = Object.freeze({ framed: true });
    return;
  }
  const SIX_HOURS = 6 * 3600 * 1000;
  const sw = navigator.serviceWorker;
  const here = (document.currentScript && document.currentScript.src) || document.baseURI;
  let busy = () => ({ call: false, idle: true });
  const busyNow = () => { try { const b = busy() || {}; return { call: !!b.call, idle: b.idle !== false && !b.call }; } catch (e) { return { call: false, idle: true }; } };
  const tell = (detail) => { try { window.dispatchEvent(new CustomEvent("buddy-site", { detail })); } catch (e) { /* (old browser) */ } };
  const sess = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* (private) */ } } };

  if (!sw) {
    const none = async () => null;
    window.BuddySite = Object.freeze({ supported: false, start() {}, info: none, about: none, check: none,
      apply: async () => ({ ok: false, why: "no service worker" }), setBusy() {}, relay: none });
    return;
  }
  let hadController = !!sw.controller, reg = null, lastCheck = 0, reloading = false, running = null, started = false, begin = null;
  const scope = new URL("./", here).href;
  const ready = new Promise((ok) => { begin = ok; })   // (start(): past the install gate, or already installed here)
    .then(() => sw.register(new URL("sw.js", here).href, { scope, updateViaCache: "none" }))
    .catch(() => sw.getRegistration(scope).then((r) => r || Promise.reject(new Error("no service worker"))))   // (offline,
    .then((r) => { reg = r; watch(r); return r; });                                                         //  and register() had to fetch)
  ready.catch(() => {});
  const start = () => { if (!started) { started = true; begin(); } };
  if (hadController) start();                          // (this storage already has Buddy's worker: nothing new is kept)

  function ask(worker, msg, ms) {
    return new Promise((ok) => {
      if (!worker) return ok(null);
      const ch = new MessageChannel(), t = setTimeout(() => ok(null), ms);
      ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data || null); };
      try { worker.postMessage(msg, [ch.port2]); } catch (e) { clearTimeout(t); ok(null); }
    });
  }
  async function active() {
    if (!started) return null;
    try { await ready; } catch (e) { return null; }
    return sw.controller || (reg && reg.active) || null;
  }
  async function info() { return ask(await active(), { type: "info" }, 5000); }
  async function about() {
    const i = await info();
    if (!i) return null;
    const note = i.failed ? "An update couldn't be verified (v" + i.failed.v + "); still on v" + i.v
      : i.pending ? "Update ready (v" + i.pending.v + "): it's used the next time you open Buddy" : "";
    return { version: "v" + i.v, fingerprint: i.fingerprint, signed: "Signed by Buddy's release key", sw: i.selfHash, note,
      pending: i.pending ? i.pending.v : null, failed: i.failed ? i.failed.v : null };
  }
  async function check() {
    lastCheck = Date.now();
    const r = await ask(await active(), { type: "check" }, 120000);
    if (r && r.failed) tell({ type: "failed", v: r.failed, have: r.v });
    return r;
  }
  async function apply() {
    if (busyNow().call) return { ok: false, why: "call" };
    if (!started) return { ok: false, why: "nothing to apply" };
    try { await ready; } catch (e) { return { ok: false, why: "no service worker" }; }
    const w = reg && reg.waiting;
    if (!w) return { ok: false, why: "nothing to apply" };
    const i = await info();
    sess.set("buddy.site.from", i ? String(i.v) : null);
    const r = await ask(w, { type: "apply" }, 15000);
    if (!r || !r.ok) sess.set("buddy.site.from", null);
    return r || { ok: false, why: "no answer" };
  }
  function watch(r) {                                  // a new release installing: ready to use, or refused
    const follow = (w) => {
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && r.active) info().then((i) => tell({ type: "ready", v: i && i.pending ? i.pending.v : null }));
        if (w.state === "redundant" && !reloading) info().then((i) => { if (i && i.failed) tell({ type: "failed", v: i.failed.v, have: i.v }); });
      });
    };
    follow(r.installing);
    r.addEventListener("updatefound", () => follow(r.installing));
  }
  function reloadWhenIdle() {                          // a new release took over: one reload, never in the middle of things
    if (reloading) return;
    if (!busyNow().idle) { setTimeout(reloadWhenIdle, 2000); return; }
    reloading = true;
    location.reload();
  }
  sw.addEventListener("controllerchange", () => {
    if (!hadController) { hadController = true; return; }   // (the first install took this page over: nothing changed)
    if (running !== null && sess.get("buddy.site.from") === null) sess.set("buddy.site.from", String(running));
    reloadWhenIdle();
  });
  sw.addEventListener("message", (e) => {              // the worker asks before it applies a release
    const d = e.data || {}, port = e.ports && e.ports[0];
    if (d.type === "busy?" && port) port.postMessage(busyNow());
  });
  if (sw.startMessages) sw.startMessages();

  const settled = () => new Promise((ok) => {
    const later = () => setTimeout(ok, 3000);
    if (document.readyState === "complete") later(); else addEventListener("load", later, { once: true });
  });
  function toast(text) {
    const show = () => {
      const t = document.createElement("div");
      t.textContent = text;
      t.setAttribute("role", "status");
      Object.assign(t.style, { position: "fixed", left: "50%", bottom: "calc(90px + env(safe-area-inset-bottom))",
        transform: "translateX(-50%)", zIndex: "99", padding: "8px 14px", borderRadius: "16px", font: "14px system-ui, sans-serif",
        background: "var(--ink, #1f2834)", color: "var(--bg, #f6f3ee)", boxShadow: "0 4px 18px rgba(0,0,0,.18)" });
      document.body.append(t);
      setTimeout(() => t.remove(), 4000);
    };
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show, { once: true });
  }
  ready.then(async (r) => {
    const from = sess.get("buddy.site.from"), now = await info();
    if (now) running = now.v;                          // (what this page runs: the note after a switch says what's new)
    if (from !== null) {                               // this load follows an update's reload
      sess.set("buddy.site.from", null);
      if (now && now.v > Number(from)) { toast("Updated to v" + now.v); tell({ type: "updated", v: now.v }); }
    }
    if (r.waiting && sw.controller) {                  // a launch with a release waiting: it's used now (once a session),
      await settled();                                 // once this load is done (Chromium may hold an update for minutes
      const i = busyNow().idle ? await info() : null;  // when it's asked while the old worker is still serving one)
      const pv = i && i.pending ? String(i.pending.v) : "";
      if (pv && sess.get("buddy.site.tried") !== pv) {
        sess.set("buddy.site.tried", pv);
        const a = await apply();
        if (a && a.ok) return;
      }
    }
    await check().catch(() => null);
  }).catch(() => {});
  setInterval(() => { if (Date.now() - lastCheck >= SIX_HOURS) check().catch(() => null); }, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && lastCheck && Date.now() - lastCheck >= SIX_HOURS) check().catch(() => null);
  });

  window.BuddySite = Object.freeze({
    supported: true, start, info, about, check, apply,
    setBusy(fn) { if (typeof fn === "function") busy = fn; },
    async relay(origin) { return ask(await active(), { type: "relay", origin: String(origin == null ? "" : origin) }, 5000); },
  });
})();
