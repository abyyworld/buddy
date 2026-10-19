// Account: one Durable Object (SQLite) per sync account, named by the account id. It keeps the account's encrypted
// records (overwritten in place: no history), its devices (only SHA-256 of each device's token), a little bookkeeping,
// and the index of its blobs (the blobs themselves are in R2 at <acct>/<bid>). A DO runs one request at a time between
// awaits, so seq and compare-and-swap are exact without locks. Nothing here can decrypt anything.
// Same behaviour as ref.py; README.md "Protocol" is the contract.

import {
  LIMITS, limitsFrom, RE, MIN, HOUR, DAY, b64d, b64e, same, sha256, acctOf, recordSizeOk, blobSizeOk,
  inviteKey, checkInvite, err, json, slowDown, readBody, parseJSON, internal,
} from "./common.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (rid TEXT PRIMARY KEY, ver INTEGER NOT NULL, seq INTEGER NOT NULL, ct BLOB,
                                    deleted_at INTEGER);
CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
CREATE INDEX IF NOT EXISTS records_deleted ON records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS devices (dev TEXT PRIMARY KEY, token_hash BLOB NOT NULL, added INTEGER, by TEXT, seen INTEGER,
                                    endpoint TEXT, revoked INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v BLOB);
CREATE TABLE IF NOT EXISTS blobs (bid TEXT PRIMARY KEY, rid TEXT, size INTEGER, at INTEGER);`;

const READ_ONLY = (m) => err(409, "read-only", { delete_at: m.delete_at });
const MiB = 1024 * 1024;
function bodyMax(path) {                 // the largest body each route takes (worker.js checks Content-Length too)
  if (path === "/") return 2 * MiB;
  if (path === "/put") return 3 * MiB;
  if (path === "/devices" || path === "/blob/copy") return 64 * 1024;
  if (path.startsWith("/blob/")) return LIMITS.blob_max + 28;
  return 0;
}

export class Account {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.lim = limitsFrom(env);
    this.m = null;                       // meta, cached
    this.fails = new Map();              // ip hash -> {t, n}: failed sign-ins (memory only)
    this.win = { t: -1, n: 0 };          // signed-in requests this minute
    this.busy = false;                   // an account being created
  }

  now() { return Date.now(); }

  // ---- bookkeeping
  load() {
    if (this.m) return this.m;
    if (!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length) return null;
    const m = {};
    for (const r of this.sql.exec("SELECT k, v FROM meta")) m[r.k] = r.v;
    return m.created ? (this.m = m) : null;
  }
  set(k, v) {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
    if (this.m) this.m[k] = v;
  }
  add(k, d) { this.set(k, (this.m[k] || 0) + d); }

  // ---- the front door
  async fetch(req) {
    try { return await this.route(req); } catch { return err(500, "server"); }
  }

  async route(req) {
    const path = new URL(req.url).pathname, method = req.method;
    if (req.headers.get("x-buddy-internal") === "1") {
      if (path === "/_blobs") return this.blobsFor(req);
      return err(404, "not found");
    }
    const acct = req.headers.get("x-buddy-acct") || "", ip = req.headers.get("x-buddy-ip") || "";
    if (!RE.acct.test(acct)) return err(400, "bad request");
    const body = await readBody(req, bodyMax(path));      // always read whole first, whatever the answer will be
    if (body === null) return err(413, "too large");
    this.acct = acct;
    let m = this.load();
    if (m && m.deleting) { await this.wipe(); m = null; }
    if (path === "/" && method === "POST") return this.create(req, body, ip, m);
    if (!m || m.acct !== acct) return err(404, "no account");

    const wait = this.backoff(ip);
    if (wait) return wait;
    const who = await this.auth(req, ip);
    if (who instanceof Response) return who;
    if (!this.m) return err(404, "no account");            // (deleted while this request waited)
    const t = Math.floor(this.now() / MIN);
    if (this.win.t !== t) this.win = { t, n: 0 };
    if (++this.win.n > LIMITS.requests_per_min) return slowDown(MIN - (this.now() % MIN));
    this.touch(who);
    if (!this.alarmSeen) {                // (once per wake-up: an account whose alarm got lost gets one again)
      this.alarmSeen = true;
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(this.now() + DAY);
    }

    const dev = (fn) => (who.dev ? fn() : err(401, "auth"));
    const admin = (fn) => (who.admin ? fn() : err(403, "admin"));
    let mm;
    if (path === "/" && method === "DELETE") return admin(() => this.remove(req));
    if (path === "/changes" && method === "GET") return dev(() => this.changes(req));
    if (path === "/put" && method === "POST") return dev(() => this.put(body));
    if (path === "/usage" && method === "GET") return dev(() => this.usage());
    if (path === "/devices" && method === "GET") return dev(() => this.devices());
    if (path === "/devices" && method === "POST") return this.addDevice(body, who);
    if ((mm = /^\/devices\/([A-Za-z0-9_-]{22})$/.exec(path)) && method === "DELETE") return this.revoke(mm[1], who);
    if (path === "/blob/copy" && method === "POST") return dev(() => this.copy(body));
    if ((mm = /^\/blob\/([A-Za-z0-9_-]{22})$/.exec(path))) {
      if (method === "PUT") return dev(() => this.blobPut(req, mm[1], body));
      if (method === "GET") return dev(() => this.blobGet(mm[1]));
      if (method === "DELETE") return dev(() => this.blobDelete(mm[1]));
    }
    return err(404, "not found");
  }

  backoff(ip) {
    const f = this.fails.get(ip), w = LIMITS.auth_failure_window_s * 1000, now = this.now();
    if (f && now - f.t < w && f.n >= LIMITS.auth_failures) return slowDown(f.t + w - now);
    return null;
  }
  fail(ip) {
    const w = LIMITS.auth_failure_window_s * 1000, now = this.now();
    let f = this.fails.get(ip);
    if (!f || now - f.t >= w) f = { t: now, n: 0 };
    f.n++; this.fails.set(ip, f);
    if (this.fails.size > 2000) for (const [k, v] of this.fails) if (now - v.t >= w) this.fails.delete(k);
    return err(401, "auth");
  }

  async adminOk(req) {                    // "Buddy-Admin <atok>", where the account id is a hash of atok
    const h = /^Buddy-Admin ([A-Za-z0-9_-]{43}=?)$/.exec(req.headers.get("authorization") || "");
    const atok = h && b64d(h[1]);
    return !!(atok && atok.length === 32 && (await acctOf(atok)) === this.acct);
  }

  async auth(req, ip) {                   // {admin: true} | {dev} | a 401/410 response
    const a = req.headers.get("authorization") || "";
    if (a.startsWith("Buddy-Admin ")) return (await this.adminOk(req)) ? { admin: true } : this.fail(ip);
    const h = /^Bearer ([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43}=?)$/.exec(a);
    const tok = h && b64d(h[2]);
    const row = h && this.sql.exec("SELECT token_hash, revoked FROM devices WHERE dev = ?", h[1]).toArray()[0];
    if (!row || !tok || tok.length !== 32 || !same(new Uint8Array(row.token_hash), await sha256(tok))) return this.fail(ip);
    if (row.revoked) return json(410, { error: "revoked", revoked: true });   // the device wipes itself
    return { dev: h[1] };
  }

  touch(who) {                            // last seen (for idle deletion and "Mac seen lately"), at most once a minute
    const now = this.now();
    if (now - (this.m.last_seen || 0) >= MIN) this.set("last_seen", now);
    if (who.dev) {
      const r = this.sql.exec("SELECT seen FROM devices WHERE dev = ?", who.dev).one();
      if (now - (r.seen || 0) >= MIN) this.sql.exec("UPDATE devices SET seen = ? WHERE dev = ?", now, who.dev);
    }
  }

  // ---- create (admin + invite)
  async create(req, body, ip, m) {
    const { j, res } = parseJSON(body);
    if (res) return res;
    if (this.backoff(ip)) return this.backoff(ip);
    if (!(await this.adminOk(req))) return this.fail(ip);
    if (m || this.busy) return err(409, "exists");
    const d = j.dev, hdr = j.hdr;
    const th = d && b64d(d.token_hash), ct = hdr && b64d(hdr.ct);
    if (!d || !RE.id.test(d.id || "") || !th || th.length !== 32 || !hdr || !RE.id.test(hdr.rid || "") || !ct)
      return err(400, "bad request", { why: "dev {id, token_hash} and hdr {rid, ct}" });
    if (ct.length > LIMITS.record_max + 29) return err(413, "too large");
    if (!recordSizeOk(ct.length)) return err(400, "padding");
    const key = inviteKey(this.env.INVITE);
    if (!key) return err(503, "not set up", { why: "the relay has no INVITE secret yet (relay/deploy.sh)" });
    const inv = await checkInvite(key, j.invite, this.now());
    if (!inv) { this.fail(ip); return err(403, "invite"); }
    this.busy = true;
    try {
      const g = await internal(this.env.GATES, "ip:" + ip, "/",
        { op: "take", bucket: "create", limit: LIMITS.creates_per_ip_day, window: DAY });
      if (!g.ok) return slowDown(g.retry);
      const c = await internal(this.env.GATES, "invite:" + inv.nonce, "/", { op: "claim", by: this.acct, until: inv.until });
      if (!c.ok) return err(403, "invite", { why: "used" });
      if (this.load()) return err(409, "exists");
      const now = this.now();
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(SCHEMA);
        for (const [k, v] of Object.entries({ acct: this.acct, created: now, last_seen: now, seq: 1, horizon: 0,
                                              nrec: 1, bytes: ct.length, nblob: 0, blob_bytes: 0 }))
          this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?)", k, v);
        this.sql.exec("INSERT INTO devices (dev, token_hash, added, by, seen) VALUES (?, ?, ?, 'admin', ?)", d.id, th, now, now);
        this.sql.exec("INSERT INTO records (rid, ver, seq, ct) VALUES (?, 1, 1, ?)", hdr.rid, ct);
      });
      this.m = null; this.load();
      await this.ctx.storage.setAlarm(now + DAY);
      return json(201, { seq: 1, now });
    } finally { this.busy = false; }
  }

  // ---- records
  changes(req) {
    const q = new URL(req.url).searchParams;
    const sq = q.get("since") || "0", lq = q.get("limit") || String(LIMITS.changes_items);
    if (!/^[0-9]{1,15}$/.test(sq) || !/^[0-9]{1,6}$/.test(lq) || Number(lq) < 1)
      return err(400, "bad request", { why: "since, limit" });
    const since = Number(sq), limit = Number(lq);
    const m = this.m;
    if (since > 0 && since < m.horizon) return json(410, { error: "horizon", horizon: m.horizon });
    const n = Math.min(limit, LIMITS.changes_items);
    const rows = this.sql.exec("SELECT rid, ver, seq, length(ct) AS size FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
                               since, n + 1).toArray();
    const items = []; let bytes = 0, more = false;
    for (const r of rows) {
      if (items.length === n || (items.length && bytes + (r.size || 0) > LIMITS.changes_bytes)) { more = true; break; }
      bytes += r.size || 0;
      items.push({ rid: r.rid, ver: r.ver, seq: r.seq, ct: null });
    }
    if (items.length) {
      const cts = new Map();
      for (const r of this.sql.exec("SELECT seq, ct FROM records WHERE seq > ? AND seq <= ? AND ct IS NOT NULL",
                                    since, items[items.length - 1].seq)) cts.set(r.seq, r.ct);
      for (const it of items) if (cts.has(it.seq)) it.ct = b64e(new Uint8Array(cts.get(it.seq)));
    }
    return json(200, { seq: m.seq, horizon: m.horizon, more, now: this.now(), items });
  }

  async put(body) {
    if (this.m.delete_at) return READ_ONLY(this.m);
    const { j, res } = parseJSON(body);
    if (res) return res;
    const items = j.items;
    if (!Array.isArray(items) || !items.length) return err(400, "bad request", { why: "items" });
    if (items.length > LIMITS.put_items) return err(413, "too large", { why: "items" });
    const seen = new Set(); let total = 0;
    const its = [];
    for (const it of items) {
      if (!it || !RE.id.test(it.rid || "") || !Number.isInteger(it.base) || it.base < 0 || it.base > 2 ** 31 ||
          !(it.ct === null || typeof it.ct === "string") || seen.has(it.rid))
        return err(400, "bad request", { why: "each item is {rid, base, ct | null}, every rid once" });
      seen.add(it.rid);
      const ct = it.ct === null ? null : b64d(it.ct);
      if (it.ct !== null && !ct) return err(400, "bad request", { why: "ct" });
      if (ct && ct.length > LIMITS.record_max + 29) return err(413, "too large");
      if (ct && !recordSizeOk(ct.length)) return err(400, "padding");
      total += ct ? ct.length : 0;
      its.push({ rid: it.rid, base: it.base, ct });
    }
    if (total > LIMITS.put_bytes) return err(413, "too large");
    const go = [], results = new Array(its.length);
    let rows = 0, delta = 0;
    its.forEach((it, i) => {
      const cur = this.sql.exec("SELECT ver, length(ct) AS size FROM records WHERE rid = ?", it.rid).toArray()[0];
      if (it.base !== (cur ? cur.ver : 0)) { results[i] = { conflict: true }; return; }
      go.push(i);
      if (!cur) rows++;
      delta += (it.ct ? it.ct.length : 0) - (cur ? cur.size || 0 : 0);
    });
    const m = this.m;
    if (rows && m.nrec + rows > this.lim.records) return err(507, "quota", { what: "records" });
    if (delta > 0 && m.bytes + delta > this.lim.record_bytes) return err(507, "quota", { what: "bytes" });
    const now = this.now();
    this.ctx.storage.transactionSync(() => {
      let seq = m.seq;
      for (const i of go) {
        const it = its[i];
        seq++;
        this.sql.exec("INSERT OR REPLACE INTO records (rid, ver, seq, ct, deleted_at) VALUES (?, ?, ?, ?, ?)",
                      it.rid, it.base + 1, seq, it.ct, it.ct ? null : now);
        results[i] = { rid: it.rid, ver: it.base + 1, seq };
      }
      this.set("seq", seq); this.add("nrec", rows); this.add("bytes", delta);
    });
    let sent = 0;
    its.forEach((it, i) => {                // a conflict carries the current version (its ct while the answer stays small)
      if (!results[i].conflict) return;
      const cur = this.sql.exec("SELECT ver, ct FROM records WHERE rid = ?", it.rid).toArray()[0];
      const c = { ver: cur ? cur.ver : 0 };
      const ct = cur && cur.ct ? new Uint8Array(cur.ct) : null;
      if (!ct) c.ct = null;
      else if (sent + ct.length <= LIMITS.changes_bytes) { c.ct = b64e(ct); sent += ct.length; }
      results[i] = { rid: it.rid, conflict: c };
    });
    return json(200, { seq: this.m.seq, results });
  }

  usage() {
    const m = this.m;
    return json(200, { records: m.nrec, bytes: m.bytes, blobs: m.nblob, blob_bytes: m.blob_bytes,
                       quota: { records: this.lim.records, bytes: this.lim.record_bytes, blob_bytes: this.lim.blob_bytes,
                                devices: this.lim.devices },
                       created: m.created, last_seen: m.last_seen, delete_at: m.delete_at || null });
  }

  // ---- devices
  devices() {
    const rows = this.sql.exec("SELECT dev, added, by, seen, endpoint FROM devices WHERE revoked IS NULL ORDER BY added, dev").toArray();
    return json(200, rows.map((r) => ({ id: r.dev, added: r.added, by: r.by, seen: r.seen, push: !!r.endpoint })));
  }

  async addDevice(body, who) {
    if (this.m.delete_at) return READ_ONLY(this.m);
    const { j, res } = parseJSON(body);
    if (res) return res;
    const th = b64d(j.token_hash);
    if (!RE.id.test(j.id || "") || !th || th.length !== 32) return err(400, "bad request", { why: "{id, token_hash}" });
    if (this.sql.exec("SELECT 1 FROM devices WHERE dev = ?", j.id).toArray().length) return err(409, "exists");
    // live devices, and every row a removed one keeps (so it gets 410) until the alarm drops it after 180 days: a
    // device adding and removing itself in a loop can't grow the account past the quota
    const n = this.sql.exec("SELECT count(*) AS n, count(revoked) AS gone FROM devices").one();
    if (n.n - n.gone >= this.lim.devices || n.n >= LIMITS.device_rows * this.lim.devices)
      return err(507, "quota", { what: "devices" });
    const now = this.now(), by = who.admin ? "admin" : who.dev;
    this.sql.exec("INSERT INTO devices (dev, token_hash, added, by) VALUES (?, ?, ?, ?)", j.id, th, now, by);
    return json(201, { id: j.id, added: now, by });
  }

  revoke(dev, who) {                      // the recovery key (admin) or the device itself; works while read-only too
    if (!who.admin && who.dev !== dev) return err(403, "admin");
    const row = this.sql.exec("SELECT revoked FROM devices WHERE dev = ?", dev).toArray()[0];
    if (!row) return err(404, "no device");
    if (!row.revoked) this.sql.exec("UPDATE devices SET revoked = ?, endpoint = NULL WHERE dev = ?", this.now(), dev);
    return json(200, { revoked: dev });
  }

  // ---- blobs
  key(bid, acct = this.acct) { return acct + "/" + bid; }

  blobQuota(size) { return this.m.blob_bytes + size > this.lim.blob_bytes ? err(507, "quota", { what: "blob_bytes" }) : null; }

  reserve(bid, rid, size) {               // the blob's row first, so a request in between sees it
    this.sql.exec("INSERT INTO blobs (bid, rid, size, at) VALUES (?, ?, ?, ?)", bid, rid, size, this.now());
    this.add("nblob", 1); this.add("blob_bytes", size);
  }
  unreserve(bid) {
    const r = this.sql.exec("SELECT size FROM blobs WHERE bid = ?", bid).toArray()[0];
    if (!r) return;
    this.sql.exec("DELETE FROM blobs WHERE bid = ?", bid);
    this.add("nblob", -1); this.add("blob_bytes", -r.size);
  }

  async blobPut(req, bid, body) {
    if (this.m.delete_at) return READ_ONLY(this.m);
    const rid = req.headers.get("x-rid") || "";
    if (!RE.id.test(rid)) return err(400, "bad request", { why: "X-Rid: the record that will hold the blob's key" });
    if (!blobSizeOk(body.length)) return err(400, "padding");
    if (this.sql.exec("SELECT 1 FROM blobs WHERE bid = ?", bid).toArray().length) return err(412, "exists");
    const q = this.blobQuota(body.length);
    if (q) return q;
    this.reserve(bid, rid, body.length);
    try { await this.env.BLOBS.put(this.key(bid), body); } catch { this.unreserve(bid); return err(500, "server"); }
    return json(201, { bid, size: body.length });
  }

  async blobGet(bid) {
    const r = this.sql.exec("SELECT size FROM blobs WHERE bid = ?", bid).toArray()[0];
    const o = r && (await this.env.BLOBS.get(this.key(bid)));
    if (!o) return err(404, "no blob");
    return new Response(o.body, { status: 200, headers: { "content-type": "application/octet-stream",
                                                          "content-length": String(r.size) } });
  }

  async blobDelete(bid) {
    if (this.m.delete_at) return READ_ONLY(this.m);
    const had = this.sql.exec("SELECT 1 FROM blobs WHERE bid = ?", bid).toArray().length > 0;
    if (had) { await this.env.BLOBS.delete(this.key(bid)); this.unreserve(bid); }
    return json(200, { deleted: had });
  }

  async blobsFor(req) {                   // (internal) another account asks which of these blobs it may copy
    const b = await req.json();
    this.acct = req.headers.get("x-buddy-acct") || "";
    const m = this.load();
    if (!m || m.deleting || m.acct !== this.acct) return Response.json({ ok: false, why: "no account" });
    const h = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43}=?)$/.exec(typeof b.auth === "string" ? b.auth : "");
    const tok = h && b64d(h[2]);
    const row = h && this.sql.exec("SELECT token_hash, revoked FROM devices WHERE dev = ?", h[1]).toArray()[0];
    if (!row || row.revoked || !tok || tok.length !== 32 || !same(new Uint8Array(row.token_hash), await sha256(tok)))
      return Response.json({ ok: false, why: "auth" });
    const sizes = {};
    for (const bid of Array.isArray(b.bids) ? b.bids : []) {
      const r = typeof bid === "string" && this.sql.exec("SELECT size FROM blobs WHERE bid = ?", bid).toArray()[0];
      if (r) sizes[bid] = r.size;
    }
    return Response.json({ ok: true, sizes });
  }

  async copy(body) {                      // new recovery key: the old account's blobs move over without re-uploading
    if (this.m.delete_at) return READ_ONLY(this.m);
    const { j, res } = parseJSON(body);
    if (res) return res;
    const bids = j.bids;
    if (!RE.acct.test(j.from || "") || j.from === this.acct || typeof j.from_auth !== "string" || !Array.isArray(bids) ||
        !bids.length || bids.some((b) => !b || !RE.id.test(b.bid || "") || !RE.id.test(b.rid || "")) ||
        new Set(bids.map((b) => b.bid)).size !== bids.length)
      return err(400, "bad request", { why: "{from, from_auth, bids: [{bid, rid}]}" });
    if (bids.length > LIMITS.copy_items) return err(413, "too large", { why: "bids" });
    const a = await internal(this.env.ACCOUNTS, j.from, "/_blobs", { auth: j.from_auth, bids: bids.map((b) => b.bid) },
                             { "x-buddy-acct": j.from });
    if (!a.ok) return a.why === "no account" ? err(404, "no account", { which: "from" }) : err(403, "from_auth");
    const out = { copied: [], missing: [], exists: [] };
    const todo = [];
    for (const b of bids) {
      if (this.sql.exec("SELECT 1 FROM blobs WHERE bid = ?", b.bid).toArray().length) out.exists.push(b.bid);
      else if (!(b.bid in a.sizes)) out.missing.push(b.bid);
      else todo.push(b);
    }
    const q = this.blobQuota(todo.reduce((n, b) => n + a.sizes[b.bid], 0));
    if (q) return q;
    for (const b of todo) {
      if (this.sql.exec("SELECT 1 FROM blobs WHERE bid = ?", b.bid).toArray().length) { out.exists.push(b.bid); continue; }
      this.reserve(b.bid, b.rid, a.sizes[b.bid]);
      try {
        const o = await this.env.BLOBS.get(this.key(b.bid, j.from));
        if (!o) { this.unreserve(b.bid); out.missing.push(b.bid); continue; }
        await this.env.BLOBS.put(this.key(b.bid), await o.arrayBuffer());
        out.copied.push(b.bid);
      } catch { this.unreserve(b.bid); return err(500, "server"); }
    }
    return json(200, out);
  }

  // ---- deleting
  async remove(req) {                     // DELETE /a/{acct}: everything at once, or read-only now and gone later
    if (req.headers.get("x-confirm") !== this.acct) return err(400, "confirm", { why: "X-Confirm: <account id>" });
    const after = req.headers.get("x-delete-after");
    if (after !== null) {
      const s = /^[0-9]{1,8}$/.test(after) ? Number(after) : 0;
      if (s < 1 || s > LIMITS.delete_after_max_s) return err(400, "bad request", { why: "X-Delete-After: 1-1209600 seconds" });
      const at = this.now() + s * 1000;
      this.set("delete_at", at);
      const cur = await this.ctx.storage.getAlarm();
      if (!cur || cur > at) await this.ctx.storage.setAlarm(at);
      return json(202, { delete_at: at });
    }
    await this.wipe();
    return json(200, { deleted: true });
  }

  async wipe() {
    if (this.wiping) return this.wiping;
    this.wiping = (async () => {
      const acct = this.m.acct;
      this.set("deleting", 1);                              // from here on the account answers 404
      await this.ctx.storage.setAlarm(this.now() + MIN);   // (finishes the job if this is cut short)
      let cursor;
      do {
        const l = await this.env.BLOBS.list({ prefix: acct + "/", cursor });
        if (l.objects.length) await this.env.BLOBS.delete(l.objects.map((o) => o.key));
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.m = null;
    })();
    try { await this.wiping; } finally { this.wiping = null; }
  }

  async alarm() {                         // daily: deletion when due, idle accounts, old tombstones, unused blobs
    const m = this.load();
    if (!m) { await this.ctx.storage.deleteAlarm(); return; }
    this.acct = m.acct;
    const now = this.now();
    // the next one first: if anything below fails (R2 down), it all runs again in an hour, and the account never
    // loses its alarm (Cloudflare gives up retrying a failed one after a few minutes; wipe() deletes this one)
    await this.ctx.storage.setAlarm(now + HOUR);
    if (m.deleting || (m.delete_at && now >= m.delete_at) || now - m.last_seen >= LIMITS.idle_days * DAY) {
      try { await this.wipe(); } catch {}
      return;
    }
    try { await this.housekeep(m, now); } catch { return; }
    await this.ctx.storage.setAlarm(Math.min(now + DAY, this.m.delete_at || Infinity));
  }

  async housekeep(m, now) {
    const cut = now - LIMITS.tombstone_days * DAY;
    this.sql.exec("DELETE FROM devices WHERE revoked IS NOT NULL AND revoked <= ?", cut);   // (gone 180 days: 401 now)
    const t = this.sql.exec("SELECT count(*) AS n, max(seq) AS top FROM records WHERE deleted_at IS NOT NULL AND deleted_at <= ?", cut).one();
    if (t.n) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM records WHERE deleted_at IS NOT NULL AND deleted_at <= ?", cut);
        this.add("nrec", -t.n);
        this.set("horizon", Math.max(m.horizon, t.top));    // a cursor older than this has missed a deletion: 410
      });
    }
    const gone = this.sql.exec(
      "SELECT b.bid FROM blobs b LEFT JOIN records r ON r.rid = b.rid " +
      "WHERE (r.rid IS NULL AND b.at <= ?) OR (r.deleted_at IS NOT NULL AND r.deleted_at <= ?)",
      now - LIMITS.orphan_blob_hours * HOUR, now - LIMITS.deleted_blob_days * DAY).toArray().map((r) => r.bid);
    for (let i = 0; i < gone.length; i += 1000) {        // (R2 first: if that fails, the alarm runs again)
      await this.env.BLOBS.delete(gone.slice(i, i + 1000).map((b) => this.key(b)));
      for (const bid of gone.slice(i, i + 1000)) this.unreserve(bid);
    }
  }
}

