// Buddy for phones' Node tests: the site's page in a vm "browser" (web/solo/* + web/direct.js, the buddy-site meta),
// with an in-memory IndexedDB (tests/phonemode/fake_idb.mjs), the fake Tinfoil SDK (tests/phonemode/fake_tinfoil.mjs)
// and kit.json = kitparts.static_kit("public") made by the real Python with an empty HOME. Fake data and keys only;
// nothing here touches the network.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import * as nodeModule from "node:module";
import { webcrypto } from "node:crypto";
import { FakeIDB, FakeStorage } from "../phonemode/fake_idb.mjs";

process.removeAllListeners("warning");
export const ROOT = new URL("../../", import.meta.url).pathname;
export const SITE = "https://abyyworld.github.io/buddy/";
const SDK = SITE + "vendor/tinfoil.mjs", FAKE_SDK = new URL("../phonemode/fake_tinfoil.mjs", import.meta.url).href;
// (the order the site loads them: scripts/build_pages.py puts web/solo/*.js sorted, engine.js last; test_pages_build checks)
export const SOLO_FILES = ["bcrypto", "chars", "edition", "facts", "life", "store", "engine"];
const src = (f) => readFileSync(join(ROOT, "web", f), "utf8");
if (!vm.constants || vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER === undefined) { process.stderr.write("needs node >= 20.12\n"); process.exit(1); }
if (nodeModule.registerHooks) nodeModule.registerHooks({ resolve: (s, c, next) => (s === SDK ? { url: FAKE_SDK, shortCircuit: true } : next(s, c)) });
else nodeModule.register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) { return s === ${JSON.stringify(SDK)} ? { url: ${JSON.stringify(FAKE_SDK)}, shortCircuit: true } : n(s, c); }`));

export function staticKit(edition = "public") {
  const home = mkdtempSync(join(tmpdir(), "buddy-solo-home-"));
  try {
    return JSON.parse(execFileSync(process.env.PYTHON || "python3", ["-I", "-B", "-c",
      "import json, sys; sys.path.insert(0, sys.argv[1]); import kitparts; print(json.dumps(kitparts.static_kit(sys.argv[2])))", ROOT, edition],
    { env: { HOME: home, PATH: process.env.PATH || "" }, encoding: "utf8" }));
  } finally { rmSync(home, { recursive: true, force: true }); }
}

export const FAKE = () => ({
  ready: "ok", release: "v0.0.38",
  models: { status: 200, data: [{ id: "gemma4-31b", multimodal: true, type: "chat" }, { id: "deepseek-v4-1-flash" }, { id: "whisper-large-v3-turbo" }] },
  chat: [
    { when: { stream: false, image: true }, status: 200, json: { choices: [{ message: { content: "A red square on white." } }] } },
    { when: { stream: false }, status: 200, json: { choices: [{ message: { content: "ok" } }] } },
    { when: { stream: true }, status: 200, sse: ["Hi there! ", "How are you?"], chunkMs: 1, done: true },
  ],
  speech: { pcm: { status: 200, chunks: 3, chunkBytes: 480 }, wav: { status: 200 } }, stt: { status: 200, text: "hello there" }, hold: {},
});
export function fakeTinfoil(cfg) { globalThis.__FAKE_TINFOIL__ = { ...FAKE(), ...(cfg || {}) }; globalThis.__FAKE_TINFOIL_LOG__ = []; }
export const tlog = () => globalThis.__FAKE_TINFOIL_LOG__ || [];

// A device: its own storage (pass one in to reopen the "same phone"), a page with everything loaded; opts.clock: a
// FakeClock (tests/solo/clock.mjs) that Date and the timers follow
export function device(kit, store, opts = {}) {
  const env = store || { idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session") };
  env.fetches = [];
  const files = { "kit.json": JSON.stringify(kit), "version.json": JSON.stringify({ v: 58 }) };
  const document = { baseURI: SITE, querySelector: (sel) => (sel === 'meta[name="buddy-site"]' ? { name: "buddy-site", content: "solo" } : null) };
  const sb = { setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
    URL, URLSearchParams, Blob, Response, Request, Headers, ReadableStream, AbortController, AbortSignal, DOMException,
    CompressionStream, DecompressionStream, structuredClone, MessageChannel, indexedDB: env.idb, localStorage: env.ls, sessionStorage: env.ss,
    isSecureContext: true, document, navigator: { userAgent: "node-test", storage: { persist: async () => true, persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 1e6 }) } },
    fetch: async (u) => {
      const url = new URL(String(u), SITE); env.fetches.push(url.href);
      if (url.origin + "/" === new URL(SITE).origin + "/" && url.pathname.startsWith("/buddy/") && files[url.pathname.slice(7)] !== undefined)
        return new Response(files[url.pathname.slice(7)], { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("not found", { status: 404 });
    } };
  if (opts.clock) opts.clock.install(sb);
  vm.createContext(sb);
  for (const f of SOLO_FILES) new vm.Script(src(`solo/${f}.js`), { filename: `solo/${f}.js` }).runInContext(sb);
  new vm.Script(src("direct.js"), { filename: "direct.js", importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(sb);
  return { sb, S: sb.BuddySolo, D: sb.BuddyDirect, Lib: sb.BuddySoloLib, env };
}

export const post = (S, path, body) => S.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const get = async (S, path) => { const r = await S.fetch(path); return { status: r.status, j: await r.json() }; };
export const ndjson = async (res) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const seg = (m, body) => Uint8Array.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]);
export function jpeg(w, h) {                             // markers only (no pixels), like tests/test_pictures.py
  const b = (s) => Array.from(Buffer.from(s, "latin1"));
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe0, b("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...Array(30).fill([0x12, 0x34, 0xff, 0x00, 0x56]).flat(), 0xff, 0xd9]);
}
// everything the device's storage holds, flattened to text (bytes as latin1 and base64), to look for what must not be there
export function dumpText(env, db = "buddy-site") {
  const d = env.idb.dump(db) || {};
  const conv = (v) => {
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) { const b = Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return b.toString("latin1") + " " + b.toString("base64"); }
    if (v && typeof v === "object" && Object.prototype.toString.call(v) === "[object CryptoKey]") return "[CryptoKey]";
    if (Array.isArray(v)) return v.map(conv);
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = conv(x); return o; }
    return v;
  };
  const ls = {}; for (const [k, v] of env.ls.m) ls[k] = v;
  const ss = {}; for (const [k, v] of env.ss.m) ss[k] = v;
  return JSON.stringify({ idb: conv(d), ls, ss });
}

// ---------- the runner ----------
export function runner() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const must = (c, what) => { if (!c) throw new Error("expected: " + what); };
  const eq = (a, b, what) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what}: got ${x && x.slice(0, 500)} want ${y && y.slice(0, 500)}`); };
  const run = async () => {
    let pass = 0, fail = 0;
    const only = process.argv.slice(2);
    for (const [name, fn] of tests) {
      if (only.length && !only.some((o) => name.includes(o))) continue;
      try { await fn(); pass++; process.stdout.write(`ok   ${name}\n`); }
      catch (e) { fail++; process.stdout.write(`FAIL ${name}\n     ${(e && e.stack) || e}\n`); }
    }
    process.stdout.write(`${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  };
  return { test, must, eq, run };
}
