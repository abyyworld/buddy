// Buddy for phones' storage (web/solo/store.js, SPEC3 §6), in Node with an in-memory IndexedDB: put() refuses anything
// private (anywhere in it), everything with content is encrypted at rest (nothing readable in a dump of the whole
// database, the keys non-extractable), the wipe marker (set, cleared, an interrupted wipe finished at the next start), a
// lost key said as such, and nothing but the marker ever in localStorage. Fake data and keys only.
//   node tests/solo/unit_store.mjs
import { readFileSync, readdirSync } from "node:fs";
import { FakeIDB, FakeStorage } from "../phonemode/fake_idb.mjs";
import { device, staticKit, fakeTinfoil, post, ndjson, jpeg, dumpText, runner, ROOT } from "./harness.mjs";

const { test, must, eq, run } = runner();
const KIT = staticKit();
const fresh = () => ({ idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session") });
const body = (k, id, d) => ({ k, v: 1, id, a: "dev", n: 1, h: "1760000000000:0000:dev", d });
async function opened(env) { const d = device(KIT, env); await d.Lib.store.init(); return d; }
async function refuses(p, what) {
  try { await p; } catch (e) { must(e.kind === "private", what + ": refused as private (" + e.message + ")"); return; }
  throw new Error("expected a refusal: " + what);
}

test("put() refuses an object with private or priv set, anywhere in it; a false one is fine", async () => {
  const env = fresh(), { Lib } = await opened(env), st = Lib.store;
  await refuses(st.putRec(body("msg", "c1", { content: "x", private: true })), "private in the data");
  await refuses(st.putRec(body("msg", "c2", { photo: { view: { priv: 1 } } })), "priv deep inside");
  await refuses(st.putRec(body("msg", "c3", { list: [{ a: 1 }, { private: "yes" }] })), "private in a list");
  await refuses(st.putRecs([{ body: body("msg", "ok1", { content: "fine" }) }, { body: body("msg", "c4", { private: true }) }]), "one private item in a batch");
  await refuses(st.setMeta("x", { private: true }), "meta");
  await refuses(st.setLocal({ char: "buddy", priv: true }), "preferences");
  await st.putRec(body("msg", "ok2", { content: "fine", private: false, priv: 0 }));
  const all = await st.allRecs("msg");
  eq(all.map((r) => r.body.id), ["ok2"], "only the non-private one, and none of the refused batch");
  must(st.hasPrivate({ a: [{ b: { private: 1 } }] }) && !st.hasPrivate({ private: false, priv: "" }), "hasPrivate");
});

test("encrypted at rest: a dump of the whole database holds no plaintext; the keys are non-extractable", async () => {
  const env = fresh(), { Lib } = await opened(env), st = Lib.store;
  await st.putRec(body("msg", "PLAIN-ID-1", { content: "PLAINTEXT-MESSAGE Zelda lives in Porto", char: "maya-7k2q" }), { char: "maya-7k2q", lid: 1 });
  await st.putRec(body("char", "maya-7k2q", { f: { name: ["h", "Maya Silverstone"] } }));
  await st.setSecret("tinfoil", "sk-FAKE-at-rest-0123456789");
  await st.setSecret("acctkeys", { kdata: "S0RBVEEtU0VDUkVU" });
  await st.setLocal({ char: "maya-7k2q", seen: { "maya-7k2q": 3 } });
  const t = dumpText(env);
  for (const bad of ["PLAINTEXT-MESSAGE", "Zelda", "Porto", "Maya Silverstone", "maya-7k2q", "PLAIN-ID-1", "sk-FAKE-at-rest", "S0RBVEEtU0VDUkVU",
                     Buffer.from("PLAINTEXT-MESSAGE").toString("base64").slice(0, 16)])
    must(!t.includes(bad), "the dump has no " + bad);
  const keys = env.idb.dump("buddy-site").keys;
  for (const k of ["atrest", "kidx"]) {
    const x = keys.find((r) => r.k === k);
    must(x && Object.prototype.toString.call(x.key) === "[object CryptoKey]" && x.key.extractable === false, k + " is a non-extractable CryptoKey");
  }
  eq((await st.allRecs("msg"))[0].body.d.content, "PLAINTEXT-MESSAGE Zelda lives in Porto", "it reads back through the store");
  eq(await st.getSecret("tinfoil"), "sk-FAKE-at-rest-0123456789", "the key reads back");
  eq((await st.getLocal()).char, "maya-7k2q", "the preferences read back");
  const recs = env.idb.dump("buddy-site").recs;
  must(recs.every((r) => r.enc && r.enc.iv && r.enc.ct && !("d" in r) && !("body" in r)), "rows hold only ciphertext and index fields");
  must(recs.find((r) => r.kind === "msg").ck && recs.find((r) => r.kind === "msg").ck.length === 11, "a character tag (HMAC, 8 bytes), not its id");
});

test("a whole session through BuddySolo with private messages: none of them in storage, not even decrypted", async () => {
  fakeTinfoil();
  const env = fresh(), d = device(KIT, env);
  eq((await d.S.init()).ok, true, "started");
  await d.S.setKey("sk-FAKE-solo-0123456789abcdef");
  await ndjson(await post(d.S, "/api/chat", { text: "a normal NORMAL-LINE", char: "buddy", via: "phone", private: false }));
  const before = (await d.Lib.store.allRecs()).length, mediaBefore = (env.idb.dump("buddy-site").media || []).length;
  await ndjson(await post(d.S, "/api/chat", { text: "PRIVATE-LINE my sister Zelda", char: "buddy", via: "phone", private: true }));
  const full = await (await d.S.fetch("/api/photo?part=full", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(800, 600)]) })).json();
  await d.S.fetch(`/api/photo?part=view&photo=${encodeURIComponent(full.photo)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(400, 300)]) });
  await ndjson(await post(d.S, "/api/chat", { text: "PRIVATE-PHOTO", char: "buddy", via: "phone", private: true, photo: full.photo }));
  await new Promise((r) => setTimeout(r, 200));
  const after = await d.Lib.store.allRecs();
  eq(after.length, before, "no record was added by the private chat");
  eq((env.idb.dump("buddy-site").media || []).length, mediaBefore, "no blob either");
  const plain = JSON.stringify(after.map((r) => r.body)) + JSON.stringify(await d.Lib.store.getLocal()), raw = dumpText(env);
  for (const bad of ["PRIVATE-LINE", "Zelda", "PRIVATE-PHOTO", "A red square"]) must(!plain.includes(bad) && !raw.includes(bad), "nothing private stored: " + bad);
  must(plain.includes("NORMAL-LINE") && !raw.includes("NORMAL-LINE"), "the normal one is stored, encrypted");
  const th = await (await d.S.fetch("/api/thread?after=0")).json();
  must(th.some((m) => m.private && m.content.includes("PRIVATE-LINE")), "the private one is on screen (memory)");
  const d2 = device(KIT, env); await d2.S.init();        // (the same phone, opened again)
  const th2 = await (await d2.S.fetch("/api/thread?after=0")).json();
  must(!th2.some((m) => m.private || /PRIVATE/.test(m.content)) && th2.some((m) => /NORMAL-LINE/.test(m.content)), "after a restart: gone; the normal one stays");
});

test("wipe: the marker is set first, the database deleted, the marker removed; an interrupted wipe is finished at the next start", async () => {
  const env = fresh(), { Lib } = await opened(env);
  await Lib.store.putRec(body("msg", "w1", { content: "soon gone" }));
  eq(await Lib.store.wipe(), true, "wiped");
  eq(await env.idb.databases(), [], "the database is gone");
  eq(env.ls.getItem("buddy.site.wipe"), null, "the marker is removed");
  eq(env.ls.log.map((x) => x.join(" ")), ["set buddy.site.wipe", "remove buddy.site.wipe"], "set, then removed (nothing else ever in localStorage)");
  const e2 = fresh(), a = await opened(e2);
  await a.Lib.store.putRec(body("msg", "w2", { content: "half gone" }));
  e2.idb.stuckDelete = true;                             // (some iOS builds: the delete never finishes)
  eq(await a.Lib.store.wipe(), false, "the delete didn't finish");
  eq(e2.ls.getItem("buddy.site.wipe"), "1", "the marker stays");
  e2.idb.stuckDelete = false;
  const b = device(KIT, e2), r = await b.Lib.store.init();
  eq([r.fresh, e2.ls.getItem("buddy.site.wipe")], [true, null], "the next start finished it: a fresh store, no marker");
  eq((await b.Lib.store.allRecs()).length, 0, "nothing from before");
});

test("a lost at-rest key is said as such (never read as empty); records without a key too", async () => {
  const env = fresh(), { Lib } = await opened(env);
  await Lib.store.putRec(body("msg", "l1", { content: "x" }));
  const d = env.idb.dbs.get("buddy-site");
  d.stores.get("keys").data.get("atrest").key = (await device(KIT, fresh()).sb.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
  let e = null;
  try { await device(KIT, env).Lib.store.init(); } catch (x) { e = x; }
  eq(e && e.kind, "lost", "another key: lost");
  d.stores.get("keys").data.clear();
  e = null;
  try { await device(KIT, env).Lib.store.init(); } catch (x) { e = x; }
  eq(e && [e.kind, e.message], ["lost", "This phone's copy can't be opened any more."], "no key but records: lost");
  const s = device(KIT, env);
  eq(await s.S.init(), { ok: false, kind: "lost", error: "This phone's copy can't be opened any more." }, "BuddySolo says so");
});

test("no IndexedDB or WebCrypto (private browsing): BuddySolo says so and stores nothing", async () => {
  const env = fresh(), d = device(KIT, env);
  d.sb.indexedDB = undefined;
  const r = await d.S.init();
  eq([r.ok, r.kind, r.error], [false, "nostorage", "Buddy needs normal browsing (not Private) to keep your chats."], "said plainly");
  eq(env.ls.log, [], "nothing written");
});

test("the site's only indexedDB.open is in store.js; no localStorage but the wipe marker; no console, no HTML sinks", async () => {
  const dir = ROOT + "web/solo/", n = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = readFileSync(dir + f, "utf8");
    n[f] = (s.match(/indexedDB\.open\(/g) || []).length;
    must(!/console\.|innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc|eval\(|new Function/.test(s), f + ": no console, HTML sinks or eval");
    for (const line of s.split("\n").map((l) => l.replace(/\s\/\/ .*$|^\s*\/\/.*$/, "")).filter((l) => /localStorage/.test(l))) must(/buddy\.site\.wipe/.test(line), f + ": localStorage only for the wipe marker: " + line.trim());
    must(!/https?:\/\/(?!atc\.tinfoil\.sh|inference\.tinfoil\.sh)[a-z]/i.test(s.replace(/\/\/.*$/gm, "")), f + ": no other host in code");
  }
  eq(Object.values(n).reduce((a, b) => a + b, 0), 1, "one indexedDB.open in web/solo: " + JSON.stringify(n));
  eq(n["store.js"], 1, "in store.js");
});

await run();
