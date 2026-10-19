// Phone mode's SDK self-check, no network: the vendored web/vendor/tinfoil.mjs exports what web/direct.js uses,
// verifies Tinfoil's recorded attestation bundle (a public document from atc.tinfoil.sh, recorded 2026-10-08, in
// sdk_fixture/) without fetching anything, rejects tampered copies of it, and refuses a plain-HTTP enclave.
// Run: node tests/phonemode/sdk_selfcheck.mjs   (CI does). Exit 1 on any failure.
// The bundle's certificates are long-lived (AMD's VCEK ~7 years); if a check fails only because of today's date,
// the message says so, and the fix is to re-record the bundle.
import { readFileSync } from "node:fs";

if (!globalThis.crypto || !globalThis.crypto.subtle || typeof structuredClone !== "function") {
  console.log("FAIL the SDK self-check needs node >= 20 (WebCrypto)"); process.exit(1);
}
const fetches = [];
globalThis.fetch = async (u) => { fetches.push(String(u && u.url ? u.url : u)); throw new TypeError("no network in the SDK self-check"); };

const RECORDED = Date.UTC(2026, 9, 8, 12);              // when the bundle was recorded
const REPO = "tinfoilsh/confidential-model-router";
const NAMES = ["SecureClient", "Verifier", "TinfoilError", "ConfigurationError", "FetchError", "AttestationError",
               "EhbpError", "KeyConfigMismatchError", "ProtocolError", "DecryptionError"];
const fixture = JSON.parse(readFileSync(new URL("sdk_fixture/attestation-bundle.json", import.meta.url), "utf8"));
let failed = 0;
const ok = (msg) => console.log("ok   " + msg);
const bad = (msg) => { failed++; console.log("FAIL " + msg); };

// Runs fn with the clock at `ms` (null: the real clock), to tell a broken check from certificates that expired.
const RealDate = Date;
async function at(ms, fn) {
  if (ms === null) return fn();
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(ms); }
    static now() { return ms; }
  }
  globalThis.Date = FixedDate;
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}

const mod = await import("../../web/vendor/tinfoil.mjs");

// 1. exactly the ten exports web/direct.js relies on
const got = Object.keys(mod).sort(), want = [...NAMES].sort();
if (JSON.stringify(got) === JSON.stringify(want) && NAMES.every((n) => typeof mod[n] === "function")) ok("exports: " + NAMES.join(", "));
else bad(`exports: got [${got.join(", ")}], want [${want.join(", ")}]`);

// 2. the recorded bundle verifies, and nothing is fetched while it does
async function verify(bundle, clock) {
  return at(clock, async () => {
    const v = new mod.Verifier({ configRepo: REPO });
    await v.verifyBundle(structuredClone(bundle));
    return v.getVerificationDocument();
  });
}
let clock = null;                                       // the clock the tamper checks run at (real, unless expired)
try {
  const doc = await verify(fixture, null);
  if (doc.securityVerified === true && doc.releaseTag === "v0.0.38") ok(`recorded bundle verifies (release ${doc.releaseTag})`);
  else bad(`recorded bundle: securityVerified ${doc.securityVerified}, releaseTag ${doc.releaseTag} (want true, v0.0.38)`);
} catch (e) {
  let then = null;
  try { then = await verify(fixture, RECORDED); } catch {}
  if (then && then.securityVerified === true) {
    clock = RECORDED;
    bad(`recorded bundle fails only because of today's date (${e.name}: ${e.message}); it still verifies at its ` +
        "recording time, so its certificates aren't valid today: re-record tests/phonemode/sdk_fixture/attestation-bundle.json " +
        "(POST {\"enclaveUrl\":\"https://inference.tinfoil.sh\"} to https://atc.tinfoil.sh/attestation) and update the releaseTag here");
  } else bad(`recorded bundle doesn't verify: ${e.name}: ${e.message}`);
}
if (fetches.length) bad("fetched during verification: " + fetches.join(", "));
else ok("no fetch during verification");

// 3. tampered copies are rejected with AttestationError
const flip = (b64) => { const b = Buffer.from(b64, "base64"); b[b.length - 10] ^= 1; return b.toString("base64"); };
for (const [label, change] of [
  ["one byte of vcek flipped", (f) => ({ ...f, vcek: flip(f.vcek) })],
  ["digest replaced by zeros", (f) => ({ ...f, digest: "0".repeat(64) })],
  ["domain replaced by evil.example.com", (f) => ({ ...f, domain: "evil.example.com" })],
]) {
  try {
    await verify(change(fixture), clock);
    bad(`tampered bundle accepted (${label})`);
  } catch (e) {
    if (e instanceof mod.AttestationError) ok(`tampered bundle rejected (${label}): ${String(e.message).slice(0, 80)}`);
    else bad(`tampered bundle (${label}) rejected with ${e && e.name}, not AttestationError: ${e && e.message}`);
  }
}
if (fetches.length) bad("fetched during the tamper checks: " + fetches.join(", "));

// 4. HTTPS only; the real configuration constructs without contacting anything
try {
  new mod.SecureClient({ enclaveURL: "http://inference.tinfoil.sh" });
  bad("SecureClient accepted an http:// enclaveURL");
} catch (e) {
  if (e instanceof mod.ConfigurationError) ok("SecureClient refuses an http:// enclaveURL (ConfigurationError)");
  else bad(`SecureClient with an http:// enclaveURL threw ${e && e.name}, not ConfigurationError`);
}
try {
  new mod.SecureClient({ enclaveURL: "https://inference.tinfoil.sh", configRepo: REPO, userCacheSecret: "0".repeat(64) });
  if (fetches.length) bad("constructing SecureClient fetched " + fetches.join(", "));
  else ok("SecureClient constructs for https://inference.tinfoil.sh without contacting anything");
} catch (e) {
  bad(`SecureClient with the real configuration threw ${e && e.name}: ${e && e.message}`);
}

if (failed) { console.log(`sdk self-check: ${failed} failed`); process.exitCode = 1; }
else console.log("sdk self-check: all passed");
