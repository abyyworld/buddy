// A small in-memory IndexedDB and web storage: what web/direct.js uses of them, for phone mode's Node tests
// (unit_direct.mjs, parity_chat.mjs). Fake data only.
const dom = (name) => new DOMException(name, name);
const later = (fn) => setTimeout(fn, 0);
function clone(v) {
  if (v === null || typeof v !== "object") return v;
  const tag = Object.prototype.toString.call(v);
  if (tag === "[object ArrayBuffer]") return v.slice(0);
  if (ArrayBuffer.isView(v)) return new v.constructor(v);
  if (tag === "[object CryptoKey]") return v;
  if (Array.isArray(v)) return v.map(clone);
  if (tag === "[object Object]") { const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  throw dom("DataCloneError");                           // (Blobs and such: direct.js stores ArrayBuffers only)
}
const cmp = (a, b) => (typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : typeof a === "number" ? -1 : 1);
class Req { constructor() { this.result = undefined; this.error = null; this.onsuccess = this.onerror = this.onblocked = this.onupgradeneeded = null; } }
export class FakeIDB {
  constructor() { this.dbs = new Map(); this.hang = false; this.stuckDelete = false; this.failWrites = false; this.log = []; }
  databases() { return Promise.resolve([...this.dbs.keys()].map((name) => ({ name, version: this.dbs.get(name).version }))); }
  open(name, version = 1) {
    const r = new Req(); this.log.push("open " + name);
    if (this.hang) return r;
    later(() => {
      let d = this.dbs.get(name);
      if (!d) { d = { version: 0, stores: new Map(), conns: new Set() }; this.dbs.set(name, d); }
      const c = new Conn(this, d);
      r.result = c;
      if (version > d.version) { d.version = version; c.upgrading = true; if (r.onupgradeneeded) r.onupgradeneeded({ target: r }); c.upgrading = false; }
      d.conns.add(c);
      if (r.onsuccess) r.onsuccess({ target: r });
    });
    return r;
  }
  deleteDatabase(name) {
    const r = new Req(); this.log.push("delete " + name);
    later(() => {
      const d = this.dbs.get(name);
      if (d) for (const c of [...d.conns]) if (!c.closed && c.onversionchange) c.onversionchange({});
      let told = false;
      const go = () => {
        if (this.stuckDelete) return;                    // (some iOS builds: it never finishes)
        if (d && [...d.conns].some((c) => !c.closed)) { if (!told && r.onblocked) r.onblocked({}); told = true; setTimeout(go, 5); return; }
        this.dbs.delete(name); if (r.onsuccess) r.onsuccess({ target: r });
      };
      go();
    });
    return r;
  }
  dump(name = "buddy-phone") {
    const d = this.dbs.get(name); if (!d) return null;
    const o = {};
    for (const [s, st] of d.stores) o[s] = [...st.data.values()].map(clone);
    return o;
  }
}
class Conn {
  constructor(idb, d) { this.idb = idb; this.d = d; this.closed = false; this.upgrading = false; this.onversionchange = null;
    this.objectStoreNames = { contains: (n) => d.stores.has(n) }; }
  createObjectStore(name, o) { if (!this.upgrading) throw dom("InvalidStateError"); const s = { keyPath: o.keyPath, data: new Map(), indexes: new Map() }; this.d.stores.set(name, s); return new Store(this, null, s); }
  transaction(names, mode = "readonly") {
    if (this.closed) throw dom("InvalidStateError");
    names = [].concat(names);
    for (const n of names) if (!this.d.stores.has(n)) throw dom("NotFoundError");
    return new Tx(this, names, mode);
  }
  close() { this.closed = true; this.d.conns.delete(this); }
}
class Tx {
  constructor(conn, names, mode) { this.conn = conn; this.names = names; this.mode = mode; this.q = []; this.done = false; this.error = null;
    this.oncomplete = this.onerror = this.onabort = null; later(() => this.pump()); }
  objectStore(n) { if (!this.names.includes(n)) throw dom("NotFoundError"); return new Store(this.conn, this, this.conn.d.stores.get(n)); }
  add(r, fn) { if (this.done) throw dom("TransactionInactiveError"); this.q.push([r, fn]); return r; }
  req(fn) { const r = new Req(); r.transaction = this; return this.add(r, fn); }
  pump() {
    if (this.done) return;
    if (!this.q.length) { this.done = true; if (this.oncomplete) this.oncomplete({}); return; }
    const [r, fn] = this.q.shift();
    try { r.result = fn(); } catch (e) { r.error = e; if (r.onerror) r.onerror({ target: r }); return this.abort(e); }
    try { if (r.onsuccess) r.onsuccess({ target: r }); } catch (e) { return this.abort(e); }
    later(() => this.pump());
  }
  abort(e) { if (this.done) return; this.done = true; this.error = e || dom("AbortError"); this.q = []; if (this.onerror) this.onerror({ target: this }); if (this.onabort) this.onabort({ target: this }); }
}
const entries = (s, idx) => [...s.data.entries()].sort((a, b) => (idx ? cmp(a[1][idx.keyPath], b[1][idx.keyPath]) : cmp(a[0], b[0])));
function cursor(tx, s, idx) {
  let keys = null, i = 0;
  const r = new Req();
  const step = () => {
    if (!keys) keys = entries(s, idx).map(([k]) => k);
    while (i < keys.length && !s.data.has(keys[i])) i++;
    if (i >= keys.length) return null;
    const k = keys[i++];
    return { key: k, primaryKey: k, value: clone(s.data.get(k)), continue() { tx.add(r, step); },
             delete() { return tx.req(() => { if (tx.mode === "readonly") throw dom("ReadOnlyError"); s.data.delete(k); }); } };
  };
  return tx.add(r, step);
}
class Store {
  constructor(conn, tx, s) { this.conn = conn; this.tx = tx; this.s = s; }
  createIndex(n, keyPath, o) { this.s.indexes.set(n, { keyPath, unique: !!(o && o.unique) }); }
  w(fn) { return this.tx.req(() => { if (this.tx.mode === "readonly") throw dom("ReadOnlyError"); if (this.conn.idb.failWrites) throw dom("QuotaExceededError"); return fn(); }); }
  put(v) {
    return this.w(() => {
      const k = v[this.s.keyPath];
      if (k === undefined) throw dom("DataError");
      for (const ix of this.s.indexes.values())
        if (ix.unique) for (const [k2, v2] of this.s.data) if (k2 !== k && v[ix.keyPath] !== undefined && v2[ix.keyPath] === v[ix.keyPath]) throw dom("ConstraintError");
      this.s.data.set(k, clone(v)); return k;
    });
  }
  get(k) { return this.tx.req(() => clone(this.s.data.get(k))); }
  getAll() { return this.tx.req(() => entries(this.s).map(([, v]) => clone(v))); }
  delete(k) { return this.w(() => { this.s.data.delete(k); }); }
  clear() { return this.w(() => { this.s.data.clear(); }); }
  count(k) { return this.tx.req(() => (k === undefined ? this.s.data.size : this.s.data.has(k) ? 1 : 0)); }
  openCursor() { return cursor(this.tx, this.s, null); }
  index(n) {
    const ix = this.s.indexes.get(n), tx = this.tx, s = this.s;
    return { getAll: () => tx.req(() => entries(s, ix).map(([, v]) => clone(v))), openCursor: () => cursor(tx, s, ix), count: () => tx.req(() => s.data.size) };
  }
}
export class FakeStorage {
  constructor(name) { this.m = new Map(); this.name = name; this.log = []; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.log.push(["set", k]); this.m.set(k, String(v)); }
  removeItem(k) { this.log.push(["remove", k]); this.m.delete(k); }
}
