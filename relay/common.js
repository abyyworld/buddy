// Buddy's sync relay: what the Worker's parts (worker.js, account.js, mailbox.js, gate.js) and invite.mjs share.
// No dependencies. The relay only ever holds ciphertext that devices made; nothing here can decrypt anything.
// ref.py implements exactly the same protocol in Python (README.md, "Protocol").

export const KiB = 1024, MiB = 1024 * KiB, GiB = 1024 * MiB;
export const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const LIMITS = Object.freeze({
  records: 100000,            // rows per account (live records and tombstones)       env QUOTA_RECORDS
  record_bytes: 200 * MiB,    // record ciphertext per account                        env QUOTA_RECORD_BYTES
  blob_bytes: 2 * GiB,        // blob ciphertext per account                          env QUOTA_BLOB_BYTES
  devices: 32,                // devices per account (not counting removed ones)      env QUOTA_DEVICES
  record_max: MiB,            // one record's padded plaintext
  blob_max: 16 * MiB,         // one blob's padded plaintext
  put_items: 200, put_bytes: 2 * MiB,
  changes_items: 500, changes_bytes: 4 * MiB,
  copy_items: 100,
  requests_per_min: 600,      // per account (signed-in requests)
  creates_per_ip_day: 3, boxes_per_ip_hour: 10, box_reads_per_min: 30,
  box_ttl_s: 600, box_msgs: 8, box_msg_bytes: 8 * KiB,
  auth_failures: 10, auth_failure_window_s: 600,
  device_rows: 4,             // rows a removed device keeps count too, up to this many times the device quota
  tombstone_days: 180, idle_days: 365, orphan_blob_hours: 24, deleted_blob_days: 7,
  delete_after_max_s: 1209600,
});

const QUOTA_ENV = { records: "QUOTA_RECORDS", record_bytes: "QUOTA_RECORD_BYTES", blob_bytes: "QUOTA_BLOB_BYTES",
                    devices: "QUOTA_DEVICES" };

export function limitsFrom(env) {         // the quotas can be set per deployment; everything else is the protocol
  const lim = { ...LIMITS };
  for (const [k, name] of Object.entries(QUOTA_ENV)) {
    const v = env && env[name];
    if (typeof v === "string" && /^[1-9][0-9]{0,12}$/.test(v)) lim[k] = Number(v);
  }
  return lim;
}

export const RE = {
  acct: /^[0-9a-hjkmnp-tv-z]{26}$/,       // lower(B32(SHA-256("buddy-sync v1 account" ‖ atok)))[:26]
  box: /^[0-9a-hjkmnp-tv-z]{26}$/,        // lower(B32(SHA-256("buddy-link v1 box" ‖ code)))[:26]
  id: /^[A-Za-z0-9_-]{22}$/,              // rid, device id, blob id: 16 bytes, base64url
  b64: /^[A-Za-z0-9_-]*={0,2}$/,
};

export const enc = new TextEncoder();

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

export function b64e(u8) {                // base64url without padding
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64d(s) {                 // base64url, padding optional; null when it isn't base64url
  if (typeof s !== "string" || !RE.b64.test(s)) return null;
  s = s.replace(/=+$/, "");
  if (s.length % 4 === 1) return null;
  let bin;
  try { bin = atob(s.replace(/-/g, "+").replace(/_/g, "/")); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford base32 (backup.py's alphabet)

export function b32(u8) {                 // most significant bit first, 5 bits a character, the last one zero-filled
  let out = "", val = 0, bits = 0;
  for (const b of u8) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function b32norm(text) {           // as people type it: spaces, dashes and dots dropped, O/I/L read as 0/1/1
  return String(text || "").replace(/[\s.\-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function b32d(s) {                 // s already normalised; null on a character outside the alphabet
  const out = []; let val = 0, bits = 0;
  for (const c of s) {
    const v = B32.indexOf(c); if (v < 0) return null;
    val = (val << 5) | v; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    val &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

export function ipKey(ip) {                // per-IP limits count an IPv6 /64 as one address (one home or phone)
  ip = String(ip || "").trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);     // ::ffff:1.2.3.4
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}

export function hex(u8) { return Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join(""); }

export function same(a, b) {              // constant time
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function sha256(u8) { return new Uint8Array(await crypto.subtle.digest("SHA-256", u8)); }

export async function hmac256(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export async function acctOf(atok) {      // the account id is a hash of the admin token: the relay stores no secret
  return b32(await sha256(concat(enc.encode("buddy-sync v1 account"), atok))).toLowerCase().slice(0, 26);
}

// Padding (SPEC3 §7.4/§7.5). Record ct = version (1) ‖ nonce (12) ‖ AES-GCM(P) (|P| + 16), where |P| is a power of two
// from 512 to 64 KiB or a multiple of 64 KiB up to 1 MiB. Blob ct = nonce (12) ‖ AES-GCM(data padded to a multiple of
// 64 KiB, at most 16 MiB) (+ 16). The relay refuses anything else, so a device can't leak exact sizes by mistake.
export function recordSizeOk(n) {
  const p = n - 29;
  if (p < 512 || p > LIMITS.record_max) return false;
  return p <= 64 * KiB ? (p & (p - 1)) === 0 : p % (64 * KiB) === 0;
}
export function blobSizeOk(n) { const p = n - 28; return p >= 64 * KiB && p <= LIMITS.blob_max && p % (64 * KiB) === 0; }

// Invites (the relay is invite-only): Crockford base32 of nonce (8) ‖ expiry (u32, unix seconds) ‖
// HMAC-SHA256(INVITE secret, "buddy-relay invite v1" ‖ nonce ‖ expiry)[:8], 32 characters in groups of 4.
// Each one creates one account (the account that used it may use it again, e.g. after deleting everything).
const INVITE_LABEL = enc.encode("buddy-relay invite v1");

export function inviteKey(text) {         // the INVITE secret: base64 of at least 32 random bytes
  if (typeof text !== "string") return null;
  const k = b64d(text.trim().replace(/\+/g, "-").replace(/\//g, "_"));
  return k && k.length >= 32 ? k : null;
}

export async function makeInvite(key, { days = 30, now = Date.now(), nonce } = {}) {
  nonce = nonce || crypto.getRandomValues(new Uint8Array(8));
  const exp = new Uint8Array(4);
  new DataView(exp.buffer).setUint32(0, Math.floor(now / 1000) + Math.round(days * 86400));
  const mac = (await hmac256(key, concat(INVITE_LABEL, nonce, exp))).slice(0, 8);
  return b32(concat(nonce, exp, mac)).match(/.{4}/g).join("-");
}

export async function checkInvite(key, text, now) {
  const s = b32norm(text);
  if (!key || s.length !== 32) return null;
  const b = b32d(s); if (!b || b.length !== 20) return null;
  const nonce = b.slice(0, 8), exp = b.slice(8, 12), mac = b.slice(12);
  if (!same(mac, (await hmac256(key, concat(INVITE_LABEL, nonce, exp))).slice(0, 8))) return null;
  const until = new DataView(exp.buffer, exp.byteOffset).getUint32(0) * 1000;
  return until > now ? { nonce: hex(nonce), until } : null;
}

// Responses
export function json(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}
export function err(status, error, more = {}, headers = {}) { return json(status, { error, ...more }, headers); }
export function slowDown(retryMs) {
  return err(429, "slow down", {}, { "retry-after": String(Math.max(1, Math.ceil(retryMs / 1000))) });
}

export async function readBody(req, max) {  // the body, or null when it is longer than max
  const len = req.headers.get("content-length");
  if (len !== null && Number(len) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const parts = []; let n = 0;
  const r = req.body.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await r.cancel(); } catch { /* gone */ } return null; }
    parts.push(value);
  }
  return concat(...parts);
}

export function parseJSON(b) {             // {j} or {res: an error response}
  try {
    const j = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
    if (j && typeof j === "object" && !Array.isArray(j)) return { j };
  } catch { /* below */ }
  return { res: err(400, "bad request", { why: "the body must be a JSON object" }) };
}

export async function drain(req) {          // read a body we refuse, so the client gets to see the answer
  if (!req.body) return;
  const r = req.body.getReader();
  try { for (;;) if ((await r.read()).done) break; } catch { /* gone */ }
}

export function stub(ns, name) { return ns.get(ns.idFromName(name)); }

export async function internal(ns, name, path, body, headers = {}) {   // a call from one part of the relay to another
  const r = await stub(ns, name).fetch("https://relay.internal" + path, {
    method: "POST", headers: { "content-type": "application/json", "x-buddy-internal": "1", ...headers },
    body: JSON.stringify(body),
  });
  return r.json();
}
