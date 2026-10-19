// Buddy for phones parity, node side: web/solo/*'s ports (bcrypto, edition, chars, facts) on the cases that
// tests/test_solo_parity.py built with the real Python (recovery.py, characters.py, images.py, edition.py, facts.py,
// kitparts.py). Input on stdin: {kit, cases: {family: [case, ...]}}; prints every mismatch; exit code 1 on any.
// With {make: {...}} instead it writes a .buddysync file from fixed records (for Python to open: base64 on stdout).
// Fake data and keys made in the test only. Run by the Python test, not by hand.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const ROOT = new URL("../../", import.meta.url).pathname;
const sb = { TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto, URL, Blob, Response, ReadableStream, DOMException,
  CompressionStream, DecompressionStream, structuredClone, setTimeout, clearTimeout };
vm.createContext(sb);
for (const f of ["bcrypto", "edition", "chars", "facts"]) new vm.Script(readFileSync(ROOT + `web/solo/${f}.js`, "utf8"), { filename: f }).runInContext(sb);
new vm.Script(readFileSync(ROOT + "web/direct.js", "utf8"), { filename: "direct.js" }).runInContext(sb);
const { bcrypto: C, edition: E, chars: CH, facts: F } = sb.BuddySoloLib;
const P = sb.BuddyDirect._pure;
const hex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const tohex = (b) => Buffer.from(b).toString("hex");
const input = JSON.parse(readFileSync(0, "utf8"));

if (input.make) {                                        // a file from fixed records, for Python to open
  const m = input.make, K = hex(m.key), keys = await C.accountKeys(K);
  const w = C.fileWriter(keys.kid, m.created);
  for (const r of m.records) {
    const rid = await C.rid(keys.kname, r.k, r.id);
    await w.record(rid, r.ver, await C.sealRecord(keys, rid, r.ver, r));
  }
  for (const b of m.blobs) { const s = await C.sealBlob(keys.acct, b.bid, Buffer.from(b.data, "base64")); await w.blob(b.bid, s.ct); b.ref = s.ref; }
  const parts = await w.end(keys.kfile);
  const bytes = Buffer.concat(parts.map((p) => Buffer.from(p)));
  await new Promise((ok) => process.stdout.write(JSON.stringify({ file: bytes.toString("base64"), acct: keys.acct, refs: m.blobs.map((b) => b.ref) }), ok));
  process.exit(0);
}

const { kit, cases } = input;
let n = 0, bad = 0;
const J = (x) => JSON.stringify(x === undefined ? null : x);
function check(kind, got, want, ctx) {
  n++;
  if (J(got) === J(want)) return;
  bad++;
  if (bad <= 40) console.log(`MISMATCH ${kind}: ${J(ctx).slice(0, 300)}\n  got:  ${J(got).slice(0, 700)}\n  want: ${J(want).slice(0, 700)}`);
}
const fam = (name) => cases[name] || [];
const attempt = async (fn) => { try { return { ok: await fn() }; } catch (e) { return { error: e.text || e.message }; } };

for (const c of fam("keytext")) check("keytext", await C.keyText(hex(c.key), c.tag), c.out, c);
for (const c of fam("parse")) {
  const r = await attempt(async () => tohex(await C.parseKey(c.text, c.tag)));
  check("parse", r.error !== undefined ? { error: r.error } : { key: r.ok }, c.key !== undefined ? { key: c.key } : { error: c.error }, c);
}
for (const c of fam("norm")) check("norm", C.norm(c.in), c.out, c.in);
for (const c of fam("hkdf")) check("hkdf", tohex(await C.hkdf(hex(c.ikm), c.info, c.n)), c.out, c);
for (const c of fam("acct")) {
  const k = await C.accountKeys(hex(c.key));
  check("acct", { acct: k.acct, kdata: tohex(k.kdata), kname: tohex(k.kname), kfile: tohex(k.kfile), kid: tohex(k.kid) }, c.out, c.key);
}
for (const c of fam("rid")) check("rid", await C.rid(hex(c.kname), c.kind, c.id), c.out, c);
for (const c of fam("b32")) check("b32", C.b32(hex(c.in)), c.out, c.in);
for (const c of fam("sources")) check("sources", c.which === "facts" ? F.SOURCES[c.name] : CH.SOURCES[c.name], c.out, c.name);
for (const c of fam("constants")) check("constants", c.name.split(".").reduce((o, k) => o[k], { CH, F, E }), c.out, c.name);
for (const c of fam("looks")) check("looks", [CH.tooYoung(c.in), CH.realPerson(c.in), CH.fromYourPhoto(c.in), CH.immodest(c.in)], c.out, c.in);
for (const c of fam("clean")) {
  const r = await attempt(() => CH.clean(c.c, c.existing, c.check, c.known));
  check("clean", r.error !== undefined ? { error: r.error } : r.ok, c.error !== undefined ? { error: c.error } : c.out, c);
}
for (const c of fam("slug")) check("slug", CH.slug(c.in), c.out, c.in);
for (const c of fam("persona")) check("persona", CH.personaOf(c.c, c.builtin), c.out, c);
for (const c of fam("create_prompt")) check("create_prompt", CH.createPrompt(kit, c.desc), c.out, c.desc);
for (const c of fam("create")) {
  const r = await attempt(() => CH.createItems(c.txt).map((it) => CH.clean(it, {}, true, [])));
  check("create", r.error !== undefined ? { error: r.error } : r.ok, c.error !== undefined ? { error: c.error } : c.out, c.txt.slice(0, 200));
}
for (const c of fam("romance")) check("romance", E.romance(kit.edition, c.partner, c.t), c.out, c);
for (const c of fam("romance_direct")) check("romance_direct", P.romanceText(kit.edition, c.partner, c.t), c.out, c);
for (const c of fam("ptags")) check("ptags", E.partnerTags(c.in), c.out, c.in);
for (const c of fam("pchange")) check("pchange", E.partnerChange(c.said, c.priv, c.t), c.out, c);
for (const c of fam("knows")) {
  const t = kit.templates.knows_ask[c.via][c.have ? "have" : "none"];
  check("knows", String(t).split("{name}").join(c.name), c.out, c);
}
for (const c of fam("fid")) check("fid", [await F.fid(c.in), F.norm(c.in)], [c.fid, c.norm], c.in);
for (const c of fam("fclean")) {
  const r = await attempt(() => F.cleanText(c.in));
  check("fclean", r.error !== undefined ? { error: r.error } : r.ok, c.error !== undefined ? { error: c.error } : c.out, c.in);
}
for (const c of fam("secret")) check("secret", F.secretish(c.in), c.out, c.in);
for (const c of fam("fops")) {                           // a sequence of sheet edits, the listing after each
  let lists = { own: null, shared: null }, i = 0;
  const hlc = () => `${String(1760000000000 + ++i).padStart(13, "0")}:0000:test`;
  const got = [];
  for (const step of c.steps) {
    const j = { ...step };
    if (j.id && j.id.startsWith("@")) {                  // (an id from an earlier listing: "@<text>")
      const all = F.listing(c.char.id, lists.own, lists.shared, c.shared_on);
      j.id = (all.find((f) => f.text === j.id.slice(1)) || { id: "missing" }).id;
    }
    try {
      const r = await F.change(c.char, j, lists, { hlc, today: c.today, sharedOn: c.shared_on });
      for (const [owner, d] of Object.entries(r.changed)) { if (owner === c.char.id) lists.own = d; else lists.shared = d; }
      got.push(r.listing);
    } catch (e) { got.push(e.status === 409 ? { changed: true } : { error: e.message }); }
  }
  check("fops", got, c.out, c.steps);
}

console.log(`${n - bad}/${n} cases match`);
process.exit(bad ? 1 : 0);
