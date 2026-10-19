// Gate: one small Durable Object per client IP hash ("ip:<hash>") for the per-IP limits (account creations a day,
// new link mailboxes an hour), and one per invite ("invite:<nonce>") so each invite creates one account. Only the
// relay's own parts call it (x-buddy-internal); it stores times and counts, never an address. Cleans itself up.

export class Gate {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
  }

  tables() {                                     // (again after deleteAll)
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits (bucket TEXT NOT NULL, at INTEGER NOT NULL, until INTEGER NOT NULL);" +
                  "CREATE TABLE IF NOT EXISTS claim (by TEXT NOT NULL, until INTEGER NOT NULL)");
  }

  now() { return Date.now(); }

  async fetch(req) {
    if (req.headers.get("x-buddy-internal") !== "1") return new Response(null, { status: 404 });
    const b = await req.json(); const now = this.now();
    this.tables();
    let out;
    if (b.op === "take") {                       // {bucket, limit, window (ms)} -> {ok} | {ok: false, retry (ms)}
      this.sql.exec("DELETE FROM hits WHERE until <= ?", now);
      const r = this.sql.exec("SELECT count(*) AS n, min(until) AS first FROM hits WHERE bucket = ?", b.bucket).one();
      if (r.n >= b.limit) out = { ok: false, retry: r.first - now };
      else { this.sql.exec("INSERT INTO hits (bucket, at, until) VALUES (?, ?, ?)", b.bucket, now, now + b.window); out = { ok: true }; }
    } else if (b.op === "claim") {               // {by, until} -> {ok}: the first claimer (or the same one again) wins
      const row = this.sql.exec("SELECT by FROM claim").toArray()[0];
      if (row) out = { ok: row.by === b.by };
      else { this.sql.exec("INSERT INTO claim (by, until) VALUES (?, ?)", b.by, b.until); out = { ok: true }; }
    } else return new Response(null, { status: 400 });
    await this.schedule(now);
    return Response.json(out);
  }

  async schedule(now) {
    const r = this.sql.exec("SELECT max(u) AS last FROM (SELECT max(until) AS u FROM hits UNION ALL SELECT max(until) FROM claim)").one();
    if (r.last === null) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }
    else await this.ctx.storage.setAlarm(Math.max(r.last, now) + 1000);
  }

  async alarm() {
    const now = this.now();
    this.tables();
    this.sql.exec("DELETE FROM hits WHERE until <= ?", now);
    this.sql.exec("DELETE FROM claim WHERE until <= ?", now);
    await this.schedule(now);
  }
}
