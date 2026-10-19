// A fake of web/vendor/tinfoil.mjs (Tinfoil's browser SDK) for phone-mode tests: the only test seam. Test servers serve
// it at /vendor/tinfoil.mjs (production code has no hook). Nothing here touches the network.
//
// Behaviour is scripted by globalThis.__FAKE_TINFOIL__, read on every call (a test may change it mid-run):
//   ready: "ok" | "attestation" | "fetch" | "network" | "config"   (what ready() does; default "ok")
//   readyMs, release ("v0.0.38")
//   models: {status, data: [{id, multimodal?, type?}]}
//   chat: [{when: {model?, image?, stream?, text?}, status, json? | sse?: [texts], chunkMs?, done?, finish?, delayMs?, hold?,
//           errorText?, raw?: [lines]}]   (the first entry whose "when" matches is used, and kept; text: words the
//           request's messages hold)
//         hold: "<name>": the answer waits while globalThis.__FAKE_TINFOIL__.hold[name] is truthy
//         raw: SSE lines written as given (e.g. a broken JSON line); done: false leaves out "data: [DONE]";
//         finish: a finish_reason on the last chunk (default "stop" when done, none otherwise)
//   speech: {pcm: {status, chunks, chunkBytes, chunkMs?, type?}, wav: {status}}   (a tiny valid WAV is made)
//   stt: {status, text, errorText, byModel?: {"<model>": {status, text, errorText}}}   (byModel: that model's own answer)
// Every call is appended to globalThis.__FAKE_TINFOIL_LOG__ as {t, kind: "ctor"|"ready"|"ready-done"|"fetch"|"abort",
// opts?, ok?, path?, method?, headers?, json?, multipart?: [{name, filename?, type?, bytes, value?}]}. A fetch is
// logged when it's called (before it awaits ready(), like the real SDK); non-2xx answers have a plain-text body.

const cfg = () => globalThis.__FAKE_TINFOIL__ || {};
const log = (e) => { (globalThis.__FAKE_TINFOIL_LOG__ = globalThis.__FAKE_TINFOIL_LOG__ || []).push({ t: Date.now(), ...e }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortErr = () => new DOMException("aborted", "AbortError");

export class TinfoilError extends Error { constructor(m, o) { super(m, o); this.name = "TinfoilError"; } }
export class ConfigurationError extends TinfoilError { constructor(m, o) { super(m, o); this.name = "ConfigurationError"; } }
export class FetchError extends TinfoilError { constructor(m, o) { super(m, o); this.name = "FetchError"; } }
export class AttestationError extends TinfoilError { constructor(m, o) { super(m, o); this.name = "AttestationError"; } }
export class EhbpError extends Error { constructor(m, o) { super(m, o); this.name = "EhbpError"; } }
export class KeyConfigMismatchError extends EhbpError { constructor(m, o) { super(m, o); this.name = "KeyConfigMismatchError"; } }
export class ProtocolError extends EhbpError { constructor(m, o) { super(m, o); this.name = "ProtocolError"; } }
export class DecryptionError extends EhbpError { constructor(m, o) { super(m, o); this.name = "DecryptionError"; } }
export class Verifier {
  constructor(opts) { this.opts = opts || {}; this.doc = null; }
  async verifyBundle() { throw new AttestationError("the fake SDK verifies nothing"); }
  getVerificationDocument() { return this.doc; }
}

function headersOf(h) {
  const out = {};
  new Headers(h || {}).forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}
async function bytesOf(body) {
  if (body == null) return new Uint8Array(0);
  if (typeof body === "string") return new TextEncoder().encode(body);
  return new Uint8Array(await new Response(body).arrayBuffer());
}
function find(hay, needle, from) {
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}
function multipart(bytes, ctype) {                       // the parts of a multipart/form-data body (fields' text kept)
  const m = /boundary=([^;]+)/.exec(ctype || "");
  if (!m) return null;
  const enc = new TextEncoder(), dec = new TextDecoder(), sep = enc.encode("--" + m[1]), gap = enc.encode("\r\n\r\n"), parts = [];
  let at = find(bytes, sep, 0);
  while (at >= 0) {
    const start = at + sep.length;
    if (bytes[start] === 45 && bytes[start + 1] === 45) break;           // "--": the last boundary
    const next = find(bytes, sep, start), hEnd = find(bytes, gap, start);
    if (next < 0 || hEnd < 0 || hEnd > next) break;
    const head = dec.decode(bytes.subarray(start + 2, hEnd)), body = bytes.subarray(hEnd + 4, next - 2);
    const name = (/name="([^"]*)"/.exec(head) || [])[1], filename = (/filename="([^"]*)"/.exec(head) || [])[1];
    const type = (/Content-Type: ([^\r\n]+)/i.exec(head) || [])[1];
    const p = { name, bytes: body.length };
    if (filename !== undefined) p.filename = filename;
    if (type !== undefined) p.type = type;
    if (filename === undefined) p.value = dec.decode(body);
    parts.push(p);
    at = next;
  }
  return parts;
}
function plain(status, text) { return new Response(text || "error", { status, headers: { "Content-Type": "text/plain" } }); }
function wav(seconds = 0.1, rate = 24000) {             // a tiny valid 16-bit mono WAV of silence
  const n = Math.round(seconds * rate) * 2, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  s(0, "RIFF"); v.setUint32(4, 36 + n, true); s(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n, true);
  return b;
}
function streamOf(pieces, ms, signal, path) {           // a body that arrives piece by piece and honours the abort
  const enc = new TextEncoder();
  let i = 0, stopped = false;
  return new ReadableStream({
    start(c) {
      if (signal) signal.addEventListener("abort", () => {
        if (stopped) return;
        stopped = true; log({ kind: "abort", path });
        try { c.error(abortErr()); } catch (e) { /* closed */ }
      }, { once: true });
    },
    async pull(c) {
      if (stopped) return;
      if (i >= pieces.length) { stopped = true; c.close(); return; }
      if (ms) await sleep(ms);
      if (stopped) return;
      const p = pieces[i++];
      c.enqueue(typeof p === "string" ? enc.encode(p) : p);
    },
    cancel() { stopped = true; },
  });
}
const matches = (when, j) => {
  if (!when) return true;
  const img = JSON.stringify(j.messages || []).includes('"image_url"');
  return (when.model === undefined || when.model === j.model) && (when.image === undefined || when.image === img)
    && (when.stream === undefined || when.stream === !!j.stream)
    && (when.text === undefined || JSON.stringify(j.messages || []).includes(JSON.stringify(when.text).slice(1, -1)));
};
async function held(e, signal) {
  while (e.hold && ((cfg().hold || {})[e.hold])) {
    if (signal && signal.aborted) throw abortErr();
    await sleep(20);
  }
}

export class SecureClient {
  constructor(opts = {}) {
    if (opts.enclaveURL !== undefined && !String(opts.enclaveURL).startsWith("https://"))
      throw new ConfigurationError(`enclaveURL must use HTTPS. Got: ${opts.enclaveURL}`);
    this.opts = { ...opts }; this.p = null; this.ok = false;
    log({ kind: "ctor", opts: this.opts });
  }
  ready() {
    if (this.p) return this.p;
    log({ kind: "ready" });
    this.p = (async () => {
      const c = cfg();
      if (c.readyMs) await sleep(c.readyMs);
      const how = c.ready || "ok";
      if (how === "ok") { this.ok = true; return; }
      if (how === "attestation") throw new AttestationError("measurements don't match");
      if (how === "fetch") throw new FetchError("ATC answered 503");
      if (how === "config") throw new ConfigurationError("bad configuration");
      throw new TypeError("Failed to fetch");
    })();
    this.p.then(() => log({ kind: "ready-done", ok: true }), () => { log({ kind: "ready-done", ok: false }); this.p = null; this.ok = false; });
    return this.p;
  }
  reset() { this.p = null; this.ok = false; }
  getVerificationDocument() {
    return { releaseTag: this.ok ? (cfg().release || "v0.0.38") : undefined, securityVerified: this.ok, enclaveHost: new URL(this.opts.enclaveURL || "https://inference.invalid").host };
  }
  get fetch() {
    return async (path, init = {}) => {
      const method = String(init.method || "GET").toUpperCase(), headers = headersOf(init.headers), bytes = await bytesOf(init.body);
      const entry = { kind: "fetch", path: String(path), method, headers };
      const ctype = headers["content-type"] || "";
      if (ctype.startsWith("application/json")) { try { entry.json = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { entry.json = null; } }
      else if (ctype.startsWith("multipart/form-data")) entry.multipart = multipart(bytes, ctype);
      log(entry);
      const signal = init.signal;
      await this.ready();
      if (signal && signal.aborted) { log({ kind: "abort", path: String(path) }); throw abortErr(); }
      return this.answer(String(path), method, entry, signal);
    };
  }
  async answer(path, method, entry, signal) {
    const c = cfg(), p = path.replace(/^https?:\/\/[^/]+/, "");
    if (p === "/v1/models" && method === "GET") {
      const m = c.models || { status: 200, data: [] };
      if ((m.status || 200) >= 300) return plain(m.status, m.errorText);
      return new Response(JSON.stringify({ object: "list", data: m.data || [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (p === "/v1/chat/completions" && method === "POST") {
      const j = entry.json || {}, e = (c.chat || []).find((x) => matches(x.when, j));
      if (!e) return plain(500, "no scripted answer");
      if (e.delayMs) await sleep(e.delayMs);
      await held(e, signal);
      if (signal && signal.aborted) { log({ kind: "abort", path }); throw abortErr(); }
      const status = e.status || 200;
      if (status >= 300) return plain(status, e.errorText);
      if (e.json) return new Response(JSON.stringify(e.json), { status, headers: { "Content-Type": "application/json" } });
      const pieces = (e.raw || []).map((l) => l + "\n");
      if (!e.raw) {
        const texts = e.sse || [], done = e.done !== false, finish = e.finish === undefined ? (done ? "stop" : null) : e.finish;
        texts.forEach((t, i) => pieces.push("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: t },
          finish_reason: i === texts.length - 1 ? finish : null }] }) + "\n\n"));
        if (done) pieces.push("data: [DONE]\n\n");
      }
      return new Response(streamOf(pieces, e.chunkMs || 0, signal, path), { status, headers: { "Content-Type": "text/event-stream" } });
    }
    if (p === "/v1/audio/speech" && method === "POST") {
      const j = entry.json || {}, s = c.speech || {};
      if (j.response_format === "pcm") {
        const o = s.pcm || { status: 200, chunks: 4, chunkBytes: 4800 };
        if ((o.status || 200) >= 300) return plain(o.status, o.errorText);
        const pieces = Array.from({ length: o.chunks || 4 }, () => new Uint8Array(o.chunkBytes || 4800));
        return new Response(streamOf(pieces, o.chunkMs || 0, signal, path), { status: 200, headers: { "Content-Type": o.type || "audio/pcm" } });
      }
      const o = s.wav || { status: 200 };
      if ((o.status || 200) >= 300) return plain(o.status, o.errorText);
      return new Response(wav(o.seconds || 0.1), { status: 200, headers: { "Content-Type": "audio/wav" } });
    }
    if (p === "/v1/audio/transcriptions" && method === "POST") {
      const model = ((entry.multipart || []).find((x) => x.name === "model") || {}).value;
      const o = (c.stt && c.stt.byModel && c.stt.byModel[model]) || c.stt || { status: 200, text: "" };
      if (o.delayMs) await sleep(o.delayMs);
      if ((o.status || 200) >= 300) return plain(o.status, o.errorText || "error");
      return new Response(JSON.stringify({ text: o.text || "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return plain(404, "not found");
  }
}
