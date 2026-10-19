// Phone mode against the real server (SPEC2 §15.6), run once parts A, B, C1 and C2 are merged:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node-tools/node_modules node tests/phonemode/integration/run.mjs
// serve.py runs the real buddy_server on a temp copy of the repo (temp HOME, the fake Tinfoil SDK in place of
// web/vendor/tinfoil.mjs). Service workers are allowed and nothing is routed: with the server stopped, only the
// worker's copy can serve /phone, /direct.js and /pcm-tap.js, exactly as on a phone whose Mac is off.
// Steps: pair a phone (the Mac's /api/pair/start), turn phone mode on, wait for the shell copy, check the real kit and
// the /phone CSP; stop the server -> phone mode: chat, photo, voice message, reaction, New chat; start it again ->
// sync -> the copy's .thread.json has them (direct: true, from: "phone"), photos 0600 in .media/, a saved chat in the
// temp home's ~/Buddy/chats/. Fake data and a fake key only. The temp copy is deleted afterwards (KEEP=1 keeps it).
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import * as L from "../e2e/lib.mjs";
const { KEY, sleep, until } = L;

const SERVE = join(L.HERE, "..", "integration", "serve.py");
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); console.log("  ok  " + msg); }
async function serve(args = []) {
  const p = spawn(process.env.PYTHON || "python3", ["-B", SERVE, ...args], { stdio: ["ignore", "pipe", "inherit"] });
  const info = await new Promise((ok, no) => {
    let buf = "";
    p.stdout.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { ok(JSON.parse(buf.slice(0, i))); } catch (e) { no(e); } } });
    p.on("exit", (c) => no(new Error("serve.py exited " + c)));
  });
  return Object.assign(info, { proc: p, url: `http://127.0.0.1:${info.port}`,
    stop: () => new Promise((ok) => { if (p.exitCode !== null) return ok(); p.once("exit", ok); p.kill("SIGTERM"); }) });
}
const asMac = (srv, path, body) => fetch(srv.url + path, { method: body === undefined ? "GET" : "POST",
  headers: { Cookie: "buddy=" + srv.token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const thread = (srv) => { try { return JSON.parse(readFileSync(join(srv.root, ".thread.json"), "utf8")); } catch { return []; } };
const mine = (page) => page.evaluate(() => document.querySelectorAll("#msgs .b.me").length);
async function chat(page, text) {
  const n = await mine(page); await L.send(page, text);
  await until(async () => (await mine(page)) > n, 10000, "your message on screen"); await L.replyDone(page, 30000);
}

const browser = await L.launch();
let srv = await serve(), failed = null;
const cfg = L.fake();
cfg.chat[2] = { when: { stream: true }, status: 200, sse: ["Lovely to hear from you. ", "[react: ❤️] Tell me more!"], chunkMs: 30, done: true, finish: "stop" };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
await ctx.grantPermissions(["microphone"], { origin: srv.url });
await ctx.addInitScript((c) => { globalThis.__FAKE_TINFOIL__ = c; globalThis.__FAKE_TINFOIL_LOG__ = []; }, cfg);
const page = await ctx.newPage();
try {
  console.log("integration: the real server on a temp copy at " + srv.root);
  check(existsSync(join(srv.root, "web", "direct.js")), "web/direct.js is in the copy");
  // ---- pair, phone mode on ----
  await page.goto(srv.url + "/phone");
  await page.waitForSelector("#pairv:not([hidden])", { timeout: 15000 });
  const code = (await (await asMac(srv, "/api/pair/start", {})).json()).code;
  await page.fill("#pv-code", code);
  await Promise.all([page.waitForNavigation(), page.click("#pv-go")]);
  await L.booted(page);
  check(true, "paired with the code from the Mac's /api/pair/start");
  await L.phoneModeOn({ page }, KEY);
  check(await page.evaluate(() => BuddyDirect.enabled() && BuddyDirect.have().kit && BuddyDirect.have().key), "phone mode on, with the real kit and this phone's key");
  const cache = await L.shellCached(page);
  check(cache.startsWith("buddy-shell-"), "the app shell is cached (" + cache + ")");
  const kit = await page.evaluate(async () => (await fetch("/api/phonekit")).json());
  check(kit.v === 1 && typeof kit.etag === "string" && kit.kit && kit.context && kit.context.chars.buddy, "the kit has its shape");
  const flat = JSON.stringify(kit);
  for (const bad of ['"knowledge"', '"appearance"', '"texts_first"', '"life_seed"', '"learns"', "phala_key", "tinfoil_key"])
    check(!flat.includes(bad), "the kit has no " + bad);
  check(kit.kit.chars.every((c) => c.persona && typeof c.facts === "object" && c.knows_ask.phone && c.knows_ask.call), "personas, facts, knows_ask for every character");
  const csp = await page.evaluate(async () => [(await fetch("/phone")).headers.get("content-security-policy"), (await fetch("/")).headers.get("content-security-policy")]);
  check(csp[0].includes("https://inference.tinfoil.sh") && csp[0].includes("https://atc.tinfoil.sh"), "/phone's CSP allows Tinfoil's two hosts");
  check(!csp[1].includes("tinfoil"), "/ keeps the plain CSP");
  // ---- the Mac goes away ----
  await srv.stop();
  await page.reload({ waitUntil: "domcontentloaded" });
  await until(() => L.isPM(page), 8000, "phone mode from the worker's copy");
  check(true, "with the server stopped the app opened from the service worker, in phone mode");
  await L.pick(page, "buddy");
  await chat(page, "hello from phone mode");
  check(await page.evaluate(() => [...document.querySelectorAll("#msgs .b.them")].some((b) => b.textContent.includes("Tell me more!"))), "a reply came (fake SDK)");
  const photo = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 200; c.height = 150; const g = c.getContext("2d");
    g.fillStyle = "#c00"; g.fillRect(0, 0, 200, 150); return c.toDataURL("image/jpeg", 0.9).split(",")[1]; });
  await page.setInputFiles("#pfile", { name: "p.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo, "base64") });
  await until(() => page.evaluate(() => !!(state.attach && state.attach.ready)), 15000, "the photo ready");
  await chat(page, "a photo");
  await page.dispatchEvent("#mic", "pointerdown", { pointerType: "touch" }); await sleep(1600);
  await page.dispatchEvent("#mic", "pointerup", { pointerType: "touch" });
  await until(() => page.evaluate(() => document.querySelectorAll("#msgs .b.me.voice").length > 0), 20000, "your voice message");
  await L.replyDone(page, 30000);
  const last = await page.evaluate(() => [...document.querySelectorAll("#msgs .b.them[data-id]")].pop().dataset.id);
  await page.evaluate((id) => api("/api/react", { id: Number(id), emoji: "👍" }), last);
  await page.evaluate(() => api("/api/newchat", { char: "buddy" }));
  const pending = await page.evaluate(() => BuddyDirect.pending());
  check(pending >= 8, "chat, photo, voice message, reactions and New chat wait in the outbox (" + pending + ")");
  // ---- the Mac is back ----
  srv = await serve(["--root", srv.root, "--port", String(srv.port)]);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await until(async () => !(await L.isPM(page)) && (await page.evaluate(() => typeof state === "object" && state.loaded).catch(() => false)), 40000, "back in Mac mode");
  await until(async () => (await page.evaluate(() => BuddyDirect.pending())) === 0, 20000, "the outbox synced");
  const th = thread(srv), direct = th.filter((m) => m.direct);
  check(direct.length === pending, `the copy's .thread.json has the phone-mode messages (${direct.length})`);
  check(direct.every((m) => m.from === "phone" && typeof m.cid === "string"), "each with from: phone and its cid");
  check(direct.some((m) => m.role === "user" && m.content === "hello from phone mode" && m.via === "phone"), "your text");
  check(direct.some((m) => m.role === "assistant" && m.content.includes("Tell me more!")), "their reply");
  const ph = direct.find((m) => m.image);
  check(ph && ph.w === 200 && ph.h === 150, "the photo, with its size from the JPEG");
  const media = join(srv.root, ".media");
  for (const f of readdirSync(media).filter((f) => f.startsWith(ph.image))) check((statSync(join(media, f)).mode & 0o777) === 0o600, ".media/" + f + " is 0600");
  check(direct.some((m) => m.voice), "the voice message");
  check(direct.some((m) => m.role === "reaction" && m.emoji === "👍" && m.by === "you"), "your reaction");
  check(direct.some((m) => m.role === "reaction" && m.by === "buddy"), "their reaction");
  check(direct.some((m) => m.role === "break"), "New chat");
  const chats = join(srv.home, "Buddy", "chats", "buddy");
  check(existsSync(chats) && readdirSync(chats).some((f) => f.endsWith(".md")), "a saved chat in the temp home's ~/Buddy/chats/buddy/");
  const saved = readdirSync(chats).map((f) => readFileSync(join(chats, f), "utf8")).join("\n");
  check(saved.includes("hello from phone mode") && saved.includes("Lovely to hear from you. Tell me more!"), "the turn saved, the reply on one line");
} catch (e) { failed = e; console.log("FAIL " + (e.message || e)); }
finally {
  await browser.close(); await srv.stop();
  if (!process.env.KEEP) rmSync(dirname(srv.root), { recursive: true, force: true });   // (KEEP=1 keeps the temp copy)
}
console.log(failed ? "integration: FAILED" : "integration: all passed");
process.exit(failed ? 1 : 0);
