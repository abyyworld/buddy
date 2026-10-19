// The relay's protocol tests: black box over HTTP, the same tests for ref.py and for the Worker (run.mjs starts them).
// T = {name, base, origin, inviteKey, quotas, now(), ctl: {advance(ms), housekeep(accts)}, dump() -> [Buffer] (every
// file the relay keeps), forensic (true when overwritten ciphertext must be gone from those files too)}.
// Everything here is made up in the test: random keys, invented records with "canary" strings that must never show
// up in anything the relay stores.
import assert from "node:assert/strict";
import { makeInvite, b32 } from "../common.js";
import { accountKeys, rid, seal, open, sealBlob, openBlob, newDevice, Replica, rand, b64e, b64d, dec } from "./client.mjs";

const KiB = 1024, MiB = 1024 * KiB, MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let T;

const CANARIES = [];                       // what the relay must never keep: plaintext, tokens, admin tokens, keys
function canary(label) { const s = `canary-${label}-${b64e(rand(9))}`; CANARIES.push([label, Buffer.from(s)]); return s; }
function secret(label, bytes) { CANARIES.push([label, Buffer.from(bytes)], [label + " (base64)", Buffer.from(b64e(bytes))]); }
let ipN = 0;
const freshIp = () => { ipN++; return `10.${(ipN >> 16) & 255}.${(ipN >> 8) & 255}.${ipN & 255}`; };

async function req(method, path, { auth, json, body, headers = {}, ip, origin } = {}) {
  const h = { ...headers };
  if (auth) h.authorization = auth;
  if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  h["x-test-ip"] = ip || "10.255.255.254";
  if (origin) h.origin = origin;
  const r = await fetch(T.base + path, { method, headers: h, body });
  const bytes = new Uint8Array(await r.arrayBuffer());
  let j = null;
  try { j = JSON.parse(dec.decode(bytes)); } catch { /* not JSON */ }
  return { status: r.status, json: j, bytes, headers: r.headers };
}
const is = (r, status, why) => assert.equal(r.status, status, `${why || ""} ${JSON.stringify(r.json)}`.trim());

const invite = (opts = {}) => makeInvite(T.inviteKey, { now: T.now(), ...opts });

async function hdrFor(keys, dev) {
  const r = await rid(keys, "hdr", "hdr");
  const ct = await seal(keys, r, 1, { k: "hdr", v: 1, id: "hdr", a: dev.id, n: 1, h: "0",
                                      d: { format: 1, creator: { edition: "public", app: canary("hdr") } } });
  return { rid: r, ct: b64e(ct) };
}

async function createReq(keys, dev, { ip = freshIp(), inv, auth = keys.admin, extra = {} } = {}) {
  return req("POST", `/v1/a/${keys.acct}`, { auth, ip, json: {
    invite: inv === undefined ? await invite() : inv, dev: { id: dev.id, token_hash: dev.token_hash },
    hdr: await hdrFor(keys, dev), ...extra } });
}

async function account({ ip, inv, keys } = {}) {   // a new account with its first device
  keys = keys || await accountKeys();
  secret("recovery key", keys.K); secret("admin token", keys.atok);
  const dev = await newDevice(); secret("device token", dev.token);
  inv = inv || await invite();
  const r = await createReq(keys, dev, { ip, inv });
  is(r, 201, "create");
  return { keys, dev, inv, a: `/v1/a/${keys.acct}` };
}

async function addDevice(acc, by = acc.dev.auth) {
  const d = await newDevice(); secret("device token", d.token);
  is(await req("POST", acc.a + "/devices", { auth: by, json: { id: d.id, token_hash: d.token_hash } }), 201, "add device");
  return d;
}

let nrec = 0;
async function rec(acc, ver, data = {}, kind = "msg", id = "m" + ++nrec) {   // a real record, sealed for (rid, ver)
  const r = await rid(acc.keys, kind, id);
  const body = { k: kind, v: 1, id, a: acc.dev.id, n: ver, h: "0", d: { content: canary("msg"), ...data } };
  return { rid: r, id, kind, ver, body, ct: await seal(acc.keys, r, ver, body) };
}
const item = (x, base, ct = x.ct) => ({ rid: x.rid, base, ct: ct === null ? null : b64e(ct) });
const put = (acc, items, dev = acc.dev) => req("POST", acc.a + "/put", { auth: dev.auth, json: { items } });
const changes = (acc, since = 0, q = "", dev = acc.dev) => req("GET", `${acc.a}/changes?since=${since}${q}`, { auth: dev.auth });
const fakeRid = () => b64e(rand(16));
const fakeCt = (p) => rand(p + 29);         // record-shaped: padded plaintext of p bytes
const fakeBlob = (p) => rand(p + 28);
const blobPut = (acc, bid, ct, rid = fakeRid(), dev = acc.dev) =>
  req("PUT", `${acc.a}/blob/${bid}`, { auth: dev.auth, body: ct, headers: { "x-rid": rid, "if-none-match": "*",
                                                                           "content-type": "application/octet-stream" } });
const usage = async (acc) => (await req("GET", acc.a + "/usage", { auth: acc.dev.auth })).json;
const has = (files, bytes) => files.some((f) => f.indexOf(Buffer.from(bytes)) >= 0);

async function minuteStart() {             // fixed one-minute windows: start a count right after one begins
  const now = await T.ctl.advance(0);
  await T.ctl.advance(MIN - (now % MIN) + 50);
}

// ---------------------------------------------------------------- basics
test("info: protocol v1, invite-only, no pushes yet, the limits", async () => {
  const r = await req("GET", "/v1/info");
  is(r, 200);
  assert.equal(r.json.v, 1); assert.equal(r.json.invite, true); assert.equal(r.json.push, false); assert.equal(r.json.vapid, null);
  const l = r.json.limits;
  assert.equal(l.records, T.quotas.records); assert.equal(l.devices, T.quotas.devices);
  assert.equal(l.record_max, MiB); assert.equal(l.blob_max, 16 * MiB); assert.equal(l.put_items, 200);
  assert.equal(l.changes_items, 500); assert.equal(l.requests_per_min, 600); assert.equal(l.box_ttl_s, 600);
});

test("CORS: only the site's origin, never credentials; nothing cached or sniffed", async () => {
  const o = T.origin, evil = "https://evil.example";
  let r = await req("OPTIONS", "/v1/a/" + "0".repeat(26) + "/put", { origin: o,
    headers: { "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } });
  is(r, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), o);
  for (const x of ["authorization", "content-type", "x-rid", "x-confirm", "x-delete-after", "if-none-match"])
    assert.ok(r.headers.get("access-control-allow-headers").includes(x), x);
  assert.equal(r.headers.get("access-control-max-age"), "86400");
  assert.equal(r.headers.get("access-control-allow-credentials"), null);
  r = await req("OPTIONS", "/v1/info", { origin: evil, headers: { "access-control-request-method": "GET" } });
  is(r, 403); assert.equal(r.headers.get("access-control-allow-origin"), null);
  r = await req("GET", "/v1/info", { origin: o });
  is(r, 200); assert.equal(r.headers.get("access-control-allow-origin"), o);
  assert.ok(r.headers.get("access-control-expose-headers").includes("retry-after"));
  r = await req("GET", "/v1/info", { origin: evil });
  is(r, 403); assert.equal(r.headers.get("access-control-allow-origin"), null);
  const acc = await account();
  is(await req("GET", acc.a + "/changes", { auth: acc.dev.auth, origin: evil }), 403, "another site's page");
  r = await req("GET", acc.a + "/changes", { auth: acc.dev.auth });       // the Mac sends no Origin
  is(r, 200); assert.equal(r.headers.get("access-control-allow-origin"), null);
  for (const x of [r, await req("GET", "/nope")]) {
    assert.equal(x.headers.get("cache-control"), "no-store");
    assert.equal(x.headers.get("x-content-type-options"), "nosniff");
  }
});

test("routes: unknown paths 404, wrong methods 405, pushes and live hints aren't in this relay yet", async () => {
  const acc = await account();
  is(await req("GET", "/nope"), 404);
  is(await req("GET", "/v1/a/NOT-AN-ACCOUNT/changes", { auth: acc.dev.auth }), 404);
  is(await req("GET", acc.a + "/nope", { auth: acc.dev.auth }), 404);
  is(await req("PUT", "/v1/info"), 405);
  is(await req("PATCH", acc.a + "/put", { auth: acc.dev.auth, json: {} }), 405);
  is(await req("GET", acc.a + "/put", { auth: acc.dev.auth }), 405);
  is(await req("PUT", acc.a + "/devices/self/push", { auth: acc.dev.auth, json: { endpoint: null } }), 404);
  is(await req("POST", acc.a + "/push", { auth: acc.dev.auth, json: {} }), 404);
  is(await req("DELETE", acc.a + "/push/abc", { auth: acc.dev.auth }), 404);
  is(await req("GET", acc.a + "/ws", { auth: acc.dev.auth }), 404);
  const other = await accountKeys();
  const r = await req("GET", `/v1/a/${other.acct}/changes`, { auth: acc.dev.auth });
  is(r, 404); assert.equal(r.json.error, "no account");
  is(await req("POST", acc.a + "/put", { auth: acc.dev.auth, body: "{not json", headers: { "content-type": "application/json" } }), 400);
  is(await req("POST", acc.a + "/put", { auth: acc.dev.auth, body: "x".repeat(3 * MiB + 1) }), 413);
});

// ---------------------------------------------------------------- accounts and invites
test("create: needs the admin token whose hash is the account id (no admin secret is stored)", async () => {
  const keys = await accountKeys(), other = await accountKeys(), dev = await newDevice(), ip = freshIp();
  is(await createReq(keys, dev, { ip, auth: other.admin }), 401, "another account's admin token");
  is(await createReq(keys, dev, { ip, auth: "Buddy-Admin " + b64e(rand(31)) }), 401, "malformed");
  is(await createReq(keys, dev, { ip, auth: dev.auth }), 401, "a device token");
  is(await createReq(keys, dev, { ip, auth: "" }), 401, "none");
  const r = await createReq(keys, dev, { ip });
  is(r, 201); assert.equal(r.json.seq, 1); assert.ok(Math.abs(r.json.now - T.now()) < 60000);
  is(await req("GET", `/v1/a/${keys.acct}/changes`, { auth: dev.auth }), 200);
});

test("create: invite-only (missing, garbage, forged, expired, used by another account)", async () => {
  const ip = freshIp(), dev = await newDevice();
  const k1 = await accountKeys(), k2 = await accountKeys();
  for (const [inv, why] of [[null, "missing"], ["AAAA-BBBB", "garbage"], [await makeInvite(rand(32), { now: T.now() }), "forged"],
                            [await invite({ now: T.now() - 40 * DAY, days: 30 }), "expired"]]) {
    const r = await createReq(k1, dev, { ip, inv });
    is(r, 403, why); assert.equal(r.json.error, "invite");
  }
  const inv = await invite();
  is(await createReq(k1, dev, { ip, inv: inv.toLowerCase().replace(/-/g, " ") }), 201, "typed loosely");
  const r = await createReq(k2, await newDevice(), { ip: freshIp(), inv });
  is(r, 403); assert.equal(r.json.why, "used");
});

test("create: at most 3 accounts a day from one IP", async () => {
  const ip = freshIp();
  for (let i = 0; i < 3; i++) await account({ ip });
  const r = await createReq(await accountKeys(), await newDevice(), { ip });
  is(r, 429);
  const after = Number(r.headers.get("retry-after"));
  assert.ok(after > 86000 && after <= 86400, String(after));
  await account({ ip: freshIp() });
  await T.ctl.advance(DAY + 1000);
  await account({ ip });
});

test("create: bad bodies, padding, 409 when it exists; extra plaintext fields aren't kept", async () => {
  const keys = await accountKeys(), dev = await newDevice(), ip = freshIp();
  secret("admin token", keys.atok); secret("device token", dev.token);
  const body = async (over) => ({ invite: await invite(), dev: { id: dev.id, token_hash: dev.token_hash },
                                  hdr: await hdrFor(keys, dev), ...over });
  const post = async (json) => req("POST", `/v1/a/${keys.acct}`, { auth: keys.admin, ip, json });
  is(await post(await body({ dev: { id: "short", token_hash: dev.token_hash } })), 400);
  is(await post(await body({ dev: { id: dev.id, token_hash: b64e(rand(16)) } })), 400);
  is(await post(await body({ hdr: { rid: fakeRid(), ct: b64e(rand(600)) } })), 400, "unpadded");
  is(await post(await body({ hdr: { rid: fakeRid(), ct: b64e(fakeCt(MiB + 64 * KiB)) } })), 413);
  is(await req("POST", `/v1/a/${keys.acct}`, { auth: keys.admin, ip, body: "nope" }), 400);
  const b = await body({ name: canary("account name"), email: canary("email") });
  b.dev.name = canary("device name");
  is(await post(b), 201);
  is(await post(await body({})), 409);
});

// ---------------------------------------------------------------- devices
test("devices: one revocable token each, only its hash kept; list; quota", async () => {
  const acc = await account();
  let r = await req("GET", acc.a + "/devices", { auth: acc.dev.auth });
  is(r, 200);
  assert.equal(r.json.length, 1);
  assert.deepEqual(Object.keys(r.json[0]).sort(), ["added", "by", "id", "push", "seen"]);
  assert.equal(r.json[0].id, acc.dev.id); assert.equal(r.json[0].by, "admin"); assert.equal(r.json[0].push, false);
  const d2 = await newDevice(); secret("device token", d2.token);
  r = await req("POST", acc.a + "/devices", { auth: acc.dev.auth,
                                              json: { id: d2.id, token_hash: d2.token_hash, name: canary("device name") } });
  is(r, 201); assert.equal(r.json.by, acc.dev.id);
  is(await changes(acc, 0, "", d2), 200, "the new device works");
  const d3 = await newDevice();
  r = await req("POST", acc.a + "/devices", { auth: acc.keys.admin, json: { id: d3.id, token_hash: d3.token_hash } });
  is(r, 201); assert.equal(r.json.by, "admin");
  is(await req("POST", acc.a + "/devices", { auth: acc.dev.auth, json: { id: d3.id, token_hash: d3.token_hash } }), 409);
  is(await req("POST", acc.a + "/devices", { auth: acc.dev.auth, json: { id: fakeRid(), token_hash: "x" } }), 400);
  while ((await req("GET", acc.a + "/devices", { auth: acc.dev.auth })).json.length < T.quotas.devices) await addDevice(acc);
  r = await req("POST", acc.a + "/devices", { auth: acc.dev.auth, json: { id: fakeRid(), token_hash: b64e(rand(32)) } });
  is(r, 507); assert.equal(r.json.what, "devices");
});

test("devices: removal revokes at once (410 {revoked: true}: the device wipes itself); 401 never means that", async () => {
  const acc = await account();
  const d2 = await addDevice(acc), d3 = await addDevice(acc, acc.keys.admin);
  is(await req("DELETE", `${acc.a}/devices/${d3.id}`, { auth: d2.auth }), 403, "a device can't remove another");
  let r = await req("DELETE", `${acc.a}/devices/${d2.id}`, { auth: acc.keys.admin });
  is(r, 200); assert.equal(r.json.revoked, d2.id);
  for (const [m, p, o] of [["GET", "/changes"], ["POST", "/put", { json: { items: [] } }], ["GET", "/usage"],
                           ["GET", "/devices"], ["GET", "/blob/" + fakeRid()], ["DELETE", "/devices/" + d2.id]]) {
    r = await req(m, acc.a + p, { auth: d2.auth, ...(o || {}) });
    is(r, 410, `${m} ${p}`); assert.equal(r.json.revoked, true);
  }
  r = await req("GET", acc.a + "/changes", { auth: `Bearer ${d2.id}.${b64e(rand(32))}` });
  is(r, 401, "a wrong token for a removed device"); assert.notEqual(r.json.revoked, true);
  is(await req("DELETE", `${acc.a}/devices/${d3.id}`, { auth: d3.auth }), 200, "a device removes itself");
  is(await changes(acc, 0, "", d3), 410);
  is(await req("POST", acc.a + "/devices", { auth: acc.keys.admin, json: { id: d2.id, token_hash: d2.token_hash } }), 409,
     "a removed device's id can't come back");
  r = await req("GET", acc.a + "/devices", { auth: acc.dev.auth });
  assert.deepEqual(r.json.map((d) => d.id), [acc.dev.id]);
  is(await req("DELETE", `${acc.a}/devices/${fakeRid()}`, { auth: acc.keys.admin }), 404);
  is(await changes(acc), 200, "the others keep working");
});

test("devices: adding and removing devices in a loop can't grow an account; removed ones are purged after 180 days", async () => {
  const acc = await account(), cap = 4 * T.quotas.devices;   // (removed devices' rows count toward 4 × the quota)
  let last, r;
  for (let rows = 1; rows < cap; rows++) {
    last = await addDevice(acc);
    is(await req("DELETE", `${acc.a}/devices/${last.id}`, { auth: last.auth }), 200, "it removes itself");
  }
  r = await req("POST", acc.a + "/devices", { auth: acc.dev.auth, json: { id: fakeRid(), token_hash: b64e(rand(32)) } });
  is(r, 507, "the rows a removed device keeps count too"); assert.equal(r.json.what, "devices");
  assert.deepEqual((await req("GET", acc.a + "/devices", { auth: acc.dev.auth })).json.map((d) => d.id), [acc.dev.id]);
  is(await changes(acc, 0, "", last), 410, "a removed device still learns it was removed");
  await T.ctl.advance(181 * DAY);
  is(await changes(acc), 200);
  await T.ctl.housekeep([acc.keys.acct]);
  r = await changes(acc, 0, "", last);
  is(r, 401, "purged after 180 days: a plain wrong token now"); assert.notEqual(r.json.revoked, true);
  await addDevice(acc);
  is(await changes(acc), 200, "the account still works");
});

test("auth: failed sign-ins back off per IP (429), other IPs unaffected", async () => {
  const acc = await account(), bad = `Bearer ${acc.dev.id}.${b64e(rand(32))}`, ipx = freshIp();
  for (let i = 0; i < 10; i++) is(await req("GET", acc.a + "/changes", { auth: bad, ip: ipx }), 401);
  const r = await req("GET", acc.a + "/changes", { auth: acc.dev.auth, ip: ipx });
  is(r, 429);
  const after = Number(r.headers.get("retry-after"));
  assert.ok(after >= 1 && after <= 600, String(after));
  is(await req("GET", acc.a + "/changes", { auth: acc.dev.auth, ip: freshIp() }), 200);
  await T.ctl.advance(601 * 1000);
  is(await req("GET", acc.a + "/changes", { auth: acc.dev.auth, ip: ipx }), 200);
});

// ---------------------------------------------------------------- records
test("records: compare-and-swap on versions, one account-wide seq", async () => {
  const acc = await account();
  const v1 = await rec(acc, 1, {}, "msg", "cas");
  let r = await put(acc, [item(v1, 0)]);
  is(r, 200); assert.deepEqual(r.json, { seq: 2, results: [{ rid: v1.rid, ver: 1, seq: 2 }] });
  const other = await rec(acc, 1, {}, "msg", "cas");
  r = await put(acc, [item(other, 0)]);
  is(r, 200); assert.equal(r.json.seq, 2);
  assert.deepEqual(r.json.results[0], { rid: v1.rid, conflict: { ver: 1, ct: b64e(v1.ct) } });
  const v2 = await rec(acc, 2, { edited: true }, "msg", "cas");
  r = await put(acc, [item(v2, 1)]);
  assert.deepEqual(r.json.results[0], { rid: v1.rid, ver: 2, seq: 3 });
  for (const base of [1, 0, 5]) {
    r = await put(acc, [item(await rec(acc, base + 1, {}, "msg", "cas"), base)]);
    assert.deepEqual(r.json.results[0].conflict, { ver: 2, ct: b64e(v2.ct) }, "base " + base);
  }
  assert.equal((await open(acc.keys, v1.rid, 2, b64d(r.json.results[0].conflict.ct))).d.edited, true);
  r = await changes(acc);
  is(r, 200);
  assert.equal(r.json.seq, 3);
  assert.deepEqual(r.json.items.map((i) => [i.ver, i.seq]), [[1, 1], [2, 3]]);
  const s = await rec(acc, 1);
  assert.equal((await put(acc, [item(s, 0)])).json.results[0].seq, 4);
});

test("records: a batch applies item by item; conflicts carry the current version; bad batches change nothing", async () => {
  const acc = await account();
  const a = await rec(acc, 1), b = await rec(acc, 1), c = await rec(acc, 4);
  let r = await put(acc, [item(a, 0), item(b, 0), item(c, 3)]);
  is(r, 200);
  assert.deepEqual(r.json.results, [{ rid: a.rid, ver: 1, seq: 2 }, { rid: b.rid, ver: 1, seq: 3 },
                                    { rid: c.rid, conflict: { ver: 0, ct: null } }]);
  const d = await rec(acc, 1);
  for (const items of [[item(d, 0), item(d, 0)], [{ rid: d.rid, base: -1, ct: b64e(d.ct) }],
                       [{ rid: d.rid, base: 0, ct: "!!" }], [{ rid: "x", base: 0, ct: null }], [{ rid: d.rid, base: 0 }]])
    is(await put(acc, items), 400, JSON.stringify(items).slice(0, 80));
  is(await req("POST", acc.a + "/put", { auth: acc.dev.auth, json: { items: [] } }), 400);
  assert.equal((await changes(acc)).json.seq, 3);
});

test("records: updates overwrite in place (no history kept)", async () => {
  const acc = await account();
  const v = [];
  for (let i = 1; i <= 3; i++) {
    v.push(await rec(acc, i, {}, "msg", "ow"));
    is(await put(acc, [item(v[i - 1], i - 1)]), 200);
  }
  const r = await changes(acc);
  const mine = r.json.items.filter((i) => i.rid === v[0].rid);
  assert.equal(mine.length, 1); assert.equal(mine[0].ver, 3); assert.equal(mine[0].ct, b64e(v[2].ct));
  if (T.forensic) {
    const files = await T.dump();
    assert.ok(has(files, v[2].ct.slice(1, 49)), "the current version is stored");
    assert.ok(!has(files, v[0].ct.slice(1, 49)) && !has(files, v[1].ct.slice(1, 49)), "older versions are gone from disk");
  }
});

test("records: padding enforced (only §7.4 sizes), tombstones need none", async () => {
  const acc = await account();
  for (const p of [512, 1024, 4096, 65536, 131072, 196608])
    is(await put(acc, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(p)) }]), 200, String(p));
  for (const p of [0, 511, 513, 1000, 65537, 100000, 131073]) {
    const r = await put(acc, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(p)) }]);
    is(r, 400, String(p)); assert.equal(r.json.error, "padding");
  }
  is(await put(acc, [{ rid: fakeRid(), base: 0, ct: null }]), 200);
});

test("records: 1 MiB a record, 2 MiB of ciphertext and 200 items a put", async () => {
  const acc = await account();
  is(await put(acc, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB)) }]), 200);
  is(await put(acc, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB + 64 * KiB)) }]), 413);
  is(await put(acc, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB)) }, { rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB)) }]), 413);
  is(await put(acc, Array.from({ length: 201 }, () => ({ rid: fakeRid(), base: 0, ct: null }))), 413);
});

test("changes: paging by count (≤ 500) and by size (≤ 4 MiB), strict cursors", async () => {
  const acc = await account();
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push(await rec(acc, 1));
  is(await put(acc, recs.map((x) => item(x, 0))), 200);
  let r = await changes(acc, 0, "&limit=3");
  assert.deepEqual(r.json.items.map((i) => i.seq), [1, 2, 3]);
  assert.equal(r.json.more, true); assert.equal(r.json.seq, 7); assert.equal(r.json.horizon, 0);
  assert.ok(Math.abs(r.json.now - T.now()) < 60000, "the relay's clock (devices learn their skew from it)");
  r = await changes(acc, 3, "&limit=3");
  assert.deepEqual(r.json.items.map((i) => i.seq), [4, 5, 6]); assert.equal(r.json.more, true);
  r = await changes(acc, 6, "&limit=3");
  assert.deepEqual(r.json.items.map((i) => i.seq), [7]); assert.equal(r.json.more, false);
  r = await changes(acc, 0, "&limit=1000");
  assert.equal(r.json.items.length, 7); assert.equal(r.json.more, false);
  r = await changes(acc, 99);
  is(r, 200); assert.deepEqual(r.json.items, []); assert.equal(r.json.seq, 7);
  for (const q of ["?since=-1", "?since=abc", "?since=1.5", "?since=0&limit=0", "?limit=x"])
    is(await req("GET", acc.a + "/changes" + q, { auth: acc.dev.auth }), 400, q);
  const big = await account();
  for (let i = 0; i < 4; i++) is(await put(big, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB)) }]), 200);
  r = await changes(big);
  assert.deepEqual(r.json.items.map((i) => i.seq), [1, 2, 3, 4]); assert.equal(r.json.more, true);
  r = await changes(big, 4);
  assert.deepEqual(r.json.items.map((i) => i.seq), [5]); assert.equal(r.json.more, false);
});

test("quotas: records and bytes (507, nothing applied), updates and deletes still work when full", async () => {
  const acc = await account();
  const fill = Array.from({ length: T.quotas.records - 1 }, () => ({ rid: fakeRid(), base: 0, ct: b64e(fakeCt(512)) }));
  is(await put(acc, fill), 200);
  let r = await put(acc, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(512)) }]);
  is(r, 507); assert.equal(r.json.what, "records");
  r = await put(acc, [{ rid: fakeRid(), base: 0, ct: null }]);
  is(r, 507, "a tombstone for a new id is a new row too");
  const seq = (await changes(acc, 0, "&limit=1")).json.seq;
  is(await put(acc, [{ ...fill[0], base: 1 }]), 200, "an update adds no row");
  is(await put(acc, [{ rid: fill[1].rid, base: 1, ct: null }]), 200, "deleting works when full");
  assert.equal((await changes(acc, 0, "&limit=1")).json.seq, seq + 2);
  const u = await usage(acc);
  assert.equal(u.records, T.quotas.records); assert.equal(u.quota.records, T.quotas.records);
  const big = await account(), rids = [];
  let n = 0;
  while ((await usage(big)).bytes + (MiB + 29) <= T.quotas.record_bytes) {
    rids.push(fakeRid());
    is(await put(big, [{ rid: rids[n++], base: 0, ct: b64e(fakeCt(MiB)) }]), 200);
  }
  r = await put(big, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB)) }]);
  is(r, 507); assert.equal(r.json.what, "bytes");
  is(await put(big, [{ rid: rids[0], base: 1, ct: null }]), 200);
  is(await put(big, [{ rid: fakeRid(), base: 0, ct: b64e(fakeCt(MiB)) }]), 200, "a delete frees its bytes");
});

// ---------------------------------------------------------------- blobs
test("blobs: upload once (412 after), the exact bytes back, X-Rid and padding required, 16 MiB", async () => {
  const acc = await account();
  const bid = fakeRid(), data = Buffer.from(canary("photo"));
  const { ct, ref } = await sealBlob(acc.keys, bid, data);
  is(await req("PUT", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth, body: ct }), 400, "no X-Rid");
  let r = await blobPut(acc, bid, ct);
  is(r, 201); assert.deepEqual(r.json, { bid, size: ct.length });
  is(await blobPut(acc, bid, ct), 412, "the same id again");
  r = await req("GET", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth });
  is(r, 200);
  assert.equal(r.headers.get("content-type"), "application/octet-stream");
  assert.deepEqual(Buffer.from(r.bytes), Buffer.from(ct));
  assert.deepEqual(Buffer.from(await openBlob(acc.keys, ref, r.bytes)), data);
  for (const n of [1000, 64 * KiB + 1, 64 * KiB - 1]) {
    r = await blobPut(acc, fakeRid(), rand(n + 28));
    is(r, 400, String(n)); assert.equal(r.json.error, "padding");
  }
  is(await blobPut(acc, fakeRid(), fakeBlob(16 * MiB)), 201, "16 MiB");
  is(await blobPut(acc, fakeRid(), fakeBlob(16 * MiB + 64 * KiB)), 413);
  const u = await usage(acc);
  assert.equal(u.blobs, 2); assert.equal(u.blob_bytes, ct.length + 16 * MiB + 28);
  r = await req("DELETE", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth });
  is(r, 200); assert.equal(r.json.deleted, true);
  is(await req("GET", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth }), 404);
  assert.equal((await req("DELETE", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth })).json.deleted, false);
  is(await req("GET", `${acc.a}/blob/${fakeRid()}`, { auth: acc.dev.auth }), 404);
});

test("blobs: the per-account quota (507), and a delete frees it", async () => {
  const acc = await account(), bids = [];
  while ((await usage(acc)).blob_bytes + (MiB + 28) <= T.quotas.blob_bytes) {
    bids.push(fakeRid()); is(await blobPut(acc, bids[bids.length - 1], fakeBlob(MiB)), 201);
  }
  const r = await blobPut(acc, fakeRid(), fakeBlob(MiB));
  is(r, 507); assert.equal(r.json.what, "blob_bytes");
  is(await req("DELETE", `${acc.a}/blob/${bids[0]}`, { auth: acc.dev.auth }), 200);
  is(await blobPut(acc, fakeRid(), fakeBlob(MiB)), 201);
});

test("blobs: copy into a new account (new recovery key) needs a device token of the old one", async () => {
  const old = await account(), neu = await account();
  const b1 = fakeRid(), b2 = fakeRid(), gone = fakeRid(), c1 = fakeBlob(64 * KiB), c2 = fakeBlob(128 * KiB);
  is(await blobPut(old, b1, c1), 201); is(await blobPut(old, b2, c2), 201);
  const bids = [b1, b2, gone].map((bid) => ({ bid, rid: fakeRid() }));
  const copy = (json, dev = neu.dev) => req("POST", neu.a + "/blob/copy", { auth: dev.auth, json });
  let r = await copy({ from: old.keys.acct, from_auth: old.dev.raw, bids });
  is(r, 200); assert.deepEqual(r.json, { copied: [b1, b2], missing: [gone], exists: [] });
  r = await req("GET", `${neu.a}/blob/${b2}`, { auth: neu.dev.auth });
  assert.deepEqual(Buffer.from(r.bytes), Buffer.from(c2));
  assert.equal((await usage(neu)).blob_bytes, c1.length + c2.length);
  assert.deepEqual((await copy({ from: old.keys.acct, from_auth: old.dev.raw, bids })).json.exists, [b1, b2]);
  is(await copy({ from: old.keys.acct, from_auth: neu.dev.raw, bids }), 403, "the new account's token");
  is(await copy({ from: neu.keys.acct, from_auth: neu.dev.raw, bids }), 400, "from itself");
  is(await copy({ from: (await accountKeys()).acct, from_auth: old.dev.raw, bids }), 404);
  is(await copy({ from: old.keys.acct, from_auth: old.dev.raw, bids: [{ bid: b1 }] }), 400);
  is(await req("DELETE", `${old.a}/devices/${old.dev.id}`, { auth: old.keys.admin }), 200);
  is(await copy({ from: old.keys.acct, from_auth: old.dev.raw, bids }), 403, "a removed device");
});

// ---------------------------------------------------------------- deletion and compaction
test("deletion: a tombstone replaces the ciphertext at once", async () => {
  const acc = await account();
  const v1 = await rec(acc, 1);
  is(await put(acc, [item(v1, 0)]), 200);
  const before = await usage(acc);
  let r = await put(acc, [item(v1, 1, null)]);
  assert.deepEqual(r.json.results[0], { rid: v1.rid, ver: 2, seq: 3 });
  r = await changes(acc);
  assert.deepEqual(r.json.items.find((i) => i.rid === v1.rid), { rid: v1.rid, ver: 2, seq: 3, ct: null });
  const after = await usage(acc);
  assert.equal(after.bytes, before.bytes - v1.ct.length); assert.equal(after.records, before.records);
  if (T.forensic) assert.ok(!has(await T.dump(), v1.ct.slice(1, 49)), "the deleted ciphertext is gone from disk");
  is(await put(acc, [item(await rec(acc, 3, {}, v1.kind, v1.id), 2)]), 200, "the relay leaves merge rules to devices");
});

test("compaction: tombstones go after 180 days; a cursor older than that gets 410 {horizon}", async () => {
  const acc = await account();
  const r1 = await rec(acc, 1), s = await rec(acc, 1);
  is(await put(acc, [item(r1, 0), item(s, 0)]), 200);
  const t = (await put(acc, [item(r1, 1, null)])).json.results[0];
  await T.ctl.advance(179 * DAY); await T.ctl.housekeep([acc.keys.acct]);
  assert.equal((await changes(acc)).json.items.length, 3, "kept for 180 days");
  await T.ctl.advance(2 * DAY); await T.ctl.housekeep([acc.keys.acct]);
  let r = await changes(acc);
  assert.deepEqual(r.json.items.map((i) => i.rid), [await rid(acc.keys, "hdr", "hdr"), s.rid]);
  assert.equal(r.json.horizon, t.seq);
  r = await changes(acc, 1);
  is(r, 410); assert.deepEqual(r.json, { error: "horizon", horizon: t.seq });
  is(await changes(acc, t.seq), 200);
  assert.equal((await usage(acc)).records, 2);
});

test("blob clean-up: unreferenced after 24 h, a deleted record's after 7 days", async () => {
  const acc = await account();
  const keep = await rec(acc, 1), del = await rec(acc, 1);
  const b1 = fakeRid(), b2 = fakeRid(), b3 = fakeRid();
  is(await blobPut(acc, b1, fakeBlob(64 * KiB), fakeRid()), 201);
  is(await blobPut(acc, b2, fakeBlob(64 * KiB), keep.rid), 201);
  is(await blobPut(acc, b3, fakeBlob(64 * KiB), del.rid), 201);
  is(await put(acc, [item(keep, 0), item(del, 0)]), 200);
  is(await put(acc, [item(del, 1, null)]), 200);
  const get = (b) => req("GET", `${acc.a}/blob/${b}`, { auth: acc.dev.auth });
  await T.ctl.advance(23 * HOUR); await T.ctl.housekeep([acc.keys.acct]);
  is(await get(b1), 200, "not yet");
  await T.ctl.advance(2 * HOUR); await T.ctl.housekeep([acc.keys.acct]);
  is(await get(b1), 404); is(await get(b2), 200); is(await get(b3), 200);
  await T.ctl.advance(7 * DAY); await T.ctl.housekeep([acc.keys.acct]);
  is(await get(b3), 404); is(await get(b2), 200);
  assert.equal((await usage(acc)).blobs, 1);
});

test("delete everything: X-Confirm, recovery key only, all gone at once", async () => {
  const acc = await account();
  const r1 = await rec(acc, 1), bid = fakeRid(), blob = fakeBlob(64 * KiB);
  is(await put(acc, [item(r1, 0)]), 200); is(await blobPut(acc, bid, blob, r1.rid), 201);
  const del = (auth, headers = {}) => req("DELETE", acc.a, { auth, headers });
  is(await del(acc.keys.admin), 400, "no X-Confirm");
  is(await del(acc.keys.admin, { "x-confirm": "0".repeat(26) }), 400);
  is(await del(acc.dev.auth, { "x-confirm": acc.keys.acct }), 403, "a device token can't");
  let r = await del(acc.keys.admin, { "x-confirm": acc.keys.acct });
  is(r, 200); assert.equal(r.json.deleted, true);
  for (const p of ["/changes", "/usage", "/devices", "/blob/" + bid]) {
    r = await req("GET", acc.a + p, { auth: acc.dev.auth });
    is(r, 404, p); assert.equal(r.json.error, "no account");
  }
  if (T.forensic) {
    const files = await T.dump();
    assert.ok(!has(files, r1.ct.slice(1, 49)) && !has(files, blob.slice(0, 48)), "nothing left on disk");
  }
  const dev = await newDevice();
  is(await createReq(acc.keys, dev, { inv: acc.inv }), 201, "the same account may use its invite again");
  r = await req("GET", acc.a + "/changes", { auth: dev.auth });
  assert.equal(r.json.items.length, 1, "a fresh, empty account");
  is(await req("GET", acc.a + "/blob/" + bid, { auth: dev.auth }), 404);
  is(await req("GET", acc.a + "/changes", { auth: acc.dev.auth }), 401, "old tokens are gone with it");
});

test("delete later: read-only until X-Delete-After (≤ 14 days), then gone", async () => {
  const acc = await account(), d2 = await addDevice(acc), bid = fakeRid();
  is(await blobPut(acc, bid, fakeBlob(64 * KiB)), 201);
  const del = (s) => req("DELETE", acc.a, { auth: acc.keys.admin, headers: { "x-confirm": acc.keys.acct, "x-delete-after": s } });
  for (const s of ["0", "1209601", "abc", "-5"]) is(await del(s), 400, s);
  const r = await del("3600");
  is(r, 202); assert.ok(Math.abs(r.json.delete_at - (T.now() + 3600 * 1000)) < 60000);
  const ro = [await put(acc, [{ rid: fakeRid(), base: 0, ct: null }]), await blobPut(acc, fakeRid(), fakeBlob(64 * KiB)),
              await req("POST", acc.a + "/devices", { auth: acc.dev.auth, json: { id: fakeRid(), token_hash: b64e(rand(32)) } }),
              await req("DELETE", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth })];
  for (const x of ro) { is(x, 409); assert.equal(x.json.error, "read-only"); assert.equal(x.json.delete_at, r.json.delete_at); }
  is(await changes(acc), 200, "still readable");
  is(await req("GET", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth }), 200);
  assert.equal((await usage(acc)).delete_at, r.json.delete_at);
  is(await req("DELETE", `${acc.a}/devices/${d2.id}`, { auth: acc.keys.admin }), 200, "removing a device still works");
  await T.ctl.advance(3601 * 1000); await T.ctl.housekeep([acc.keys.acct]);
  is(await changes(acc), 404);
});

test("idle accounts: deleted after 365 days without a signed-in request", async () => {
  const a1 = await account(), a2 = await account();
  await T.ctl.advance(200 * DAY);
  is(await changes(a2), 200);
  await T.ctl.advance(166 * DAY); await T.ctl.housekeep([a1.keys.acct, a2.keys.acct]);
  is(await changes(a1), 404); is(await changes(a2), 200);
});

// ---------------------------------------------------------------- limits
test("rate limit: 600 signed-in requests a minute per account", async () => {
  const acc = await account();
  await minuteStart();
  for (let i = 0; i < 600; i += 20)
    for (const r of await Promise.all(Array.from({ length: 20 }, () => req("GET", acc.a + "/usage", { auth: acc.dev.auth })))) is(r, 200);
  const r = await req("GET", acc.a + "/usage", { auth: acc.dev.auth });
  is(r, 429);
  const after = Number(r.headers.get("retry-after"));
  assert.ok(after >= 1 && after <= 60, String(after));
  const other = await account();
  is(await changes(other), 200, "per account");
  await T.ctl.advance(MIN);
  is(await req("GET", acc.a + "/usage", { auth: acc.dev.auth }), 200);
});

// ---------------------------------------------------------------- link mailboxes
const newBox = () => b32(rand(20)).toLowerCase().slice(0, 26);
const boxPut = (box, m, ip) => req("PUT", "/v1/m/" + box, { ip, json: { m: b64e(m) } });

test("mailboxes: up to 8 messages of 8 KiB, kept as given, 10 minutes, then gone", async () => {
  const box = newBox(), ip = freshIp();
  is(await req("GET", "/v1/m/" + box), 404);
  const first = Buffer.concat([rand(28), Buffer.from(canary("link"))]);    // (devices encrypt these; opaque here)
  let r = await boxPut(box, first, ip);
  is(r, 201); assert.equal(r.json.n, 1);
  const exp = r.json.exp;
  assert.ok(Math.abs(exp - (T.now() + 600 * 1000)) < 60000);
  for (let i = 2; i <= 8; i++) assert.equal((await boxPut(box, rand(100), ip)).json.n, i);
  r = await boxPut(box, rand(100), ip);
  is(r, 409); assert.equal(r.json.error, "full");
  r = await req("GET", "/v1/m/" + box);
  is(r, 200); assert.equal(r.json.msgs.length, 8); assert.equal(r.json.exp, exp);
  assert.deepEqual(Buffer.from(b64d(r.json.msgs[0].m)), first);
  assert.deepEqual((await req("GET", `/v1/m/${box}?after=6`)).json.msgs.map((m) => m.n), [7, 8]);
  is(await req("GET", `/v1/m/${box}?after=x`), 400);
  const b2 = newBox();
  is(await boxPut(b2, rand(8 * KiB + 1), ip), 413);
  is(await boxPut(b2, rand(8 * KiB), ip), 201);
  is(await req("PUT", "/v1/m/" + b2, { ip, json: { m: "" } }), 400);
  is(await req("PUT", "/v1/m/" + b2, { ip, body: "nope" }), 400);
  is(await req("DELETE", "/v1/m/" + box), 200);
  is(await req("GET", "/v1/m/" + box), 404);
  await T.ctl.advance(601 * 1000);
  is(await req("GET", "/v1/m/" + b2), 404, "expired");
  r = await boxPut(b2, rand(10), freshIp());
  is(r, 201); assert.equal(r.json.n, 1, "a fresh box");
  is(await req("GET", "/v1/m/NOT-A-BOX"), 404);
  is(await req("POST", "/v1/m/" + b2, { json: {} }), 405);
});

test("mailboxes: 30 reads a minute per box, 10 new boxes an hour per IP", async () => {
  const box = newBox();
  is(await boxPut(box, rand(10), freshIp()), 201);
  await minuteStart();
  for (let i = 0; i < 30; i++) is(await req("GET", "/v1/m/" + box), 200);
  is(await req("GET", "/v1/m/" + box), 429);
  await T.ctl.advance(MIN);
  is(await req("GET", "/v1/m/" + box), 200);
  const ip = freshIp();
  for (let i = 0; i < 10; i++) is(await boxPut(newBox(), rand(10), ip), 201);
  const r = await boxPut(newBox(), rand(10), ip);
  is(r, 429); assert.ok(Number(r.headers.get("retry-after")) > 3000);
  is(await boxPut(box, rand(10), ip), 201, "an open box still takes messages");
  is(await boxPut(newBox(), rand(10), freshIp()), 201);
  const v6 = (h) => `2001:db8:${ipN.toString(16)}:${h}`;           // an IPv6 /64 counts as one address
  for (let i = 1; i <= 10; i++) is(await boxPut(newBox(), rand(10), v6(`7::${i.toString(16)}`)), 201);
  is(await boxPut(newBox(), rand(10), v6("7:ffff:0:0:1")), 429, "the same /64");
  is(await boxPut(newBox(), rand(10), v6("8::1")), 201, "another /64");
  await T.ctl.advance(HOUR);
  is(await boxPut(newBox(), rand(10), ip), 201);
});

// ---------------------------------------------------------------- what a misbehaving relay can and can't do
test("attacks: moved, replayed, rolled-back, damaged or hidden records are caught (AAD = acct|rid|ver)", async () => {
  const acc = await account(), other = await account();
  const r1v1 = await rec(acc, 1, {}, "msg", "a1"), r2 = await rec(acc, 1, {}, "msg", "a2"), r3 = await rec(acc, 1, {}, "msg", "a3");
  is(await put(acc, [item(r1v1, 0), item(r2, 0), item(r3, 0)]), 200);
  const r1v2 = await rec(acc, 2, { edited: true }, "msg", "a1");
  is(await put(acc, [item(r1v2, 1)]), 200);
  const devRec = await rec(acc, 1, { recent: [[r3.rid, 1]] }, "dev", acc.dev.id);
  is(await put(acc, [item(devRec, 0)]), 200);
  const good = (await changes(acc)).json;
  const honest = new Replica(acc.keys);
  assert.deepEqual(await honest.apply(good), [], "an honest relay raises nothing");
  assert.equal(honest.recs.get(r1v1.rid).d.edited, true);
  const tamper = (fn) => { const c = structuredClone(good); fn(c.items, c); return c; };
  const find = (items, r) => items.find((i) => i.rid === r.rid);
  const flags = async (resp, rep = new Replica(acc.keys)) => (await rep.apply(resp)).map((f) => `${f.what}:${f.rid || ""}`);
  const othersCt = (await rec(other, 1, {}, "msg", "a2")).ct;
  assert.deepEqual(await flags(tamper((it) => { find(it, r2).ct = find(it, r1v1).ct; })), [`damaged:${r2.rid}`], "moved to another record");
  assert.deepEqual(await flags(tamper((it) => { find(it, r1v1).ct = b64e(r1v1.ct); })), [`damaged:${r1v1.rid}`], "an old version as the new one");
  assert.deepEqual(await flags(tamper((it) => { find(it, r2).ct = b64e(othersCt); })), [`damaged:${r2.rid}`], "from another account");
  assert.deepEqual(await flags(tamper((it) => { const c = b64d(find(it, r2).ct); c[40] ^= 1; find(it, r2).ct = b64e(c); })),
                   [`damaged:${r2.rid}`], "one bit changed");
  assert.deepEqual(await flags(tamper((it) => { find(it, r2).ver += 1; })), [`damaged:${r2.rid}`], "a version number changed");
  assert.deepEqual(await flags({ seq: good.seq, items: [{ rid: r1v1.rid, ver: 1, seq: 2, ct: b64e(r1v1.ct) }] }, honest),
                   [`older:${r1v1.rid}`], "rolled back to an older version");
  assert.deepEqual(await flags(tamper((it, c) => { c.items = it.filter((i) => i.rid !== r3.rid); })), [`hidden:${r3.rid}`],
                   "a device's write hidden");
});

test("attacks: replaying a captured write is refused by compare-and-swap; a revoked device can't replay", async () => {
  const acc = await account();
  const v1 = await rec(acc, 1, {}, "msg", "rp"), v2 = await rec(acc, 2, {}, "msg", "rp");
  const captured = [item(v1, 0)];
  is(await put(acc, captured), 200); is(await put(acc, [item(v2, 1)]), 200);
  let r = await put(acc, captured);
  assert.deepEqual(r.json.results[0].conflict, { ver: 2, ct: b64e(v2.ct) });
  r = await changes(acc);
  assert.equal(r.json.items.find((i) => i.rid === v1.rid).ct, b64e(v2.ct), "unchanged");
  const moved = fakeRid();
  is(await put(acc, [{ rid: moved, base: 0, ct: b64e(v2.ct) }]), 200, "the relay can't tell (it can't read)…");
  const rep = new Replica(acc.keys);
  assert.deepEqual((await rep.apply((await changes(acc)).json)).map((f) => f.what + ":" + f.rid), [`damaged:${moved}`],
                   "…but no device accepts it");
  const d2 = await addDevice(acc), v3 = await rec(acc, 3, {}, "msg", "rp");
  const cap2 = [item(v3, 2)];
  is(await req("DELETE", `${acc.a}/devices/${d2.id}`, { auth: acc.keys.admin }), 200);
  is(await put(acc, cap2, d2), 410);
});

test("attacks: swapped or moved blobs never open (hash in the record, AAD = acct|bid)", async () => {
  const acc = await account();
  const b1 = await sealBlob(acc.keys, fakeRid(), Buffer.from(canary("blob"))), b2 = await sealBlob(acc.keys, fakeRid(), rand(100));
  is(await blobPut(acc, b1.ref.bid, b1.ct), 201); is(await blobPut(acc, b2.ref.bid, b2.ct), 201);
  const get = async (bid) => (await req("GET", `${acc.a}/blob/${bid}`, { auth: acc.dev.auth })).bytes;
  await openBlob(acc.keys, b1.ref, await get(b1.ref.bid));
  await assert.rejects(openBlob(acc.keys, b1.ref, await get(b2.ref.bid)), /hash/, "swapped");
  const b3 = fakeRid();
  is(await blobPut(acc, b3, b1.ct), 201);
  await assert.rejects(openBlob(acc.keys, { ...b1.ref, bid: b3 }, await get(b3)), "moved to another id");
});

test("attacks: a relay that lost data or was reset is noticed (head seq below the device's high-water mark)", async () => {
  const acc = await account();
  const recs = [];
  for (let i = 0; i < 4; i++) recs.push(await rec(acc, 1));
  is(await put(acc, recs.map((x) => item(x, 0))), 200);
  const rep = new Replica(acc.keys);
  assert.deepEqual(await rep.apply((await changes(acc)).json), []);
  assert.equal(rep.hw, 5);
  is(await req("DELETE", acc.a, { auth: acc.keys.admin, headers: { "x-confirm": acc.keys.acct } }), 200);
  is(await createReq(acc.keys, acc.dev, { inv: acc.inv }), 201);
  const r = await changes(acc, rep.hw);
  is(r, 200);
  assert.deepEqual((await rep.apply(r.json)).map((f) => f.what), ["reset"]);
});

// ---------------------------------------------------------------- last: what the relay keeps
test("the relay never sees plaintext: no record body, name, token, admin token or recovery key in what it stores", async () => {
  const acc = await account();
  const live = await rec(acc, 1, { note: canary("live") });
  is(await put(acc, [item(live, 0)]), 200);
  const blob = await sealBlob(acc.keys, fakeRid(), Buffer.from(canary("live photo")));
  is(await blobPut(acc, blob.ref.bid, blob.ct, live.rid), 201);
  await new Promise((ok) => setTimeout(ok, 300));
  const files = await T.dump();
  assert.ok(files.length > 0);
  assert.ok(has(files, live.ct.slice(1, 49)), "control: the record's ciphertext is there");
  assert.ok(has(files, blob.ct.slice(0, 48)), "control: the blob's ciphertext is there");
  const found = CANARIES.filter(([, c]) => has(files, c)).map(([l]) => l);
  assert.deepEqual(found, [], "plaintext or secrets in the relay's storage");
  assert.ok(CANARIES.length > 100, `checked ${CANARIES.length} values`);
});

export async function conformance(target, log = console.log) {
  T = target;
  let fail = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try { await t.fn(); log(`  ok    ${t.name} (${Date.now() - t0} ms)`); }
    catch (e) { fail++; log(`  FAIL  ${t.name}\n${String(e.stack || e).split("\n").slice(0, 8).map((l) => "        " + l).join("\n")}`); }
  }
  return { total: tests.length, fail };
}
