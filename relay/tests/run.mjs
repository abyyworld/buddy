// Runs the relay's protocol tests (conformance.mjs) against ref.py and against the Worker in `wrangler dev` (local
// workerd: Durable Objects with SQLite and R2 on disk, nothing deployed, no Cloudflare account needed).
//   node relay/tests/run.mjs [--target ref|worker|all] [--python python3]
// "all" (the default) skips the Worker with a note when relay/node_modules isn't installed
// (cd relay && npm ci --ignore-scripts); "--target worker" then fails instead. Temp folders only; random keys.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { conformance } from "./conformance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)), RELAY = join(HERE, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const target = opt("--target", "all"), python = opt("--python", "python3");
if (!["ref", "worker", "all"].includes(target)) { console.log("Usage: node relay/tests/run.mjs [--target ref|worker|all] [--python python3]"); process.exit(2); }
const ORIGIN = "https://site.test";
const MiB = 1024 * 1024;
const QUOTAS = { records: 60, record_bytes: 6 * MiB, blob_bytes: 20 * MiB, devices: 5 };

const running = new Set();                    // children to stop however this ends
function stop(child) {
  running.delete(child);
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill(); } catch { /* gone */ } }
}
const temps = new Set();
process.on("exit", () => {
  for (const c of running) stop(c);
  for (const d of temps) try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(130));

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
const dumpDir = (dir) => async () => walk(dir).map((p) => { try { return readFileSync(p); } catch { return Buffer.alloc(0); } });

function freePort() {
  return new Promise((ok, no) => {
    const s = createServer(); s.unref(); s.on("error", no);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

function control(base) {
  const post = async (path, body) => (await (await fetch(base + path, { method: "POST", body: JSON.stringify(body) })).json()).now;
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    ctl: {
      advance: async (ms) => { const now = await post("/_test/clock", { advance_ms: ms }); offset = now - Date.now(); return now; },
      housekeep: async (accts) => { await post("/_test/housekeep", { accts }); },
    },
  };
}

async function waitFor(url, child, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error("it exited (" + child.exitCode + ")");
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("didn't start in time");
}

async function runRef(tmp, inviteKey) {
  const data = join(tmp, "data");
  const child = spawn(python, ["-B", "-I", join(HERE, "ref_harness.py"), "--data", data, "--origins", ORIGIN,
                               "--quotas", JSON.stringify(QUOTAS)],
                      { env: { ...process.env, HOME: tmp, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["ignore", "pipe", "inherit"],
                        detached: true });
  running.add(child);
  const port = await new Promise((ok, no) => {
    let buf = "";
    child.stdout.on("data", (d) => { buf += d; const m = /listening (\d+)/.exec(buf); if (m) ok(Number(m[1])); });
    child.on("exit", (c) => no(new Error("ref.py exited " + c)));
  });
  return { child, base: `http://127.0.0.1:${port}`, dump: dumpDir(data), forensic: true, data, inviteKey };
}

async function runWorker(tmp, inviteKey) {
  const wrangler = join(RELAY, "node_modules", ".bin", "wrangler");
  const port = await freePort();
  const vars = { INVITE: Buffer.from(inviteKey).toString("base64"), ALLOWED_ORIGINS: ORIGIN,
                 QUOTA_RECORDS: QUOTAS.records, QUOTA_RECORD_BYTES: QUOTAS.record_bytes, QUOTA_BLOB_BYTES: QUOTAS.blob_bytes,
                 QUOTA_DEVICES: QUOTAS.devices };
  const state = join(tmp, "state");
  const child = spawn(wrangler, ["dev", "tests/worker_entry.js", "--local", "--ip", "127.0.0.1", "--port", String(port),
                                 "--persist-to", state, "--log-level", "error", "--show-interactive-dev-session=false",
                                 ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
                      { cwd: RELAY, env: { ...process.env, HOME: tmp, XDG_CONFIG_HOME: join(tmp, ".config"),
                                           WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"],
                        detached: true });               // (its own process group: stop() ends workerd with it)
  running.add(child);
  let out = "";
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  try { await waitFor(base + "/v1/info", child, 90000); }
  catch (e) { stop(child); throw new Error(`wrangler dev: ${e.message}\n${out.slice(-3000)}`); }
  return { child, base, dump: dumpDir(state), forensic: false, inviteKey, log: () => out };
}

// Checks on the files themselves: logs off, no dependencies at run time, wrangler pinned.
function staticChecks() {
  const problems = [];
  const read = (f) => readFileSync(join(RELAY, f), "utf8");
  for (const f of ["worker.js", "account.js", "mailbox.js", "gate.js", "common.js"]) {
    const src = read(f);
    if (/\bconsole\s*\./.test(src)) problems.push(`${f} logs (console.*)`);
    for (const m of src.matchAll(/^\s*(?:import|export)[^"'\n]*from\s*["']([^"']+)["']/gm))
      if (!m[1].startsWith("./")) problems.push(`${f} imports ${m[1]} (the Worker has no dependencies)`);
  }
  const toml = read("wrangler.toml");
  if (!/^\[observability\]\s*\nenabled = false/m.test(toml)) problems.push("wrangler.toml: observability isn't off");
  if (!/^logpush = false/m.test(toml)) problems.push("wrangler.toml: logpush isn't off");
  if (/^\s*INVITE\s*=/m.test(toml)) problems.push("wrangler.toml holds the INVITE secret");
  const want = JSON.parse(read("package.json")).devDependencies.wrangler;
  const lock = JSON.parse(read("package-lock.json")).packages;
  if (!/^\d+\.\d+\.\d+$/.test(want)) problems.push(`package.json: wrangler ${want} isn't an exact version`);
  if (lock["node_modules/wrangler"]?.version !== want) problems.push("package-lock.json doesn't pin the same wrangler");
  if (Object.entries(lock).some(([k, v]) => k && !v.integrity && !v.link)) problems.push("package-lock.json: a package without a hash");
  return problems;
}

function stdlibOnly() {                       // ref.py starts with no site-packages at all
  return new Promise((ok) => {
    const c = spawn(python, ["-I", "-S", "-B", join(RELAY, "ref.py"), "--help"], { stdio: ["ignore", "ignore", "pipe"] });
    let e = ""; c.stderr.on("data", (d) => { e += d; });
    c.on("exit", (code) => ok(code === 0 ? null : "ref.py needs more than the standard library: " + e.slice(-300)));
  });
}

const targets = target === "all" ? ["ref", "worker"] : [target];
let failed = 0;
{
  const problems = staticChecks();
  const s = targets.includes("ref") && await stdlibOnly();
  if (s) problems.push(s);
  for (const p of problems) console.log("  FAIL  " + p);
  console.log(problems.length ? "static: failed" : "static: logs off, no run-time dependencies, wrangler pinned with hashes" +
              (targets.includes("ref") ? ", ref.py stdlib only" : ""));
  failed += problems.length;
}
for (const name of targets) {
  if (name === "worker" && !existsSync(join(RELAY, "node_modules", ".bin", "wrangler"))) {
    const msg = "worker: skipped (to run it: cd relay && npm ci --ignore-scripts)";
    if (target === "worker") { console.log(msg.replace("skipped", "can't run")); failed++; } else console.log(msg);
    continue;
  }
  const tmp = mkdtempSync(join(tmpdir(), "buddy-relay-" + name + "-"));
  temps.add(tmp);
  const inviteKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  if (name === "ref") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tmp, "data"), { recursive: true, mode: 0o700 });
    writeFileSync(join(tmp, "data", "invite.key"), Buffer.from(inviteKey).toString("base64") + "\n", { mode: 0o600 });
  }
  let t;
  try {
    t = name === "ref" ? await runRef(tmp, inviteKey) : await runWorker(tmp, inviteKey);
    console.log(`${name}: ${t.base}${name === "ref" ? " (" + python + ")" : " (wrangler dev, local workerd)"}`);
    const { now, ctl } = control(t.base);
    const res = await conformance({ name, base: t.base, origin: ORIGIN, inviteKey, quotas: QUOTAS, now, ctl,
                                    dump: t.dump, forensic: t.forensic });
    if (name === "ref") {                       // the relay's files are for its owner only
      const loose = walk(t.data).concat([t.data, join(t.data, "accounts"), join(t.data, "blobs")])
        .filter((p) => statSync(p).mode & 0o077);
      if (loose.length) { console.log("  FAIL  files others can read: " + loose.join(", ")); res.fail++; }
      else console.log("  ok    every file and folder of ref.py's is 0600/0700");
    }
    console.log(`${name}: ${res.total - res.fail}/${res.total} passed`);
    failed += res.fail;
  } catch (e) {
    console.log(`${name}: couldn't run: ${e.stack || e}`); failed++;
  } finally {
    if (t) stop(t.child);
    await new Promise((ok) => setTimeout(ok, 300));
    rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
