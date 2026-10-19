// Phone-mode parity, whole requests (SPEC2 §15.3): web/direct.js's own chat() — BuddyDirect.fetch("/api/chat") in a vm
// page with an in-memory IndexedDB and the fake Tinfoil SDK — on the turns tests/test_phonemode_parity.py ran through the
// real Handler._chat, from the kit and context the Mac gave before the first one, at the same times. Fake data only.
// Input on stdin: {phonekit, models, look, reply, turns: [{t, kind: "chat"|"newchat", body, photo?: base64, reply?}]}.
// Prints {turns: [{lines, request}]}: what the page got, and the body of the chat request it sent to Tinfoil.
// Run by the Python test, not by hand.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as nodeModule from "node:module";
import { webcrypto } from "node:crypto";
import { FakeIDB, FakeStorage } from "./fake_idb.mjs";

process.removeAllListeners("warning");                  // (the vm loader option is marked experimental: no noise)
const SRC = readFileSync(new URL("../../web/direct.js", import.meta.url), "utf8");
const FAKE_SDK = new URL("./fake_tinfoil.mjs", import.meta.url).href;
if (nodeModule.registerHooks) {                          // /vendor/tinfoil.mjs (what the page imports) -> the fake SDK
  nodeModule.registerHooks({ resolve: (s, c, next) => (s === "/vendor/tinfoil.mjs" ? { url: FAKE_SDK, shortCircuit: true } : next(s, c)) });
} else {
  nodeModule.register("data:text/javascript," + encodeURIComponent(
    `export async function resolve(s, c, n) { return s === "/vendor/tinfoil.mjs" ? { url: ${JSON.stringify(FAKE_SDK)}, shortCircuit: true } : n(s, c); }`));
}

const input = JSON.parse(readFileSync(0, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.__FAKE_TINFOIL__ = {
  ready: "ok", readyMs: 0, release: "v0", models: { status: 200, data: input.models }, hold: {},
  chat: [{ when: { stream: false }, status: 200, json: { choices: [{ message: { content: input.look } }] } },
         { when: { stream: true }, status: 200, sse: input.reply, chunkMs: 0, done: true }],
};
globalThis.__FAKE_TINFOIL_LOG__ = [];
const clock = { now: input.turns[0].t * 1000 };
const idb = new FakeIDB(), ls = new FakeStorage("local"), ss = new FakeStorage("session");
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
async function mac(url) {                                // the Mac: only the kit (it's away for every turn)
  if (new URL(String(url), "http://phone.test").pathname === "/api/phonekit") return json(input.phonekit);
  throw new TypeError("Failed to fetch");
}
function page() {
  const sb = { setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
    URL, URLSearchParams, Blob, Response, Request, Headers, ReadableStream, AbortController, AbortSignal, DOMException, DecompressionStream,
    structuredClone, MessageChannel, indexedDB: idb, localStorage: ls, sessionStorage: ss, isSecureContext: true,
    navigator: { storage: { persist: async () => true } }, fetch: mac, __clock: clock };
  vm.createContext(sb);
  vm.runInContext("Date.now = () => __clock.now;", sb);   // (the turns' own times, like the Mac's clock)
  new vm.Script(SRC, { filename: "direct.js", importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(sb);
  return sb.BuddyDirect;
}
const post = (D, path, body, type) => D.fetch(path, { method: "POST", headers: { "Content-Type": type || "application/json" },
  body: type ? body : JSON.stringify(body) });

const D = page();
await D.init();
if (!(await D.setEnabled(true)).ok || !(await D.refreshKit()).ok || !(await D.setKey("sk-FAKE-parity-0123456789")).ok) throw new Error("setup");
const P = page();                                        // (a new page: phone mode from the stored kit, like a reload)
await P.init(); P.activate();
const out = [];
for (const turn of input.turns) {
  clock.now = turn.t * 1000;
  globalThis.__FAKE_TINFOIL__.chat[1].sse = turn.reply || input.reply;   // (what the model says this time)
  if (turn.kind === "newchat") { await (await post(P, "/api/newchat", { char: turn.char })).json(); out.push(null); continue; }
  const body = { ...turn.body };
  if (turn.photo) {
    const bytes = Uint8Array.from(Buffer.from(turn.photo, "base64"));
    const full = await (await post(P, "/api/photo?part=full", new Blob([bytes]), "image/jpeg")).json();
    await (await post(P, `/api/photo?part=view&photo=${encodeURIComponent(full.photo)}`, new Blob([bytes]), "image/jpeg")).json();
    body.photo = full.photo;
  }
  const n = globalThis.__FAKE_TINFOIL_LOG__.length;
  const res = await post(P, "/api/chat", body);
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (let i = 0; i < 300 && P.busy(); i++) await sleep(10);   // (a photo's look ends before the next turn, as on the Mac)
  const req = globalThis.__FAKE_TINFOIL_LOG__.slice(n).filter((e) => e.kind === "fetch" && e.path === "/v1/chat/completions" && e.json && e.json.stream).pop();
  out.push({ lines, request: req ? req.json : null });
}
process.stdout.write(JSON.stringify({ turns: out }));
