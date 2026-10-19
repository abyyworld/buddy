// The source seam in web/direct.js (SPEC3 §4, P0): on the Mac's /phone the source is macSource (phone mode as it was:
// tests/phonemode/unit_direct.mjs checks all of that); on the Buddy for phones site (a page with
// <meta name="buddy-site">) it's window.BuddySolo, never the Mac: its routes first, then the shared chat, photo, voice,
// hearing, speech and call code, and 404 {"error": "not in Buddy for phones"} for anything else. Here a stand-in
// BuddySolo keeps everything in memory, and its kit is kitparts.static_kit("public") (Python) plus made-up user parts,
// so the kit the site will build plugs into the unchanged chat code. In Node with direct.js in a vm "page" and the fake
// Tinfoil SDK (tests/phonemode/fake_tinfoil.mjs). Fake data and fake keys only. Run:  node tests/phonemode/unit_seam.mjs
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import * as nodeModule from "node:module";
import { webcrypto } from "node:crypto";
import { FakeIDB, FakeStorage } from "./fake_idb.mjs";

process.removeAllListeners("warning");                  // (the vm loader option is marked experimental: no noise)
const SRC = readFileSync(new URL("../../web/direct.js", import.meta.url), "utf8");
const ROOT = new URL("../../", import.meta.url).pathname;
const FAKE_SDK = new URL("./fake_tinfoil.mjs", import.meta.url).href;
const SITE = "https://abyyworld.github.io/buddy/", SITE_SDK = SITE + "vendor/tinfoil.mjs";
const imported = [];                                     // the SDK addresses the pages asked for
if (!vm.constants || vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER === undefined) {
  process.stderr.write("needs node >= 20.12 (vm USE_MAIN_CONTEXT_DEFAULT_LOADER)\n"); process.exit(1);
}
const isSdk = (s) => s === "/vendor/tinfoil.mjs" || s === SITE_SDK;
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (s, c, next) => (isSdk(s) ? (imported.push(s), { url: FAKE_SDK, shortCircuit: true }) : next(s, c)) });
} else {
  nodeModule.register("data:text/javascript," + encodeURIComponent(
    `export async function resolve(s, c, n) { return (s === "/vendor/tinfoil.mjs" || s === ${JSON.stringify(SITE_SDK)}) ` +
    `? { url: ${JSON.stringify(FAKE_SDK)}, shortCircuit: true } : n(s, c); }`));
}

const SOLO_KEY = "sk-FAKE-solo-0123456789abcdef";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000, what = "condition") => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(10); }
  throw new Error("timed out waiting for " + what);
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// ---------- the site's kit: kitparts.static_kit("public") + what BuddySolo adds from this device (made up here) ----------
function staticKit() {
  const home = mkdtempSync(join(tmpdir(), "buddy-seam-home-"));
  try {
    return JSON.parse(execFileSync(process.env.PYTHON || "python3", ["-I", "-B", "-c",
      "import json, sys; sys.path.insert(0, sys.argv[1]); import kitparts; print(json.dumps(kitparts.static_kit('public')))", ROOT],
    { env: { HOME: home, PATH: process.env.PATH || "" }, encoding: "utf8" }));
  } finally { rmSync(home, { recursive: true, force: true }); }
}
const STATIC = staticKit();
function siteKit() {
  const k = structuredClone(STATIC);
  const ka = (have, via) => k.templates.knows_ask[via][have ? "have" : "none"].split("{name}").join("Buddy");
  return { ...k, name: "Sam", tz: "UTC", see_photos: true, companion_on_phala: false,
    chars: [{ id: "buddy", name: "Buddy", tagline: "Your closest friend", color: "#d9973c", avatar: 0, wallpaper: 0, builtin: true,
              brain: "advisor", voice: "casual_female", persona: k.builtin.persona,
              facts: { own: [{ text: "SOLO-FACT: I keep bees.", date: "2026-10-08" }], shared: [] },
              knows_ask: { phone: { have: ka(true, "phone"), none: ka(false, "phone") }, call: { have: ka(true, "call"), none: ka(false, "call") } },
              life: null }],
    voice: { ...k.voice, default: "casual_female" },
    models: { ...k.models, advisor: { preferred: null, ...k.models.advisor }, companion: { preferred: null, ...k.models.companion } },
    tinfoil: { ids: [], meta: {} }, stt: { language: "", model: "" },
    edition: { ...k.edition, partner: { has: "", at: null, noask: false } } };
}

// ---------- a stand-in BuddySolo (memory only) ----------
function fakeSolo({ key = SOLO_KEY } = {}) {
  const o = { kit: siteKit(), msgs: [], nextId: 100, calls: [], key };
  o.api = {
    kit: () => o.kit,
    thread: (after) => o.msgs.filter((m) => after === undefined || m.id > after).sort((a, b) => a.id - b.id),
    add: async (it, priv, keepOnFail) => {
      it.cid = it.cid || "solo-cid-" + String(o.nextId + 1).padStart(10, "0");
      o.calls.push(["add", it.role, !!priv, !!keepOnFail]);
      const m = { id: ++o.nextId, role: it.role, content: it.content || "", ts: it.ts, char: it.char, cid: it.cid, private: !!priv };
      if (it.photo) Object.assign(m, { image: "local:" + it.cid, w: it.photo.w, h: it.photo.h });
      if (it.role === "reaction") Object.assign(m, { emoji: it.emoji, by: it.by, target_cid: it.target_cid, target: it.target });
      o.msgs.push(m);
      return m;
    },
    annotate: async (cid, fields, priv) => { o.calls.push(["annotate", cid, fields, !!priv]); const m = o.msgs.find((x) => x.cid === cid); if (m) Object.assign(m, fields); },
    forget: async (char, deleted, epoch) => { o.calls.push(["forget", char, !!deleted]); o.msgs = o.msgs.filter((m) => m.char !== char); },
    route: async (method, p, q) => {
      o.calls.push(["route", method, p]);
      if (method === "GET" && p === "/api/thread") return json(o.api.thread(parseInt(q.get("after") || "0", 10) || 0));
      if (method === "GET" && p === "/api/status") return json({ name: o.kit.name, solo: true });
      return null;
    },
    key: async () => o.key,
    cacheSecret: () => "solo-cache-secret",
  };
  return o;
}

// ---------- a "page": direct.js in its own vm context, with a document that is the site's (or the Mac's /phone) ----------
function page({ site = true, solo = null } = {}) {
  const env = { idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session"), fetches: [] };
  const document = { baseURI: site ? SITE : "https://buddy.example.ts.net/phone",
                     querySelector: (sel) => (site && sel === 'meta[name="buddy-site"]' ? { name: "buddy-site", content: "solo" } : null) };
  const sb = { setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
    URL, URLSearchParams, Blob, Response, Request, Headers, ReadableStream, AbortController, AbortSignal, DOMException, DecompressionStream,
    structuredClone, MessageChannel, indexedDB: env.idb, localStorage: env.ls, sessionStorage: env.ss, isSecureContext: true, document,
    navigator: { storage: { persist: async () => true } },
    fetch: (u) => { env.fetches.push(String(u)); return Promise.reject(new TypeError("no network in this test")); } };
  if (solo) sb.BuddySolo = solo.api;
  vm.createContext(sb);
  new vm.Script(SRC, { filename: "direct.js", importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(sb);
  return { D: sb.BuddyDirect, env, sb };
}
const FAKE = () => ({
  ready: "ok", release: "v0.0.38",
  models: { status: 200, data: [{ id: "gemma4-31b", multimodal: true, type: "chat" }, { id: "deepseek-v4-1-flash" }, { id: "whisper-large-v3-turbo" }] },
  chat: [
    { when: { stream: false, image: true }, status: 200, json: { choices: [{ message: { content: "A red square on white." } }] } },
    { when: { stream: false }, status: 200, json: { choices: [{ message: { content: "ok" } }] } },
    { when: { stream: true }, status: 200, sse: ["[react: 😂] Hi there! ", "How are you?"], chunkMs: 2, done: true },
  ],
  speech: { pcm: { status: 200, chunks: 3, chunkBytes: 480 }, wav: { status: 200 } }, stt: { status: 200, text: "hello there" }, hold: {},
});
const tlog = () => globalThis.__FAKE_TINFOIL_LOG__ || [];
function fresh(cfg) { globalThis.__FAKE_TINFOIL__ = { ...FAKE(), ...(cfg || {}) }; globalThis.__FAKE_TINFOIL_LOG__ = []; imported.length = 0; }
const post = (D, path, body) => D.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ndjson = async (res) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const seg = (m, body) => Uint8Array.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]);
function jpeg(w, h) {                                    // markers only (no pixels), like tests/test_pictures.py
  const b = (s) => Array.from(Buffer.from(s, "latin1"));
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe0, b("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...Array(30).fill([0x12, 0x34, 0xff, 0x00, 0x56]).flat(), 0xff, 0xd9]);
}
async function nothingOfPhoneMode(env, what) {          // the site never makes or reads phone mode's storage, never asks a Mac
  eq(await env.idb.databases(), [], what + ": no IndexedDB database");
  must(!env.idb.log.length, what + ": IndexedDB never touched");
  must(!env.ls.log.length && !env.ss.log.length, what + ": no web storage written");
  eq(env.fetches, [], what + ": no request to any Mac");
}

// ---------- the runner ----------
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
function must(c, what) { if (!c) throw new Error("expected: " + what); }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what}: got ${x.slice(0, 400)} want ${y.slice(0, 400)}`); }

test("the Mac's /phone (no buddy-site meta): macSource, phone mode's answers as before", async () => {
  fresh(); const { D, env } = page({ site: false });
  eq(D.solo, false, "not the site");
  const me = await D.fetch("/api/me");
  eq([me.status, (await me.json()).device.id], [200, "phone-mode"], "/api/me as phone mode");
  const st = await D.fetch("/api/status");
  eq([st.status, (await st.json()).error], [503, D._pure.texts.nokit], "no kit yet: phone mode's words");
  eq((await D.probe(50)).why !== "site", true, "it asks the Mac");
  must(env.fetches.includes("/api/me"), "the probe went to the Mac");
});
test("the site before BuddySolo is there: nothing answers, nothing is stored, no Mac and no Tinfoil", async () => {
  fresh(); const { D, env } = page({ site: true });
  eq(D.solo, true, "the site");
  for (const [m, p] of [["GET", "/api/status"], ["GET", "/api/me"], ["POST", "/api/chat"], ["GET", "/api/thread?after=0"], ["POST", "/api/newchat"]]) {
    const r = await D.fetch(p, { method: m, headers: { "Content-Type": "application/json" }, body: m === "POST" ? "{}" : undefined });
    eq([r.status, (await r.json()).error], [503, D._pure.texts.notready], `${m} ${p}`);
  }
  await D.init();
  eq(await D.setEnabled(true), { ok: false, error: "not in Buddy for phones" }, "phone mode can't be turned on here");
  eq((await D.setKey(SOLO_KEY)).ok, false, "nor phone mode's key");
  eq((await D.refreshKit()).ok, false, "no kit from a Mac"); eq((await D.sync()).ok, false, "no sync to a Mac");
  eq(await D.probe(), { up: false, why: "site" }, "no Mac to probe");
  eq(D.enabled(), false, "phone mode off");
  await nothingOfPhoneMode(env, "before solo");
  eq(tlog(), [], "Tinfoil never contacted");
});
test("the site with BuddySolo: its routes first, then the shared ones, and 404 for everything else", async () => {
  fresh(); const solo = fakeSolo(), { D, env } = page({ solo });
  const th = await D.fetch("/api/thread?after=0");
  eq([th.status, await th.json()], [200, []], "BuddySolo answers /api/thread");
  eq(await (await D.fetch("/api/status")).json(), { name: "Sam", solo: true }, "and /api/status");
  for (const [m, p] of [["GET", "/api/me"], ["GET", "/api/settings"], ["GET", "/api/phonekit"], ["POST", "/api/thread/import"],
                        ["POST", "/api/newchat"], ["POST", "/api/react"], ["GET", "/api/whatever"], ["POST", "/api/whatever"],
                        ["DELETE", "/api/chat"], ["GET", "/api/chat"], ["GET", "/api/media/local:x"]]) {
    const r = await D.fetch(p, { method: m, headers: { "Content-Type": "application/json" }, body: m === "POST" ? "{}" : undefined });
    eq([r.status, await r.json()], [404, { error: "not in Buddy for phones" }], `${m} ${p}`);
  }
  const cs = await post(D, "/api/call/start", { char: "buddy" });
  eq((await cs.json()).greetings, STATIC.call.greetings, "a shared route with the site's kit: the call's lines");
  must(solo.calls.filter((c) => c[0] === "route").length >= 14, "BuddySolo was asked first, every time");
  await nothingOfPhoneMode(env, "routes");
});
test("a chat on the site: kit, key, cache secret and thread from BuddySolo, messages to it, the SDK from next to the page", async () => {
  fresh(); const solo = fakeSolo(), { D, env } = page({ solo });
  const now = Date.now() / 1000;
  solo.msgs.push({ id: 1, role: "user", content: "OLD-USER-LINE", ts: now - 2 * 86400 - 60, char: "buddy", cid: "old-user-cid-000001" },
                 { id: 2, role: "assistant", content: "OLD-REPLY", ts: now - 2 * 86400, char: "buddy", cid: "old-reply-cid-00002" });
  const lines = await ndjson(await post(D, "/api/chat", { text: "hey how was your day", char: "buddy", via: "phone", private: false }));
  eq(lines.filter((l) => l.s).map((l) => l.s), ["Hi there!", "How are you?"], "the reply, sentence by sentence");
  must(lines.some((l) => l.mode === "advisor") && lines.some((l) => l.react === "😂"), "mode and reaction lines");
  eq(solo.calls.filter((c) => c[0] === "add"), [["add", "user", false, false], ["add", "reaction", false, true], ["add", "assistant", false, true]],
     "every message went to BuddySolo, in order");
  const [user, react, reply] = solo.msgs.slice(2);
  eq([react.target_cid, reply.content], [user.cid, "Hi there! How are you?"], "the reaction is on yours; the reply is kept");
  const L = tlog(), ctor = L.find((e) => e.kind === "ctor"), req = L.find((e) => e.kind === "fetch" && e.path === "/v1/chat/completions");
  eq([ctor.opts.enclaveURL, ctor.opts.userCacheSecret], ["https://inference.tinfoil.sh", "solo-cache-secret"], "the SDK client");
  eq(req.headers.authorization, "Bearer " + SOLO_KEY, "this device's key, from BuddySolo");
  const sys = req.json.messages[0].content, conv = JSON.stringify(req.json.messages.slice(1));
  must(sys.startsWith(STATIC.builtin.persona + "\n\nYour name is Buddy. You are an adult.\n\n" + STATIC.prompts.modes.advisor), "persona, adult line, mode");
  must(sys.includes(STATIC.edition.halal) && sys.includes(STATIC.edition.romance.unknown), "the public edition's rules from the static kit");
  must(sys.includes("SOLO-FACT: I keep bees.") && sys.includes(STATIC.prompts.no_photos), "facts and no photos");
  must(sys.includes("Our last message before this was 2 days ago. It was yours, and I never answered it."), "time since the last message, from BuddySolo's thread");
  must(conv.includes("OLD-USER-LINE") && conv.includes("OLD-REPLY"), "the conversation from BuddySolo's thread");
  eq(imported, [SITE_SDK], "the pinned SDK from next to the page, never the Mac's /vendor/");
  await nothingOfPhoneMode(env, "chat");
});
test("a private chat and a photo on the site: private to BuddySolo as private, the look annotated there", async () => {
  fresh(); const solo = fakeSolo(), { D, env } = page({ solo });
  await ndjson(await post(D, "/api/chat", { text: "just between us", char: "buddy", via: "phone", private: true }));
  eq(solo.calls.filter((c) => c[0] === "add").map((c) => [c[1], c[2]]), [["user", true], ["reaction", true], ["assistant", true]], "all private");
  const full = await (await D.fetch("/api/photo?part=full", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(800, 600)]) })).json();
  const v = await D.fetch(`/api/photo?part=view&photo=${encodeURIComponent(full.photo)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(400, 300)]) });
  eq(v.status, 200, "the photo routes are shared");
  const lines = await ndjson(await post(D, "/api/chat", { text: "look", char: "buddy", via: "phone", private: false, photo: full.photo }));
  must(lines.some((l) => l.s), "a reply");
  await until(() => solo.calls.some((c) => c[0] === "annotate"), 3000, "the look");
  const an = solo.calls.find((c) => c[0] === "annotate"), photoMsg = solo.msgs.find((m) => m.image);
  eq([an[1], an[2], an[3]], [photoMsg.cid, { photo_desc: "A red square on white.", seen_by: "gemma4-31b" }, false], "annotated in BuddySolo");
  await nothingOfPhoneMode(env, "photo");
});
test("the site without this device's key says where it goes; BuddySolo loaded after direct.js is found; forget goes to it", async () => {
  fresh(); const solo = fakeSolo({ key: null }), { D, env, sb } = page({ site: true });
  sb.BuddySolo = solo.api;                               // (web/solo/engine.js may load after direct.js)
  eq(await ndjson(await post(D, "/api/chat", { text: "hi", char: "buddy", via: "phone" })), [{ error: D._pure.texts.solokey }], "the site's words");
  eq(tlog(), [], "nothing contacted Tinfoil without a key");
  eq(solo.msgs.length, 1, "your message is kept by BuddySolo");
  await D.forgetChar("buddy", false, 3);
  eq(solo.calls.filter((c) => c[0] === "forget"), [["forget", "buddy", false]], "forget went to BuddySolo");
  eq(solo.msgs.length, 0, "and it's gone");
  await nothingOfPhoneMode(env, "forget");
});

let pass = 0, fail = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; process.stdout.write(`ok   ${name}\n`); }
  catch (e) { fail++; process.stdout.write(`FAIL ${name}\n     ${(e && e.stack) || e}\n`); }
}
process.stdout.write(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
