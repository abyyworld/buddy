// Test-only entry for `wrangler dev` (run.mjs): the production Worker and Durable Objects, with a clock the tests
// can move forward (POST /_test/clock {advance_ms}), the daily alarm on demand (POST /_test/housekeep {accts}), and
// X-Test-IP standing in for the client's address. worker.js itself has no such hooks; this file is never deployed.
import prod, * as P from "../worker.js";

globalThis.__buddyTestOffset = globalThis.__buddyTestOffset || 0;
const now = () => Date.now() + globalThis.__buddyTestOffset;
const testable = (Base) => class extends Base {
  now() { return now(); }
  async fetch(req) {
    if (new URL(req.url).pathname === "/_test/alarm" && req.headers.get("x-buddy-internal") === "1") {
      await this.alarm();
      return new Response("ok");
    }
    return super.fetch(req);
  }
};
export const Account = testable(P.Account);
export const Mailbox = testable(P.Mailbox);
export const Gate = testable(P.Gate);

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/_test/clock") {
      globalThis.__buddyTestOffset += (await req.json()).advance_ms || 0;
      return Response.json({ now: now() });
    }
    if (u.pathname === "/_test/housekeep") {
      for (const a of (await req.json()).accts || [])
        await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(a)).fetch("https://relay.internal/_test/alarm",
                                                                 { headers: { "x-buddy-internal": "1" } });
      return Response.json({ now: now() });
    }
    const ip = req.headers.get("x-test-ip");
    if (ip) {
      const h = new Headers(req.headers);
      h.set("cf-connecting-ip", ip); h.delete("x-test-ip");
      req = new Request(req, { headers: h });
    }
    return prod.fetch(req, env, ctx);
  },
};
