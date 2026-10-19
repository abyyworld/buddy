// Unit tests for web/direct.js (phone mode), in Node, no browser: the pure helpers, and the stateful parts with
// direct.js in a vm "page" against an in-memory IndexedDB, fake web storage, a fake Mac (fetch) and the fake Tinfoil
// SDK (tests/phonemode/fake_tinfoil.mjs, which the page gets from import("/vendor/tinfoil.mjs") like in production).
// Fake data and a fake key only. Run:  node tests/phonemode/unit_direct.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as nodeModule from "node:module";
import { resolveObjectURL } from "node:buffer";
import { webcrypto } from "node:crypto";
import { FakeIDB, FakeStorage } from "./fake_idb.mjs";

process.removeAllListeners("warning");                  // (the vm loader option is marked experimental: no noise)
const SRC = readFileSync(new URL("../../web/direct.js", import.meta.url), "utf8");
const FAKE_SDK = new URL("./fake_tinfoil.mjs", import.meta.url).href;
if (!vm.constants || vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER === undefined) {
  console.error("needs node >= 20.12 (vm USE_MAIN_CONTEXT_DEFAULT_LOADER)"); process.exit(1);
}
if (nodeModule.registerHooks) {                          // /vendor/tinfoil.mjs (what the page imports) -> the fake SDK
  nodeModule.registerHooks({ resolve: (s, c, next) => (s === "/vendor/tinfoil.mjs" ? { url: FAKE_SDK, shortCircuit: true } : next(s, c)) });
} else {
  nodeModule.register("data:text/javascript," + encodeURIComponent(
    `export async function resolve(s, c, n) { return s === "/vendor/tinfoil.mjs" ? { url: ${JSON.stringify(FAKE_SDK)}, shortCircuit: true } : n(s, c); }`));
}

const KEY = "sk-FAKE-0123456789abcdef";
const KEY_FORMS = [KEY, Buffer.from(KEY).toString("base64"), encodeURIComponent(KEY), Buffer.from(KEY).toString("base64url")];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000, what = "condition") => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(10); }
  throw new Error("timed out waiting for " + what);
};

// ---------- the fake Mac (what direct.js asks it with the real fetch) ----------
const KIT = {
  v: 3, name: "Buddy", tz: "UTC", see_photos: true, companion_on_phala: false,
  chars: [
    { id: "buddy", name: "Buddy", tagline: "Your closest friend", color: "#d9973c", avatar: 0, wallpaper: 0, builtin: true, brain: "advisor",
      voice: "casual_female", persona: "You are Buddy, a fake test persona.",
      facts: { own: [{ text: "I live in Lisbon.", date: "2026-10-08" }], shared: [{ text: "We both like tea.", date: "" }] },
      knows_ask: { phone: { have: "KA-phone-have", none: "KA-phone-none" }, call: { have: "KA-call-have", none: "KA-call-none" } },
      life: { log: { about: ["Has a cat"], people: [], ongoing: [], weeks: [], days: [] },
              friends: [{ id: "mara", name: "Mara", how: "old friends", log: { about: [], people: [], ongoing: [{ what: "pottery class" }], weeks: [], days: [] } }] } },
    { id: "mara", name: "Mara", tagline: "Ceramicist", color: "#5b8def", avatar: 1700000000000, wallpaper: 0, builtin: false, brain: "companion",
      voice: "Serena", persona: "You are Mara, a fake ceramicist.",
      facts: { own: [{ text: "MARA-FACT: I work at the studio.", date: "2026-10-01" }], shared: [{ text: "We both like tea.", date: "" }] },
      knows_ask: { phone: { have: "KA", none: "KA" }, call: { have: "KA", none: "KA" } },
      life: { log: { about: ["MARA-LIFE glazes bowls"], people: [], ongoing: [], weeks: [], days: [] },
              friends: [{ id: "buddy", name: "Buddy", how: "", log: { about: [], people: [], ongoing: [{ what: "reading" }], weeks: [], days: [] } }] } },
  ],
  voices: [{ id: "casual_female", label: "Casual (female)" }, { id: "Serena", label: "Serena (female)" }],
  voice: { default: "casual_female", ids: ["casual_female", "Serena", "casual_male"] },
  prompts: { modes: { advisor: "ADVISOR-MODE", companion: "COMPANION-MODE" }, styles: { phone: "PHONE-STYLE", call: "CALL-STYLE" },
    length: { long: "LONG", tiny: "TINY", short: "SHORT", medium: "MEDIUM" }, facts_head: "FACTS:", facts_rule: "RULE.", photo_safety: "SAFETY.",
    cant_see: "CANT-SEE.", looked: "[I'm sending you a photo. A private helper looked at it for you, so react as if you saw it: {desc}]\n{text}",
    describe: "DESCRIBE-IT.", no_photos: "NO-PHOTOS." },
  facts_paths: { shared: "Buddy knows/_everyone", own_prefix: "Buddy knows/" },
  models: { advisor: { preferred: "gemma4-31b", fallbacks: ["gemma4-31b", "glm-5-3"] }, companion: { preferred: null, fallbacks: ["deepseek-v4-1-flash", "kimi-k3"] },
    vision_order: ["gemma4-31b", "deepseek-v4-1-flash", "kimi-k3"], no_thinking: { "deepseek-v4-1-flash": { reasoning_effort: "none" } },
    always_thinks: ["glm-5-3"], temperature: 0.9, call_max_tokens: 300, stt: "whisper-large-v3-turbo", stt_next: "voxtral-small-24b" },
  tinfoil: { ids: [], meta: {} }, stt: { language: "", model: "" },
  edition: { public: false }, billing: { out: "OUT-OF-CREDITS (fake)", limit: "SPEND-LIMIT (fake)" },
  call: { greetings: ["Hey!"], fillers: ["Hmm."], missed: { missed: ["Say that again?"] } }, texting: { caps: { tiny: [2, 30], short: [3, 50], medium: [4, 80] } },
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
function fakeMac() {
  const m = { mode: "up", kit: structuredClone(KIT), etag: "e1", kitOff: false, thread: [], epochs: { buddy: 0, mara: 0 }, nextId: 1791459999000,
              log: [], importFail: 0, importDown: 0, partner: [], kitFree: false };
  m.context = () => {
    const chars = {};
    for (const c of m.kit.chars) {
      const msgs = m.thread.filter((x) => x.char === c.id);
      chars[c.id] = { epoch: m.epochs[c.id] || 0, last_ts: Math.max(0, ...msgs.filter((x) => x.role === "user" || x.role === "assistant").map((x) => x.ts)),
                      msgs: msgs.map((x) => ({ ...x })) };
    }
    return { upto: Math.max(0, ...m.thread.map((x) => x.id)), chars };
  };
  m.fetch = async (url, init = {}) => {
    const u = new URL(String(url), "http://phone.test"), body = init.body == null ? "" : String(init.body);
    m.log.push({ url: String(url), method: init.method || "GET", headers: { ...(init.headers || {}) }, body });
    if (m.mode === "down") throw new TypeError("Failed to fetch");
    if (m.mode === "502") return new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } });
    if (m.mode === "401" && u.pathname !== "/api/me") return json({ error: "pair" }, 401);
    if (u.pathname === "/api/me") return json({ paired: m.mode !== "401", device: m.mode === "401" ? null : { id: "p1", name: "Phone", kind: "phone" } });
    if (u.pathname === "/api/phonekit") {
      if (m.kitFree) return json({ error: "FREE-BRAIN-NO-KEY (fake)", phone_mode: false, free: true }, 403);
      if (m.kitOff) return json({ error: "phone mode is off on your Mac", phone_mode: false }, 403);
      const have = u.searchParams.get("have");
      return json({ v: 1, etag: m.etag, kit: have === m.etag ? null : m.kit, generated_at: Date.now() / 1000, context: m.context() });
    }
    if (u.pathname === "/api/thread/import") {
      if (m.importDown > 0) { m.importDown--; throw new TypeError("Failed to fetch"); }
      const j = JSON.parse(body), results = [];
      for (const it of j.messages) {
        if (it.role === "partner") { m.partner.push(it); results.push({ cid: it.cid, applied: true }); continue; }   // (a status)
        const dup = m.thread.find((x) => x.cid === it.cid);
        if (dup) { results.push({ cid: it.cid, id: dup.id, dup: true }); continue; }
        if (it.epoch < (m.epochs[it.char] || 0)) { results.push({ cid: it.cid, dropped: "deleted" }); continue; }
        const msg = { id: ++m.nextId, role: it.role, content: it.content, ts: it.ts, char: it.char, cid: it.cid, from: "phone", direct: true };
        for (const k of ["mode", "photo_desc", "seen_by", "seen", "emoji", "by", "knows"]) if (it[k] !== undefined) msg[k] = it[k];
        if (it.role === "reaction") msg.target = it.target_cid ? (m.thread.find((x) => x.cid === it.target_cid) || {}).id : it.target;
        if (it.photo) Object.assign(msg, { image: "f".repeat(32), w: 64, h: 48 });
        if (it.voice) Object.assign(msg, { voice: "a".repeat(32), dur: it.voice.dur });
        m.thread.push(msg); results.push({ cid: it.cid, id: msg.id });
      }
      return json({ ok: true, results, upto: Math.max(0, ...results.map((r) => r.id || 0)) });
    }
    return json({ error: "not found" }, 404);
  };
  return m;
}

// ---------- a "page": direct.js in its own vm context (a reload = a new page on the same storage) ----------
function newEnv() { return { idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session"), mac: fakeMac() }; }
function page(env) {
  const sb = { setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
    URL, URLSearchParams, Blob, Response, Request, Headers, ReadableStream, AbortController, AbortSignal, DOMException, DecompressionStream,
    structuredClone, MessageChannel, indexedDB: env.idb, localStorage: env.ls, sessionStorage: env.ss, isSecureContext: true,
    navigator: { storage: { persist: async () => true } }, fetch: (u, i) => env.mac.fetch(u, i) };
  vm.createContext(sb);
  new vm.Script(SRC, { filename: "direct.js", importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(sb);
  return sb.BuddyDirect;
}
const FAKE = () => ({
  ready: "ok", readyMs: 0, release: "v0.0.38",
  models: { status: 200, data: [{ id: "gemma4-31b", multimodal: true, type: "chat" }, { id: "deepseek-v4-1-flash" }, { id: "whisper-large-v3-turbo" }] },
  chat: [
    { when: { stream: false, image: true }, status: 200, json: { choices: [{ message: { content: "A red square on white." } }] } },
    { when: { stream: false }, status: 200, json: { choices: [{ message: { content: "ok" } }] } },
    { when: { stream: true }, status: 200, sse: ["[react: 😂] Hi there! ", "How are you?\n\nSecond text."], chunkMs: 2, done: true },
  ],
  speech: { pcm: { status: 200, chunks: 3, chunkBytes: 480 }, wav: { status: 200 } },
  stt: { status: 200, text: "hello there" },
  hold: {},
});
const tlog = () => globalThis.__FAKE_TINFOIL_LOG__;
function fresh(cfg) { globalThis.__FAKE_TINFOIL__ = { ...FAKE(), ...(cfg || {}) }; globalThis.__FAKE_TINFOIL_LOG__ = []; }
async function ready(env, { key = true } = {}) {      // phone mode on, the kit fetched, the key saved; then a reload into phone mode
  const D = page(env);
  await D.init();
  must((await D.setEnabled(true)).ok, "setEnabled");
  must((await D.refreshKit()).ok, "refreshKit");
  if (key) must((await D.setKey(KEY)).ok, "setKey");
  const P = page(env);
  await P.init();
  return P;
}
const post = (D, path, body, extra) => D.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...(extra || {}) });
const ndjson = async (res) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const seg = (m, body) => Uint8Array.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]);
function jpeg(w, h, extra = []) {                        // markers only (no pixels), like tests/test_pictures.py
  const b = (s) => Array.from(Buffer.from(s, "latin1"));
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe0, b("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")), ...extra,
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...Array(30).fill([0x12, 0x34, 0xff, 0x00, 0x56]).flat(), 0xff, 0xd9]);
}
const EXIF = seg(0xe1, Array.from(Buffer.from("Exif\0\0GPSGPSGPS", "latin1")));
async function sendPhoto(D, text, extra) {
  const full = await (await D.fetch("/api/photo?part=full", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(800, 600, EXIF)]) })).json();
  const v = await D.fetch(`/api/photo?part=view&photo=${encodeURIComponent(full.photo)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(400, 300, EXIF)]) });
  must(v.status === 200, "view upload " + v.status);
  return post(D, "/api/chat", { text, char: "buddy", private: false, via: "phone", photo: full.photo, ...(extra || {}) });
}

// ---------- the runner ----------
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
function must(c, what) { if (!c) throw new Error("expected: " + what); }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what}: got ${x.slice(0, 400)} want ${y.slice(0, 400)}`); }
const pure = () => page(newEnv())._pure;

// ---------- pure ----------
test("sseFeed: lines across chunks, \\r\\n, [DONE], finish_reason, errors", () => {
  const P = pure(), st = P.sseState(), out = [];
  const d = (t, f) => "data: " + JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: f || null }] });
  const whole = d("Hel") + "\r\n\r\n" + d("lo") + "\n\n" + 'data: {"error": {"message": "x"}}\n' + ": keep-alive\n" + d("!", "stop") + "\n";
  for (let i = 0; i < whole.length; i += 7) out.push(...P.sseFeed(st, whole.slice(i, i + 7)));
  eq(out, ["Hel", "lo", "", "!"], "deltas"); must(st.finished, "finish_reason ends it");
  const s2 = P.sseState(); P.sseFeed(s2, d("a") + "\ndata: [DONE]"); must(!s2.finished, "partial line kept"); P.sseEnd(s2); must(s2.finished, "[DONE] at the end");
  for (const bad of ["data: [1,2]\n", "data: 5\n", "data: null\n", "data: {oops\n"]) {
    let threw = false; try { P.sseFeed(P.sseState(), bad); } catch (e) { threw = true; } must(threw, "throws on " + bad);
  }
  const s3 = P.sseState(), got = [];
  P.sseFeed(s3, d("one") + "\n" + d("two") + "\n" + d("three") + "\n", (x) => { got.push(x); return x !== "two"; });
  eq(got, ["one", "two"], "a stop ends the reading");
});
test("newCid: 22 base64url characters, unique", () => {
  const P = pure(), seen = new Set();
  for (let i = 0; i < 10000; i++) { const c = P.newCid(); must(/^[A-Za-z0-9_-]{22}$/.test(c), "format " + c); seen.add(c); }
  must(seen.size === 10000, "unique");
});
test("batches: 100 items, one photo or voice message, ~20 MB", () => {
  const P = pure(), t = (i, n = 1) => ({ cid: "c" + i, seq: i, role: "user", content: "x".repeat(n) });
  eq(P.batches(Array.from({ length: 250 }, (_, i) => t(i))).map((b) => b.length), [100, 100, 50], "100 a request");
  const ph = { ...t(2), photo: { bytes: 1000 } }, vo = { ...t(4), voice: { bytes: 10 } };
  eq(P.batches([t(0), t(1), ph, t(3), vo, t(5)]).map((b) => b.map((x) => x.cid)), [["c0", "c1", "c2"], ["c3", "c4"], ["c5"]], "a media item ends a batch");
  eq(P.batches([t(0, 1e6), t(1, 1e6), t(2, 1e6), t(3, 1e6), t(4, 4e6), t(5)]).map((b) => b.length), [3, 1, 1, 1], "the size estimate");
  eq(P.batches([{ ...t(0), photo: { bytes: 30e6 } }, t(1)]).map((b) => b.length), [1, 1], "a big one alone");
  eq(P.localIds(1791459999123, [1, 2, 3]), [1791459999124, 1791459999125, 1791459999126], "local ids above the base");
});
test("systemPrompt: the adult line is always built in code", () => {
  const P = pure(), base = { kit: KIT, modeUsed: "advisor", via: "phone", extra: [], query: "", asking: false, lastTs: 0, nowSec: 1791460000, length: "" };
  for (const name of ["A.*(b)[c]+?$", "Zoë", "Buddy"]) {
    const kchar = { ...KIT.chars[0], name, persona: "You are a child." };
    const r = P.systemPrompt({ ...base, kchar });
    must(r.text.includes(`Your name is ${name}. You are an adult.`), "adult line for " + name);
  }
  let n = 0, threw = false;
  const tricky = { ...KIT.chars[0], get name() { return n++ ? "Someone" : "Else"; } };
  try { P.systemPrompt({ ...base, kchar: tricky }); } catch (e) { threw = /adult/.test(e.message); }
  must(threw, "throws if the line weren't there");
  const r = P.systemPrompt({ ...base, kchar: KIT.chars[0], asking: true });
  must(r.text.includes("KA-phone-have") && r.text.includes("FACTS:\n- We both like tea.\n- I live in Lisbon.\nRULE."), "facts and knows_ask");
  eq(r.used, [{ kind: "facts", path: "Buddy knows/_everyone", n: 1 }, { kind: "facts", path: "Buddy knows/buddy", n: 1 }], "sources");
});
test("pyFormat: one pass", () => {
  const P = pure();
  eq(P.pyFormat("{desc} / {text}", { desc: "{text}", text: "x" }), "{text} / x", "a value isn't formatted again");
  eq(P.pyFormat("{{x}} {a}", { a: 1 }), "{x} 1", "escaped braces");
  let threw = false; try { P.pyFormat("{nope}", {}); } catch (e) { threw = true; } must(threw, "unknown name throws");
});
test("classify: SDK and network errors -> the honest texts", () => {
  const P = pure(), T = P.texts, e = (name) => Object.assign(new Error("whatever " + KEY), { name });
  eq(P.classify(e("AttestationError")).text, T.attestation, "attestation");
  eq(P.classify(e("FetchError")).text, T.atc, "ATC");
  eq(P.classify(e("ConfigurationError")).text, T.config, "config");
  eq(P.classify(new TypeError("Failed to fetch")).text, T.network, "network");
  eq(P.classify({ kind: "timeout" }).text, T.network, "timeout");
  eq(P.classify(e("ProtocolError")).text, T.attestation, "anything else: not verified");
});
test("importItem: never private, never a local id; media round-trips as base64", () => {
  const P = pure(), full = Uint8Array.from([1, 2, 3, 250]), view = Uint8Array.from([9, 8]), audio = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
  const items = [
    { cid: "a".repeat(22), seq: 5, id: 99, local: true, private: true, direct: true, role: "user", char: "buddy", content: "hi", ts: 1, epoch: 0,
      photo: { full: full.buffer, view: view.buffer, w: 4, h: 4 }, photo_desc: "d", seen_by: "m" },
    { cid: "b".repeat(22), seq: 6, role: "assistant", char: "buddy", content: "yo", ts: 2, epoch: 0, mode: "advisor", reply_to: "a".repeat(22),
      voice: { data: audio.buffer, type: "audio/wav", dur: 1.5 }, call: true, knows: true, sources: [{ kind: "facts", path: "p", n: 1 }] },
    { cid: "c".repeat(22), seq: 7, role: "reaction", char: "buddy", content: "", ts: 3, epoch: 0, target_cid: "b".repeat(22), emoji: "😂", by: "you" },
    { cid: "d".repeat(22), seq: 8, role: "break", char: "buddy", content: "", ts: 4, epoch: 0, call: false },
  ];
  const out = items.map(P.importItem);
  for (const o of out) for (const k of ["private", "id", "local", "seq", "direct", "image", "voice_id"]) must(!(k in o), "no " + k);
  eq([...P.unb64(out[0].photo.full)], [...full], "full copy"); eq([...P.unb64(out[0].photo.view)], [...view], "view copy");
  eq([...P.unb64(out[1].voice.data)], [...audio], "voice"); eq(out[1].voice.dur, 1.5, "dur");
  must(out[1].call === true && !("call" in out[3]), "call only when true");
  eq(out[2].target_cid, "b".repeat(22), "target by cid");
});
test("Splitter: the cap stops a wall of texts", () => {
  const P = pure(), got = [];
  const sp = new P.Splitter("phone", [2, 80], (s, p) => got.push([s, p]));
  sp.add("one.\n\ntwo.\n\nthree.\n\nfour.\n\nfive.");
  must(sp.stopped, "stopped"); eq(sp.texts.length, 3, "three texts, then it stops");
  sp.end(); eq(sp.said("phone", false), "one.\n\ntwo.\n\nthree.", "separate texts by a blank line");
  eq(got, [["one.", false], ["two.", true], ["three.", true]], "p on a new text");
  const call = new P.Splitter("call", null, null); call.add("Hi *smiles* there. 😊 Ok"); call.end(); eq(call.said("call", false), "Hi there. Ok", "calls");
});

// ---------- stateful ----------
test("phone mode off: nothing is created, nothing contacts Tinfoil", async () => {
  fresh(); const env = newEnv(), D = page(env);
  await D.init();
  must(!D.enabled() && !env.idb.dbs.size && !env.idb.log.length, "no database"); must(!env.ls.log.length, "no local storage");
  await D.forgetChar("buddy"); await D.saveThumbs([{ id: "buddy", avatar: 1 }]);
  await D.wipe("off");
  must(!env.idb.dbs.size && !env.idb.log.some((l) => l.startsWith("open")), "still none"); must(!env.ls.log.length, "a phone without a database gets no marker");
  eq(tlog(), [], "no SDK use");
  must(D.supported().ok, "supported here");
});
test("enable, key, kit; nothing reaches Tinfoil before there's a key", async () => {
  fresh(); const env = newEnv(), D = page(env);
  await D.init(); must((await D.setEnabled(true)).ok, "on");
  eq((await D.setKey("not a key")).error, "that doesn't look like an API key", "key format");
  const r = await D.refreshKit(); must(r.ok && r.changed, "kit");
  must(D.have().kit && !D.have().key, "kit, no key");
  D.activate(); await sleep(30);
  eq(tlog(), [], "no ctor/ready/fetch without a key");
  must((await D.setKey("  " + KEY + "\n")).ok, "key saved");
  const dump = env.idb.dump();
  must(!JSON.stringify(dump).includes(KEY), "the key isn't stored in clear");
  const rec = dump.keys.find((k) => k.k === "tinfoil");
  must(rec && rec.ct && rec.iv && rec.at, "encrypted record"); must(dump.keys.find((k) => k.k === "wrap").key.extractable === false, "non-extractable");
  const P = page(env); await P.init();
  must(P.have().key && P.have().kit && !P.have().stale, "a reload has it");
  eq((await P.check()).ok, true, "check works"); eq((await P.check()).release, "v0.0.38", "release");
});
test("no key: warmUp, check and a chat stop first (no ctor, ready or fetch)", async () => {
  fresh(); const env = newEnv(), P = await ready(env, { key: false });
  P.activate(); await sleep(20);
  eq((await P.check()).error, P._pure.texts.nokey, "check");
  const lines = await ndjson(await post(P, "/api/chat", { text: "hi", char: "buddy", via: "phone" }));
  eq(lines, [{ error: P._pure.texts.nokey }], "chat says so");
  eq(tlog(), [], "nothing contacted Tinfoil");
  eq(env.idb.dump().outbox.length, 1, "your message is kept");
});
test("verification fails: nothing is sent, the message stays", async () => {
  fresh({ ready: "attestation" }); const env = newEnv(), P = await ready(env);
  P.activate();
  const lines = await ndjson(await post(P, "/api/chat", { text: "hi", char: "buddy", via: "phone" }));
  eq(lines, [{ error: P._pure.texts.attestation }], "the honest text");
  must(!tlog().some((e) => e.kind === "fetch"), "no fetch entry at all");
  eq(P.status().verified, false, "verified false"); eq(env.idb.dump().outbox.length, 1, "still in the outbox");
  for (const [how, text] of [["fetch", "atc"], ["network", "network"], ["config", "config"]]) {
    fresh({ ready: how }); const Q = await ready(newEnv());
    eq(await ndjson(await post(Q, "/api/chat", { text: "hi", char: "buddy", via: "phone" })), [{ error: Q._pure.texts[text] }], how);
  }
});
test("a chat: only through the SDK, only after ready(); texts, reaction, outbox order", async () => {
  fresh({ readyMs: 200 }); const env = newEnv(), P = await ready(env);
  P.activate();
  const res = await post(P, "/api/chat", { text: "hey how was your day", char: "buddy", mode: "advisor", private: false, via: "phone" });
  eq(res.headers.get("Content-Type"), "application/x-ndjson", "a stream");
  const lines = await ndjson(res);
  eq(lines, [{ mode: "advisor" }, { sources: [{ kind: "facts", path: "Buddy knows/_everyone", n: 1 }, { kind: "facts", path: "Buddy knows/buddy", n: 1 }] },
             { s: "Hi there!" }, { s: "How are you?" }, { s: "Second text.", p: 1 }, { react: "😂" }], "the Mac's lines");
  const L = tlog(), firstOk = L.findIndex((e) => e.kind === "ready-done" && e.ok), firstFetch = L.findIndex((e) => e.kind === "fetch");
  must(firstOk >= 0 && firstFetch > firstOk, "no fetch before ready-done ok");
  const chatReq = L.find((e) => e.kind === "fetch" && e.path === "/v1/chat/completions");
  eq(Object.keys(chatReq.headers).sort(), ["authorization", "content-type"], "only the headers of G2");
  eq(chatReq.headers.authorization, "Bearer " + KEY, "the key, as the header");
  must(chatReq.json.stream === true && chatReq.json.temperature === 0.9 && chatReq.json.model === "gemma4-31b", "body");
  const sys = chatReq.json.messages[0].content;
  must(sys.startsWith("You are Buddy, a fake test persona.\n\nYour name is Buddy. You are an adult.\n\nADVISOR-MODE\n\nPHONE-STYLE"), "system prompt");
  must(sys.endsWith("\n\nTINY") && sys.includes("YOUR OWN LIFE") && sys.includes("Your friend Mara (old friends), whom I also talk to: lately pottery class."), "life and length");
  must(sys.includes("FACTS:\n- We both like tea.\n- I live in Lisbon.\nRULE.") && /Right now it's \w+day \d\d \w+ \d{4}, \d\d:\d\d\./.test(sys), "facts and time");
  const ob = env.idb.dump().outbox.sort((a, b) => a.seq - b.seq);
  eq(ob.map((x) => x.role), ["user", "reaction", "assistant"], "outbox order");
  eq(ob[1].target_cid, ob[0].cid, "reaction on yours"); eq(ob[2].reply_to, ob[0].cid, "reply_to");
  eq(ob[2].content, "Hi there! How are you?\n\nSecond text.", "separate texts by a blank line");
  const th = await (await P.fetch("/api/thread?after=0")).json();
  eq(th.map((m) => m.role), ["user", "reaction", "assistant"], "thread");
  must(th.every((m) => m.local && m.direct && m.cid && m.id > 0), "local shapes");
  eq(th[1].target, th[0].id, "reaction target is the page id");
  must(P.busy() === false, "not busy after");
});
test("the key goes nowhere else", async () => {
  fresh(); const env = newEnv(), P = await ready(env);
  P.activate();
  await ndjson(await post(P, "/api/chat", { text: "hey", char: "buddy", via: "phone" }));
  await ndjson(await sendPhoto(P, "look"));
  const wav = new Uint8Array(await new Response(new Blob([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), new Uint8Array(40)])).arrayBuffer());
  const v = await (await P.fetch("/api/voice?char=buddy&private=0", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Blob([wav]) })).json();
  await ndjson(await post(P, "/api/chat", { text: v.text, char: "buddy", via: "phone", voice: v.voice, dur: 1 }));
  const first = (await (await P.fetch("/api/thread?after=0")).json()).find((m) => m.role === "assistant");
  await post(P, "/api/react", { id: first.id, emoji: "🔥" });
  await post(P, "/api/newchat", { char: "buddy" });
  await until(() => !P.busy(), 3000, "looks");
  const kinds = new Set(env.idb.dump().outbox.map((x) => x.role + (x.photo ? "+photo" : "") + (x.voice ? "+voice" : "")));
  for (const k of ["user", "user+photo", "user+voice", "assistant", "assistant+voice", "reaction", "break"]) must(kinds.has(k), "an outbox " + k);
  const T = P._pure.texts, texts = Object.values(T).concat([P._pure.keyText(401), P._pure.keyText(402), P._pure.keyText(429)]);
  const errs = ["AttestationError", "FetchError", "ConfigurationError", "TypeError", "ProtocolError"].map((n) => P._pure.classify(Object.assign(new Error(KEY), { name: n })));
  const items = env.idb.dump().outbox.map(P._pure.importItem);
  const haystack = JSON.stringify([P.status(), P.have(), errs, texts, items, [...env.ss.m], [...env.ls.m]]);
  for (const f of KEY_FORMS) must(!haystack.includes(f), "no key in status/have/errors/texts/import items");
  must((await P.sync()).ok, "sync");
  must(env.mac.log.length >= 2, "the Mac was asked");
  for (const r of env.mac.log) for (const f of KEY_FORMS) must(!JSON.stringify(r).includes(f), "no key in what went to the Mac: " + r.url);
  for (const e of tlog()) {
    const { headers, ...rest } = e;
    for (const f of KEY_FORMS) must(!JSON.stringify(rest).includes(f), "the key only as a header (" + e.kind + ")");
    if (headers) for (const [k, v] of Object.entries(headers)) for (const f of KEY_FORMS) must(!v.includes(f) || (k === "authorization" && v === "Bearer " + KEY), "header " + k);
  }
});
test("photos: cleaned, looked at, sync never runs ahead of a look", async () => {
  fresh(); const env = newEnv(), P = await ready(env);
  P.activate();
  await ndjson(await post(P, "/api/chat", { text: "before", char: "buddy", via: "phone" }));
  globalThis.__FAKE_TINFOIL__.hold = { look: true };
  globalThis.__FAKE_TINFOIL__.chat[0].hold = "look";
  const lines = await ndjson(await sendPhoto(P, "what's this?"));
  must(lines[0].mode === "advisor" && lines.some((l) => l.s), "an answer while the look runs (this model sees)");
  const chatReq = tlog().filter((e) => e.kind === "fetch" && e.path === "/v1/chat/completions" && e.json.stream).pop();
  const last = chatReq.json.messages[chatReq.json.messages.length - 1];
  must(Array.isArray(last.content) && last.content[1].type === "image_url", "the picture inline");
  const sent = Buffer.from(last.content[1].image_url.url.split(",")[1], "base64");
  must(!sent.includes(Buffer.from("Exif")), "no APP1 in what was sent");
  must(chatReq.json.messages[0].content.includes("SAFETY."), "photo safety line");
  must(P.busy(), "busy while the look runs");
  let s = await P.sync();
  must(s.ok, "sync ok");
  eq(env.mac.thread.map((m) => m.role), ["user", "reaction", "assistant"], "what came before the photo");
  must(env.mac.thread[0].content === "before" && !env.mac.thread.some((m) => m.image), "the photo (and after) waits for its look");
  const before = env.mac.thread.length;
  globalThis.__FAKE_TINFOIL__.hold = {};
  await until(() => !P.busy(), 3000, "the look");
  const item = env.idb.dump().outbox.find((x) => x.photo);
  eq([item.photo_desc, item.seen_by], ["A red square on white.", "gemma4-31b"], "described");
  const vision = tlog().find((e) => e.kind === "fetch" && e.json && e.json.stream === undefined && JSON.stringify(e.json).includes("image_url"));
  must(vision.json.max_tokens === 300 && vision.json.messages[0].content[0].text === "DESCRIBE-IT.", "the Mac's describe body");
  s = await P.sync();
  must(s.ok && env.mac.thread.length > before, "then it goes");
  must(env.mac.thread.find((m) => m.image).photo_desc === "A red square on white.", "with its description");
  const imports = env.mac.log.filter((r) => r.url === "/api/thread/import").map((r) => JSON.parse(r.body).messages);
  must(imports.every((b) => b.filter((x) => x.photo || x.voice).length <= 1), "one media item a request");
  const ph = imports.flat().find((x) => x.photo);
  must(!Buffer.from(ph.photo.full, "base64").includes(Buffer.from("Exif")), "the full copy is clean too");
});
test("photo the model can't see: look first, then talk (LOOKED); nobody can look: CANT_SEE", async () => {
  fresh({ models: { status: 200, data: [{ id: "gemma4-31b", multimodal: false }, { id: "kimi-k3", multimodal: true }] } });
  const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await sendPhoto(P, "look"));
  const req = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  must(req.json.messages.pop().content.startsWith("[I'm sending you a photo. A private helper looked at it for you, so react as if you saw it: A red square on white.]\nlook"), "LOOKED");
  fresh({ models: { status: 200, data: [{ id: "gemma4-31b", multimodal: true }] } });
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: false }, status: 400, errorText: "no pictures" }, { when: { stream: true, image: true }, status: 422 },
                                      { when: { stream: true }, status: 200, sse: ["Ok."] }];
  const Q = await ready(newEnv()); Q.activate();
  const lines = await ndjson(await sendPhoto(Q, "look"));
  must(lines.some((l) => l.s === "Ok."), "answered without the picture");
  const req2 = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  must(req2.json.messages[0].content.includes("CANT-SEE.") && !JSON.stringify(req2.json).includes("image_url"), "CANT_SEE and no picture");
});
test("frozen while active; refreshKit after a partial sync", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await post(P, "/api/chat", { text: "one", char: "buddy", via: "phone" }));
  await ndjson(await sendPhoto(P, "two"));
  await until(() => !P.busy(), 3000, "look");
  await ndjson(await post(P, "/api/chat", { text: "three", char: "buddy", via: "phone" }));
  const before = await (await P.fetch("/api/thread?after=0")).text();
  env.mac.importDown = 0;
  let kitAsked = env.mac.log.filter((r) => r.url.startsWith("/api/phonekit")).length;
  const orig = env.mac.fetch; let n = 0;
  env.mac.fetch = async (u, i) => { if (String(u) === "/api/thread/import" && ++n === 2) { env.mac.log.push({ url: String(u) }); throw new TypeError("Failed to fetch"); } return orig(u, i); };
  const s = await P.sync();
  must(!s.ok && s.down && s.sent > 0, "partial: " + JSON.stringify(s));
  must(env.mac.log.filter((r) => r.url.startsWith("/api/phonekit")).length > kitAsked, "refreshKit still ran");
  env.mac.fetch = orig;
  must((await P.sync()).ok, "the rest");
  must((await P.refreshKit()).ok, "kit again");
  eq(await (await P.fetch("/api/thread?after=0")).text(), before, "the page's thread is unchanged (no duplicates, same ids)");
  const dump = env.idb.dump();
  eq(dump.outbox.length, 0, "outbox empty in storage");
  must(dump.chats.find((c) => c.char === "buddy").msgs.some((m) => m.cid), "storage has the imported copies");
  eq(await P.pending(), 0, "pending");
  const Q = page(env); await Q.init(); Q.activate();
  const th = await (await Q.fetch("/api/thread?after=0")).json();
  eq(th.filter((m) => m.content === "one").length, 1, "after the reload: once, from the Mac");
  must(th.every((m) => !m.local), "nothing local any more");
});
test("forgetChar: facts, life, friends' entries, chats, outbox and thumb go at once", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await post(P, "/api/chat", { text: "hi Mara", char: "mara", via: "phone" }));
  env.idb.dbs.get("buddy-phone").stores.get("thumbs").data.set("mara", { id: "mara", v: 1, url: "data:image/jpeg;base64,AA==" });
  const M = page(env); await M.init();                 // (Mac mode: forget happens there)
  env.mac.mode = "down";
  await M.forgetChar("mara");
  const d = env.idb.dump(), kit = d.meta.find((x) => x.k === "kit").kit;
  const mara = kit.chars.find((c) => c.id === "mara");
  eq([mara.facts.own, mara.life], [[], null], "her facts and life");
  must(kit.chars.every((c) => !c.life || c.life.friends.every((f) => f.id !== "mara")), "no friend entry");
  must(!d.chats.some((c) => c.char === "mara" && c.msgs.length) && !d.outbox.some((x) => x.char === "mara") && !d.thumbs.some((x) => x.id === "mara"), "chats, outbox, thumb");
  eq(d.chats.find((c) => c.char === "mara").epoch, 1, "her conversation's new count is kept (the Mac didn't answer)");
  must(!JSON.stringify(d).includes("MARA-FACT") && !JSON.stringify(d).includes("MARA-LIFE"), "nothing of hers left");
  await M.forgetChar("buddy", true);
  must(!env.idb.dump().meta.find((x) => x.k === "kit").kit.chars.some((c) => c.id === "buddy"), "deleted: gone from the kit");
  const off = newEnv(), O = page(off); await O.init(); await O.forgetChar("mara");
  must(!off.idb.log.length, "phone mode off: no database opened");
});
test("wipe: everything, with the marker only while it runs", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  for (const t of ["a", "b"]) await ndjson(await post(P, "/api/chat", { text: t, char: "buddy", via: "phone" }));
  env.mac.mode = "down";
  env.ss.setItem("buddy.carry", "{}"); env.ss.setItem("buddy.direct", "1"); env.ss.setItem("buddy.note", "x");
  const url = P.mediaURL("local:nothing");
  must(url === null, "no media");
  const n = (await P.pending());
  must(n === 5, "five waiting (yours, their reply twice, one 😂: they don't react every time)");
  env.ls.log = [];
  await P.wipe("unpaired");
  must(!env.idb.dbs.has("buddy-phone"), "database deleted (with this page's own connection open)");
  eq(env.ls.log, [["set", "buddy.wipe"], ["remove", "buddy.wipe"]], "the marker during the delete only");
  must(!env.ss.m.has("buddy.carry") && !env.ss.m.has("buddy.direct"), "session keys gone");
  eq(env.ss.getItem("buddy.note"), `${n} phone-mode message(s) were deleted because this phone isn't paired any more`, "the count note");
  must(!P.active && !P.enabled() && !P.have().key, "memory cleared");
  eq(await (await P.fetch("/api/thread?after=0")).json(), { error: P._pure.texts.nokit }, "no kit any more");
  // a delete that never finishes: the next start finishes it before reading anything
  fresh(); const e2 = newEnv(), Q = await ready(e2);
  e2.idb.stuckDelete = true;
  await Q.wipe("off");
  eq(e2.ls.getItem("buddy.wipe"), "1", "marker left"); must(e2.idb.dbs.has("buddy-phone"), "still there");
  e2.idb.stuckDelete = false; e2.idb.log = [];
  const R = page(e2); await R.init();
  eq(e2.idb.log[0], "delete buddy-phone", "deleted first"); must(!e2.idb.log.some((l) => l.startsWith("open")), "never read");
  must(!R.enabled() && !e2.idb.dbs.has("buddy-phone") && e2.ls.getItem("buddy.wipe") === null, "phone mode off, marker gone");
});
test("expire: 30 days without the Mac", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await post(P, "/api/chat", { text: "kept", char: "buddy", via: "phone" }));
  const st = env.idb.dbs.get("buddy-phone").stores.get("meta").data.get("settings");
  st.macSeenAt = Date.now() - 31 * 86400000;
  env.idb.dbs.get("buddy-phone").stores.get("thumbs").data.set("buddy", { id: "buddy", v: 1, url: "data:," });
  const Q = page(env); await Q.init();
  must(Q.have().stale, "stale");
  await Q.expire();
  const d = env.idb.dump();
  must(d.meta.find((x) => x.k === "settings") && d.outbox.length === 3, "settings and outbox stay");
  must(!d.meta.some((x) => x.k === "kit" || x.k === "context") && !d.chats.length && !d.thumbs.length && !d.keys.some((k) => k.k === "tinfoil"), "kit, chats, thumbs, key gone");
  must(Q.status().expired && !Q.have().key, "expired");
  const R = page(env); await R.init(); must(R.status().expired, "still, after a reload");
  must((await R.refreshKit()).ok, "the Mac again"); must(!R.status().expired && R.have().kit && !R.have().key, "kit back, key needed");
  env.idb.dbs.get("buddy-phone").stores.get("meta").data.get("settings").macSeenAt = Date.now() - 25 * 86400000;
  const S = page(env); await S.init(); eq(S.status().staleInDays, 5, "warning from day 23");
  must(!S.have().stale, "not expired yet");
});
test("mediaFull: full copies are read from storage when needed, not held", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await sendPhoto(P, "pic"));
  await until(() => !P.busy(), 3000, "look");
  const Q = page(env); await Q.init(); Q.activate();
  const m = (await (await Q.fetch("/api/thread?after=0")).json()).find((x) => x.image);
  must(m.image.startsWith("local:") && m.w === 800 && m.h === 600, "local photo, the cleaned size");
  const vu = Q.mediaURL(m.image, true); must(vu && vu.startsWith("blob:"), "view copy"); must(Q.mediaURL(m.image, true) === vu, "made once");
  const fu = await Q.mediaFull(m.image), blob = resolveObjectURL(fu);
  const bytes = new Uint8Array(await blob.arrayBuffer()), stored = new Uint8Array(env.idb.dump().outbox.find((x) => x.photo).photo.full);
  eq([...bytes], [...stored], "the full copy, from storage");
  env.idb.dbs.get("buddy-phone").stores.get("outbox").data.clear();
  eq(await Q.mediaFull(m.image), null, "gone from storage: null (it wasn't in memory)");
  const v1 = await Q.fetch("/api/media/" + encodeURIComponent(m.image) + "?v=1");
  eq([v1.status, v1.headers.get("Content-Type")], [200, "image/jpeg"], "GET /api/media view");
  eq((await Q.fetch("/api/media/abcdef")).status, 404, "a Mac photo isn't here");
});
test("voice message, hearing, speech, react, new chat, calls", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  const wav = new Uint8Array(await new Response(new Blob([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), new Uint8Array(40)])).arrayBuffer());
  const v = await (await P.fetch("/api/voice?char=mara&private=0", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Blob([wav]) })).json();
  must(/^local:[A-Za-z0-9_-]{22}$/.test(v.voice) && v.text === "hello there", "voice upload");
  const stt = tlog().find((e) => e.path === "/v1/audio/transcriptions");
  eq(stt.multipart.map((p) => [p.name, p.value]), [["model", "whisper-large-v3-turbo"], ["prompt", "Mara."], ["file", undefined]], "multipart");   // (Whisper first, like the Mac)
  const lines = await ndjson(await post(P, "/api/chat", { text: v.text, char: "mara", via: "phone", voice: v.voice, dur: 2.5 }));
  must(lines.some((l) => l.voice_reply) && lines.some((l) => l.voice && l.voice.startsWith("local:")), "a voice reply");
  const req = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  must(req.json.messages.pop().content.startsWith("(a voice message) hello there"), "the voice message's words");
  const th = await (await P.fetch("/api/thread?after=0")).json();
  const mine = th.find((m) => m.role === "user"), theirs = th.find((m) => m.role === "assistant");
  must(mine.voice && mine.dur === 2.5 && theirs.voice && theirs.dur > 0, "voices both ways");
  must((await P.fetch("/api/media/" + encodeURIComponent(theirs.voice))).headers.get("Content-Type") === "audio/wav", "plays");
  eq((await post(P, "/api/chat", { text: "", char: "mara", via: "phone", voice: v.voice })).status, 400, "used up");
  const h = await P.fetch("/api/stt?char=mara", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  eq(await h.json(), { text: "hello there" }, "stt");
  globalThis.__FAKE_TINFOIL__.stt = { status: 400, errorText: "audio too short" };
  const h2 = await P.fetch("/api/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  eq([h2.status, (await h2.json()).unclear], [422, true], "unclear");
  const sp = await post(P, "/api/speak", { text: "Hey! 😊", voice: "Serena", stream: true });
  eq([sp.status, sp.headers.get("Content-Type"), sp.headers.get("X-Sample-Rate")], [200, "audio/pcm", "24000"], "pcm stream");
  eq((await sp.arrayBuffer()).byteLength, 1440, "all of it");
  const sp2 = await post(P, "/api/speak", { text: "Hey! 😊", voice: "Serena", stream: true });
  eq((await sp2.arrayBuffer()).byteLength, 1440, "a stock line, from memory");
  eq(tlog().filter((e) => e.path === "/v1/audio/speech" && e.json.input === "Hey!").length, 1, "asked once");
  globalThis.__FAKE_TINFOIL__.speech.pcm = { status: 422 };
  const sp3 = await post(P, "/api/speak", { text: "something else", stream: true });
  eq(sp3.headers.get("Content-Type"), "audio/wav", "a WAV after a 422");
  eq((await post(P, "/api/speak", { text: "😊" })).status, 204, "nothing to say");
  eq(await (await post(P, "/api/react", { id: theirs.id, emoji: "❤" })).json(), { ok: true }, "react");
  eq((await post(P, "/api/react", { id: theirs.id, emoji: "fire" })).status, 404, "not an emoji");
  eq(await (await post(P, "/api/react", { id: theirs.id, emoji: "🍕" })).json(), { ok: true }, "any one emoji");
  eq(await (await post(P, "/api/newchat", { char: "mara" })).json(), { ok: true }, "new chat");
  const ob = env.idb.dump().outbox.sort((a, b) => a.seq - b.seq);
  must(ob.some((x) => x.role === "reaction" && x.by === "you" && x.emoji === "❤️" && x.target_cid === ob.find((y) => y.role === "assistant").cid), "your reaction");
  eq(ob[ob.length - 1].role, "break", "break last");
  const start = await (await post(P, "/api/call/start", { char: "buddy" })).json();
  eq(start.greetings, ["Hey!"], "call lines");
  const ctrl = new AbortController();
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 200, sse: ["one. ", "two. ", "three. ", "four. ", "five."], chunkMs: 60 }];
  const res = await post(P, "/api/chat", { text: "hi", char: "buddy", via: "call", from: "phone" }, { signal: ctrl.signal });
  const rd = res.body.getReader(), dec = new TextDecoder();
  for (let got = ""; !got.includes('"s"');) got += dec.decode((await rd.read()).value);   // (Tinfoil is talking)
  ctrl.abort();
  let aborted = false; try { for (;;) { const r = await rd.read(); if (r.done) break; } } catch (e) { aborted = e.name === "AbortError"; }
  must(aborted, "the page's abort errors the stream");
  await until(() => tlog().some((e) => e.kind === "abort" && e.path === "/v1/chat/completions"), 2000, "Tinfoil stops");
  const call = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop().json;
  must(call.max_tokens === 300 && call.messages[0].content.includes("CALL-STYLE"), "call body");
  let pre = false; try { await post(P, "/api/chat", { text: "x", via: "call" }, { signal: AbortSignal.abort() }); } catch (e) { pre = e.name === "AbortError"; }
  must(pre, "an aborted signal rejects");
  eq((await P.fetch("/api/version")).status, 503, "Mac-only");
  eq(await (await P.fetch("/api/settings", { method: "POST", body: "{}" })).json(), { error: "needs your Mac (phone mode)" }, "Mac-only text");
});
test("private: memory only, never stored or synced", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  const lines = await ndjson(await post(P, "/api/chat", { text: "PRIVATE-XYZ", char: "buddy", via: "phone", private: true }));
  must(lines.some((l) => l.s), "answered");
  must(!JSON.stringify(env.idb.dump()).includes("PRIVATE-XYZ") && !env.idb.dump().outbox.length, "nothing stored");
  eq(P.privateCount(), 3, "held in memory (yours, their reaction, their reply)");
  const th = await (await P.fetch("/api/thread?after=0")).json();
  must(th.every((m) => m.private === true) && th.length === 3, "private shapes");
  await P.sync();
  must(!env.mac.log.some((r) => (r.body || "").includes("PRIVATE-XYZ")), "never synced");
  const Q = page(env); await Q.init(); eq(Q.privateCount(), 0, "gone on reload");
});
test("probe and recentlyDown", async () => {
  fresh(); const env = newEnv(), D = page(env);
  eq(await D.probe(0), { up: false, why: "timeout" }, "probe(0)");
  eq(await D.probe(500), { up: true, me: { paired: true, device: { id: "p1", name: "Phone", kind: "phone" } } }, "up");
  env.mac.mode = "down"; eq((await D.probe(500)).why, "network", "network");
  env.mac.mode = "502"; eq((await D.probe(500)).why, "proxy", "5xx");
  env.mac.mode = "up"; const f = env.mac.fetch; env.mac.fetch = () => new Promise(() => {});
  eq((await D.probe(50)).why, "timeout", "hang"); env.mac.fetch = f;
  eq(await D.recentlyDown(), false, "nothing yet");
  env.ss.setItem("buddy.direct", String(Date.now() - 1000)); eq(await D.recentlyDown(), "down", "a switch just now");
  env.ss.setItem("buddy.direct", String(Date.now() - 61000)); eq(await D.recentlyDown(), false, "too long ago");
});
test("refreshKit: the Mac turned phone mode off; unpaired wipes", async () => {
  fresh(); const env = newEnv(), P = await ready(env);
  env.idb.dbs.get("buddy-phone").stores.get("meta").data.get("settings").macSeenAt = Date.now() - 40 * 86400000;
  const M = page(env); await M.init();
  must(M.have().stale, "(40 days since the Mac answered)");
  env.mac.kitOff = true;
  const r = await M.refreshKit();
  must(r.off && M.status().macOff, "off");
  const d = env.idb.dump();
  must(!d.meta.some((x) => x.k === "kit") && d.keys.some((k) => k.k === "tinfoil"), "kit gone, key kept");
  must(!M.have().stale && Date.now() - d.meta.find((x) => x.k === "settings").macSeenAt < 5000, "the Mac answered: the 30 days start again");
  env.mac.kitOff = false; must((await M.refreshKit()).ok && !M.status().macOff, "back on");
  env.mac.mode = "401"; await M.refreshKit();
  must(!env.idb.dbs.has("buddy-phone"), "unpaired: wiped");
  void P;
});
test("another page turned phone mode off: this page forgets everything too and never makes it again", async () => {
  fresh(); const env = newEnv(), A = await ready(env); A.activate();
  await ndjson(await post(A, "/api/chat", { text: "before", char: "buddy", via: "phone" }));
  const B = page(env); await B.init();
  must(B.enabled() && A.enabled(), "both pages see phone mode");
  must((await B.setEnabled(false)).ok, "off (in the other page)");
  must(!env.idb.dbs.has("buddy-phone"), "deleted");
  must(!A.enabled() && !A.active && !A.have().key && !A.have().kit, "this page forgot it too");
  const n = tlog().length;
  await A.refreshKit(); await A.pending(); await A.sync(); await A.saveThumbs([]);
  eq((await post(A, "/api/chat", { text: "after", char: "buddy", via: "phone" })).status, 503, "no phone mode any more");
  must(!env.idb.dbs.has("buddy-phone"), "never made again");
  eq(tlog().length, n, "nothing more went to Tinfoil");
  const C = page(env); await C.init();
  must(!C.enabled(), "a new page: phone mode is off");
});
test("a connection the browser lost is opened again (no false storage or key error)", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await post(P, "/api/chat", { text: "one", char: "buddy", via: "phone" }));
  const Q = page(env); await Q.init();
  const lose = () => { for (const c of env.idb.dbs.get("buddy-phone").conns) c.closed = true; };   // (WebKit lost its storage process)
  lose(); Q.activate();
  const lines = await ndjson(await post(Q, "/api/chat", { text: "two", char: "buddy", via: "phone" }));
  must(lines.some((l) => l.s) && !lines.some((l) => l.error), "answered: " + JSON.stringify(lines));
  lose();
  const l3 = await ndjson(await post(Q, "/api/chat", { text: "three", char: "buddy", via: "phone" }));
  must(l3.some((l) => l.s) && !l3.some((l) => l.error), "and again: " + JSON.stringify(l3));
  eq(Q.status().error, undefined, "no error"); must(Q.have().key, "the key is fine");
  eq(env.idb.dump().outbox.filter((x) => x.role === "user").map((x) => x.content).sort(), ["one", "three", "two"], "all stored");
});
test("imported messages stay in phone mode's copy until a stored context has them", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await post(P, "/api/chat", { text: "dinner with Ana is on Tuesday", char: "buddy", via: "phone" }));
  const orig = env.mac.fetch;
  env.mac.fetch = async (u, i) => { if (String(u).startsWith("/api/phonekit")) throw new TypeError("Failed to fetch"); return orig(u, i); };
  const s = await P.sync();
  must(s.ok && s.sent === 3, "imported: " + JSON.stringify(s));
  eq(env.idb.dump().outbox.length, 3, "kept: no stored context has them yet");
  eq(await P.pending(), 0, "nothing is waiting for the Mac");
  const n = env.mac.log.filter((r) => r.url === "/api/thread/import").length;
  await P.sync();
  eq(env.mac.log.filter((r) => r.url === "/api/thread/import").length, n, "not sent again by this page");
  env.mac.mode = "down";                               // the Mac away again: phone mode still has them
  const Q = page(env); await Q.init(); Q.activate();
  await ndjson(await post(Q, "/api/chat", { text: "when is dinner?", char: "buddy", via: "phone" }));
  const req = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  must(req.json.messages.some((m) => m.role === "user" && m.content === "dinner with Ana is on Tuesday"), "in the model's context");
  env.mac.mode = "up"; env.mac.fetch = orig;
  const s2 = await Q.sync();
  must(s2.ok && !s2.dropped.length, "synced (the old ones as dups)");
  eq(env.mac.thread.filter((m) => m.content === "dinner with Ana is on Tuesday").length, 1, "once on the Mac");
  eq(env.idb.dump().outbox.length, 0, "gone once a stored context has them");
  must(env.idb.dump().chats.find((c) => c.char === "buddy").msgs.some((m) => m.content === "dinner with Ana is on Tuesday"), "in the stored context");
});
test("after a reload, a photo whose look didn't finish is looked at again (phone mode only)", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  globalThis.__FAKE_TINFOIL__.hold = { look: true };
  globalThis.__FAKE_TINFOIL__.chat[0].hold = "look";
  await ndjson(await sendPhoto(P, "look at this"));
  const item = () => env.idb.dump().outbox.find((x) => x.photo);
  eq([item().photo_desc, item().seen], [undefined, undefined], "(the page went away while it looked)");
  globalThis.__FAKE_TINFOIL__.chat[0] = { ...globalThis.__FAKE_TINFOIL__.chat[0], hold: undefined };   // (the old look stays stuck)
  const M = page(env); await M.init();
  must(!M.busy(), "Mac mode doesn't look (the Mac does, once it's imported)");
  const Q = page(env); await Q.init(); Q.activate();
  must(Q.busy(), "phone mode looks again");
  await until(() => !Q.busy(), 3000, "the look");
  eq([item().photo_desc, item().seen_by], ["A red square on white.", "gemma4-31b"], "described");
  await ndjson(await post(Q, "/api/chat", { text: "what was in it?", char: "buddy", via: "phone" }));
  const req = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  must(JSON.stringify(req.json.messages).includes("A red square on white."), "later turns know what was in it");
  globalThis.__FAKE_TINFOIL__.hold = {};
  await until(() => !P.busy(), 3000, "the old page's look");
});
test("a forgotten conversation: later phone-mode messages carry the Mac's new count", async () => {
  fresh(); const env = newEnv(), P = await ready(env); void P;
  const M = page(env); await M.init();
  env.mac.epochs.mara = 3; env.mac.mode = "down";      // (forgotten on the Mac, which then can't be reached)
  await M.forgetChar("mara", false, 3);
  eq(env.idb.dump().chats.find((c) => c.char === "mara").epoch, 3, "the Mac's count is kept");
  const Q = page(env); await Q.init(); Q.activate();
  await ndjson(await post(Q, "/api/chat", { text: "hi Mara", char: "mara", via: "phone" }));
  must(env.idb.dump().outbox.every((x) => x.epoch === 3), "written with it");
  env.mac.mode = "up";
  const s = await Q.sync();
  must(s.ok && !s.dropped.length && s.sent >= 2, "added, not dropped as deleted: " + JSON.stringify(s));
});
test("a reply that can't be stored says so (it won't reach the Mac)", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  globalThis.__FAKE_TINFOIL__.hold = { reply: true };
  globalThis.__FAKE_TINFOIL__.chat[2].hold = "reply";
  const res = post(P, "/api/chat", { text: "hi", char: "buddy", via: "phone" });
  await until(() => (env.idb.dump().outbox || []).length === 1, 3000, "your message stored");
  env.idb.failWrites = true;                           // (the phone's storage is full)
  globalThis.__FAKE_TINFOIL__.hold = {};
  const lines = await ndjson(await res);
  must(lines.some((l) => l.s), "the reply shows");
  eq(P.status().error, P._pure.texts.storeReply, "and the page is told it wasn't kept");
  env.idb.failWrites = false;
  await ndjson(await post(P, "/api/chat", { text: "again", char: "buddy", via: "phone" }));
  eq(P.status().error, undefined, "cleared once storing works again");
});

// ---------- the same as the Mac since main gained cheaper models, credits, Whisper-first hearing, the public edition and
// the free brain: thinking off in texts, credits said plainly, Voxtral only when Whisper fails, the edition's rules,
// [partner: …] synced back, and phone mode off (saying why) with the free brain and no Tinfoil key on the Mac ----------
const WAV0 = () => new Uint8Array(Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(40)]));
const sttModels = () => tlog().filter((e) => e.path === "/v1/audio/transcriptions").map((e) => e.multipart.find((x) => x.name === "model").value);
const lastChat = () => tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop().json;
test("pure: thinking off in texts too; credits words; Whisper first; romance; partner tags; the new prompt order", () => {
  const P = pure(), k = KIT;
  eq(P.chatExtras(k, "deepseek-v4-1-flash", "phone", new Set()), { reasoning_effort: "none" }, "typed: thinking off, no cap");
  eq(P.chatExtras(k, "deepseek-v4-1-flash", "call", new Set()), { reasoning_effort: "none", max_tokens: 300 }, "a call: and a cap");
  eq(P.chatExtras(k, "deepseek-v4-1-flash", "phone", new Set(["deepseek-v4-1-flash"])), {}, "refused the switch: asked plainly");
  eq(P.chatExtras(k, "glm-5-3", "call", new Set()), {}, "a model that always thinks: no cap");
  eq([P.creditsKind(402, ""), P.creditsKind(429, "Spend limit reached"), P.creditsKind(429, "spending_limit"), P.creditsKind(429, "rate limited"),
      P.creditsKind(500, "spend limit")], ["out", "limit", "limit", null, null], "what a refusal says about the bill");
  eq([P.creditsText(k, "out"), P.creditsText(k, "limit"), P.creditsText(null, "out"), P.creditsText({}, "limit")],
     ["OUT-OF-CREDITS (fake)", "SPEND-LIMIT (fake)", P.BILLING.out, P.BILLING.limit], "the Mac's words from the kit");
  eq(P.keyText(402), P.BILLING.out, "a 402 is said like the Mac says it");
  must(/busy/.test(P.keyText(429)) && !/limit/.test(P.keyText(429)), "any other 429: just busy");
  const W = "whisper-large-v3-turbo", V = "voxtral-small-24b";
  eq([P.sttModel("", false, W, V), P.sttModel("", true, W, V), P.sttModel("x-model", false, W, V), P.sttModel(W, true, W, V),
      P.sttModel("bad model!", true, W, V), P.sttModel(undefined, false, W, V)], [W, V, "x-model", V, V, W], "Whisper first");
  const ed = { public: true, recheck: 100, romance: { yes: "Y", no: "N", no_recheck: "NR", no_noask: "NQ", unknown: "U", unknown_noask: "UQ" } };
  eq([P.romanceText(ed, { has: "yes" }, 1000), P.romanceText(ed, { has: "no", at: 950 }, 1000), P.romanceText(ed, { has: "no", at: 800 }, 1000),
      P.romanceText(ed, { has: "no", at: null }, 1000), P.romanceText(ed, { has: "no", noask: true }, 1000), P.romanceText(ed, {}, 1000),
      P.romanceText(ed, { noask: true }, 1000), P.romanceText(ed, null, 1000)], ["Y", "N", "NR", "NR", "NQ", "U", "UQ", "U"], "romance()");
  eq([..."[partner: no] hi [Partner:NOASK] [partner: maybe]".matchAll(P.PARTNER_TAG)].map((m) => m[1]), ["no", "NOASK"], "tags");
  const pub = { ...KIT, edition: { ...ed, halal: "HALAL-RULES", companion: "PUBLIC-COMPANION" } };
  const base = { kit: pub, kchar: KIT.chars[1], via: "phone", extra: ["EXTRA-LINE"], query: "", asking: false, lastTs: 0, nowSec: 1000, length: "LEN" };
  const t = P.systemPrompt({ ...base, modeUsed: "companion", partner: { has: "yes" } }).text;
  must(t.includes("You are an adult.\n\nPUBLIC-COMPANION\n\nPHONE-STYLE") && !t.includes("COMPANION-MODE"), "the public Companion's text");
  const at = (s) => t.indexOf(s);
  must(at("YOUR OWN LIFE") < at("FACTS:") && at("RULE.") < at("EXTRA-LINE") && at("EXTRA-LINE") < at("HALAL-RULES\nY\n\nRight now")
       && t.endsWith("\n\nLEN"), "what stays the same first, then this turn, the rules, the time and the length");
  const a = P.systemPrompt({ ...base, kit: KIT, modeUsed: "advisor" }).text;
  must(!a.includes("HALAL") && a.includes("ADVISOR-MODE") && a.indexOf("EXTRA-LINE") > a.indexOf("RULE."), "the private edition: no rules, the same order");
  let threw = false;
  try { P.systemPrompt({ ...base, kit: { ...KIT, edition: { public: true } }, modeUsed: "advisor" }); } catch (e) { threw = true; }
  must(threw, "a public kit without its rules fails closed");
});
test("a typed turn asks with thinking switched off, like the Mac", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  await ndjson(await post(P, "/api/chat", { text: "hey", char: "mara", via: "phone" }));
  const req = lastChat();
  eq([req.model, req.reasoning_effort, "max_tokens" in req], ["deepseek-v4-1-flash", "none", false], "deepseek: thinking off, no cap");
});
test("credits ran out: said plainly in chats, calls, hearing and voices, with a banner until a request works", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  const err = async (body) => (await ndjson(await post(P, "/api/chat", { char: "buddy", via: "phone", ...body }))).find((l) => l.error);
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 402, errorText: "payment required" }];
  eq(await err({ text: "hi" }), { error: "OUT-OF-CREDITS (fake)", credits: true }, "a chat");
  eq(await err({ text: "hi", via: "call" }), { error: "OUT-OF-CREDITS (fake)", credits: true }, "a call (never 'you cut out')");
  let st = await (await P.fetch("/api/status")).json();
  eq([st.credits, st.credits_note, P.status().credits], ["out", "OUT-OF-CREDITS (fake)", "out"], "the banner");
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 429, errorText: "This key reached its spend limit." }];
  eq(await err({ text: "hi" }), { error: "SPEND-LIMIT (fake)", credits: true }, "the key's spend limit");
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 429, errorText: "slow down" }];
  const busy = await err({ text: "hi" });
  must(!busy.credits && /busy/.test(busy.error), "any other 429: busy, not credits");
  globalThis.__FAKE_TINFOIL__.stt = { status: 402, errorText: "no credits" };
  const h = await P.fetch("/api/stt?char=buddy&call=1", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: WAV0() });
  eq([h.status, await h.json()], [402, { error: "OUT-OF-CREDITS (fake)", credits: true }], "hearing in a call");
  eq(sttModels().length, 1, "no other model tried (it's the bill, not Whisper)");
  const v = await P.fetch("/api/voice?char=buddy", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Blob([WAV0()]) });
  eq([v.status, (await v.json()).credits], [402, true], "a voice message");
  globalThis.__FAKE_TINFOIL__.speech = { pcm: { status: 402 }, wav: { status: 402 } };
  const sp = await post(P, "/api/speak", { text: "something new", stream: true });
  eq([sp.status, (await sp.json()).credits], [402, true], "their voice");
  eq(tlog().filter((e) => e.path === "/v1/audio/speech" && e.json.input === "something new").length, 1, "not asked again as a file");
  const sp2 = await post(P, "/api/speak", { text: "a file this time" });
  eq([sp2.status, (await sp2.json()).error], [402, "OUT-OF-CREDITS (fake)"], "a whole file: the same");
  fresh();                                             // (topped up: Tinfoil answers again)
  must((await ndjson(await post(P, "/api/chat", { text: "hi", char: "buddy", via: "phone" }))).some((l) => l.s), "answered");
  st = await (await P.fetch("/api/status")).json();
  eq([st.credits, st.credits_note], [null, ""], "the banner goes once a request works");
});
test("hearing: Whisper first, Voxtral only when Whisper itself fails (then for 10 minutes), only your language setting", async () => {
  fresh({ stt: { status: 200, text: "hello there", byModel: { "whisper-large-v3-turbo": { status: 404, errorText: "model 'whisper' not found" } } } });
  const env = newEnv(), P = await ready(env); P.activate();
  const stt = (q) => P.fetch("/api/stt?char=buddy" + (q || ""), { method: "POST", headers: { "Content-Type": "audio/wav" }, body: WAV0() });
  eq(await (await stt("&lang=pt")).json(), { text: "hello there" }, "heard (by Voxtral)");
  eq(sttModels(), ["whisper-large-v3-turbo", "voxtral-small-24b"], "Whisper, then Voxtral");
  eq(tlog().find((e) => e.path === "/v1/audio/transcriptions").multipart.find((x) => x.name === "language"), undefined, "never the device's language (hints made Whisper loop)");
  globalThis.__FAKE_TINFOIL__.stt.byModel = {};
  await stt();
  eq(sttModels().slice(-1), ["voxtral-small-24b"], "Voxtral for a while after Whisper failed");
  fresh({ stt: { status: 400, errorText: "audio too short" } });
  const Q = await ready(newEnv()); Q.activate();
  const r = await Q.fetch("/api/stt?char=buddy", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: WAV0() });
  eq([r.status, (await r.json()).unclear, sttModels()], [422, true, ["whisper-large-v3-turbo"]], "a sound Whisper can't use: no other model");
  fresh({ stt: { status: 200, text: "hi again", byModel: { "whisper-large-v3-turbo": { status: 503, errorText: "busy" } } } });
  const R = await ready(newEnv()); R.activate();
  const r2 = await R.fetch("/api/stt?char=buddy", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: WAV0() });
  eq([await r2.json(), sttModels()], [{ text: "hi again" }, ["whisper-large-v3-turbo", "voxtral-small-24b"]], "a 5xx: Voxtral");
  fresh({ stt: { status: 404, errorText: "model not found" } });
  const G = await ready(newEnv()); G.activate();
  const r3 = await G.fetch("/api/stt?char=buddy", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: WAV0() });
  eq(r3.status, 502, "neither is there: an error, not 'unclear'");
});
test("public edition: its rules in every prompt; [partner: …] changes your status here at once and reaches your Mac", async () => {
  fresh(); const env = newEnv();
  env.mac.kit.edition = { public: true, halal: "HALAL-RULES", companion: "PUBLIC-COMPANION", recheck: 15724800,
    romance: { yes: "R-YES", no: "R-NO", no_recheck: "R-NO-RECHECK", no_noask: "R-NO-NOASK", unknown: "R-UNKNOWN", unknown_noask: "R-UNKNOWN-NOASK" },
    partner: { has: "", at: null, noask: false } };
  const P = await ready(env); P.activate();
  const say = async (text, reply, extra) => {
    globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 200, sse: reply, done: true }];
    const lines = await ndjson(await post(P, "/api/chat", { text, char: "buddy", via: "phone", ...(extra || {}) }));
    return { lines, sys: lastChat().messages[0].content };
  };
  const a = await say("I'm single", ["[partner: no] Oh nice, ", "good to know."]);
  must(a.sys.includes("HALAL-RULES\nR-UNKNOWN\n\nRight now"), "not known yet");
  must(!JSON.stringify(a.lines).toLowerCase().includes("partner"), "the tag is never shown");
  must((await say("so?", ["ok"])).sys.includes("HALAL-RULES\nR-NO\n\nRight now"), "single, from the next turn");
  const kept = env.idb.dump().meta.find((x) => x.k === "partner");
  must(kept && kept.has === "no" && typeof kept.at === "number" && kept.cid && !JSON.stringify(kept).includes("single"), "kept: the status only");
  await say("we got married", ["[partner: yes] Congrats!"], { private: true });   // (a private chat: stricter is fine)
  await say("we split up", ["[partner: no] Oh no."], { private: true });          // (but never less strict)
  must((await say("hello", ["hey"])).sys.includes("HALAL-RULES\nR-YES\n\nRight now"), "married (a private 'no' didn't count)");
  await say("stop asking", ["[partner: noask] Okay."]);
  const s = await (await P.fetch("/api/settings")).json();
  eq([s.has_partner, s.partner_noask, s.free_brain], ["yes", true, false], "settings say it too");
  const M = page(env); await M.init();                 // (your Mac is back: Mac mode, a new page)
  await M.sync();
  eq(env.mac.partner.map((x) => [x.role, x.has, typeof x.at, x.noask]), [["partner", "yes", "number", true]], "sent once, as a status");
  must(!env.idb.dump().meta.some((x) => x.k === "partner"), "then forgotten here (the kit says it from now on)");
  await M.sync();
  eq(env.mac.partner.length, 1, "not again");
});
test("a status your Mac took while phone mode goes on (the rest didn't sync): it still counts here and after a reload, until the next kit", async () => {
  fresh(); const env = newEnv();
  env.mac.kit.edition = { public: true, halal: "HALAL-RULES", companion: "PUBLIC-COMPANION", recheck: 15724800,
    romance: { yes: "R-YES", no: "R-NO", no_recheck: "R-NO-RECHECK", no_noask: "R-NO-NOASK", unknown: "R-UNKNOWN", unknown_noask: "R-UNKNOWN-NOASK" },
    partner: { has: "", at: null, noask: false } };
  const P = await ready(env); P.activate();
  const sys = async (D, reply) => {
    globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 200, sse: reply || ["hey"], done: true }];
    await ndjson(await post(D, "/api/chat", { text: "hello", char: "buddy", via: "phone" }));
    return lastChat().messages[0].content;
  };
  await sys(P, ["[partner: yes] Congrats!"]);
  const f = env.mac.fetch;                             // (your Mac goes away again right after it took the status)
  env.mac.fetch = async (u, i) => { const r = await f(u, i); if (String(u).includes("/api/thread/import")) env.mac.mode = "down"; return r; };
  const s = await P.sync();
  must(s.down && env.mac.partner.length === 1 && env.mac.thread.length === 0, "the status reached your Mac, the messages didn't");
  must((await sys(P)).includes("HALAL-RULES\nR-YES\n\nRight now"), "still married here (this page's kit is from before)");
  const Q = page(env); await Q.init(); Q.activate();   // (a reload, still in phone mode)
  must((await sys(Q)).includes("HALAL-RULES\nR-YES\n\nRight now"), "and after a reload");
  env.mac.fetch = f; env.mac.mode = "up";
  await Q.sync();
  eq([env.mac.partner.length, env.mac.thread.filter((x) => x.role === "user").length], [1, 3], "not sent again; the messages now");
  env.mac.kit = structuredClone(env.mac.kit); env.mac.kit.edition.partner = { has: "yes", at: 1, noask: false }; env.mac.etag = "e2";
  must((await Q.refreshKit()).ok, "the next kit");
  must(!env.idb.dump().meta.some((x) => x.k === "partner"), "then forgotten here (the stored kit says it)");
  const R = page(env); await R.init(); R.activate();
  must((await sys(R)).includes("HALAL-RULES\nR-YES\n\nRight now"), "from the kit after a reload");
});
test("free brain and no Tinfoil key on the Mac: phone mode stays off and says why (it's Tinfoil only)", async () => {
  fresh(); const env = newEnv(), P = await ready(env);
  const M = page(env); await M.init();
  env.mac.kitFree = true;
  const T = M._pure.texts, r = await M.refreshKit();
  must(r.off && r.error === T.free, "off, and why");
  eq([M.status().macOff, M.status().macOffText, M.status().error], [true, T.free, T.free], "status says why");
  must(!env.idb.dump().meta.some((x) => x.k === "kit") && env.idb.dump().keys.some((k) => k.k === "tinfoil"), "its copy goes, the key stays");
  const Q = page(env); await Q.init();
  eq([Q.status().error, Q.status().macOffText, Q.have().kit], [T.free, T.free, false], "after a reload too");
  const n = tlog().length;
  eq((await post(Q, "/api/chat", { text: "hi", char: "buddy", via: "phone" })).status, 503, "nothing to answer with");
  eq(tlog().length, n, "and nothing went anywhere");
  must(/free brain/.test(T.free) && /Tinfoil/.test(T.free), "the words");
  env.mac.kitFree = false;
  must((await Q.refreshKit()).ok && !Q.status().macOff && Q.have().kit && Q.status().error === undefined, "a Tinfoil key on the Mac: back");
  void P;
});
test("a kit from before the edition (v1) or NO_PHOTOS (v2) is used only once it's refreshed", async () => {
  for (const v of [1, 2]) {
    fresh(); const env = newEnv(); env.mac.kit.v = v;
    const P = await ready(env); P.activate();
    eq((await post(P, "/api/chat", { text: "hi", char: "buddy", via: "phone" })).status, 503, "no answer from an old kit");
    must(!P.have().kit && !tlog().some((e) => e.path === "/v1/chat/completions"), "as if there were none");
  }
});

// ---------- the same as the Mac since main gained photos in any spelling, NO_PHOTOS and thinking for deep asks: phone
// mode never makes a picture, so a photo however they wrote it is only taken out of the words; thinking stays off except
// for a typed message that plainly asks for depth ----------
test("pure: photos in any spelling come out of the words; ':[' stays; thinking only for deep asks", () => {
  const P = pure(), k = KIT;
  eq(P.picTags("haha ok [image: me at the gym, sweaty]"), ["haha ok ", ["me at the gym, sweaty"]], "a square tag");
  eq(P.picTags("sure! *sends a mirror selfie* there you go"), ["sure! there you go", ["mirror selfie"]], "an action");
  eq(P.picTags("ok wait\n\nImage: me in the kitchen"), ["ok wait\n\n ", ["me in the kitchen"]], "a line");
  eq(P.picTags("Image: me in the kitchen", true, false), ["Image: me in the kitchen", []], "a line only at a real line start");
  eq(P.picTags("look [photo: me at the beach. it was windy"), ["look ", ["me at the beach. it was windy"]], "cut off at the end");
  for (const t of ["omg yes (the photo of your dog killed me)", "aw :[ that sucks", "ooh new outfit? *send pics* 👀", "[react: 😂] lol"])
    eq(P.picTags(t), [t, []], "a mention stays: " + t);
  eq([P.noTags("aw :[ that sucks"), P.noTags("hi [react: 😂"), P.noTags("ooh *send pics* 👀")], ["aw :[ that sucks", "hi ", "ooh send pics 👀"], "no_tags");
  must(P.PIC_OPEN.test("haha (sends a photo: me at the") && !P.PIC_OPEN.test("ugh :( that"), "a photo being written isn't cut");
  eq([P.deepQuestion("can you explain how compound interest works"), P.deepQuestion("help me decide between these two jobs"),
      P.deepQuestion("why not"), P.deepQuestion("explain yourself mister, where were you all day"), P.deepQuestion("please explain it")],
     [true, true, false, false, false], "deep asks only (6+ words)");
  eq(P.chatExtras(k, "deepseek-v4-1-flash", "phone", new Set(), true), {}, "a typed deep ask: may think");
  eq(P.chatExtras(k, "deepseek-v4-1-flash", "phone", new Set(), false), { reasoning_effort: "none" }, "anything else: off");
  const base = { kit: KIT, kchar: KIT.chars[0], via: "phone", extra: [], query: "", asking: false, lastTs: 0, nowSec: 1000, length: "LEN" };
  const t = P.systemPrompt({ ...base, modeUsed: "advisor" }).text;
  must(t.includes("PHONE-STYLE\n\nNO-PHOTOS.\n\nYOUR OWN LIFE"), "NO_PHOTOS where the Mac puts it");
  must(P.systemPrompt({ ...base, via: "call", modeUsed: "advisor" }).text.includes("CALL-STYLE\n\nNO-PHOTOS."), "in calls too");
  let threw = false;
  try { P.systemPrompt({ ...base, kit: { ...KIT, prompts: { ...KIT.prompts, no_photos: undefined } }, modeUsed: "advisor" }); } catch (e) { threw = true; }
  must(threw, "a kit without the photo rule fails closed");
  eq(P.asText({ role: "assistant", content: "", image: "x", photo_desc: "me at the [beach]" }), "[photo: me at the (beach)]", "their own photo");
  eq(P.asText({ role: "assistant", content: "hi", image: "x" }), "[photo]", "one nobody looked at");
});
test("a reply's photo in any spelling never shows, and no picture is asked for; a deep ask may think", async () => {
  fresh(); const env = newEnv(), P = await ready(env); P.activate();
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 200, done: true,
    sse: ["haha ok *sends a mirr", "or selfie* there you go. (image: me at ", "the gym)\n📸 me on my balcony at sunset\n\naw :[ ok"] }];
  const lines = await ndjson(await post(P, "/api/chat", { text: "send me a pic", char: "mara", via: "phone" }));
  eq(lines.filter((l) => l.s), [{ s: "haha ok there you go." }, { s: "aw :[ ok", p: 1 }], "only their words");
  const req = lastChat();
  must(req.messages[0].content.includes("NO-PHOTOS.") && req.reasoning_effort === "none", "NO_PHOTOS, thinking off");
  must(!tlog().some((e) => /images|generations/.test(e.path || "")), "no picture asked for anywhere");
  const ob = env.idb.dump().outbox.filter((x) => x.role === "assistant").pop();
  eq(ob.content, "haha ok there you go.\n\naw :[ ok", "what's kept: words only");
  globalThis.__FAKE_TINFOIL__.chat = [{ when: { stream: true }, status: 200, sse: ["Sure."], done: true }];
  await ndjson(await post(P, "/api/chat", { text: "can you explain how compound interest works", char: "mara", via: "phone" }));
  must(!("reasoning_effort" in lastChat()), "a typed deep ask: thinking allowed");
  await ndjson(await post(P, "/api/chat", { text: "can you explain how compound interest works", char: "mara", via: "call" }));
  eq([lastChat().reasoning_effort, lastChat().max_tokens], ["none", 300], "never in a call");
});

let pass = 0, fail = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; process.stdout.write(`ok   ${name}\n`); }
  catch (e) { fail++; process.stdout.write(`FAIL ${name}\n     ${(e && e.stack) || e}\n`); }
}
process.stdout.write(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
