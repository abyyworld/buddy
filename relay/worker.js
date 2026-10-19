// Buddy's sync relay on Cloudflare (SPEC3 §10): a Worker in front of one Durable Object per account (Account, SQLite),
// one per link mailbox (Mailbox) and small per-IP / per-invite counters (Gate); blobs in R2. Devices send only what
// they encrypted themselves (records, blobs, mailbox messages), so the relay can't read anything. Invite-only.
// No logging: nothing here writes a log line, and the deployment has observability off (wrangler.toml).
// Same protocol as ref.py; README.md "Protocol" is the contract.

import { LIMITS, limitsFrom, RE, enc, hex, ipKey, sha256, err, json, drain } from "./common.js";

export { Account } from "./account.js";
export { Mailbox } from "./mailbox.js";
export { Gate } from "./gate.js";

const MiB = 1024 * 1024;
const ACCOUNT_ROUTES = [               // [path after /v1/a/{acct}, methods, largest body]
  [/^$/, ["POST", "DELETE"], 2 * MiB],
  [/^\/changes$/, ["GET"], 0],
  [/^\/put$/, ["POST"], 3 * MiB],
  [/^\/usage$/, ["GET"], 0],
  [/^\/devices$/, ["GET", "POST"], 64 * 1024],
  [/^\/devices\/[A-Za-z0-9_-]{22}$/, ["DELETE"], 0],
  [/^\/blob\/copy$/, ["POST"], 64 * 1024],
  [/^\/blob\/[A-Za-z0-9_-]{22}$/, ["GET", "PUT", "DELETE"], LIMITS.blob_max + 28],
];
const PASS = ["authorization", "content-type", "content-length", "x-rid", "x-confirm", "x-delete-after", "if-none-match"];
const ALLOW_HEADERS = "authorization, content-type, x-rid, x-confirm, x-delete-after, if-none-match";

function origins(env) { return String(env.ALLOWED_ORIGINS || "").split(/[\s,]+/).filter(Boolean); }

async function ipHash(req) {           // per-IP limits only need to tell clients apart; the address itself is never kept
  return hex(await sha256(enc.encode("buddy-relay ip|" + ipKey(req.headers.get("cf-connecting-ip"))))).slice(0, 32);
}

async function forward(ns, name, req, path, extra) {
  const h = new Headers();
  for (const k of PASS) { const v = req.headers.get(k); if (v !== null) h.set(k, v); }
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  const body = req.method === "GET" || req.method === "DELETE" ? undefined : req.body;
  return ns.get(ns.idFromName(name)).fetch("https://relay.internal" + path, { method: req.method, headers: h, body });
}

async function tooLarge(req) {         // (read a refused body up to 32 MiB, so the client sees the 413)
  if (Number(req.headers.get("content-length")) <= 32 * MiB) await drain(req);
  return err(413, "too large");
}

async function route(req, env) {
  const url = new URL(req.url), p = url.pathname, method = req.method;
  if (p === "/v1/info") {
    if (method !== "GET") return err(405, "method");
    return json(200, { v: 1, vapid: null, push: false, invite: true, limits: limitsFrom(env) });
  }
  let m;
  if ((m = /^\/v1\/a\/([^/]+)(\/.*)?$/.exec(p))) {
    if (!RE.acct.test(m[1])) return err(404, "not found");
    const rest = m[2] || "";
    const r = ACCOUNT_ROUTES.find(([re]) => re.test(rest));
    if (!r) return err(404, "not found");
    if (!r[1].includes(method)) return err(405, "method", {}, { allow: r[1].join(", ") });
    if (Number(req.headers.get("content-length")) > r[2]) return tooLarge(req);
    return forward(env.ACCOUNTS, m[1], req, (rest || "/") + url.search,
                   { "x-buddy-acct": m[1], "x-buddy-ip": await ipHash(req) });
  }
  if ((m = /^\/v1\/m\/([^/]+)$/.exec(p))) {
    if (!RE.box.test(m[1])) return err(404, "not found");
    if (!["GET", "PUT", "DELETE"].includes(method)) return err(405, "method", {}, { allow: "GET, PUT, DELETE" });
    if (Number(req.headers.get("content-length")) > 16 * 1024) return tooLarge(req);
    return forward(env.MAILBOXES, m[1], req, "/" + url.search, { "x-buddy-ip": await ipHash(req) });
  }
  return err(404, "not found");
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin");
    const allowed = origin === null || origins(env).includes(origin);
    let res;
    try {
      if (!allowed) res = err(403, "origin");
      else if (req.method === "OPTIONS") {
        res = new Response(null, { status: 204, headers: {
          "access-control-allow-methods": "GET, POST, PUT, DELETE", "access-control-allow-headers": ALLOW_HEADERS,
          "access-control-max-age": "86400" } });
      } else res = await route(req, env);
    } catch { res = err(500, "server"); }
    res = new Response(res.body, res);       // (a Durable Object's response has fixed headers)
    const h = res.headers;
    h.set("cache-control", "no-store"); h.set("x-content-type-options", "nosniff"); h.set("referrer-policy", "no-referrer");
    if (origin !== null && allowed) {        // CORS for Buddy's own site only; never credentials
      h.set("access-control-allow-origin", origin); h.set("access-control-expose-headers", "retry-after");
      h.append("vary", "Origin");
    }
    return res;
  },
};
