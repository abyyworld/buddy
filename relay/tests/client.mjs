// Test-only: a minimal Buddy sync client (SPEC3 §7, §8.4), enough to drive the relay with real encrypted records and
// to check what a device would notice when a relay misbehaves. Keys are random, made here; nothing real is used.
import { b64e, b64d, concat, enc, sha256, acctOf } from "../common.js";

const subtle = globalThis.crypto.subtle;
export const dec = new TextDecoder();
export function rand(n) {                      // (getRandomValues fills at most 64 KiB at a time)
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}
export { b64e, b64d };

async function hkdf(ikm, info, n = 32) {      // HKDF-SHA256, salt = 32 zero bytes (backup.hkdf)
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32),
                                                  info: enc.encode(info) }, k, n * 8));
}

async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

export async function accountKeys(K = rand(32)) {   // §7.2
  const atok = await hkdf(K, "buddy-sync v1 admin");
  const kdataRaw = await hkdf(K, "buddy-sync v1 data");
  return {
    K, atok, acct: await acctOf(atok), kdataRaw,
    kdata: await subtle.importKey("raw", kdataRaw, "AES-GCM", false, ["encrypt", "decrypt"]),
    kname: await hkdf(K, "buddy-sync v1 names"),
    admin: "Buddy-Admin " + b64e(atok),
  };
}

export async function rid(keys, kind, id) { return b64e((await hmac(keys.kname, enc.encode(kind + ":" + id))).slice(0, 16)); }

export function padSize(n) {                  // §7.4: 512 .. 64 KiB by powers of two, then 64 KiB steps, ≤ 1 MiB
  if (n <= 512) return 512;
  if (n <= 65536) return 2 ** Math.ceil(Math.log2(n));
  const p = Math.ceil(n / 65536) * 65536;
  if (p > 1048576) throw new Error("record too large");
  return p;
}

const aad = (keys, r, ver) => enc.encode(`buddy-sync v1|${keys.acct}|${r}|${ver}`);

export async function seal(keys, r, ver, body) {
  const js = enc.encode(JSON.stringify(body));
  const P = new Uint8Array(padSize(5 + js.length));
  new DataView(P.buffer).setUint32(0, js.length); P[4] = 0; P.set(js, 5);
  const nonce = rand(12);
  const c = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(keys, r, ver) }, keys.kdata, P));
  return concat(new Uint8Array([1]), nonce, c);
}

export async function open(keys, r, ver, ct) {  // throws unless it is exactly this record at this version
  if (ct[0] !== 1) throw new Error("made by a newer Buddy");
  const P = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: ct.slice(1, 13), additionalData: aad(keys, r, ver) },
                                                keys.kdata, ct.slice(13)));
  const n = new DataView(P.buffer).getUint32(0);
  const body = JSON.parse(dec.decode(P.slice(5, 5 + n)));
  if ((await rid(keys, body.k, body.id)) !== r) throw new Error("record id mismatch");
  return body;
}

export async function sealBlob(keys, bid, data) {  // §7.5
  const key = rand(32);
  const k = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const padded = new Uint8Array(Math.max(1, Math.ceil(data.length / 65536)) * 65536); padded.set(data);
  const nonce = rand(12);
  const c = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: enc.encode(`buddy-sync blob v1|${keys.acct}|${bid}`) }, k, padded));
  const ct = concat(nonce, c);
  return { ct, ref: { bid, key: b64e(key), sha: b64e(await sha256(ct)), n: data.length } };
}

export async function openBlob(keys, ref, ct) {
  if (b64e(await sha256(ct)) !== ref.sha) throw new Error("blob hash mismatch");
  const k = await subtle.importKey("raw", b64d(ref.key), "AES-GCM", false, ["decrypt"]);
  const p = new Uint8Array(await subtle.decrypt(
    { name: "AES-GCM", iv: ct.slice(0, 12), additionalData: enc.encode(`buddy-sync blob v1|${keys.acct}|${ref.bid}`) },
    k, ct.slice(12)));
  return p.slice(0, ref.n);
}

export async function newDevice() {           // §7.3: the relay only ever gets SHA-256(token)
  const id = b64e(rand(16)), token = rand(32);
  return { id, token, token_hash: b64e(await sha256(token)), auth: `Bearer ${id}.${b64e(token)}`, raw: `${id}.${b64e(token)}` };
}

// What a device keeps to notice a misbehaving relay (§8.4): the highest version of each record, the highest seq,
// and the writes other devices say they made (their dev records' "recent").
export class Replica {
  constructor(keys) { this.keys = keys; this.ver = new Map(); this.recs = new Map(); this.hw = 0; this.flags = []; }

  async apply(resp) {
    if (resp.seq < this.hw) this.flags.push({ what: "reset", seq: resp.seq, hw: this.hw });
    for (const it of resp.items) {
      const have = this.ver.get(it.rid) || 0;
      if (it.ver < have) { this.flags.push({ what: "older", rid: it.rid }); continue; }
      if (it.ver === have) continue;
      if (it.ct === null) { this.ver.set(it.rid, it.ver); this.recs.set(it.rid, null); }
      else {
        try { this.recs.set(it.rid, await open(this.keys, it.rid, it.ver, b64d(it.ct))); this.ver.set(it.rid, it.ver); }
        catch { this.flags.push({ what: "damaged", rid: it.rid }); continue; }
      }
      this.hw = Math.max(this.hw, it.seq);
    }
    for (const body of this.recs.values()) {
      if (!body || body.k !== "dev" || !body.d || !Array.isArray(body.d.recent)) continue;
      for (const [r, v] of body.d.recent) if ((this.ver.get(r) || 0) < v) this.flags.push({ what: "hidden", rid: r, by: body.id });
    }
    return this.flags;
  }
}
