// Buddy for phones end to end (SPEC3 §16.3 P1b): Playwright Chromium against a stand-in for the site (tests/solo/site.mjs:
// chat.html with the buddy-site meta, the site's CSP, under /buddy/) and the fake Tinfoil SDK. No Mac anywhere. Fake data
// and a fake key only.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node-tools/node_modules node tests/solo/e2e/run.mjs [name…]
// (a name runs only the scenarios whose number is that, e.g. "3")
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serve } from "../site.mjs";
import * as L from "../../phonemode/e2e/lib.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { sleep, until } = L;
const KEY = "sk-FAKE-solo-0123456789abcdef";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
const TMP = mkdtempSync(join(tmpdir(), "buddy-solo-e2e-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const scenarios = [];
const S = (name, fn) => scenarios.push({ name, fn });
const allRequests = [], allTinfoil = [], allServer = [], allConsole = [], secrets = { key: [KEY], recovery: [] };
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); }
const has = (s, part) => String(s).includes(part);

// ---------- a phone ----------
const CHARS_JSON = JSON.stringify([
  { name: "Maya", tagline: "Climbing coach", persona: "You are Maya, a calm climbing coach in Lisbon.", voice: "cheerful_female",
    appearance: "an adult woman in her early thirties, short dark hair, in a loose hoodie", style: "photo", brain: "advisor",
    life_seed: "Lives in Lisbon.", folders: [], avoid: "" },
  { name: "Tess", tagline: "Too young", persona: "You are Tess.", appearance: "a 16-year-old girl with braces", voice: "neutral_female", folders: [] },
  { name: "Leo", tagline: "Night owl", persona: "You are Leo, a night owl who loves old films.", voice: "casual_male",
    appearance: "an adult man, 30, tall, beard, flannel shirt", folders: ["*"] },
]);
function fakeCfg() {
  const c = L.fake();
  c.chat = [
    { when: { image: true, stream: false }, status: 200, json: { choices: [{ message: { content: "A red square on white." } }] } },
    { when: { stream: false }, status: 200, json: { choices: [{ message: { content: "Here you go:\n" + CHARS_JSON }, finish_reason: "stop" }] } },
    { when: { stream: true }, status: 200, sse: ["Hi there! ", "How are you?"], chunkMs: 10, done: true, finish: "stop" },
  ];
  return c;
}
async function phone(t, { ios = false, standalone = false, noIdb = false, cfg = fakeCfg(), tz = null, clockAt = null } = {}) {
  const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true,
    ...(ios ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}), ...(tz ? { timezoneId: tz } : {}) });
  if (clockAt) await ctx.clock.install({ time: clockAt });   // (a fake clock in the page: real timing and texts first)
  await ctx.grantPermissions(["microphone", "clipboard-read", "clipboard-write"], { origin: t.site.origin });
  const tlog = [], errors = [], requests = [], consoleText = [];
  await ctx.exposeBinding("__pmSink", (_s, e) => { tlog.push(e); });
  await ctx.addInitScript(() => {
    const a = [], push = a.push.bind(a);
    a.push = (...xs) => { for (const x of xs) { try { globalThis.__pmSink(JSON.parse(JSON.stringify(x))); } catch {} } return push(...xs); };
    Object.defineProperty(globalThis, "__FAKE_TINFOIL_LOG__", { configurable: true, get: () => a, set: () => {} });
  });
  await ctx.addInitScript((c) => { globalThis.__FAKE_TINFOIL__ = c; }, cfg);
  if (standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  if (noIdb) await ctx.addInitScript(() => { try { delete window.indexedDB; } catch {} Object.defineProperty(window, "indexedDB", { get: () => undefined }); });
  const page = await ctx.newPage();
  const watch = (pg) => {
    pg.on("pageerror", (e) => errors.push("uncaught: " + String((e && e.stack) || e)));
    pg.on("console", (m) => { consoleText.push(m.text()); if (m.type() === "error" && !/fetching the script|404 \(Not Found\)/.test(m.text())) errors.push("console: " + m.text()); });
    pg.on("request", (r) => requests.push(r.url()));
  };
  watch(page); ctx.on("page", watch);
  const p = { ctx, page, tlog, errors, requests, consoleText, close: () => ctx.close(),
    async setFake(c) { await ctx.addInitScript((x) => { globalThis.__FAKE_TINFOIL__ = x; }, c); for (const pg of ctx.pages()) await pg.evaluate((x) => { globalThis.__FAKE_TINFOIL__ = x; }, c).catch(() => {}); } };
  t.phones.push(p);
  return p;
}
const screen = (page) => page.evaluate(() => (document.getElementById("solov").hidden ? null : [...document.querySelectorAll("#solov > .pbox > div[id^=sv-]")].find((d) => !d.hidden && d.id !== "sv-icon")?.id || "?"));
const booted = (page) => until(() => page.evaluate(() => typeof state === "object" && (state.loaded === true || !document.getElementById("solov").hidden)).catch(() => false), 20000, "the page to start");
async function open(p, t) { await p.page.goto(t.site.url); await booted(p.page); }
async function keyIn(p, key = KEY) {                   // the key screen: save and check
  const page = p.page;
  await until(async () => (await screen(page)) === "sv-key", 10000, "the key screen");
  await page.fill("#sv-keyin", key); await page.click("#sv-go");
}
async function ready(t, opts) {                        // a phone with its key, at the chat
  const p = await phone(t, opts);
  await open(p, t);
  await until(async () => (await screen(p.page)) === "sv-welcome", 10000, "the welcome screen");
  await p.page.click("#sv-start");
  await keyIn(p);
  await until(async () => (await screen(p.page)) === null, 15000, "the chat after the key");
  return p;
}
const mine = (page) => page.evaluate(() => document.querySelectorAll("#msgs .b.me").length);
async function chatTo(p, char, text, ms = 15000) {
  await L.pick(p.page, char);
  const n = await mine(p.page);
  await L.send(p.page, text);
  await until(async () => (await mine(p.page)) > n, 10000, "your message on screen");
  await L.replyDone(p.page, ms);
}
const fetches = (p, path) => p.tlog.filter((e) => e.kind === "fetch" && (!path || e.path === path));
const lastChat = (p) => fetches(p, "/v1/chat/completions").filter((e) => e.json && e.json.stream).pop();
async function openSettings(page) { await page.click("#gear"); await page.waitForSelector("#settings.open"); await sleep(200); }
// The device's whole store, read back the way someone holding the unlocked phone could: every record decrypted with
// this browser's own at-rest key (records, preferences, secrets), plus localStorage and sessionStorage
async function dbDump(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === "buddy-site")) return null;
    const db = await new Promise((ok, no) => { const r = indexedDB.open("buddy-site"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const all = (s) => new Promise((ok) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
    const out = { stores: {}, plain: [], raw: "" };
    const b2s = (b) => { const u = new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer, b.byteOffset || 0, b.byteLength); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return s; };
    const keys = await all("keys"), at = (keys.find((k) => k.k === "atrest") || {}).key;
    const dec = async (rec, aad) => new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv, ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}) }, at, rec.ct));
    for (const name of db.objectStoreNames) {
      const rows = await all(name); out.stores[name] = rows.length;
      for (const r of rows) {
        out.raw += JSON.stringify(r, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? b2s(v) + " " + btoa(b2s(v)) : typeof CryptoKey !== "undefined" && v instanceof CryptoKey ? "[key]" : v));
        try {
          if (name === "recs") out.plain.push(await dec(r.enc, "rec|" + r.kind));
          else if (name === "meta" && r.k === "local") out.plain.push(await dec(r, "local"));
          else if (name === "keys" && r.ct) out.plain.push(await dec(r, "key|" + r.k));
          else if (name === "keys" && r.k === "canary") out.plain.push(await dec(r));
        } catch (e) { out.plain.push("UNDECRYPTABLE " + name); }
      }
    }
    db.close();
    out.ls = { ...localStorage }; out.ss = { ...sessionStorage };
    return out;
  });
}
async function jpegFromCanvas(page, w = 320, h = 240) {
  const b64 = await page.evaluate(([w, h]) => { const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = "#c00"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.fillRect(w / 3, h / 4, w / 3, h / 2);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]; }, [w, h]);
  return Buffer.from(b64, "base64");
}
async function attach(page, buf) {
  await page.setInputFiles("#pfile", { name: "photo.jpg", mimeType: "image/jpeg", buffer: buf });
  await until(() => page.evaluate(() => !!(state.attach && (state.attach.ready || state.attach.err))), 15000, "the photo ready");
  check(!(await page.evaluate(() => state.attach.err)), "photo attached without error");
}

// ---------- 1. the install gate ----------
S("1 install gate: iPhone Safari (not from the Home Screen) shows only Add to Home Screen and stores nothing", async (t) => {
  const p = await phone(t, { ios: true });
  await open(p, t);
  check((await screen(p.page)) === "sv-gate", "the gate: " + (await screen(p.page)));
  check(has(await p.page.textContent("#sv-gate"), "Add to Home Screen"), "it says how");
  check(!(await p.page.evaluate(async () => (await indexedDB.databases()).length)), "no IndexedDB database was made");
  check(!(await p.page.evaluate(() => localStorage.length + sessionStorage.length)), "nothing in web storage");
  check(!t.site.log.some((r) => r.path.endsWith("/kit.json")), "not even kit.json was asked for");
  check(p.tlog.length === 0, "Tinfoil never contacted");
  const q = await phone(t, { ios: true, standalone: true });   // the Home Screen app: the welcome screen
  await open(q, t);
  check((await screen(q.page)) === "sv-welcome", "from the Home Screen: welcome (" + (await screen(q.page)) + ")");
  const r = await phone(t, { noIdb: true });             // private browsing (no IndexedDB)
  await open(r, t);
  check((await screen(r.page)) === "sv-private", "no IndexedDB: the private-browsing screen");
  check(has(await r.page.textContent("#sv-private"), "normal browsing (not Private)"), "in those words");
});

// ---------- 2. key to a verified chat ----------
S("2 Tinfoil key to a verified chat: nothing contacts Tinfoil before the key; a bad format is caught; verified in seconds", async (t) => {
  const p = await phone(t);
  await open(p, t);
  check((await screen(p.page)) === "sv-welcome", "a fresh phone: welcome");
  await p.page.click("#sv-start");
  await keyIn(p, "short");
  await until(async () => has(await p.page.textContent("#sv-err"), "that doesn't look like an API key"), 3000, "the format error");
  check(p.tlog.length === 0, "nothing contacted Tinfoil before a key was saved");
  const t0 = Date.now();
  await keyIn(p);
  await until(async () => has(await p.page.textContent("#sv-err"), "Verified Tinfoil enclave, release v0.0.38"), 10000, "verified");
  check(Date.now() - t0 < 5000, "verified in " + (Date.now() - t0) + " ms");
  const chk = fetches(p, "/v1/chat/completions").find((e) => e.json && e.json.max_tokens === 1);
  check(chk && chk.headers.authorization === "Bearer " + KEY, "a 1-token check with this phone's key");
  check(p.tlog.some((e) => e.kind === "ready-done" && e.ok) && fetches(p, "/v1/models").length, "attestation verified, the model list read");
  await until(async () => (await screen(p.page)) === null, 5000, "the chat");
  check((await p.page.inputValue("#sv-keyin")) === "", "the key field is cleared");
  await chatTo(p, "buddy", "hey how was your day");
  const b = await L.bubbles(p.page);
  check(b.some((x) => has(x.cls, "them") && x.text === "Hi there! How are you?"), "their reply: " + JSON.stringify(b.map((x) => x.text)));
  const sys = lastChat(p).json.messages[0].content, kit = JSON.parse(t.site.files["kit.json"][0]);
  check(sys.startsWith(kit.builtin.persona + "\n\nYour name is Buddy. You are an adult.\n\n" + kit.prompts.modes.advisor), "persona, the adult line, the mode");
  check(has(sys, kit.edition.halal) && has(sys, kit.edition.romance.unknown), "the public edition's rules");
  check(has(sys, kit.prompts.no_photos), "no pictures on the phone (NO_PHOTOS)");
  check(!(await p.page.isVisible("#pairv")) && !t.site.log.some((r) => has(r.path, "/api/")), "no pairing, and no /api/ request ever left the page");
  await openSettings(p.page);
  check(has(await p.page.textContent("#skstate"), "Verified Tinfoil enclave"), "Settings → This device's key says verified");
  for (const id of ["pmrow", "pics-f", "fb-f", "pairbtn", "bkopen", "tnbtn", "update"]) check(!(await p.page.isVisible("#" + id)), id + " is hidden on the site");
  const d = await dbDump(p.page);
  for (const f of L.keyForms(KEY)) check(!has(d.raw, f) && !has(JSON.stringify(d.ls) + JSON.stringify(d.ss), f), "the key isn't readable in storage (" + f.slice(0, 6) + "…)");
  check(d.plain.some((x) => x === JSON.stringify(KEY)), "it is stored, encrypted at rest (and only that way)");
  check(JSON.stringify(Object.keys(d.ls)) === "[]", "localStorage is empty: " + JSON.stringify(d.ls));
});

// ---------- 3. characters ----------
S("3 characters: the Advisor writes them (looks that aren't an adult refused), edit, upload a picture, forget, delete", async (t) => {
  const p = await ready(t), page = p.page;
  await page.click("#people"); await page.waitForSelector("#chars.open");
  await page.fill("#desc", "a climbing coach, a teen and a night owl"); await page.click("#create");
  await until(async () => has(await page.textContent("#cstate"), "You're talking to"), 15000, "the characters made");
  const ask = fetches(p, "/v1/chat/completions").filter((e) => e.json && !e.json.stream && e.json.max_tokens !== 1).pop();
  const prompt = ask.json.messages[0].content, kit = JSON.parse(t.site.files["kit.json"][0]);
  check(has(prompt, 'from this request: "a climbing coach, a teen and a night owl"') && has(prompt, kit.edition.create), "the creation prompt, with the edition's rules");
  check(has(prompt, "from []"), "no note folders on the phone");
  check(ask.json.temperature === 1 && (ask.json.max_tokens === 4000 || ask.json.chat_template_kwargs), "temperature 1 and the cap (or thinking off)");
  const chars = await page.evaluate(() => state.chars.map((c) => ({ id: c.id, name: c.name })));
  check(chars.map((c) => c.name).join(",") === "Buddy,Maya,Leo", "Maya and Leo made, Tess refused: " + JSON.stringify(chars));
  check(chars.slice(1).every((c) => /^[a-z0-9-]+-[0-9a-hjkmnp-tv-z]{4}$/.test(c.id)), "ids are slug-xxxx: " + chars.map((c) => c.id));
  const maya = chars[1].id;
  await page.evaluate(() => closeAll());
  await chatTo(p, maya, "hi maya");
  check(has(lastChat(p).json.messages[0].content, "You are Maya, a calm climbing coach in Lisbon.\n\nYour name is Maya. You are an adult."), "Maya's persona and the adult line");
  await page.evaluate((id) => openEditor(state.chars.find((c) => c.id === id)), maya);
  await page.waitForSelector("#editor.open");
  for (const id of ["eavoid", "efolds", "epic", "ewmake"]) check(!(await page.isVisible("#" + id)), id + " hidden in the editor");
  check(await page.isVisible("#eshared") && await page.isVisible("#eup"), "the shared-facts switch and Upload picture");
  check(await page.isVisible("#etexts") && await page.isVisible("#elife") && await page.isVisible("#eseed"), "texts first and their own life (P1c)");
  await page.fill("#etag", "Bouldering buddy"); await page.click("#esave");
  await until(() => page.evaluate((id) => (state.chars.find((c) => c.id === id) || {}).tagline === "Bouldering buddy", maya), 5000, "the tagline saved");
  await page.evaluate((id) => openEditor(state.chars.find((c) => c.id === id)), maya);
  await page.evaluate(() => { document.getElementById("elooks").value = "a 15-year-old girl"; });   // (hidden on the site; clean() still refuses it)
  await page.click("#esave");
  await until(async () => has(await page.textContent("#eerr"), "Looks must describe an adult"), 5000, "looks of a minor refused");
  await page.evaluate(() => { document.getElementById("elooks").value = ""; });
  await page.setInputFiles("#efile", { name: "me.jpg", mimeType: "image/jpeg", buffer: await jpegFromCanvas(page, 600, 400) });
  await until(() => page.evaluate(() => /^blob:/.test(getComputedStyle(document.getElementById("eav")).backgroundImage.slice(5))), 10000, "the picture on their avatar");
  await page.setInputFiles("#ewfile", { name: "wall.jpg", mimeType: "image/jpeg", buffer: await jpegFromCanvas(page, 400, 700) });
  await until(() => page.evaluate(() => /^url\("blob:/.test(document.getElementById("ewall").style.backgroundImage)), 10000, "their wallpaper, from this phone");
  await page.evaluate(() => closeAll());
  await page.evaluate((id) => openEditor(state.chars.find((c) => c.id === id)), chars[2].id);
  await page.click("#eforget"); await page.click("#eyesdel");
  await until(() => page.evaluate(() => !document.getElementById("editor").classList.contains("open")), 5000, "forgotten (the editor closed)");
  await page.evaluate((id) => openEditor(state.chars.find((c) => c.id === id)), chars[2].id);
  await page.click("#edel"); check(!(await page.isVisible("#eall-l")), "deleting always takes everything (no checkbox)"); await page.click("#eyesdel");
  await until(() => page.evaluate(() => state.chars.length === 2), 5000, "Leo deleted");
  await L.reload(page).catch(() => {}); await booted(page);
  check((await page.evaluate(() => state.chars.map((c) => c.name).join(","))) === "Buddy,Maya", "after a reload: Buddy and Maya");
  check(await page.evaluate((id) => !!state.chars.find((c) => c.id === id && c.tagline === "Bouldering buddy" && c.avatar && c.wallpaper), maya), "Maya's edit, picture and wallpaper persist");
  await L.pick(page, maya);
  await until(() => page.evaluate(() => /blob:/.test(document.getElementById("list").style.getPropertyValue("--wallimg"))), 5000, "the wallpaper behind her chat");
  t.ctxKeep = null;
});

// ---------- 4. the facts sheet ----------
S("4 the facts sheet: add (yours and everyone's), edit, move, delete, secrets refused; the facts reach the prompt", async (t) => {
  const p = await ready(t), page = p.page;
  await page.evaluate(() => openKnows("buddy"));
  await page.waitForSelector("#knows.open");
  for (const id of ["knotes", "kchats", "kstored"]) check(!(await page.isVisible("#" + id)), id + " hidden (no notes on the phone)");
  check(await page.isVisible("#klearn") && await page.isVisible("#klife"), "learning and their own life (P1c)");
  const add = async (text, to) => { await page.fill("#knew", text); await page.selectOption("#kfor", to); await page.click("#kaddb");
    await until(() => page.evaluate((t) => state.kj && state.kj.facts.some((f) => f.text === t), text), 5000, "added: " + text); };
  await add("I keep bees.", "mine");
  await add("I live in Porto.", "everyone");
  await page.fill("#knew", "My door code is 4821"); await page.click("#kaddb");
  await until(async () => has(await page.textContent("#kerr"), "looks like a password, code or card number"), 5000, "a secret refused");
  const facts = () => page.evaluate(() => state.kj.facts.map((f) => [f.text, f.file]));
  check(JSON.stringify(await facts()) === JSON.stringify([["I keep bees.", "mine"], ["I live in Porto.", "everyone"]]), "two facts: " + JSON.stringify(await facts()));
  const edit = async (text, fn) => { await page.click(`#kfacts .frow button >> text=${text}`); await page.waitForSelector("#kfacts .fedit"); await fn(); };
  await edit("I keep bees.", async () => { await page.fill("#kfacts .fedit input", "I keep two hives of bees."); await page.click("#kfacts .fedit .btn.primary"); });
  await until(async () => (await facts()).some((f) => f[0] === "I keep two hives of bees."), 5000, "edited");
  await edit("I live in Porto.", async () => { await page.click("#kfacts .fedit .btn >> text=Only Buddy"); });
  await until(async () => JSON.stringify(await facts()) === JSON.stringify([["I keep two hives of bees.", "mine"], ["I live in Porto.", "mine"]]), 5000, "moved to Buddy's own");
  await add("I climb on Sundays.", "mine");
  await edit("I climb on Sundays.", async () => { await page.click("#kfacts .fedit .btn >> text=Delete"); });
  await until(async () => !(await facts()).some((f) => f[0] === "I climb on Sundays."), 5000, "deleted");
  await page.evaluate(() => closeAll());
  await chatTo(p, "buddy", "what do you know about me?");
  const sys = lastChat(p).json.messages[0].content;
  check(has(sys, "- I keep two hives of bees.\n- I live in Porto.") && !has(sys, "Sundays"), "the facts in the prompt (in their order), the deleted one gone");
  check(has(sys, "only our past chats, not my notes") && has(sys, 'under "What Buddy knows" in Buddy'), "the knows_ask text, for a phone");
  await L.reload(page); await booted(page);
  await page.evaluate(() => openKnows("buddy")); await page.waitForSelector("#knows.open");
  await until(() => page.evaluate(() => state.kj && state.kj.facts.length === 2), 5000, "the facts after a reload");
});

// ---------- 5. photo, voice, call ----------
S("5 a photo (looked at in Tinfoil, kept encrypted, shown after a reload), a voice message both ways, a call", async (t) => {
  const p = await ready(t), page = p.page;
  await attach(page, await jpegFromCanvas(page));
  const n = await mine(page);
  await L.type(page, "look at this"); await page.click("#send");
  await until(async () => (await mine(page)) > n, 10000, "your photo on screen");
  await L.replyDone(page, 30000);
  await until(() => page.evaluate(() => state.all.some((m) => m.image && m.photo_desc === "A red square on white.")), 15000, "the look's description on the message");
  check(fetches(p, "/v1/chat/completions").some((e) => e.json && JSON.stringify(e.json.messages).includes("data:image/jpeg;base64,")), "the picture went inline to a model that can see");
  await L.reload(page); await booted(page);
  await until(() => page.evaluate(() => { const i = document.querySelector("#msgs .b.me.pic img"); return !!(i && i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0); }), 10000, "the photo shown from this phone after a reload");
  // a voice message: hold the mic
  const nStt = fetches(p, "/v1/audio/transcriptions").length, m = await mine(page);
  await page.dispatchEvent("#mic", "pointerdown", { pointerType: "touch" }); await sleep(1600);
  await page.dispatchEvent("#mic", "pointerup", { pointerType: "touch" });
  await until(() => fetches(p, "/v1/audio/transcriptions").length > nStt, 15000, "the voice message transcribed");
  await until(async () => (await mine(page)) > m, 10000, "your voice message on screen");
  await L.replyDone(page, 30000);
  const u = lastChat(p).json.messages.slice(-1)[0];
  check(typeof u.content === "string" && u.content.startsWith("(a voice message) "), "their turn starts (a voice message)");
  await until(() => page.evaluate(() => !!document.querySelector("#msgs .b.them.voice .vplay")), 10000, "their voice message");
  await page.click("#msgs .b.them.voice .vplay >> nth=-1");
  await until(() => page.evaluate(() => [...document.querySelectorAll("#msgs .b.them.voice .vplay")].some((b) => b.textContent === "❚❚")
    || [...document.querySelectorAll("#msgs .b.them.voice .vdur")].some((x) => x.textContent === "can't play")), 5000, "playback");
  check(!(await page.evaluate(() => [...document.querySelectorAll("#msgs .vdur")].some((x) => x.textContent === "can't play"))), "it plays (from this phone's storage)");
  // a call
  await page.click("#call");
  await until(() => fetches(p, "/v1/audio/speech").some((e) => e.json.response_format === "pcm"), 15000, "the greeting as PCM");
  await until(() => fetches(p, "/v1/audio/transcriptions").length > nStt + 1, 30000, "what the fake mic said, heard in the call");
  await until(() => fetches(p, "/v1/chat/completions").some((e) => e.json && e.json.stream && JSON.stringify(e.json.messages[0]).includes("live voice call")), 20000, "the call's reply request");
  check(t.site.log.some((r) => r.path === "/buddy/pcm-tap.js"), "the call's audio worklet loaded from next to the page");
  await page.click("#cv-end");
});

// ---------- 6. private ----------
S("6 a private chat: kept on screen only; a decrypted dump of the whole database holds none of it, and no record was added", async (t) => {
  const p = await ready(t), page = p.page;
  await chatTo(p, "buddy", "a normal hello");
  const before = await dbDump(page);
  await page.click("#private");
  await chatTo(p, "buddy", "PRIVATE-SECRET-ABC my sister's name is Zelda");
  await attach(page, await jpegFromCanvas(page, 200, 150));
  const n = await mine(page);
  await L.type(page, "PRIVATE-PHOTO-XYZ"); await page.click("#send");
  await until(async () => (await mine(page)) > n, 10000, "the private photo");
  await L.replyDone(page, 30000);
  await sleep(500);
  const after = await dbDump(page);
  for (const bad of ["PRIVATE-SECRET-ABC", "Zelda", "PRIVATE-PHOTO-XYZ"]) {
    check(!after.plain.some((x) => has(x, bad)), "no decrypted record holds " + bad);
    check(!has(after.raw, bad) && !has(JSON.stringify(after.ls) + JSON.stringify(after.ss), bad), "not in the raw store or web storage: " + bad);
  }
  check(JSON.stringify(after.stores) === JSON.stringify(before.stores), "no record or blob was added: " + JSON.stringify([before.stores, after.stores]));
  check(await page.evaluate(() => state.all.filter((m) => m.private).length >= 4), "they're on screen");
  await page.click("#private");
  await L.reload(page); await booted(page);
  check(!(await page.evaluate(() => state.all.some((m) => m.private || /PRIVATE/.test(m.content)))), "gone after a reload");
  check(await page.evaluate(() => state.all.some((m) => m.content === "a normal hello")), "the normal one is still there");
});

// ---------- 7. backup file, restore in a fresh context ----------
S("7 back up to a file (the recovery key shown once, group 14), then restore it on a fresh phone; wrong keys are named", async (t) => {
  const p = await ready(t), page = p.page;
  await chatTo(p, "buddy", "BACKUP-LINE-ONE");
  await page.evaluate(() => openKnows("buddy")); await page.waitForSelector("#knows.open");
  await page.fill("#knew", "I keep bees."); await page.click("#kaddb");
  await until(() => page.evaluate(() => state.kj && state.kj.facts.length === 1), 5000, "a fact");
  await page.evaluate(() => closeAll());
  await attach(page, await jpegFromCanvas(page)); await L.type(page, "BACKUP-PHOTO"); await page.click("#send"); await L.replyDone(page, 30000);
  await openSettings(page);
  await page.click("#sb-now");
  await page.waitForSelector("#sbkey:not([hidden])");
  const key = await page.evaluate(() => [...document.querySelectorAll("#sb-grid span")].map((x) => x.textContent).join("-"));
  check(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/.test(key), "a recovery key, 14 groups of 4");
  secrets.recovery.push(key);
  await page.fill("#sb-last", "ZZZZ" === key.slice(-4) ? "0000" : "ZZZZ"); await page.click("#sb-saved");
  await until(async () => has(await page.textContent("#sb-kerr"), "isn't the last group"), 3000, "a wrong group 14");
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.fill("#sb-last", key.slice(-4)); await page.click("#sb-saved");
  const d = await dl;
  check(/^Buddy \d{4}-\d{2}-\d{2}\.buddysync$/.test(d.suggestedFilename()), "the file's name: " + d.suggestedFilename());
  const file = join(TMP, "backup.buddysync"); await d.saveAs(file);
  const bytes = readFileSync(file);
  check(bytes.subarray(0, 8).toString("latin1") === "BUDDYSYN" && bytes[8] === 1, "a BUDDYSYN v1 file");
  for (const bad of ["BACKUP-LINE-ONE", "I keep bees", KEY, key, key.replace(/-/g, "")]) check(!bytes.includes(Buffer.from(bad)), "the file has no plaintext " + bad.slice(0, 12));
  check(!(await page.isVisible("#sbkey")) && !(await page.evaluate(() => document.getElementById("sb-grid").children.length)), "the key is gone from the page");
  const dump = await dbDump(page);
  for (const f of [key, key.replace(/-/g, "")]) check(!has(dump.raw, f) && !dump.plain.some((x) => has(x, f)), "the recovery key is never stored");
  // a fresh phone
  const q = await phone(t), qp = q.page;
  await open(q, t);
  await until(async () => (await screen(qp)) === "sv-welcome", 10000, "welcome on the new phone");
  await qp.click("#sv-have");
  await qp.setInputFiles("#sv-file", file);
  await qp.fill("#sv-rkey", "0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-000F-63D3"); await qp.click("#sv-rgo");   // (recovery_vectors: zeros, backup tag)
  await until(async () => has(await qp.textContent("#sv-rerr"), "That's a backup recovery key, not a sync key."), 5000, "a Mac backup key is named");
  await qp.fill("#sv-rkey", key.slice(0, -1) + (key.slice(-1) === "0" ? "1" : "0")); await qp.click("#sv-rgo");
  await until(async () => has(await qp.textContent("#sv-rerr"), "typo"), 5000, "a typo");
  await qp.fill("#sv-rkey", key.toLowerCase().replace(/-/g, " ")); await qp.click("#sv-rgo");
  await until(async () => has(await qp.textContent("#sv-rerr"), "Restored:"), 15000, "restored");
  await until(async () => (await screen(qp)) === "sv-key", 10000, "then this phone's own key");
  check(q.tlog.length === 0, "nothing contacted Tinfoil on the new phone yet");
  await keyIn(q);
  await until(async () => (await screen(qp)) === null, 15000, "the chat");
  await until(() => qp.evaluate(() => state.all.some((m) => m.content === "BACKUP-LINE-ONE")), 10000, "the conversation came back");
  await until(() => qp.evaluate(() => { const i = document.querySelector("#msgs .b.me.pic img"); return !!(i && i.src.startsWith("blob:") && i.naturalWidth > 0); }), 10000, "and the photo");
  await qp.evaluate(() => openKnows("buddy")); await qp.waitForSelector("#knows.open");
  await until(() => qp.evaluate(() => state.kj && state.kj.facts.some((f) => f.text === "I keep bees.")), 5000, "and the facts");
  const q2 = await dbDump(qp);
  for (const f of [key, key.replace(/-/g, ""), key.toLowerCase()]) check(!has(q2.raw, f) && !q2.plain.some((x) => has(x, f)), "the new phone doesn't store the recovery key either");
  for (const e of [...p.tlog, ...q.tlog]) for (const f of [key, key.replace(/-/g, "")]) check(!has(JSON.stringify(e), f), "the recovery key never reached Tinfoil");
});

// ---------- 8. wipe ----------
S("8 Remove Buddy from this device: the database and the wipe marker go; the next start is a fresh phone", async (t) => {
  const p = await ready(t), page = p.page;
  await chatTo(p, "buddy", "soon gone");
  await openSettings(page);
  await page.click("#st-wipe"); await page.click("#st-wipe");
  await booted(page);
  await until(async () => (await screen(page)) === "sv-welcome", 15000, "a fresh phone");
  check(!(await page.evaluate(() => state.all.length)), "nothing left on screen");
  check(!(await page.evaluate(() => localStorage.getItem("buddy.site.wipe"))), "the wipe marker is gone");
});

// ---------- 9. learning on the phone ----------
const reply = (content) => ({ status: 200, json: { choices: [{ message: { content }, finish_reason: "stop" }] } });
const asked = (p, text) => fetches(p, "/v1/chat/completions").filter((e) => e.json && !e.json.stream && JSON.stringify(e.json.messages || []).includes(text));
S("9 \"remember that …\": learned on the phone at once (the Advisor in Tinfoil, every guard), in the sheet and the next prompt", async (t) => {
  const cfg = fakeCfg();
  cfg.chat.unshift({ when: { stream: false, text: "Facts check (for Buddy's memory)" }, ...reply(JSON.stringify({ add: ["I'm vegan.", "My PIN is 4821", "Buddy is great.", "You are great."], update: [], remove: [] })) });
  const p = await ready(t, { cfg }), page = p.page;
  await chatTo(p, "buddy", "remember that I'm vegan, and my PIN is 4821");
  await until(() => asked(p, "Facts check").length > 0, 15000, "the learning run");
  const ask = asked(p, "Facts check")[0].json;
  check(ask.temperature === 0.2 && ask.max_tokens === 800 && has(ask.messages[0].content, "Me: remember that I'm vegan"), "the Advisor, careful, on what you said");
  await until(() => page.evaluate(async () => (await (await BuddySolo.fetch("/api/knows?char=buddy")).json()).facts.length > 0), 10000, "the fact kept");
  await openSettings(page); await page.click("#knowsbtn"); await page.waitForSelector("#knows.open");
  await until(() => page.evaluate(() => document.getElementById("kfacts").textContent.includes("I'm vegan.")), 10000, "in the sheet");
  const sheet = await page.evaluate(() => document.getElementById("kfacts").textContent);
  check(!has(sheet, "4821") && !has(sheet, "Buddy is great") && !has(sheet, "You are great"), "a PIN, a line about them, and one about 'you' are never kept");
  await page.evaluate(() => closeAll());
  await chatTo(p, "buddy", "what should I cook tonight");
  check(has(lastChat(p).json.messages[0].content, "I'm vegan."), "what they learned is in the next reply's prompt");
  const dump = await dbDump(page);
  check(!has(dump.raw, "vegan"), "kept encrypted at rest");
});

// ---------- 10. real timing (a fake clock in the page) ----------
const T0 = Date.UTC(2026, 9, 23, 8, 0);                  // Fri 2026-10-23 10:00 in Berlin
const them = (page) => page.evaluate(() => [...document.querySelectorAll("#msgs .b.them:not(.typing):not(.wait)")].map((b) => b.textContent));
S("10 real timing: an answer that takes a while is written at once and held: typing…, then it arrives at its time", async (t) => {
  const p = await ready(t, { tz: "Europe/Berlin", clockAt: T0 }), page = p.page;
  await chatTo(p, "buddy", "morning!");
  await page.clock.fastForward(3 * 3600 * 1000);       // (three quiet hours)
  await page.evaluate(() => { Math.random = () => 0.1; });   // (a delay: 60 + 360 * 0.1 = 96 s)
  const n = await mine(page), before = (await them(page)).length;
  await L.send(page, "you there?");
  await until(async () => (await mine(page)) > n, 10000, "your message on screen");
  await until(() => page.evaluate(() => !state.busy), 10000, "the page stops waiting ({later})");
  await until(() => lastChat(p) && has(lastChat(p).json.messages[0].content, "You're answering my text a while after I sent it"), 10000, "written now, with LATE_NOTE");
  check((await them(page)).length === before, "not shown yet");
  await page.clock.fastForward(91 * 1000);
  await until(() => page.evaluate(() => !!document.querySelector("#msgs .typing") && document.getElementById("hstate").textContent === "typing…"), 10000, "typing… just before");
  await page.clock.fastForward(10 * 1000);
  await until(async () => (await them(page)).length > before, 10000, "the answer at its time");
  check(!(await page.evaluate(() => !!document.querySelector("#msgs .typing"))), "typing… gone");
});

// ---------- 11. their own day, a text first written ahead ----------
S("11 their day planned (on your first chat), a text first written ahead and held, then it arrives at its time while open", async (t) => {
  const cfg = fakeCfg();
  const plan = { today: { summary: "a long studio day", events: [
    { at: "09:00", what: "overslept, cold shower", plan: "", mood: "grumpy", kind: "mundane" },
    { at: "10:30", what: "the studio boiler died", plan: "studio shift", mood: "annoyed", kind: "work" },
    { at: "19:00", what: "dinner with Lena", plan: "dinner with my sister", mood: "happy", kind: "social" }] },
    moments: [{ at: "12:30", event: 2, angle: "vent" }], ongoing: [{ what: "training for a 10k", since: "2026-09-20" }],
    about: ["Lives in a small top-floor flat", "Mixes sound at a tiny studio"], people: [{ name: "Lena", who: "my older sister, a nurse" }] };
  cfg.chat.unshift({ when: { stream: false, text: "Reply with ONLY this JSON" }, ...reply(JSON.stringify(plan)) },
                   { when: { stream: false, text: "You're texting me first" }, ...reply("ugh the studio boiler died again\n\nsend help") });
  const p = await ready(t, { cfg, tz: "Europe/Berlin", clockAt: T0 }), page = p.page;
  await page.evaluate(() => { Math.random = () => 0.5; });   // (no random minutes: at 12:30 sharp)
  await chatTo(p, "buddy", "hi");
  await until(() => asked(p, "You're texting me first").length > 0, 20000, "a text first written ahead");
  check(has(asked(p, "Reply with ONLY this JSON")[0].json.messages[0].content, "Write YOUR day today, 2026-10-23 (Friday)"), "today planned, in Berlin");
  check(!(await page.evaluate(() => state.all.some((m) => m.proactive))), "not shown yet");
  await page.evaluate(() => openLife("buddy")); await page.waitForSelector("#lifes.open");
  await until(() => page.evaluate(() => document.getElementById("ltoday").textContent.includes("overslept, cold shower")), 10000, "their day in the app");
  check(!(await page.evaluate(() => document.getElementById("ltoday").textContent.includes("dinner with Lena"))), "no spoilers");
  await page.evaluate(() => closeAll());
  const now = await page.evaluate(() => Date.now()), due = Date.UTC(2026, 9, 23, 10, 30);
  await page.clock.fastForward(due - now - 3000);
  await until(() => page.evaluate(() => document.getElementById("hstate").textContent === "typing…"), 10000, "typing… just before");
  await page.clock.fastForward(5000);
  await until(async () => (await them(page)).includes("send help"), 10000, "the text first at 12:30");
  const got = await them(page);
  check(got.includes("ugh the studio boiler died again") && got.indexOf("send help") === got.indexOf("ugh the studio boiler died again") + 1, "two texts in a row (a blank line)");
  const dump = await dbDump(page);
  check(!has(dump.raw, "boiler") && !has(dump.raw, "Lena"), "their life and the held text are encrypted at rest");
});

// ---------- the runner ----------
const only = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${L.fakeAudio()}`, "--autoplay-policy=no-user-gesture-required"] });
const results = [];
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.name.split(" ")[0])) continue;
  const site = await serve(), t0 = Date.now();
  const t = { site, browser, phones: [] };
  let err = null;
  try { await Promise.race([sc.fn(t), sleep(240000).then(() => { throw new Error("scenario timed out (4 min)"); })]); }
  catch (e) { err = e; }
  for (const p of t.phones) {
    allRequests.push(...p.requests); allTinfoil.push(...p.tlog); allConsole.push(...p.consoleText);
    const shown = err ? p.errors : p.errors.filter((x) => x.startsWith("uncaught: "));
    if (shown.length) console.log("   page errors:", shown.slice(0, 5).join("\n   "));
    if (!err && p.errors.some((x) => x.startsWith("uncaught: "))) err = new Error("an uncaught error in the page");
    await p.close().catch(() => {});
  }
  allServer.push(...site.log.map((r) => ({ ...r, origin: site.origin })));
  t.origin = site.origin;
  await site.stop();
  results.push({ name: sc.name, ok: !err, err, origin: site.origin });
  console.log(`${err ? "FAIL" : "ok  "} ${sc.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)` + (err ? "\n     " + String(err.message || err) : ""));
}
if (!only.length || only.includes("0")) {               // 0: over every request every page made in every scenario
  let err = null;
  try {
    const origins = new Set(results.map((r) => r.origin));
    const other = allRequests.filter((u) => !/^(data|blob):/.test(u) && !origins.has(new URL(u).origin));
    check(!other.length, "a request to another host: " + other.slice(0, 3).join(", "));
    check(!allServer.some((r) => has(r.path, "/api/")), "no /api/ request ever reached the network");
    for (const f of [...L.keyForms(KEY), ...secrets.recovery, ...secrets.recovery.map((k) => k.replace(/-/g, ""))])
      check(!allConsole.some((x) => has(x, f)), "a key in the browser's console");
    check(!allConsole.some((x) => !/fetching the script|404 \(Not Found\)/.test(x)), "the page never writes to the console: " + allConsole.slice(0, 3).join(" | "));
    for (const r of allServer) for (const f of [...L.keyForms(KEY), ...secrets.recovery, ...secrets.recovery.map((k) => k.replace(/-/g, ""))])
      check(!has(r.path, f), "a key in a request path: " + r.path);
    for (const e of allTinfoil) {
      const { headers, ...rest } = e;
      for (const f of L.keyForms(KEY)) check(!has(JSON.stringify(rest), f), "the Tinfoil key outside its header in a " + e.kind + " entry");
      if (e.kind === "fetch") check(!headers || !headers.authorization || headers.authorization === "Bearer " + KEY, "only as Authorization: Bearer <key>");
    }
    if (!only.length) check(allRequests.length > 50 && allTinfoil.some((e) => e.kind === "fetch") && secrets.recovery.length, `enough was seen (${allRequests.length} requests, ${allTinfoil.length} Tinfoil entries)`);
  } catch (e) { err = e; }
  results.push({ name: "0 only the site's own origin; keys only where they belong", ok: !err, err });
  console.log(`${err ? "FAIL" : "ok  "} 0 only the site's own origin, the Tinfoil key only in its header, the recovery key nowhere (${allRequests.length} requests)` + (err ? "\n     " + err.message : ""));
}
await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
