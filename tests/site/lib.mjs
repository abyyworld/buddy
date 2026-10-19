// Helpers for Buddy for phones' site tests (unit_sw.mjs, e2e/shell.mjs): the public copy's files (publish.sh --tree),
// test signing keys made here with ssh-keygen in temp folders, site builds (scripts/build_pages.py from that tree) and
// signatures. Never the owner's release key, never anything private; everything is removed when the process exits.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const PYTHON = process.env.BUDDY_PYTHON || "python3";
const temps = [];
process.on("exit", () => { for (const d of temps) try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } });
export function temp(prefix = "buddy-site-") { const d = mkdtempSync(join(tmpdir(), prefix)); temps.push(d); return d; }
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// A test key pair: {priv, pub (the .pub line), raw (32 bytes), b64 (raw as base64)}
export function keygen(name = "k") {
  const d = temp("buddy-key-"), priv = join(d, name);
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test-" + name, "-f", priv]);
  const pub = readFileSync(priv + ".pub", "utf8").trim();
  const blob = Buffer.from(pub.split(" ")[1], "base64");
  const raw = blob.subarray(blob.length - 32);
  return { priv, pub, raw, b64: raw.toString("base64") };
}
export const siteSigners = (k) => `buddy-release namespaces="buddy-site" ${k.pub}\n`;

// The public copy's files, as publish.sh writes them (needs zsh), with its real web/solo/*; `solo`: {name: source} put
// into web/solo/ (temp only), `change(tree)` for anything else
let treeCache = null;
function tracked() {                                   // what git would keep here: not .gitignore's patterns (or .git)
  const glob = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
  const pats = readFileSync(join(REPO, ".gitignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => l.replace(/\/$/, "")).concat([".git"]).map((p) => ({ path: p.includes("/"), re: glob(p) }));
  return (src) => {
    const rel = relative(REPO, src).split("\\").join("/");
    if (!rel) return true;
    const name = rel.split("/").pop();
    return !pats.some((p) => p.re.test(p.path ? rel : name));
  };
}
export function publicTree() {
  if (!treeCache) {
    treeCache = temp("buddy-pub-");
    if (existsSync(join(REPO, "scripts", "publish.sh"))) run("zsh", [join(REPO, "scripts", "publish.sh"), "--tree", treeCache]);
    else if (existsSync(join(REPO, "edition.json"))) cpSync(REPO, treeCache, { recursive: true, filter: tracked() });   // (run in the public copy itself)
    else throw new Error("neither scripts/publish.sh nor the public copy's edition.json is here");
  }
  return treeCache;
}
export function tree(key, { solo = {}, change = null } = {}) {
  const t = temp("buddy-tree-");
  cpSync(publicTree(), t, { recursive: true });
  writeFileSync(join(t, "site-signers"), siteSigners(key));
  for (const [n, src] of Object.entries(solo)) { mkdirSync(join(t, "web", "solo"), { recursive: true }); writeFileSync(join(t, "web", "solo", n), src); }
  if (change) change(t);
  return t;
}
// Builds the site from a tree (its own scripts/build_pages.py, as publish.sh and pages.yml do); returns the folder
export function build(t, version, { base = "/buddy/", out = null } = {}) {
  const o = out || join(temp("buddy-built-"), "site");
  run(PYTHON, ["-I", join(t, "scripts", "build_pages.py"), "--tree", t, "--out", o, "--version", String(version), "--base", base]);
  return o;
}
export function sign(site, key, ns = "buddy-site", extra = []) {
  rmSync(join(site, "site-manifest.json.sig"), { force: true });
  run("ssh-keygen", ["-q", "-Y", "sign", "-f", key.priv, "-n", ns, ...extra, join(site, "site-manifest.json")]);
  return readFileSync(join(site, "site-manifest.json.sig"), "utf8");
}
export function files(dir) {                           // {relative path: Buffer}
  const out = {};
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p).split("\\").join("/")] = readFileSync(p); } };
  walk(dir);
  return out;
}
export function copy(site) { const d = join(temp("buddy-copy-"), "site"); cpSync(site, d, { recursive: true }); return d; }
export const exists = existsSync;
