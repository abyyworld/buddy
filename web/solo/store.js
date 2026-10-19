// Buddy for phones: what this device keeps (SPEC3 §6), IndexedDB "buddy-site" version 1. Part of window.BuddySoloLib.
// This file holds the site's only indexedDB.open (CI counts it). Everything with content is encrypted at rest with
// AES-GCM-256 under "atrest", a non-extractable key made here that never leaves this browser's storage:
//   meta  (k)    device {id, created, kind}, lid (the page's message counter), n (this device's write counter), hlc,
//                cacheSecret, and "local": this device's own preferences (sealed: they name characters)
//   keys  (k)    atrest (CryptoKey, non-extractable), kidx (HMAC CryptoKey, non-extractable: record ids and character
//                tags, so no name is readable), tinfoil {iv, ct} (this device's own Tinfoil key), acctkeys {iv, ct} (the
//                keys a recovery key gives, never the recovery key itself), canary {iv, ct} (tells a lost key apart)
//   recs  (rid)  every record {rid, kind, ck?, lid?, at?, ver, seq, dirty, enc: {iv, ct}}: enc is the record body under
//                atrest; kind is plain, ck = first 8 bytes of HMAC(kidx, character id), lid the page's id (a held message
//                has none until it's shown: then `at`, its time in ms, goes)
//   media (bid)  {bid, ct, size, pinned, usedAt}: ct is the blob's own ciphertext (its key lives only in its record)
//   out, outb, work   (made now, used once sync and background work exist)
// Never stored: anything private (put() refuses an object with private or priv set, anywhere in it), the recovery
// key, other devices' keys. Wipe: the content-free marker localStorage["buddy.site.wipe"], close, delete the database,
// remove the marker (an interrupted wipe is finished at the next start). The browser's web storage holds nothing else.
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});
  const C = () => L.bcrypto;
  const DB = "buddy-site", DB_VERSION = 1;
  const STORES = { meta: "k", keys: "k", recs: "rid", media: "bid", out: "rid", outb: "bid", work: "id" };
  const CANARY = "buddy-site at rest v1";

  let db = null, opening = null, gen = 0, atrest = null, kidx = null;

  // ---------- defence in depth: nothing private is ever written ----------
  function hasPrivate(v, depth = 0) {
    if (!v || typeof v !== "object" || depth > 8) return false;
    if (ArrayBuffer.isView(v) || Object.prototype.toString.call(v) === "[object ArrayBuffer]") return false;
    if (Array.isArray(v)) return v.some((x) => hasPrivate(x, depth + 1));
    for (const k of Object.keys(v)) {
      if ((k === "private" || k === "priv") && v[k]) return true;
      if (hasPrivate(v[k], depth + 1)) return true;
    }
    return false;
  }
  function refusePrivate(v) { if (hasPrivate(v)) { const e = new Error("private items are never stored"); e.kind = "private"; throw e; } }

  // ---------- the database ----------
  function upgrade(d) {
    for (const [name, keyPath] of Object.entries(STORES)) {
      if (d.objectStoreNames.contains(name)) continue;
      const s = d.createObjectStore(name, { keyPath });
      if (name === "recs") {
        s.createIndex("kind", "kind"); s.createIndex("cklid", ["ck", "lid"]); s.createIndex("at", "at"); s.createIndex("dirty", "dirty");
      }
    }
  }
  const complete = (d) => Object.keys(STORES).every((n) => d.objectStoreNames.contains(n));
  function openOnce(version) {
    return new Promise((ok, no) => {
      let r;
      try { r = root.indexedDB.open(...(version ? [DB, version] : [DB])); } catch (e) { no(e); return; }   // (the only opener)
      r.onupgradeneeded = () => { try { upgrade(r.result); } catch (e) { /* reported by onerror */ } };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error || new Error("storage"));
      r.onblocked = () => {};
    });
  }
  function open() {                                     // the only opener (one connection per page)
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = (async () => {
      let d = await openOnce();                       // (version 1 when new: whatever it is now otherwise)
      if (!complete(d)) {                               // (made by another part of the site first: add what's missing)
        const v = d.version + 1; d.close(); d = await openOnce(v);
      }
      d.onversionchange = () => { d.close(); if (db === d) db = null; gen++; forgetMemory(); };   // (a wipe in another tab)
      d.onclose = () => { if (db === d) db = null; };
      db = d;
      return d;
    })();
    const p = opening;
    p.then(() => { opening = null; }, () => { opening = null; });
    return p;
  }
  async function tx(names, mode, fn) {                  // fn issues the requests synchronously; -> what fn returned
    const g = gen, d = await open();
    if (g !== gen) throw new Error("wiped");
    const t = d.transaction(names, mode);
    return new Promise((ok, no) => {
      let out;
      t.oncomplete = () => ok(out);
      t.onerror = () => no(t.error || new Error("storage"));
      t.onabort = () => no(t.error || new Error("storage"));
      try { out = fn(t); } catch (e) { try { t.abort(); } catch (x) { /* over */ } no(e); }
    });
  }
  const got = (r, o, k) => { r.onsuccess = () => { o[k] = r.result; }; return o; };
  const get = (store, k) => tx([store], "readonly", (t) => got(t.objectStore(store).get(k), {}, "v")).then((o) => o.v);
  const getAll = (store) => tx([store], "readonly", (t) => got(t.objectStore(store).getAll(), {}, "v")).then((o) => o.v || []);
  const put = (store, v) => tx([store], "readwrite", (t) => { t.objectStore(store).put(v); });
  const del = (store, k) => tx([store], "readwrite", (t) => { t.objectStore(store).delete(k); });

  // ---------- start: finish a wipe, open, the at-rest keys (or say they're gone) ----------
  const WIPE_MARK = "buddy.site.wipe";                  // (spelled out where it's used, so CI can see it's the only one)
  const markSet = () => { try { root.localStorage.setItem("buddy.site.wipe", "1"); } catch (e) { /* private browsing */ } };
  const markGet = () => { try { return root.localStorage.getItem("buddy.site.wipe") === "1"; } catch (e) { return false; } };
  const markDel = () => { try { root.localStorage.removeItem("buddy.site.wipe"); } catch (e) { /* nothing to do */ } };
  function supported() {
    try {
      if (!root.indexedDB || typeof root.indexedDB.open !== "function") return false;
      if (!root.crypto || !root.crypto.subtle) return false;
      return true;
    } catch (e) { return false; }
  }
  async function init() {                               // -> {fresh, lost}; throws {kind: "private"} without storage
    if (!supported()) { const e = new Error("Buddy needs normal browsing (not Private) to keep your chats."); e.kind = "nostorage"; throw e; }
    if (markGet()) await deleteDb(4000);
    let d;
    try { d = await open(); } catch (e) { const x = new Error("Buddy needs normal browsing (not Private) to keep your chats."); x.kind = "nostorage"; throw x; }
    void d;
    const ks = {};
    await tx(["keys"], "readonly", (t) => { const s = t.objectStore("keys"); for (const k of ["atrest", "kidx", "canary"]) got(s.get(k), ks, k); });
    if (ks.atrest && ks.kidx && ks.canary) {
      try {
        const v = C().u8(await C().openBytes(ks.atrest.key, ks.canary));
        if (new TextDecoder().decode(v) !== CANARY) throw new Error("canary");
      } catch (e) { const x = new Error("This phone's copy can't be opened any more."); x.kind = "lost"; throw x; }
      atrest = ks.atrest.key; kidx = ks.kidx.key;
      return { fresh: false };
    }
    const n = await tx(["recs"], "readonly", (t) => got(t.objectStore("recs").count(), {}, "n")).then((o) => o.n || 0);
    if (n > 0) { const x = new Error("This phone's copy can't be opened any more."); x.kind = "lost"; throw x; }   // (records, no key)
    atrest = await C().newAtRest(); kidx = await C().newIndexKey();
    const canary = await C().sealBytes(atrest, new TextEncoder().encode(CANARY));
    await tx(["keys"], "readwrite", (t) => {
      const s = t.objectStore("keys");
      s.put({ k: "atrest", key: atrest }); s.put({ k: "kidx", key: kidx }); s.put({ k: "canary", ...canary });
    });
    return { fresh: true };
  }
  const ready = () => !!atrest;
  function need() { if (!atrest) throw new Error("storage isn't open"); }

  // ---------- records ----------
  const localRid = async (kind, id) => C().b64e((await C().hmac(kidx, `${kind}:${id}`)).slice(0, 16));
  const charTag = async (char) => C().b64e((await C().hmac(kidx, `char:${char}`)).slice(0, 8));
  async function row(body, opts) {                      // body {k, v, id, a, n, h, d} -> the stored row
    need(); refusePrivate(body);
    if (!body || typeof body.k !== "string" || typeof body.id !== "string") throw new Error("bad record");
    const r = { rid: await localRid(body.k, body.id), kind: body.k, ver: (opts && opts.ver) || 0, seq: 0, dirty: 1,
                enc: await C().sealJSON(atrest, body, `rec|${body.k}`) };
    if (opts && opts.char !== undefined) r.ck = await charTag(opts.char);
    if (opts && Number.isInteger(opts.lid)) r.lid = opts.lid;
    if (opts && typeof opts.at === "number") r.at = opts.at;
    return r;
  }
  async function putRecs(items, metaPut) {              // [{body, opts}] (and meta {k, ...} rows) in one transaction
    const rows = [];
    for (const it of items) rows.push(await row(it.body, it.opts));
    for (const m of metaPut || []) refusePrivate(m);
    await tx(["recs", "meta"], "readwrite", (t) => {
      const s = t.objectStore("recs"), m = t.objectStore("meta");
      for (const r of rows) s.put(r);
      for (const x of metaPut || []) m.put(x);
    });
    return rows.map((r) => r.rid);
  }
  const putRec = (body, opts, metaPut) => putRecs([{ body, opts }], metaPut);
  async function open1(r) { return { body: await C().openJSON(atrest, r.enc, `rec|${r.kind}`), rid: r.rid, lid: r.lid, at: r.at, ver: r.ver }; }
  async function getRec(kind, id) {
    need();
    const r = await get("recs", await localRid(kind, id));
    return r ? (await open1(r)).body : null;
  }
  async function allRecs(kind) {                        // [{body, rid, lid, at, ver}] (undecryptable rows are skipped, counted)
    need();
    const out = [];
    let bad = 0;
    for (const r of await getAll("recs")) {
      if (kind && r.kind !== kind) continue;
      try { out.push(await open1(r)); } catch (e) { bad++; }
    }
    out.bad = bad;
    return out;
  }
  async function delRecs(list, metaPut) {               // [[kind, id], ...] in one transaction
    need();
    const rids = [];
    for (const [k, id] of list) rids.push(await localRid(k, id));
    await tx(["recs", "meta"], "readwrite", (t) => {
      for (const r of rids) t.objectStore("recs").delete(r);
      for (const x of metaPut || []) t.objectStore("meta").put(x);
    });
  }

  async function setLids(list, metaPut) {                // [[kind, id, lid]]: a held message gets its page id when it's shown
    need();
    const rows = [];
    for (const [k, id, lid] of list) rows.push([await localRid(k, id), lid]);
    await tx(["recs", "meta"], "readwrite", (t) => {
      const s = t.objectStore("recs");
      for (const [rid, lid] of rows) { const r = s.get(rid); r.onsuccess = () => { const row = r.result; if (row) { row.lid = lid; delete row.at; s.put(row); } }; }
      for (const x of metaPut || []) { refusePrivate(x); t.objectStore("meta").put(x); }
    });
  }

  // ---------- meta (content-free; "local" preferences are sealed) ----------
  const getMeta = (k) => get("meta", k);
  async function setMeta(k, v) { refusePrivate(v); await put("meta", { ...v, k }); }
  async function getLocal() {
    const r = await get("meta", "local");
    if (!r || !r.ct) return {};
    try { return await C().openJSON(atrest, r, "local"); } catch (e) { return {}; }
  }
  async function setLocal(obj) { need(); refusePrivate(obj); await put("meta", { k: "local", ...(await C().sealJSON(atrest, obj, "local")) }); }

  // ---------- keys ----------
  async function setSecret(name, value) {               // a secret string or JSON under atrest (tinfoil, acctkeys)
    need();
    await put("keys", { k: name, ...(await C().sealJSON(atrest, value, `key|${name}`)) });
  }
  async function getSecret(name) {
    need();
    const r = await get("keys", name);
    if (!r || !r.ct) return null;
    return C().openJSON(atrest, r, `key|${name}`);
  }
  const hasSecret = async (name) => !!(await get("keys", name));
  const delSecret = (name) => del("keys", name);

  // ---------- media ----------
  async function putMedia(list) {                       // [{bid, ct, pinned?}] in one transaction
    const now = Date.now();
    await tx(["media"], "readwrite", (t) => {
      for (const m of list) t.objectStore("media").put({ bid: m.bid, ct: C().ab(m.ct), size: C().u8(m.ct).length, pinned: m.pinned ? 1 : 0, usedAt: now });
    });
  }
  async function getMedia(bid) { const r = await get("media", bid); return r && r.ct ? C().u8(r.ct) : null; }
  async function delMedia(bids) { if (!bids.length) return; await tx(["media"], "readwrite", (t) => { for (const b of bids) t.objectStore("media").delete(b); }); }
  async function usage() {                              // counts and sizes only (Settings → Storage)
    const kinds = {};
    let bytes = 0, media = 0, mediaBytes = 0;
    for (const r of await getAll("recs")) { kinds[r.kind] = (kinds[r.kind] || 0) + 1; bytes += C().u8(r.enc.ct).length; }
    for (const m of await getAll("media")) { media++; mediaBytes += m.size || 0; }
    return { kinds, bytes, media, mediaBytes };
  }

  // ---------- wipe ----------
  function forgetMemory() { atrest = null; kidx = null; }
  function deleteDb(ms) {                               // -> true once deleted; the marker goes in its onsuccess
    return new Promise((ok) => {
      let r;
      const t = setTimeout(() => ok(false), ms);
      try { r = root.indexedDB.deleteDatabase(DB); } catch (e) { clearTimeout(t); ok(false); return; }
      r.onsuccess = () => { markDel(); clearTimeout(t); ok(true); };
      r.onerror = () => { clearTimeout(t); ok(false); };
      r.onblocked = () => {};
    });
  }
  async function wipe() {                               // everything this device kept (the shell cache has no data)
    gen++;
    markSet();
    forgetMemory();
    if (db) { try { db.close(); } catch (e) { /* closed */ } db = null; }
    opening = null;
    return deleteDb(4000);
  }

  L.store = { DB, DB_VERSION, WIPE_MARK, supported, init, ready, hasPrivate, refusePrivate,
              putRec, putRecs, getRec, allRecs, delRecs, setLids, getMeta, setMeta, getLocal, setLocal,
              setSecret, getSecret, hasSecret, delSecret, putMedia, getMedia, delMedia, usage, wipe };
})(typeof window !== "undefined" ? window : globalThis);
