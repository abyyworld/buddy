// Phone mode end to end (SPEC2 §15.5): Playwright Chromium against tests/phonemode/fake_mac.py and the fake Tinfoil SDK.
// Fake data and a fake key only. Each scenario gets a fresh fake Mac and fresh phone profiles; 1a (the key never
// reaches the Mac) is checked at the end over everything every scenario sent.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node-tools/node_modules node tests/phonemode/e2e/run.mjs [name…]
// (a name runs only the scenarios whose name starts with it, e.g. "4" or "10")
import * as L from "./lib.mjs";
const { KEY, sleep, until } = L;

const scenarios = [];
const S = (name, fn) => scenarios.push({ name, fn });
const macLogs = [], tinfoilLogs = [];

function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); }
const has = (s, part) => String(s).includes(part);
const msgText = (m) => (typeof m.content === "string" ? m.content : (m.content || []).map((x) => x.text || "").join(" "));
async function online(page) { await page.evaluate(() => dispatchEvent(new Event("online"))); }
async function toPhoneMode(t, p) {                     // the Mac stops answering; a reload opens in phone mode
  await t.mac.mode("refuse");
  await L.reload(p.page);
  await until(() => L.isPM(p.page), 5000, "phone mode");
}
async function ready(t, cfg) {                         // paired, phone mode on with the key, the app shell cached
  const p = await t.phone(cfg);
  await L.pair(p); await L.phoneModeOn(p); await L.shellCached(p.page);
  return p;
}
const mine = (page) => page.evaluate(() => document.querySelectorAll("#msgs .b.me").length);
async function chatTo(p, char, text, ms = 15000) {      // send, and wait for the whole reply (or its failure)
  await L.pick(p.page, char);
  const n = await mine(p.page);
  await L.send(p.page, text);
  await until(async () => (await mine(p.page)) > n, 10000, "your message on screen");
  await L.replyDone(p.page, ms);
}
async function sendPhoto(p, buf, text, ms = 30000) {
  await attach(p.page, buf);
  const n = await mine(p.page);
  await L.type(p.page, text); await p.page.click("#send");
  await until(async () => (await mine(p.page)) > n, 10000, "your photo on screen");
  await L.replyDone(p.page, ms);
}
const notes = (page) => page.evaluate(() => [...document.querySelectorAll("#msgs .note")].map((n) => n.textContent));
// a JPEG made by Chromium's own encoder, with an APP1 "Exif … GPS" segment put in after its start
async function exifJpeg(browser) {
  const pg = await browser.newPage();
  const b64 = await pg.evaluate(() => { const c = document.createElement("canvas"); c.width = 320; c.height = 240;
    const g = c.getContext("2d"); g.fillStyle = "#c00"; g.fillRect(0, 0, 320, 240); g.fillStyle = "#fff"; g.fillRect(100, 60, 120, 120);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]; });
  await pg.close();
  const j = Buffer.from(b64, "base64"), payload = Buffer.concat([Buffer.from("Exif\0\0MM\0*GPS 52.5200N 13.4050E secret-place"), Buffer.alloc(40)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  return Buffer.concat([j.subarray(0, 2), app1, j.subarray(2)]);
}
function jpegHasApp1(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1]; if (m === 0xe1) return true; if (m === 0xda) return false;
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return false;
}
async function attach(page, buf) {
  await page.setInputFiles("#pfile", { name: "photo.jpg", mimeType: "image/jpeg", buffer: buf });
  await until(() => page.evaluate(() => !!(state.attach && (state.attach.ready || state.attach.err))), 15000, "the photo ready");
  const err = await page.evaluate(() => state.attach.err); check(!err, "photo attached without error: " + err);
}
const visionCalls = (tlog) => L.tinfoilFetches(tlog, "/v1/chat/completions").filter((e) => e.json && !e.json.stream);

// ---------- 1. setup ----------
S("1 setup: pair, phone mode on, key saved; nothing private or the key in the phone's storage", async (t) => {
  const p = await t.phone();
  await L.pair(p);
  await L.phoneModeOn(p, null);
  check(p.tlog.length === 0, "nothing contacts Tinfoil before this phone's key is saved (log: " + JSON.stringify(p.tlog.slice(0, 3)) + ")");
  await L.openSettings(p.page);
  check(has(await p.page.textContent("#pmstate"), "On · needs this phone's Tinfoil key"), "Settings asks for the key");
  await p.page.fill("#pm-key", "short"); await p.page.click("#pm-save");
  await until(async () => has(await p.page.textContent("#pm-err"), "that doesn't look like an API key"), 3000, "the key-format error");
  await p.page.fill("#pm-key", KEY); await p.page.click("#pm-save");
  await until(() => p.page.evaluate(() => BuddyDirect.have().key), 5000, "the key saved");
  check((await p.page.inputValue("#pm-key")) === "", "the key field is cleared after saving");
  check(p.tlog.length === 0, "saving the key contacts nothing");
  check(has(await p.page.textContent("#pmstate"), "Ready for when your Mac is away"), "Settings: ready");
  await L.closeSheets(p.page);
  await L.shellCached(p.page);
  const d = await L.dump(p.page), flat = JSON.stringify({ idb: d.idb, ls: d.ls, ss: d.ss });
  check(d.idb && d.idb.meta.some((x) => x.k === "kit"), "the kit is stored");
  for (const bad of ["Sarah", "red coat", "PRIVATE-XYZ"]) check(!has(flat, bad), "the phone's storage has no " + bad);
  for (const f of L.keyForms()) check(!has(flat, f), "the key (" + f.slice(0, 6) + "…) isn't in IndexedDB, localStorage or sessionStorage");
  const keys = d.idb.keys.map((k) => k.k).sort();
  check(JSON.stringify(keys) === '["tinfoil","wrap"]', "keys store: wrap and tinfoil only (" + keys + ")");
  const wrap = d.idb.keys.find((k) => k.k === "wrap"), tf = d.idb.keys.find((k) => k.k === "tinfoil");
  check(wrap.key && wrap.key.$cryptoKey === "AES-GCM" && wrap.key.extractable === false, "the wrapping key is a non-extractable AES-GCM CryptoKey");
  check(tf.ct && tf.ct.$bytes > 0 && tf.iv && tf.iv.$bytes === 12, "the key is stored as ciphertext with a 12-byte IV");
  const names = Object.keys(d.caches);
  check(names.length === 1 && names[0].startsWith("buddy-shell-"), "one shell cache (" + names + ")");
  const urls = d.caches[names[0]].map((x) => new URL(x.url).pathname).sort();
  check(JSON.stringify(urls) === JSON.stringify([...L.SHELL].sort()), "the cache holds exactly the shell: " + urls);
  for (const x of d.caches[names[0]]) for (const bad of ["red coat", "PRIVATE-XYZ", "Sarah is my sister", ...L.keyForms()])
    check(!has(x.body, bad), "cached " + x.url + " has no " + bad.slice(0, 8));
  t.p1 = p;
});

// ---------- 2. offline launch ----------
S("2 offline launch: the service worker opens the cached app in phone mode", async (t) => {
  const p = await ready(t), page = p.page;
  await t.mac.mode("refuse");
  let t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await until(() => L.isPM(page), 5000, "phone mode");
  const fast = Date.now() - t0;
  check(fast < 1500, `a refusing Mac: phone mode in ${fast} ms (< 1 s wanted; 1.5 s allowed for a slow test machine)`);
  check(has(await page.textContent("#hstate"), "phone mode · Mac away"), "the header says phone mode");
  await t.mac.mode("hang");
  const at = Date.now(), since = (await t.mac.state()).log;
  t0 = Date.now();
  await page.goto(t.mac.url + "/phone", { waitUntil: "domcontentloaded" });
  await until(() => L.isPM(page), 5000, "phone mode after a new navigation");
  check(Date.now() - t0 < 4000, "a hung Mac: phone mode in " + (Date.now() - t0) + " ms (< 4 s)");
  await sleep(Math.max(0, 2000 - (Date.now() - at)));
  const me = (await t.mac.log(since)).filter((e) => e.path === "/api/me");
  check(me.length === 0, "no /api/me for 2 s after it (the page knew the Mac was down): " + me.length);
  const v = await page.evaluate(async () => {
    const seen = []; document.addEventListener("securitypolicyviolation", (e) => seen.push(e.blockedURI));
    const go = (u) => fetch(u, { signal: AbortSignal.timeout(4000) }).then(() => "ok", (e) => e.name);
    const a = await go("https://example.com/x"), b = await go("https://inference.tinfoil.sh/v1/models");
    await new Promise((r) => setTimeout(r, 300));
    return { seen, a, b };
  });
  check(v.seen.some((u) => has(u, "example.com")), "the cached page's CSP blocks example.com: " + JSON.stringify(v));
  check(!v.seen.some((u) => has(u, "tinfoil")), "and allows Tinfoil's hosts (it fails at the network only): " + JSON.stringify(v));
  const d = await L.dump(page), names = Object.keys(d.caches);
  check(names.length === 1, "one cache");
  const urls = d.caches[names[0]].map((x) => new URL(x.url).pathname);
  check(JSON.stringify([...urls].sort()) === JSON.stringify([...L.SHELL].sort()), "Cache Storage holds exactly the shell");
  check(!urls.some((u) => u.startsWith("/api/")), "no /api/ URL is ever cached");
  await t.mac.mode("up");
  const mp = await p.ctx.newPage(), before = (await t.mac.state()).log;
  const resp = await mp.goto(t.mac.url + "/?mac=1", { waitUntil: "domcontentloaded" });
  check(!resp.fromServiceWorker(), "/?mac=1 isn't answered by the service worker");
  check((await t.mac.log(before)).some((e) => e.path === "/?mac=1"), "/?mac=1 reached the fake Mac");
  await mp.close();
});

// ---------- 3. switching mid-session ----------
S("3 switching mid-session: two failed polls, idle -> phone mode (private text typed: it waits)", async (t) => {
  const p = await ready(t), page = p.page;
  await page.evaluate(() => { window.__mark = 1; });
  await page.click("#private");
  await L.type(page, "a private thought");
  await t.mac.mode("hang");
  await until(() => page.evaluate(() => directing === true), 30000, "the page to see the Mac gone and wait for idle");
  await sleep(4000);
  check(await page.evaluate(() => window.__mark === 1), "with private text typed it waits (no reload)");
  await L.type(page, "");
  await until(() => L.isPM(page), 20000, "phone mode after the composer emptied");
  check(has(await page.textContent("#hstate"), "phone mode · Mac away"), "header: phone mode · Mac away");
  await p.close();                                     // a plain (not private) draft is carried over the switch
  await t.mac.mode("up");
  const p2 = await ready(t), page2 = p2.page;
  await L.type(page2, "half a thought");
  await t.mac.mode("hang");
  const t0 = Date.now();
  await until(() => L.isPM(page2), 35000, "phone mode within 35 s");
  check(Date.now() - t0 < 35000, "switched in " + (Date.now() - t0) + " ms");
  check((await page2.inputValue("#text")) === "half a thought", "a non-private draft is carried over the switch");
});

// ---------- 3a. a slow Mac stays the Mac ----------
S("3a a slow Mac stays the Mac; a refusing one doesn't get asked", async (t) => {
  const p = await ready(t), page = p.page;
  await t.mac.mode("slow 3000");
  const t0 = Date.now();
  const resp = await page.goto(t.mac.url + "/phone", { waitUntil: "domcontentloaded" });
  const took = Date.now() - t0;
  const info = await page.evaluate(() => new Promise((ok) => {   // (asked before the boot's probe ends and says "up")
    const ch = new MessageChannel(); ch.port1.onmessage = (e) => ok(e.data);
    navigator.serviceWorker.controller.postMessage({ type: "info" }, [ch.port2]); setTimeout(() => ok(null), 1000);
  }));
  check(resp.fromServiceWorker() && took >= 2400 && info && info.downWhy === "timer" && info.navFromCacheAt > 0,
    `the SW served the cached page after its 2.5 s timer (${took} ms, ${JSON.stringify(info)})`);
  await page.evaluate(() => { window.__mark = 1; });
  await L.booted(page, 20000);
  await sleep(2000);
  check(!(await L.isPM(page)), "the boot probed for 4 s and stayed in Mac mode");
  check(await page.evaluate(() => window.__mark === 1), "no second reload");
  await t.mac.mode("reset");
  await sleep(500);
  await t.mac.mode("refuse");
  const asked = []; const onReq = (r) => { if (new URL(r.url()).pathname === "/api/me") asked.push(r.url()); };
  page.on("request", onReq);
  const t1 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await until(() => L.isPM(page), 5000, "phone mode");
  check(Date.now() - t1 < 1500, "a refusing Mac: phone mode in " + (Date.now() - t1) + " ms");
  check(asked.length === 0, "the boot didn't probe (the SW had just seen the Mac fail): " + asked.length);
  page.off("request", onReq);
});

// ---------- 3b. the Mac's own slow GETs ----------
S("3b on the Mac (/?mac=1) a 9 s /api/images isn't cut at 8 s", async (t) => {
  const ctx = await t.browser.newContext();
  await ctx.addCookies([{ name: "buddy", value: t.mac.mac_token, url: t.mac.url }]);
  t.extra.push(ctx);
  await t.mac.mode("slow 9000 /api/images");
  const pg = await ctx.newPage(), done = [], failed = [];
  pg.on("requestfinished", (r) => { if (has(r.url(), "/api/images")) done.push(r.url()); });
  pg.on("requestfailed", (r) => { if (has(r.url(), "/api/images")) failed.push(r.failure()); });
  await pg.goto(t.mac.url + "/?mac=1");
  await until(() => done.length || failed.length, 20000, "the /api/images answer");
  check(done.length && !failed.length, "it completed: " + JSON.stringify(failed));
});

// ---------- 4. text chat ----------
S("4 text chat in phone mode: one request to Tinfoil with the key; separate texts; their reaction; the outbox", async (t) => {
  const cfg = L.fake();
  cfg.chat[2] = { when: { stream: true }, status: 200, sse: ["Hi there! [react: 😂] ", "How are you?\n\n", "I missed you."], chunkMs: 250, done: true, finish: "stop" };
  const p = await ready(t, cfg), page = p.page;
  await toPhoneMode(t, p);
  const since = (await t.mac.state()).log;
  await L.pick(page, "mara");
  await L.send(page, "hey Mara, guess what");
  await until(() => page.evaluate(() => [...document.querySelectorAll("#msgs .b.them")].some((b) => b.textContent.includes("Hi there!")) && state.busy), 8000, "the reply streaming in");
  await L.replyDone(page);
  const c = L.lastChat(p.tlog);
  check(c, "a chat request went to Tinfoil");
  check(c.headers.authorization === "Bearer " + KEY, "Authorization: Bearer <this phone's key>");
  check(Object.keys(c.headers).every((h) => ["authorization", "content-type", "ehbp-encapsulated-key"].includes(h)), "only the headers G2 allowed: " + Object.keys(c.headers));
  check(c.json.stream === true && c.json.temperature === 0.9, "stream: true, temperature 0.9");
  check(c.json.model === "deepseek-v4-1-flash", "Companion's first listed model: " + c.json.model);
  const sys = c.json.messages[0];
  check(sys.role === "system" && sys.content.startsWith("You are Mara, a painter who lives by the sea."), "the system message starts with Mara's persona");
  check(has(sys.content, "Your name is Mara. You are an adult."), "the adult line");
  check(has(sys.content, "FAKE-TEXTING-STYLE"), "the phone's texting style");
  check(has(sys.content, "I live in Lisbon."), "a fact Mara knows");
  check(["FAKE-LENGTH-TINY.", "FAKE-LENGTH-SHORT.", "FAKE-LENGTH-MEDIUM.", "FAKE-LENGTH-LONG."].some((x) => sys.content.endsWith(x)), "ends with the length line");
  check(!has(sys.content, "Sarah"), "nothing kept from Mara");
  check(!(await t.mac.log(since)).some((e) => e.path === "/api/chat"), "the fake Mac got no /api/chat");
  const them = (await L.bubbles(page)).filter((b) => has(b.cls, "them"));
  check(them.some((b) => b.text.startsWith("Hi there! How are you?")) && them.some((b) => b.text.startsWith("I missed you.")), "a blank line: two bubbles: " + JSON.stringify(them.map((b) => b.text)));
  check(await page.evaluate(() => [...document.querySelectorAll("#msgs .b.me .rxb")].some((x) => x.textContent === "😂")), "their 😂 shows on your message");
  const ob = await L.outbox(page);
  check(ob.map((x) => x.role).join(",") === "user,reaction,assistant", "the outbox: user, reaction, assistant: " + ob.map((x) => x.role));
  check(ob[2].reply_to === ob[0].cid && ob[1].target_cid === ob[0].cid && ob[1].by === "mara" && ob[1].emoji === "😂", "reply_to and the reaction's target");
  check(ob[2].content === "Hi there! How are you?\n\nI missed you.", "the reply's texts joined by a blank line: " + JSON.stringify(ob[2].content));
  check(ob.every((x) => !("private" in x) && x.epoch === 0 && /^[A-Za-z0-9_-]{22}$/.test(x.cid)), "outbox items: cid, epoch, never private");
});

// ---------- 5. private ----------
S("5 private in phone mode: nothing stored; gone after a reload; switching back warns", async (t) => {
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  check(has(await page.getAttribute("#private", "title"), "kept only on this screen"), "the Private chip says where it's kept");
  const before = JSON.stringify((await L.dump(page)).idb);
  await page.click("#private");
  await chatTo(p, "buddy", "my secret plan");
  const after = await L.dump(page);
  check(!has(JSON.stringify(after.idb), "my secret plan") && !has(JSON.stringify(after.ss) + JSON.stringify(after.ls), "my secret plan"), "nothing private in storage");
  check(JSON.stringify(after.idb.outbox) === JSON.stringify(JSON.parse(before).outbox), "the outbox didn't change");
  check(await page.evaluate(() => BuddyDirect.privateCount() > 0), "private messages held in memory");
  await t.mac.mode("up");
  await online(page);
  await until(async () => has(await page.textContent("#warn"), "Your Mac is back. Switching ends phone mode; its private messages will be gone."), 10000, "the switch-back warning");
  check(await page.evaluate(() => !!document.querySelector("#warn .link") && document.querySelector("#warn .link").textContent === "Switch"), "with a Switch button");
  check(!(await t.mac.log()).some((e) => e.path === "/api/thread/import"), "nothing synced before Switch");
  await t.mac.mode("refuse");
  await L.reload(page);
  await until(() => L.isPM(page), 5000, "phone mode again");
  check(!has(await page.textContent("#msgs"), "my secret plan"), "private messages are gone after a reload");
});

// ---------- 6. photos ----------
S("6 photos in phone mode: the vision look, inline or the description, back-offs, CANT_SEE", async (t) => {
  const jpg = await exifJpeg(t.browser);
  check(jpegHasApp1(jpg), "(the test photo has an APP1 segment)");
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  await L.pick(page, "mara");
  await sendPhoto(p, jpg, "look at this");
  const v = visionCalls(p.tlog)[0];
  check(v && !("stream" in v.json) || (v && v.json.stream === false), "the look is one request, not streamed");
  const url = v.json.messages[0].content.find((x) => x.type === "image_url").image_url.url;
  check(url.startsWith("data:image/jpeg;base64,"), "a JPEG data URL");
  check(!jpegHasApp1(Buffer.from(url.split(",")[1], "base64")), "with no APP1 (no camera or location data)");
  const c = L.lastChat(p.tlog), lastUser = c.json.messages[c.json.messages.length - 1];
  check(typeof lastUser.content === "string" && has(lastUser.content, "A red square on white.") && has(lastUser.content, "look at this"), "Mara's model can't see: her turn is the LOOKED text: " + JSON.stringify(lastUser.content));
  check(has(c.json.messages[0].content, "FAKE-PHOTO-SAFETY"), "PHOTO_SAFETY in the system message");
  let ob = (await L.outbox(page)).filter((x) => x.role === "user" && x.photo);
  check(ob.length === 1 && ob[0].photo.full.$bytes > 0 && ob[0].photo.view.$bytes > 0, "the outbox item has both copies");
  check(ob[0].photo_desc === "A red square on white." && ob[0].seen_by === "gemma4-31b", "and the description: " + ob[0].photo_desc + " / " + ob[0].seen_by);
  check(await page.evaluate(() => [...document.querySelectorAll("#msgs .b.me.pic img")].some((i) => i.src.startsWith("blob:"))), "the photo shows from this phone");
  await L.pick(page, "buddy");                         // Buddy's model (gemma) sees: the picture goes inline
  await sendPhoto(p, jpg, "and this?");
  const c2 = L.lastChat(p.tlog), u2 = c2.json.messages[c2.json.messages.length - 1];
  check(Array.isArray(u2.content) && u2.content.some((x) => x.type === "image_url"), "a model that sees gets the picture inline");
  const cfg = L.fake();                                // the first vision model refuses: the next one looks
  cfg.chat = [{ when: { model: "gemma4-31b", image: true, stream: false }, status: 400 },
    { when: { model: "kimi-k3", image: true, stream: false }, status: 200, json: { choices: [{ message: { content: "A blue circle." } }] } }, ...cfg.chat.slice(1)];
  await p.setFake(cfg);
  await L.pick(page, "mara");
  const n0 = visionCalls(p.tlog).length;
  await sendPhoto(p, jpg, "third");
  const tried = visionCalls(p.tlog).slice(n0).map((e) => e.json.model);
  check(tried.join(",") === "gemma4-31b,kimi-k3", "a 400 on the first vision model: the next one is tried: " + tried);
  ob = (await L.outbox(page)).filter((x) => x.role === "user" && x.photo).pop();
  check(ob.photo_desc === "A blue circle." && ob.seen_by === "kimi-k3", "described by the second: " + ob.seen_by);
  cfg.chat[1] = { when: { model: "kimi-k3", image: true, stream: false }, status: 422 };
  await p.setFake(cfg);
  await sendPhoto(p, jpg, "fourth", 40000);
  const c4 = L.lastChat(p.tlog);
  check(has(c4.json.messages[0].content, "FAKE-CANT-SEE"), "nobody could look: CANT_SEE is in the system message");
  ob = (await L.outbox(page)).filter((x) => x.role === "user" && x.photo).pop();
  check(ob.seen === false && !ob.photo_desc, "and the message says nobody saw it");
});

// ---------- 7. voice messages ----------
S("7 voice messages in phone mode: Whisper through the SDK, a voice reply, text when TTS fails", async (t) => {
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  await L.pick(page, "mara");
  const hold = async () => {
    const n = L.tinfoilFetches(p.tlog, "/v1/audio/transcriptions").length, m = await mine(page);
    await page.dispatchEvent("#mic", "pointerdown", { pointerType: "touch" });
    await sleep(1600);
    await page.dispatchEvent("#mic", "pointerup", { pointerType: "touch" });
    await until(() => L.tinfoilFetches(p.tlog, "/v1/audio/transcriptions").length > n, 15000, "the voice message transcribed");
    await until(async () => (await mine(page)) > m, 10000, "your voice message on screen");
    await L.replyDone(page, 30000);
  };
  await hold();
  const stt = L.tinfoilFetches(p.tlog, "/v1/audio/transcriptions").pop();
  check(stt && stt.multipart, "a transcription request (multipart)");
  const parts = Object.fromEntries(stt.multipart.map((x) => [x.name, x]));
  const txt = (x) => (x && x.value !== undefined ? x.value : "");   // (a field's text)
  check(parts.model && txt(parts.prompt) === "Mara." && parts.file && parts.file.filename, "model, prompt (Mara.) and the file: " + JSON.stringify(stt.multipart.map((x) => x.name)));
  const c = L.lastChat(p.tlog), u = c.json.messages[c.json.messages.length - 1];
  check(typeof u.content === "string" && u.content.startsWith("(a voice message) "), "their turn starts (a voice message): " + JSON.stringify(u.content));
  check(L.tinfoilFetches(p.tlog, "/v1/audio/speech").some((e) => e.json.response_format === "wav"), "the reply was made as a WAV");
  await until(() => page.evaluate(() => !!document.querySelector("#msgs .b.them.voice .vplay")), 10000, "their voice message");
  await page.click("#msgs .b.them.voice .vplay >> nth=-1");
  await until(() => page.evaluate(() => [...document.querySelectorAll("#msgs .b.them.voice .vplay")].some((b) => b.textContent === "❚❚")
    || [...document.querySelectorAll("#msgs .b.them.voice .vdur")].some((x) => x.textContent === "can't play")), 5000, "playback");
  check(!(await page.evaluate(() => [...document.querySelectorAll("#msgs .vdur")].some((x) => x.textContent === "can't play"))), "it plays (from this phone)");
  const ob = await L.outbox(page);
  check(ob.some((x) => x.role === "user" && x.voice && x.voice.data.$bytes > 0) && ob.some((x) => x.role === "assistant" && x.voice), "both voice messages are in the outbox with their audio");
  const cfg = L.fake(); cfg.speech.wav = { status: 500 };
  await p.setFake(cfg);
  const nVoice = await page.evaluate(() => document.querySelectorAll("#msgs .b.them.voice").length);
  await hold();
  check((await page.evaluate(() => document.querySelectorAll("#msgs .b.them.voice").length)) === nVoice, "TTS failed: no new voice message");
  check((await L.bubbles(page)).filter((b) => has(b.cls, "them")).pop().text.includes("How are you?"), "it arrives as text");
});

// ---------- 8. verification failure, no key ----------
S("8 a failed verification sends nothing; no key contacts nothing", async (t) => {
  const p = await ready(t, L.fake({ ready: "attestation" })), page = p.page;
  await toPhoneMode(t, p);
  await chatTo(p, "buddy", "are you there?");
  check(L.tinfoilFetches(p.tlog).length === 0, "no fetch at all after a failed attestation: " + JSON.stringify(L.tinfoilFetches(p.tlog).map((e) => e.path)));
  check((await notes(page)).some((n) => has(n, "Couldn't verify Tinfoil's enclave, so nothing was sent.")), "the §12 text shows");
  check((await L.outbox(page)).some((x) => x.role === "user" && x.content === "are you there?"), "your message is kept for your Mac");
  await until(async () => has(await page.textContent("#warn"), "Couldn't verify Tinfoil's enclave"), 3000, "the warn row");
  await t.mac.mode("up");
  const q = await ready(t);                             // a phone without its key
  await L.openSettings(q.page); await q.page.click("#pm-del");
  await until(() => q.page.evaluate(() => !BuddyDirect.have().key), 5000, "the key forgotten");
  await until(() => q.page.isHidden("#pm-del"), 3000, "Forget key hidden once there's no key");
  await L.closeSheets(q.page);
  await toPhoneMode(t, q);
  await chatTo(q, "buddy", "hello?");
  check(q.tlog.length === 0, "no key: no ctor, ready or fetch: " + JSON.stringify(q.tlog.map((e) => e.kind)));
  check((await notes(q.page)).some((n) => has(n, "Phone mode needs this phone's own Tinfoil key: Settings → Phone mode.")), "the §12 no-key text");
  check(has(await q.page.textContent("#warn"), "Phone mode needs this phone's own Tinfoil key"), "and the warn row says so");
});

// ---------- 9. calls ----------
S("9 calls in phone mode: PCM speech, hearing, the call style, barge-in aborts, 422 -> WAV, missed lines", async (t) => {
  const cfg = L.fake();
  cfg.chat[2] = { when: { stream: true }, status: 200, sse: ["Sure, ", "I can hear you. ", "Tell me more about it. ", "What happened next? ", "And then?"], chunkMs: 700, done: true, finish: "stop" };
  const p = await ready(t, cfg), page = p.page;
  await toPhoneMode(t, p);
  await L.pick(page, "buddy");
  await page.click("#call");
  await until(() => L.tinfoilFetches(p.tlog, "/v1/audio/speech").some((e) => e.json.response_format === "pcm"), 15000, "the greeting as PCM");
  const greet = L.tinfoilFetches(p.tlog, "/v1/audio/speech")[0].json.input;
  check(["Hey!", "Hi, you."].includes(greet), "the greeting is a kit line: " + greet);
  await until(() => L.tinfoilFetches(p.tlog, "/v1/audio/transcriptions").length, 30000, "what the fake mic said, transcribed");
  await until(() => L.lastChat(p.tlog), 20000, "the call's reply request");
  const c = L.lastChat(p.tlog);
  check(c.json.max_tokens === 300 || c.json.reasoning_effort || c.json.chat_template_kwargs, "the call reply is capped or without thinking: " + JSON.stringify({ m: c.json.max_tokens }));
  check(has(c.json.messages[0].content, "FAKE-CALLING-STYLE"), "the call style");
  await sleep(1000);
  await page.evaluate(() => interrupt());               // you talk over them
  await until(() => p.tlog.some((e) => e.kind === "abort" && e.path === "/v1/chat/completions"), 5000, "the open chat request aborted");
  const lines = ["Hm? Say that again?", "Sorry, it's loud there.", "You cut out for a sec.", "Sorry, I lost my train of thought.", "I keep losing you.", "It's so noisy there."];
  await until(() => L.tinfoilFetches(p.tlog, "/v1/audio/speech").some((e) => lines.includes(e.json.input)), 30000, "missed lines fetched after the greeting");
  const sp = L.tinfoilFetches(p.tlog, "/v1/audio/speech"), gi = sp.findIndex((e) => e.json.input === greet), mi = sp.findIndex((e) => lines.includes(e.json.input));
  check(gi >= 0 && mi > gi, "the missed lines come after the greeting");
  const c2 = L.fake(); c2.chat = cfg.chat; c2.speech.pcm = { status: 422 };
  await p.setFake(c2);
  const n = L.tinfoilFetches(p.tlog, "/v1/audio/speech").length;
  await page.evaluate(() => fetchClip("A brand new line.", "casual_female"));
  const after = L.tinfoilFetches(p.tlog, "/v1/audio/speech").slice(n).map((e) => e.json.response_format);
  check(after.join(",") === "pcm,wav", "a 422 for PCM: a WAV request follows: " + after);
  await page.click("#cv-end");
});

// ---------- 10. back to the Mac ----------
S("10 back to the Mac: idle and quiet, inert footer, sync once (retry, no duplicates), reload into Mac mode", async (t) => {
  const cfg = L.fake();
  cfg.chat[0] = Object.assign({}, cfg.chat[0], { delayMs: 7000 });   // a look that's still going
  const p = await ready(t, cfg), page = p.page;
  await toPhoneMode(t, p);
  await chatTo(p, "buddy", "one");
  await chatTo(p, "mara", "two");
  await L.pick(page, "buddy");
  const jpg = await exifJpeg(t.browser);
  await sendPhoto(p, jpg, "pic", 20000);
  check(await page.evaluate(() => BuddyDirect.busy()), "the photo's look is still running");
  await t.mac.ctl("/epoch", { char: "mara" });          // Mara's conversation deleted on the Mac meanwhile
  await page.evaluate(() => {                           // (when the first import starts: is the footer inert?)
    const f = window.fetch; window.__inert = null;
    window.fetch = function (u, i) { if (String(u).includes("/api/thread/import") && window.__inert === null) window.__inert = document.querySelector("footer").inert; return f.apply(this, arguments); };
  });
  await L.type(page, "still typing"); await page.focus("#text");
  await t.mac.ctl("/drop-import-response", {});
  await t.mac.mode("up");
  await online(page);
  await sleep(4500);
  const imports = async () => (await t.mac.log()).filter((e) => e.path === "/api/thread/import");
  check((await imports()).length === 0, "no import while you're typing and the look runs");
  await L.type(page, "");
  check((await imports()).length === 0, "nor while the look still runs");
  await until(async () => (await imports()).length > 0, 20000, "the first import, once idle and quiet");
  const inert = await page.evaluate(() => window.__inert);
  check(inert === true, "the footer was inert when the sync started: " + inert);
  await until(async () => has(await page.textContent("#warn"), "Your Mac is back but syncing failed"), 20000, "the failed sync said");
  check(await L.isPM(page), "still phone mode after a failed sync");
  check(await page.evaluate(() => !document.querySelector("footer").inert), "and the footer usable again");
  const shown = (await L.bubbles(page)).map((b) => b.id).filter(Boolean);
  check(new Set(shown).size === shown.length || shown.length === new Set(shown).size, "every message shows once");
  const texts = (await L.bubbles(page)).filter((b) => has(b.cls, "me")).map((b) => b.text);
  check(texts.filter((x) => x === "one").length === 1, "no Mac-id copies: " + JSON.stringify(texts));
  await online(page);
  await until(async () => !(await L.isPM(page)) && (await page.evaluate(() => typeof state === "object" && state.loaded)), 30000, "the reload into Mac mode");
  const th = await t.mac.thread(), cids = th.filter((m) => m.cid).map((m) => m.cid);
  check(new Set(cids).size === cids.length, "no duplicates on the Mac after the retry");
  const reqs = (await imports()).map((e) => JSON.parse(Buffer.from(e.body, "base64").toString()).messages);
  for (const items of reqs) {
    check(items.filter((x) => x.photo || x.voice).length <= 1, "one media item per request");
    check(items.every((x) => /^[A-Za-z0-9_-]{16,64}$/.test(x.cid) && !("private" in x)), "cids, never private");
    check(items.every((x, i) => i === 0 || x.ts >= items[i - 1].ts), "in order");
  }
  const ph = th.find((m) => m.direct && m.image);
  check(ph && ph.photo_desc === "A red square on white.", "the photo arrived after its look, with photo_desc");
  check(th.some((m) => m.direct && m.content === "one" && m.from === "phone"), "your messages are on the Mac (from: phone, direct)");
  check(!th.some((m) => m.content === "two"), "Mara's were dropped (deleted on the Mac)");
  check((await L.outbox(page)).length === 0, "the outbox is empty");
  check(await page.evaluate(() => !Object.keys(unreadCounts()).length), "synced replies aren't unread");
  await until(async () => has(await page.textContent("#hstate"), "couldn't be added (their conversation was deleted on your Mac)"), 8000, "the note about the dropped ones");
});

// ---------- 11. unpaired ----------
S("11 unpaired: everything of phone mode is deleted and the pairing screen shows", async (t) => {
  const p = await ready(t), page = p.page;
  await page.evaluate(() => { window.__mark = 1; });
  await t.mac.mode("unpaired");
  await until(() => page.evaluate(() => !document.getElementById("pairv").hidden), 15000, "the pairing screen");
  await until(async () => !(await L.idbHas(page)), 5000, "the database deleted");
  check(await page.evaluate(() => window.__mark === 1), "without a reload");
  check(await page.evaluate(() => localStorage.getItem("buddy.wipe") === null), "the wipe marker is gone");
  await t.mac.mode("reset");
  const q = await ready(t), qp = q.page;
  await t.mac.mode("locked /api/photo");
  await qp.setInputFiles("#pfile", { name: "photo.jpg", mimeType: "image/jpeg", buffer: await exifJpeg(t.browser) });
  await until(() => qp.evaluate(() => !document.getElementById("pairv").hidden), 15000, "the pairing screen after a 401 on the photo upload");
  await until(async () => !(await L.idbHas(qp)), 5000, "the database deleted (upPart)");
  await t.mac.mode("reset");
  const r = await ready(t), rp = r.page;
  await toPhoneMode(t, r);
  await t.mac.mode("up"); await t.mac.mode("unpaired");
  await online(rp);
  await until(() => rp.evaluate(() => typeof state === "object" && !document.getElementById("pairv").hidden).catch(() => false), 20000, "phone mode -> unpaired -> pairing screen");
  check(!(await L.idbHas(rp)), "the database is gone");
});

// ---------- 12. the shell snapshot ----------
S("12 the shell snapshot: all or nothing; a failed one never breaks the worker", async (t) => {
  const p = await t.phone(); await L.pair(p);
  const page = p.page, first = await L.shellCached(page);
  await t.mac.ctl("/touch", { path: "direct.js" });
  await page.evaluate(() => checkUpdate());
  await until(async () => (await L.booted(page)) && (await page.evaluate(async (n) => !(await caches.has(n)), first)), 20000, "the old copy replaced");
  const second = await L.shellCached(page);
  check(second !== first, "a new buddy-shell-<version>");
  let d = await L.dump(page);
  check(Object.keys(d.caches).length === 1, "the old cache is gone");
  check(d.caches[second].some((x) => x.url.endsWith("/direct.js") && has(x.body, "// touched")), "the new copy has the new direct.js");
  check(d.caches[second].some((x) => x.url.endsWith("/phone") && has(x.body, "<script src=\"/direct.js\"></script>")), "and chat.html");
  await t.mac.mode("fail-file /direct.js");
  await t.mac.ctl("/touch", { path: "chat.html" });
  await page.evaluate(() => checkUpdate()).catch(() => {});
  await sleep(1500); await L.booted(page);
  await page.evaluate(async () => { const v = (await (await fetch("/api/version")).json()).version; navigator.serviceWorker.controller.postMessage({ type: "refresh", version: v }); });
  await sleep(2500);
  d = await L.dump(page);
  check(Object.keys(d.caches).length === 1 && d.caches[second] && d.caches[second].length === L.SHELL.length, "with /direct.js failing the old copy stays intact: " + Object.keys(d.caches));
  const q = await t.phone();                            // a fresh phone while /direct.js fails
  await q.page.goto(t.mac.url + "/phone");
  const ok = await q.page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
    if (!reg) return { ready: false };
    let sub = "";
    try { await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(65).fill(4) }); sub = "made"; }
    catch (e) { sub = e.name + ": " + e.message; }
    return { ready: !!reg.active, sub };
  });
  check(ok.ready, "the worker installs and activates although its copy failed");
  check(!/no active service worker/i.test(ok.sub), "a push subscription can be asked for: " + ok.sub);
});

// ---------- 13. proxy 502, the Mac turning phone mode off ----------
S("13 a 502 from the tailnet front door counts as down; the Mac's phone_mode off deletes the kit", async (t) => {
  const p = await ready(t), page = p.page;
  await t.mac.mode("proxy502");
  await until(() => L.isPM(page), 40000, "phone mode after 502s");
  await chatTo(p, "buddy", "hi from phone mode");
  const n = (await L.outbox(page)).length;
  check(n >= 1, "something to sync");
  await t.mac.mode("up"); await t.mac.mode("kit-off");
  const r = await page.evaluate(() => BuddyDirect.refreshKit());
  check(r && r.off === true, "refreshKit says it's off: " + JSON.stringify(r));
  const d = await L.dump(page);
  check(!d.idb.meta.some((x) => x.k === "kit") && !d.idb.chats.length && !d.idb.thumbs.length, "kit, chats and thumbnails deleted");
  check(d.idb.keys.some((x) => x.k === "tinfoil") && d.idb.outbox.length === n, "the key and the outbox kept");
  await L.openSettings(page);
  check(has(await page.textContent("#pmstate"), "Phone mode was turned off on your Mac"), "Settings says so");
});

// ---------- 14. forgetting a character ----------
S("14 forget a character in Mac mode: its facts, life, chats, outbox and thumbnail go from the phone at once", async (t) => {
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  await chatTo(p, "mara", "hello Mara");
  await t.mac.mode("fail-file /api/thread/import 413");   // (so Mara's messages are still in the outbox)
  await t.mac.mode("up");
  await online(page);                                   // back to the Mac: the sync is refused (413), the page reloads
  await until(async () => !(await L.isPM(page)) && (await page.evaluate(() => typeof state === "object" && state.loaded).catch(() => false)), 20000, "Mac mode");
  await until(async () => has(await page.textContent("#warn"), "2 messages from phone mode are waiting to reach your Mac"), 5000, "the waiting messages said");
  check((await L.outbox(page)).some((x) => x.char === "mara"), "Mara has unsynced messages");
  check(((await L.dump(page)).idb.thumbs || []).some((x) => x.id === "mara"), "and a thumbnail");
  await L.pick(page, "mara");
  await page.evaluate(() => openEditor(charById("mara")));
  await page.waitForSelector("#editor.open");
  await page.click("#eforget"); await page.click("#eyesdel");
  await until(async () => !(await L.outbox(page)).some((x) => x.char === "mara"), 10000, "Mara's outbox items gone");
  const d = await L.dump(page), kit = d.idb.meta.find((x) => x.k === "kit").kit;
  const mara = kit.chars.find((c) => c.id === "mara"), buddy = kit.chars.find((c) => c.id === "buddy");
  check(mara.facts.own.length === 0 && mara.life === null, "Mara's facts and life are gone from the stored kit");
  check(!buddy.life || !buddy.life.friends.some((f) => f.id === "mara"), "Buddy's friends no longer include Mara");
  check(!(d.idb.chats.find((c) => c.char === "mara") || { msgs: [] }).msgs.length, "no Mara messages kept");
  await page.evaluate(() => openEditor(charById("mara")));   // and deleting her: nothing of her stays
  await page.waitForSelector("#editor.open");
  await page.click("#edel"); await page.click("#eyesdel");
  await until(async () => { const k = await L.meta(page, "kit"); return k && !k.kit.chars.some((c) => c.id === "mara"); }, 10000, "Mara gone from the stored kit");
  const d2 = await L.dump(page);
  check(!d2.idb.chats.some((c) => c.char === "mara") && !(d2.idb.thumbs || []).some((x) => x.id === "mara"), "no Mara chats or thumbnail");
  await t.mac.mode("reset");
  await toPhoneMode(t, p);
  await chatTo(p, "buddy", "how are you");
  check(!has(L.lastChat(p.tlog).json.messages[0].content, "Mara"), "a phone-mode reply to Buddy has nothing of Mara");
});

// ---------- 15. expiry ----------
S("15 expiry: 30 days without the Mac deletes the kit and the key, keeps the outbox; 25 days warns", async (t) => {
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  await chatTo(p, "buddy", "before it expires");
  const n = (await L.outbox(page)).length;
  const s = await L.meta(page, "settings");
  await L.setMeta(page, Object.assign({}, s, { macSeenAt: Date.now() - 31 * 864e5 }));
  await L.reload(page);
  check(!(await L.isPM(page)), "no phone mode after 30 days without the Mac");
  await L.openSettings(page);
  await until(async () => has(await page.textContent("#pmstate"), "Phone mode needs your Mac again (not reached for 30 days)"), 5000, "the expiry text");
  let d = await L.dump(page);
  check(!d.idb.meta.some((x) => x.k === "kit" || x.k === "context") && !d.idb.chats.length && !(d.idb.thumbs || []).length, "kit, chats and thumbnails deleted");
  check(!d.idb.keys.some((x) => x.k === "tinfoil"), "this phone's key deleted");
  check(d.idb.outbox.length === n && d.idb.meta.some((x) => x.k === "settings"), "the outbox and the settings kept");
  await t.mac.mode("up");
  await L.reload(page);
  await until(async () => (await L.outbox(page)).length === 0, 15000, "the outbox synced");
  check(!!(await L.meta(page, "kit")), "the kit is back");
  await L.openSettings(page);
  check(has(await page.textContent("#pmstate"), "On · needs this phone's Tinfoil key"), "the key is still needed");
  await page.fill("#pm-key", KEY); await page.click("#pm-save");
  await until(() => page.evaluate(() => BuddyDirect.have().key), 5000, "the key saved again");
  await L.closeSheets(page);
  const s2 = await L.meta(page, "settings");
  await L.setMeta(page, Object.assign({}, s2, { macSeenAt: Date.now() - 25 * 864e5 }));
  await t.mac.mode("refuse");
  await L.reload(page);
  check(await L.isPM(page), "25 days: still phone mode");
  await L.openSettings(page);
  check(has(await page.textContent("#pmstate"), "Open Buddy while your Mac is reachable within 5 days, or phone mode forgets its copy and this phone's key"), "the warning line: " + await page.textContent("#pmstate"));
});

// ---------- 16. expiry without a kit ----------
S("16 expiry without a kit: phone mode off on the Mac keeps the key only while the Mac answers", async (t) => {
  const p = await ready(t), page = p.page;
  await t.mac.mode("kit-off");
  check((await page.evaluate(() => BuddyDirect.refreshKit())).off === true, "the Mac turned phone mode off");
  const old = async () => L.setMeta(page, Object.assign({}, await L.meta(page, "settings"), { macSeenAt: Date.now() - 40 * 864e5 }));
  const hasKey = async () => ((await L.dump(page)).idb.keys || []).some((x) => x.k === "tinfoil");
  await old();
  await L.reload(page);                                 // your Mac answers (phone mode still off there): kept, and the
  await until(async () => Date.now() - (await L.meta(page, "settings")).macSeenAt < 60000, 15000, "the Mac's answer counted");
  check(await hasKey(), "this phone's key is kept while the Mac answers");
  await old();
  await t.mac.mode("refuse");
  await L.reload(page);                                 // 40 days, no kit, the Mac away: the key goes
  await until(async () => !(await hasKey()), 10000, "the key deleted");
  check((await L.meta(page, "settings")).expired === true && !(await L.isPM(page)), "expired, not phone mode");
});

// ---------- 17. a message sent while the page switches to phone mode ----------
S("17 a message sent while the page switches to phone mode is never lost", async (t) => {
  const p = await ready(t), page = p.page;
  await page.evaluate(() => {                           // your Mac stops answering what tells it's there (8 s, then an
    const f = window.fetch; window.__down = true; window.__mark = 1;   // error), but would still take a message
    window.fetch = function (u, i) {
      const path = String(u);
      if (window.__down && (path.startsWith("/api/thread") || path.startsWith("/api/me")))
        return new Promise((_, no) => { const s = i && i.signal; const t = setTimeout(() => no(new TypeError("Failed to fetch")), 8000);
          if (s) s.addEventListener("abort", () => { clearTimeout(t); no(new DOMException("aborted", "AbortError")); }); });
      return f.apply(this, arguments);
    };
  });
  await until(() => page.evaluate(() => directing === true), 40000, "the page to start switching");
  await L.send(page, "please don't lose me");          // (sent while it probes: its catch-up poll hangs for 8 s)
  await until(async () => (await t.mac.thread()).some((m) => m.content === "please don't lose me"), 40000, "the message on the Mac");
  await until(() => page.evaluate(() => typeof state === "object" && state.loaded && window.__mark === undefined).catch(() => false), 40000, "the switch");
  check((await t.mac.thread()).filter((m) => m.content === "please don't lose me").length === 1, "on the Mac once");
});

// ---------- 18. private messages written while the switch back waits ----------
S("18 switching back asks again about private messages written while it waited", async (t) => {
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  await page.evaluate(() => { window.__mark = 1; });
  await page.click("#private");
  await L.type(page, "a private thought");             // (typed, not sent: the switch back waits)
  await t.mac.mode("up");
  await online(page);
  await until(() => page.evaluate(() => leaving === true), 15000, "the switch back waiting");
  check(!has(await page.textContent("#warn"), "Your Mac is back."), "no private messages yet: not asked");
  await page.click("#send");
  await L.replyDone(page);
  await until(async () => has(await page.textContent("#warn"), "Your Mac is back. Switching ends phone mode; its private messages will be gone."), 10000, "asked before they go");
  await sleep(1500);
  check(await page.evaluate(() => window.__mark === 1), "no reload until you say so");
  check(has(await page.textContent("#msgs"), "a private thought"), "your private message is still there");
  await page.click("#warn .link");
  await until(async () => !(await L.isPM(page)) && (await page.evaluate(() => typeof state === "object" && state.loaded).catch(() => false)), 20000, "Mac mode after Switch");
});

// ---------- 19. a page from the worker's copy ----------
S("19 a page the worker served from its old copy updates itself; its files never mix versions", async (t) => {
  const p = await t.phone(); await L.pair(p);
  const page = p.page; await L.shellCached(page);
  const navs = [], files = [];
  page.on("response", async (r) => {
    const path = new URL(r.url()).pathname;
    if (r.request().isNavigationRequest() && path === "/phone") navs.push({ sw: r.fromServiceWorker(), body: await r.text().catch(() => "") });
    if (path === "/direct.js") files.push({ sw: r.fromServiceWorker(), body: await r.text().catch(() => "") });
  });
  await t.mac.ctl("/touch", { path: "chat.html" });
  await t.mac.mode("slow 3500 /phone");
  await page.reload({ waitUntil: "domcontentloaded" });
  check(navs.length === 1 && navs[0].sw && !has(navs[0].body, "// touched"), "the old page, from the worker's copy (your Mac was slow)");
  await until(() => navs.some((n) => has(n.body, "// touched")), 60000, "the page updating itself");
  await L.booted(page);
  const n = navs.length; await sleep(3000);
  check(navs.length === n, "and no more reloads: " + navs.length);
  check(await page.evaluate(async () => state.version === (await (await fetch("/api/version")).json()).version), "it knows its version");
  await t.mac.mode("reset");
  await L.shellCached(page);
  await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: "up" }));   // (your Mac answers again)
  files.length = 0;
  await t.mac.ctl("/touch", { path: "chat.html" }); await t.mac.ctl("/touch", { path: "direct.js" });
  await t.mac.mode("slow 3000 /direct.js");             // a page your Mac sent: its direct.js from your Mac too
  const r = await page.reload({ waitUntil: "domcontentloaded" });
  check((await r.text()).split("// touched").length === 3, "the new page (from your Mac)");
  await until(() => files.length > 0, 10000, "direct.js");
  check(files.every((f) => has(f.body, "// touched")), "with the new direct.js, not the copy's old one");
});

// ---------- 20. two open pages ----------
S("20 another open page turning phone mode off: this page forgets it too and never brings it back", async (t) => {
  const p = await ready(t), a = p.page;
  const b = await p.ctx.newPage();
  await b.goto(t.mac.url + "/phone"); await L.booted(b);
  check(await b.evaluate(() => BuddyDirect.enabled()), "(the second page has phone mode on too)");
  await L.openSettings(b); await b.click("#pmode");      // (nothing waiting for the Mac: off at once)
  await until(async () => !(await L.idbHas(b)), 10000, "the database deleted");
  check(await a.evaluate(() => !BuddyDirect.enabled() && !BuddyDirect.have().key && !keepUp()), "the first page forgot it too");
  await a.evaluate(async () => { await BuddyDirect.pending(); await BuddyDirect.refreshKit(); await BuddyDirect.sync(); });
  await sleep(500);
  check(!(await L.idbHas(a)), "and never made it again (its timers' work included)");
  await b.close();
  await L.reload(a);
  check(await a.evaluate(() => !BuddyDirect.enabled()), "a new page: phone mode is off");
});

// ---------- 21. a page your Mac sent that starts phone mode itself ----------
S("21 a page your Mac sent, then gone: phone mode loads the SDK from the copy and answers (no hung import)", async (t) => {
  const p = await ready(t), page = p.page;
  await t.mac.mode("slow 6000 /api/me");                // the page itself comes from your Mac in time…
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  check(Date.now() - t0 < 2400, "(the page came from your Mac, not the copy)");
  await t.mac.mode("hang");                             // …and then it stops answering anything
  await until(() => L.isPM(page), 30000, "phone mode");
  const n = await mine(page);
  await L.send(page, "are you there?");
  await until(async () => (await mine(page)) > n, 10000, "your message on screen");
  await L.replyDone(page, 20000);
  check(await page.evaluate(() => BuddyDirect.status().verified === true), "verified with the copy's SDK");
  check(L.lastChat(p.tlog), "and the reply came from Tinfoil");
  await t.mac.mode("up");
});

// ---------- 22. no phone mode, opened while your Mac is away ----------
S("22 without phone mode, opened while your Mac is away: your character stays; back: it returns, and a newer version too", async (t) => {
  const p = await t.phone(); await L.pair(p);
  const page = p.page; await L.shellCached(page);
  const saved = () => page.evaluate(() => localStorage.getItem("buddy.char"));
  await L.pick(page, "mara");
  check((await saved()) === '"mara"', "(Mara chosen)");
  await t.mac.mode("refuse");
  await L.reload(page);                                 // the worker's copy; the page has only a stand-in Buddy
  check(await page.evaluate(() => state.offline === true && !BuddyDirect.enabled() && state.cur === "buddy"), "(offline, no phone mode, Buddy shown)");
  await sleep(5000);
  check((await saved()) === '"mara"', "the stand-in Buddy isn't saved as your choice: " + (await saved()));
  await t.mac.mode("up");
  const t0 = Date.now();
  await until(() => page.evaluate(() => state.cur === "mara" && !state.offline), 15000, "Mara again once your Mac answers");
  check(Date.now() - t0 < 12000, "back within a poll or two, not the 60 s list refresh (" + (Date.now() - t0) + " ms)");
  check((await saved()) === '"mara"', "still Mara in storage");
  const navs = [];                                       // and a newer version on your Mac than the copy this page came from
  page.on("response", async (r) => {
    if (r.request().isNavigationRequest() && new URL(r.url()).pathname === "/phone") navs.push({ sw: r.fromServiceWorker(), body: await r.text().catch(() => "") });
  });
  await t.mac.mode("refuse");
  await L.reload(page);
  check(navs.length === 1 && !has(navs[0].body, "// touched"), "(the copy's page)");
  await t.mac.ctl("/touch", { path: "chat.html" });
  await t.mac.mode("up");
  await until(() => navs.some((n) => has(n.body, "// touched")), 40000, "the page updating itself once your Mac is back");
  await L.booted(page);
  await until(() => page.evaluate(() => state.cur === "mara"), 10000, "on Mara after the update");
});

// ---------- 23. credits out, and the free brain (the same as on the Mac) ----------
S("23 credits out in phone mode: said plainly with a banner until a reply works; the free brain without a Tinfoil key keeps phone mode off, saying why", async (t) => {
  const p = await ready(t), page = p.page;
  await toPhoneMode(t, p);
  const out = L.fake(); out.chat[2] = { when: { stream: true }, status: 402, errorText: "payment required" };
  await p.setFake(out);
  await chatTo(p, "buddy", "are you there?");
  const shown = await page.evaluate(() => [...document.querySelectorAll("#msgs .note")].map((n) => n.textContent).join(" | "));
  check(has(shown, "FAKE-CREDITS-OUT: top up.") && !has(shown, "Try again?") && !has(shown, "402"), "said in the Mac's words: " + shown);
  await until(async () => has(await page.textContent("#warn"), "FAKE-CREDITS-OUT: top up") && !(await page.isHidden("#warn")), 5000, "the banner");
  await p.setFake(L.fake());
  await chatTo(p, "buddy", "and now?");
  await until(async () => (await page.isHidden("#warn")) || !has(await page.textContent("#warn"), "FAKE-CREDITS-OUT"), 5000, "the banner gone once a reply works");
  const c = L.lastChat(p.tlog);
  check(c && c.json.model === "gemma4-31b" && !("max_tokens" in c.json), "a typed turn: no cap");
  await t.mac.mode("up"); await t.mac.mode("kit-free");
  const r = await page.evaluate(() => BuddyDirect.refreshKit());
  check(r && r.off === true && has(r.error, "never the free brain"), "phone mode is off, and why: " + JSON.stringify(r));
  const d = await L.dump(page);
  check(!d.idb.meta.some((x) => x.k === "kit") && d.idb.keys.some((x) => x.k === "tinfoil"), "its copy deleted, the key kept");
  await L.openSettings(page);
  check(has(await page.textContent("#pmstate"), "never the free brain"), "Settings says why");
  await t.mac.mode("refuse"); await L.reload(page);      // (your Mac away: phone mode doesn't take over, and the banner says why)
  await until(async () => has(await page.textContent("#warn"), "never the free brain") && !(await page.isHidden("#warn")), 20000,
    "the banner says why while your Mac is away");
  check(!(await L.isPM(page)), "still not phone mode");
});

// ---------- 24. a page from the worker's old copy while you type ----------
S("24 a page from the worker's old copy while you're typing: never reloaded under you, and still updated once you stop (your draft goes along)", async (t) => {
  const p = await t.phone(); await L.pair(p);
  const page = p.page; await L.shellCached(page);
  const navs = [];
  page.on("response", async (r) => {
    if (r.request().isNavigationRequest() && new URL(r.url()).pathname === "/phone") navs.push({ sw: r.fromServiceWorker(), body: await r.text().catch(() => "") });
  });
  await t.mac.ctl("/touch", { path: "chat.html" });
  await t.mac.mode("slow 4000 /phone");                 // your Mac updated, and is slow to send the page (a cold tunnel)
  await page.reload({ waitUntil: "domcontentloaded" });
  check(navs.length === 1 && navs[0].sw && !has(navs[0].body, "// touched"), "(the old page, from the worker's copy)");
  await L.booted(page);
  await page.focus("#text"); await L.type(page, "half a thought");   // you start typing at once
  const now = () => page.evaluate(async () => (await (await fetch("/api/version")).json()).version);
  await until(async () => ((await page.evaluate(() => swAsk())) || {}).version === (await now()), 60000, "the worker's copy of the new version");
  await sleep(5000);
  check(navs.length === 1, "no reload while you're typing: " + navs.length);
  check((await page.inputValue("#text")) === "half a thought", "your words still in the box");
  await page.evaluate(() => document.activeElement.blur());   // you put the phone down
  await until(() => navs.some((n) => has(n.body, "// touched")), 40000, "the page updating itself once you stopped");
  await L.booted(page);
  check((await page.inputValue("#text")) === "half a thought", "your draft came along: " + (await page.inputValue("#text")));
  check(await page.evaluate(async () => state.version === (await (await fetch("/api/version")).json()).version), "it knows its version");
  const n = navs.length; await sleep(3000);
  check(navs.length === n, "and no more reloads: " + navs.length);
  await t.mac.mode("reset");
});

// ---------- the runner ----------
const only = process.argv.slice(2);
const browser = await L.launch();
const results = [];
for (const sc of scenarios) {
  if (only.length && !only.some((o) => sc.name.split(" ")[0] === o)) continue;
  const mac = await L.startMac(), phones = [], t0 = Date.now();
  const t = { mac, browser, extra: [], async phone(cfg) { const p = await L.phone(browser, mac, cfg); phones.push(p); return p; } };
  let err = null;
  try { await Promise.race([sc.fn(t), sleep(240000).then(() => { throw new Error("scenario timed out (4 min)"); })]); }
  catch (e) { err = e; }
  for (const p of phones) {
    tinfoilLogs.push(...p.tlog);
    const shown = err ? p.errors : p.errors.filter((x) => x.startsWith("uncaught: "));   // (an uncaught error is worth seeing)
    if (shown.length) console.log("   page errors:", shown.slice(0, 5).join("\n   "));
  }
  macLogs.push(...(await mac.log().catch(() => [])));
  for (const p of phones) await p.close().catch(() => {});
  for (const c of t.extra) await c.close().catch(() => {});
  await mac.stop();
  results.push({ name: sc.name, ok: !err, ms: Date.now() - t0, err });
  console.log(`${err ? "FAIL" : "ok  "} ${sc.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)` + (err ? "\n     " + String(err.message || err) : ""));
}
if (!only.length || only.includes("1a")) {             // 1a: over everything sent in every scenario
  let err = null;
  try {
    for (const e of macLogs) for (const f of L.keyForms())
      check(!has(e.path, f) && !has(JSON.stringify(e.headers), f) && !has(Buffer.from(e.body, "base64").toString("latin1"), f), `the key reached the Mac: ${e.method} ${e.path}`);
    for (const e of tinfoilLogs) {
      const { headers, ...rest } = e;
      for (const f of L.keyForms()) check(!has(JSON.stringify(rest), f), "the key is in a Tinfoil " + e.kind + " entry outside its header");
      if (e.kind === "fetch") check(!headers || !headers.authorization || headers.authorization === "Bearer " + KEY, "only as Authorization: Bearer <key>");
      if (headers) for (const [h, v] of Object.entries(headers)) if (h !== "authorization") for (const f of L.keyForms()) check(!has(v, f), "the key in header " + h);
    }
    check(macLogs.length > 100 && tinfoilLogs.some((e) => e.kind === "fetch"), `enough was logged to mean something (${macLogs.length} Mac requests, ${tinfoilLogs.length} Tinfoil entries)`);
  } catch (e) { err = e; }
  results.push({ name: "1a the key never reaches the Mac", ok: !err, err });
  console.log(`${err ? "FAIL" : "ok  "} 1a the key never reaches the Mac (${macLogs.length} Mac requests, ${tinfoilLogs.length} Tinfoil log entries)` + (err ? "\n     " + err.message : ""));
}
await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
