// Mailbox: one Durable Object per link mailbox (/v1/m/{box}), used while a device is linked with a one-time code
// (SPEC3 §9.1). It holds at most 8 messages of 8 KiB that the devices encrypted themselves, for 10 minutes from its
// first message, then deletes itself. No auth: the box id comes from the code. Reads are limited per box, new boxes
// per IP (through the Gate).

import { LIMITS, MIN, b64d, b64e, err, json, readBody, parseJSON, internal, slowDown } from "./common.js";

export class Mailbox {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.reads = { t: -1, n: 0 };
  }

  now() { return Date.now(); }

  created() {
    if (!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'box'").toArray().length) return 0;
    const r = this.sql.exec("SELECT created FROM box").toArray()[0];
    return r ? r.created : 0;
  }

  async wipe() { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }

  async fetch(req) {
    try { return await this.route(req); } catch { return err(500, "server"); }
  }

  async route(req) {
    const ttl = LIMITS.box_ttl_s * 1000;
    const body = await readBody(req, 16 * 1024);         // always read whole first, whatever the answer will be
    if (body === null) return err(413, "too large");
    let created = this.created();
    if (created && this.now() >= created + ttl) { await this.wipe(); created = 0; }
    if (req.method === "DELETE") { if (created) await this.wipe(); return json(200, { ok: true }); }
    if (req.method === "GET") {
      const t = Math.floor(this.now() / MIN);
      if (this.reads.t !== t) this.reads = { t, n: 0 };
      if (++this.reads.n > LIMITS.box_reads_per_min) return slowDown(MIN - (this.now() % MIN));
      if (!created) return err(404, "no mailbox");
      const aq = new URL(req.url).searchParams.get("after") || "0";
      if (!/^[0-9]{1,6}$/.test(aq)) return err(400, "bad request", { why: "after" });
      const after = Number(aq);
      const msgs = this.sql.exec("SELECT n, m FROM msgs WHERE n > ? ORDER BY n", after).toArray()
        .map((r) => ({ n: r.n, m: b64e(new Uint8Array(r.m)) }));
      return json(200, { msgs, exp: created + ttl });
    }
    if (req.method !== "PUT") return err(405, "method");
    const { j, res } = parseJSON(body);
    if (res) return res;
    const m = b64d(j.m);
    if (!m || !m.length) return err(400, "bad request", { why: "m" });
    if (m.length > LIMITS.box_msg_bytes) return err(413, "too large");
    if (!created) {
      const ip = req.headers.get("x-buddy-ip") || "";
      const g = await internal(this.env.GATES, "ip:" + ip, "/",
        { op: "take", bucket: "box", limit: LIMITS.boxes_per_ip_hour, window: 60 * MIN });
      if (!g.ok) return slowDown(g.retry);
      created = this.created();               // (another message may have opened it meanwhile)
      if (!created) {
        created = this.now();
        this.sql.exec("CREATE TABLE IF NOT EXISTS box (created INTEGER NOT NULL);" +
                      "CREATE TABLE IF NOT EXISTS msgs (n INTEGER PRIMARY KEY, m BLOB NOT NULL)");
        this.sql.exec("INSERT INTO box (created) VALUES (?)", created);
        await this.ctx.storage.setAlarm(created + ttl);
      }
    }
    const n = this.sql.exec("SELECT count(*) AS n FROM msgs").one().n;
    if (n >= LIMITS.box_msgs) return err(409, "full");
    this.sql.exec("INSERT INTO msgs (n, m) VALUES (?, ?)", n + 1, m);
    return json(201, { n: n + 1, exp: created + ttl });
  }

  async alarm() {
    const created = this.created();
    if (!created || this.now() >= created + LIMITS.box_ttl_s * 1000) await this.wipe();
    else await this.ctx.storage.setAlarm(created + LIMITS.box_ttl_s * 1000);
  }
}
