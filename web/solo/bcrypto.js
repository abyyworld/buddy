// Buddy for phones: keys and cryptography (SPEC3 §7), WebCrypto only. Part of window.BuddySoloLib (web/solo/*).
//
// - The recovery key format (recovery.py, ported: the same vectors, tests/recovery_vectors.json): 32 random bytes as
//   Crockford base32 of key ‖ SHA-256(tag ‖ key)[:3], 56 characters in 14 groups of 4. The sync key's tag is
//   "buddy sync key"; a Mac backup key ("buddy recovery key") typed here is named, never called a typo.
// - HKDF-SHA256 with 32 zero bytes of salt (recovery.hkdf) and the keys derived from a recovery key (§7.2): the account
//   id, kdata (records), kname (record ids), kfile (a file's trailer MAC), kid (a file's key id). The admin token is
//   only ever used here to work out the account id; it is never returned or kept.
// - Records (§7.4) and blobs (§7.5) exactly as the relay keeps them, and the .buddysync file (§8.9) that holds those
//   same ciphertexts.
// - At rest (§6): AES-GCM-256 under a non-extractable key that never leaves this browser's storage.
// The recovery key itself is never stored anywhere and never put in a request, an error or a log.
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});
  const enc = new TextEncoder(), dec = new TextDecoder();
  const subtle = () => root.crypto.subtle;

  // ---------- bytes ----------
  function u8(x) {                                      // bytes of an ArrayBuffer or a view (any realm)
    if (x == null) return new Uint8Array(0);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (Object.prototype.toString.call(x) === "[object ArrayBuffer]") return new Uint8Array(x);
    if (typeof x === "string") return enc.encode(x);
    return new Uint8Array(0);
  }
  function concat(...parts) {
    parts = parts.map(u8);
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const ab = (x) => { const v = u8(x); return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength); };
  function rand(n) {                                    // (getRandomValues fills at most 64 KiB at a time)
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) root.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
    return out;
  }
  function b64e(x) {                                    // base64url, no padding
    const v = u8(x);
    let s = "";
    for (let i = 0; i < v.length; i += 32768) s += String.fromCharCode.apply(null, v.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64d(s) {                                    // base64url (or plain base64), padding optional; null if it isn't
    if (typeof s !== "string" || !/^[A-Za-z0-9_+/-]*={0,2}$/.test(s)) return null;
    let t = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
    if (t.length % 4 === 1) return null;
    t += "===".slice((t.length + 3) % 4);
    let bin;
    try { bin = atob(t); } catch (e) { return null; }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const hex = (x) => Array.from(u8(x), (b) => b.toString(16).padStart(2, "0")).join("");
  function same(a, b) {                                 // constant time
    a = u8(a); b = u8(b);
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";      // Crockford base32: no I, L, O, U
  function b32(x) {                                     // most significant bit first, 5 bits a character
    let out = "", val = 0, bits = 0;
    for (const b of u8(x)) {
      val = (val << 8) | b; bits += 8;
      while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
      val &= (1 << bits) - 1;
    }
    if (bits) out += B32[(val << (5 - bits)) & 31];
    return out;
  }

  // ---------- hashes, HKDF, HMAC ----------
  const sha256 = async (x) => new Uint8Array(await subtle().digest("SHA-256", u8(x)));
  async function hkdf(ikm, info, n = 32) {              // HKDF-SHA256 (RFC 5869), salt = 32 zero bytes
    const k = await subtle().importKey("raw", u8(ikm), "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32),
                                                      info: u8(info) }, k, n * 8));
  }
  const hmacKey = (raw, extractable = false) =>
    subtle().importKey("raw", u8(raw), { name: "HMAC", hash: "SHA-256" }, extractable, ["sign"]);
  async function hmac(key, data) {                      // key: raw bytes or an HMAC CryptoKey
    const k = ArrayBuffer.isView(key) || Object.prototype.toString.call(key) === "[object ArrayBuffer]" ? await hmacKey(key) : key;
    return new Uint8Array(await subtle().sign("HMAC", k, u8(data)));
  }

  // ---------- recovery keys (recovery.py) ----------
  const TAGS = { sync: "buddy sync key", backup: "buddy recovery key" };
  const INCOMPLETE = "That recovery key isn't complete: it has 14 groups of 4 letters and numbers.";
  const TYPO = "That recovery key has a typo somewhere. Check each group.";
  const NOT_SYNC = "That's a backup recovery key, not a sync key.";
  const NOT_BACKUP = "That's a sync recovery key, not a backup key.";
  const OTHER = { sync: NOT_SYNC, backup: NOT_BACKUP };
  const tagOf = (t) => { if (!Object.prototype.hasOwnProperty.call(TAGS, t)) throw new Error("unknown recovery key tag"); return t; };
  const checkOf = async (K, tag) => (await sha256(concat(TAGS[tag], K))).slice(0, 3);
  async function keyText(K, tag) {                      // the key as people see it, 14 groups of 4
    K = u8(K);
    if (K.length !== 32) throw new Error("a recovery key is 32 bytes");
    const s = b32(concat(K, await checkOf(K, tagOf(tag))));   // (35 bytes = exactly 56 characters)
    return s.match(/.{4}/g).join("-");
  }
  // Python's whitespace (str.isspace / \s), spelled out: JS's \s is a different set
  const PYWS = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const NORM_DROP = new RegExp(`[${PYWS}\\-.]`, "gu");
  const norm = (text) => String(text == null ? "" : text).replace(NORM_DROP, "").toUpperCase()
    .replace(/O/g, "0").replace(/[IL]/g, "1");        // as typed: spaces, dashes, dots dropped; O/I/L read as 0/1/1
  function keyError(text, kind, found) { const e = new Error(text); e.text = text; e.kind = kind; if (found) e.found = found; return e; }
  async function parseKey(text, tag) {                  // -> the 32 bytes, or throws {text, kind: incomplete|other|typo}
    tagOf(tag);
    const s = norm(text);
    if (s.length !== 56 || [...s].some((c) => !B32.includes(c))) throw keyError(INCOMPLETE, "incomplete");
    let n = 0n;
    for (const c of s) n = (n << 5n) | BigInt(B32.indexOf(c));
    const b = new Uint8Array(35);
    for (let i = 34; i >= 0; i--) { b[i] = Number(n & 255n); n >>= 8n; }
    const K = b.slice(0, 32), chk = b.slice(32);
    if (same(chk, await checkOf(K, tag))) return K;
    for (const other of Object.keys(TAGS))
      if (other !== tag && same(chk, await checkOf(K, other))) throw keyError(OTHER[tag], "other", other);
    throw keyError(TYPO, "typo");
  }

  // ---------- the keys a recovery key gives (§7.2) ----------
  const LABELS = { atok: "buddy-sync v1 admin", kdata: "buddy-sync v1 data", kname: "buddy-sync v1 names",
                   kfile: "buddy-sync v1 file", kid: "buddy-sync v1 key-id" };
  const acctOf = async (atok) => b32(await sha256(concat("buddy-sync v1 account", atok))).toLowerCase().slice(0, 26);
  async function accountKeys(K) {                       // -> {acct, kdata, kname, kfile, kid} as bytes (never the admin token)
    K = u8(K);
    if (K.length !== 32) throw new Error("a recovery key is 32 bytes");
    const atok = await hkdf(K, LABELS.atok, 32);
    const out = { acct: await acctOf(atok), kdata: await hkdf(K, LABELS.kdata, 32), kname: await hkdf(K, LABELS.kname, 32),
                  kfile: await hkdf(K, LABELS.kfile, 32), kid: await hkdf(K, LABELS.kid, 8) };
    atok.fill(0);
    return out;
  }
  const aesKey = (raw, uses = ["encrypt", "decrypt"]) => subtle().importKey("raw", u8(raw), "AES-GCM", false, uses);
  const isKey = (x) => !!x && typeof x === "object" && Object.prototype.toString.call(x) === "[object CryptoKey]";

  // ---------- records (§7.4) ----------
  const rid = async (kname, kind, id) => b64e((await hmac(kname, `${kind}:${id}`)).slice(0, 16));   // 22 characters
  function padSize(n) {                                 // 512 .. 64 KiB by powers of two, then 64 KiB steps, at most 1 MiB
    if (n <= 512) return 512;
    if (n <= 65536) return 2 ** Math.ceil(Math.log2(n));
    const p = Math.ceil(n / 65536) * 65536;
    if (p > 1048576) throw new Error("record too large");
    return p;
  }
  async function squeeze(bytes, how) {                  // deflate-raw both ways (CompressionStream: Safari 16.4+)
    const S = how === "c" ? root.CompressionStream : root.DecompressionStream;
    const s = new Blob([bytes]).stream().pipeThrough(new S("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const canSqueeze = () => typeof root.CompressionStream === "function" && typeof root.DecompressionStream === "function";
  const recAad = (acct, r, ver) => enc.encode(`buddy-sync v1|${acct}|${r}|${ver}`);
  // keys: {acct, kdata (bytes or AES CryptoKey), kname (bytes)}; body: {k, v, id, a, n, h, d}
  async function sealRecord(keys, r, ver, body) {
    let js = enc.encode(JSON.stringify(body)), flag = 0;
    if (js.length > 4096 && canSqueeze()) { js = await squeeze(js, "c"); flag = 1; }
    const P = new Uint8Array(padSize(5 + js.length));
    new DataView(P.buffer).setUint32(0, js.length); P[4] = flag; P.set(js, 5);
    const nonce = rand(12), k = isKey(keys.kdata) ? keys.kdata : await aesKey(keys.kdata);
    const c = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: recAad(keys.acct, r, ver) }, k, P));
    return concat(Uint8Array.of(1), nonce, c);
  }
  async function openRecord(keys, r, ver, ct) {         // throws unless it is exactly this record at this version
    ct = u8(ct);
    if (ct[0] !== 1) throw new Error("made by a newer Buddy");
    const k = isKey(keys.kdata) ? keys.kdata : await aesKey(keys.kdata);
    const P = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: ct.slice(1, 13), additionalData: recAad(keys.acct, r, ver) },
      k, ct.slice(13)));
    const n = new DataView(P.buffer).getUint32(0), flag = P[4];
    if (5 + n > P.length || flag > 1) throw new Error("damaged record");
    let js = P.slice(5, 5 + n);
    if (flag === 1) js = await squeeze(js, "d");
    const body = JSON.parse(dec.decode(js));
    if (!body || typeof body !== "object" || (await rid(keys.kname, body.k, body.id)) !== r) throw new Error("record id mismatch");
    return body;
  }

  // ---------- blobs (§7.5): each with its own key, which lives only in the record that refers to it ----------
  const blobAad = (acct, bid) => enc.encode(`buddy-sync blob v1|${acct}|${bid}`);
  const newBid = () => b64e(rand(16));
  async function sealBlob(acct, bid, data, key) {       // -> {ct, ref: {bid, key, sha, n}}; key: reuse one (re-sealing)
    data = u8(data);
    if (data.length > 16 * 1048576 - 65536) throw new Error("too big");
    key = key ? u8(key) : rand(32);
    const padded = new Uint8Array(Math.max(1, Math.ceil(data.length / 65536)) * 65536); padded.set(data);
    const nonce = rand(12);
    const c = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: blobAad(acct, bid) },
      await aesKey(key, ["encrypt"]), padded));
    const ct = concat(nonce, c);
    return { ct, ref: { bid, key: b64e(key), sha: b64e(await sha256(ct)), n: data.length } };
  }
  async function openBlob(acct, ref, ct) {              // a blob whose hash doesn't match is treated as missing (throws)
    ct = u8(ct);
    if (b64e(await sha256(ct)) !== ref.sha) throw new Error("blob hash mismatch");
    const p = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: ct.slice(0, 12), additionalData: blobAad(acct, ref.bid) },
      await aesKey(b64d(ref.key), ["decrypt"]), ct.slice(12)));
    return p.slice(0, ref.n);
  }

  // ---------- at rest (§6): non-extractable keys made here, used only through WebCrypto ----------
  const newAtRest = () => subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const newIndexKey = () => subtle().generateKey({ name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  async function sealBytes(key, bytes, aad) {           // -> {iv, ct}
    const iv = rand(12);
    const ct = await subtle().encrypt({ name: "AES-GCM", iv, ...(aad ? { additionalData: u8(aad) } : {}) }, key, u8(bytes));
    return { iv, ct };
  }
  async function openBytes(key, rec, aad) {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: u8(rec.iv), ...(aad ? { additionalData: u8(aad) } : {}) },
      key, u8(rec.ct)));
  }
  const sealJSON = (key, obj, aad) => sealBytes(key, enc.encode(JSON.stringify(obj)), aad);
  const openJSON = async (key, rec, aad) => JSON.parse(dec.decode(await openBytes(key, rec, aad)));

  // ---------- the file (§8.9): "BUDDYSYN" | v1 | flags 0 | kid (8) | created (8, ms), then frames ----------
  //   'R' rid (22) | ver (4) | ct     'B' bid (22) | ct     'E' nR (4) | nB (4) | HMAC(kfile, SHA-256(payload) ‖ …)
  const MAGIC = "BUDDYSYN", HEAD = 26;
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
  function header(kid, created) {
    const h = new Uint8Array(HEAD);
    h.set(enc.encode(MAGIC), 0); h[8] = 1; h[9] = 0; h.set(u8(kid).slice(0, 8), 10);
    new DataView(h.buffer).setBigUint64(18, BigInt(Math.max(0, Math.floor(created))));
    return h;
  }
  function frame(type, payload) { return concat(enc.encode(type), u32(payload.length), payload); }
  // A writer that hands out the parts of the file one by one (they go into a Blob: nothing is held twice)
  function fileWriter(kid, created) {
    const parts = [header(kid, created)], hashes = [];
    let nR = 0, nB = 0;
    const id22 = (s) => { const b = enc.encode(String(s)); if (b.length !== 22) throw new Error("bad id"); return b; };
    return {
      parts,
      async record(r, ver, ct) { const p = concat(id22(r), u32(ver), ct); hashes.push(await sha256(p)); parts.push(frame("R", p)); nR++; },
      async blob(bid, ct) { const p = concat(id22(bid), ct); hashes.push(await sha256(p)); parts.push(frame("B", p)); nB++; },
      async end(kfile) {
        const mac = await hmac(kfile, concat(...hashes));
        parts.push(frame("E", concat(u32(nR), u32(nB), mac)));
        return parts;
      },
    };
  }
  // -> {kid, created, records: [{rid, ver, ct}], blobs: [{bid, ct}], check(kfile) -> true if whole and in order}
  function readFile(bytes) {
    const b = u8(bytes), bad = (why) => { const e = new Error(why); e.kind = "damaged"; throw e; };
    if (b.length < HEAD || dec.decode(b.subarray(0, 8)) !== MAGIC) bad("That isn't a Buddy backup file (.buddysync).");
    if (b[8] !== 1) bad("That backup was made by a newer Buddy: update Buddy first.");
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = { kid: b.slice(10, 18), created: Number(dv.getBigUint64(18)), records: [], blobs: [], payloads: [], end: null };
    let i = HEAD;
    while (i < b.length) {
      if (out.end) bad("That backup file has something after its end.");
      if (i + 5 > b.length) bad("That backup file is cut off.");
      const type = String.fromCharCode(b[i]), n = dv.getUint32(i + 1), at = i + 5;
      if (at + n > b.length) bad("That backup file is cut off.");
      const p = b.subarray(at, at + n);
      if (type === "R") {
        if (n < 26) bad("That backup file is damaged.");
        out.records.push({ rid: dec.decode(p.subarray(0, 22)), ver: new DataView(p.buffer, p.byteOffset).getUint32(22), ct: p.slice(26) });
        out.payloads.push(p);
      } else if (type === "B") {
        if (n < 22) bad("That backup file is damaged.");
        out.blobs.push({ bid: dec.decode(p.subarray(0, 22)), ct: p.slice(22) });
        out.payloads.push(p);
      } else if (type === "E") {
        if (n !== 40) bad("That backup file is damaged.");
        out.end = { nR: new DataView(p.buffer, p.byteOffset).getUint32(0), nB: new DataView(p.buffer, p.byteOffset).getUint32(4), mac: p.slice(8) };
      } else bad("That backup was made by a newer Buddy: update Buddy first.");
      i = at + n;
    }
    if (!out.end) bad("That backup file is cut off.");
    out.check = async (kfile) => {
      if (out.end.nR !== out.records.length || out.end.nB !== out.blobs.length) return false;
      const hs = [];
      for (const p of out.payloads) hs.push(await sha256(p));
      return same(await hmac(kfile, concat(...hs)), out.end.mac);
    };
    return out;
  }

  L.bcrypto = {
    u8, concat, ab, rand, b64e, b64d, hex, same, B32, b32, sha256, hkdf, hmac, hmacKey, aesKey,
    TAGS, INCOMPLETE, TYPO, NOT_SYNC, NOT_BACKUP, norm, keyText, parseKey,
    LABELS, acctOf, accountKeys, rid, padSize, sealRecord, openRecord, canSqueeze,
    newBid, sealBlob, openBlob,
    newAtRest, newIndexKey, sealBytes, openBytes, sealJSON, openJSON,
    FILE_MAGIC: MAGIC, fileWriter, readFile,
  };
})(typeof window !== "undefined" ? window : globalThis);
