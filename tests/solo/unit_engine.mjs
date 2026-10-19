// Buddy for phones' engine (web/solo/engine.js, window.BuddySolo) in Node: the kit in phonekit()['kit']'s shape (against
// the Mac's recorded golden kit, public edition), the routes and their 404s, characters (the Advisor writes them through
// direct.js's Tinfoil path; looks that aren't an adult refused; delete, forget and epochs), [partner: …] as a setting,
// and "Back up to a file": the recovery key shown once, a file only that key opens, the restore into a fresh phone (and
// again: nothing doubled), wrong, damaged, cut off and reordered files refused. Fake data and keys only.
//   node tests/solo/unit_engine.mjs
import { readFileSync } from "node:fs";
import { FakeIDB, FakeStorage } from "../phonemode/fake_idb.mjs";
import { device, staticKit, fakeTinfoil, tlog, post, get, ndjson, jpeg, dumpText, runner, ROOT, FAKE } from "./harness.mjs";

const { test, must, eq, run } = runner();
const KIT = staticKit();
const KEY = "sk-FAKE-solo-0123456789abcdef";
const fresh = () => ({ idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session") });
async function phone(env = fresh(), key = KEY) {
  const d = device(KIT, env);
  eq((await d.S.init()).ok, true, "started");
  if (key) eq(await d.S.setKey(key), { ok: true }, "key saved");
  return d;
}
const CHARS = (extra = []) => JSON.stringify([
  { name: "Maya", tagline: "Coach", persona: "You are Maya.", appearance: "an adult woman, 31", voice: "Serena", folders: [] },
  { name: "Tess", persona: "You are Tess.", appearance: "a 16-year-old girl" },
  { name: "Leo", persona: "You are Leo.", appearance: "an adult man", folders: ["*"], color: "#123456" }, ...extra]);
const fakeWith = (content) => fakeTinfoil({ chat: [
  { when: { stream: false, image: true }, status: 200, json: { choices: [{ message: { content: "A red square on white." } }] } },
  { when: { stream: false }, status: 200, json: { choices: [{ message: { content }, finish_reason: "stop" }] } },
  { when: { stream: true }, status: 200, sse: ["Hi there! ", "How are you?"], chunkMs: 1, done: true }] });
async function photo(S) {
  const full = await (await S.fetch("/api/photo?part=full", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(800, 600)]) })).json();
  await S.fetch(`/api/photo?part=view&photo=${encodeURIComponent(full.photo)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Blob([jpeg(400, 300)]) });
  return full.photo;
}
const shape = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])])) : Array.isArray(o) ? "list" : typeof o);

test("the kit has phonekit()['kit']'s shape (the Mac's golden kit, public edition), always the public edition", async () => {
  const d = await phone();
  const k = d.S.kit(), golden = JSON.parse(readFileSync(ROOT + "tests/kitparts_golden.json", "utf8")).cases["public-partner-yes"].kit;
  const missing = (a, b, path = "") => Object.keys(b).filter((x) => !(x in a)).map((x) => path + x)
    .concat(...Object.keys(b).filter((x) => x in a && b[x] && typeof b[x] === "object" && !Array.isArray(b[x]) && x !== "tinfoil" && x !== "romance")
      .map((x) => missing(a[x] || {}, b[x], path + x + ".")));
  eq(missing(k, golden), [], "every key phonekit() has");
  eq(Object.keys(k.chars[0]), Object.keys(golden.chars[0]), "a character's keys, in phonekit()'s order");
  eq(shape(k.chars[0].facts), shape(golden.chars[0].facts), "facts' shape");
  eq(Object.keys(k.edition.partner), ["has", "at", "noask"], "edition.partner");
  eq([k.edition.public, k.v >= 3, k.chars[0].life, k.chars[0].persona], [true, true, { log: { about: [], people: [], ongoing: [], weeks: [], days: [] }, friends: [] }, KIT.builtin.persona],
     "public, kit v3, a life not planned yet (phonekit()'s shape, lives.slim), the shipped persona");
  eq(shape(k.chars[0].life), shape(golden.chars[0].life), "life's shape");
  eq(k.chars[0].knows_ask.phone.have, KIT.templates.knows_ask.phone.have.split("{name}").join("Buddy"), "knows_ask from the template");
  eq(d.S.cacheSecret().length, 64, "a per-device secret scopes Tinfoil's prompt cache");
});

test("routes: the site's own, then direct.js's; anything else 404 'not in Buddy for phones'; no pictures, no free brain", async () => {
  const d = await phone();
  for (const p of ["/api/me", "/api/stored", "/api/knowledge", "/api/phonekit", "/api/backup", "/api/devices", "/api/whatever"]) {
    const r = await d.S.fetch(p);
    eq([r.status, await r.json()], [404, { error: "not in Buddy for phones" }], "GET " + p);
  }
  for (const p of ["/api/thread/import", "/api/pair", "/api/push/subscribe", "/api/knows/preview"]) {
    const r = await post(d.S, p, {});
    eq([r.status, (await r.json()).error], [404, "not in Buddy for phones"], "POST " + p);
  }
  eq((await get(d.S, "/api/images")).j.pictures, "off", "pictures off");
  eq((await post(d.S, "/api/characters/avatar", { id: "buddy" })).status, 403, "no picture making");
  eq([(await post(d.S, "/api/settings", { pictures: "near" })).status, (await post(d.S, "/api/settings", { free_brain: true })).status], [400, 400], "refused settings");
  const st = (await get(d.S, "/api/status")).j;
  eq([st.solo, st.edition, st.tinfoil_key, st.phala_key, st.near_key], [true, "public", true, false, false], "status");
  eq((await get(d.S, "/api/version")).j.version, "v58", "the site's version (version.json)");
  eq((await post(d.S, "/api/settings", { has_partner: "no", see_photos: false })).status, 200, "settings saved");
  const k = d.S.kit();
  eq([k.edition.partner.has, typeof k.edition.partner.at, k.see_photos], ["no", "number", false], "they reach the kit");
});

test("[partner: …] in a reply becomes your setting (the status only); from a private chat only yes/noask", async () => {
  fakeTinfoil({ chat: [{ when: { stream: true }, status: 200, sse: ["[partner: no] oh nice ", "good to know"], chunkMs: 1, done: true }] });
  const d = await phone();
  await ndjson(await post(d.S, "/api/chat", { text: "i'm single", char: "buddy", via: "phone", private: true }));
  eq((await get(d.S, "/api/settings")).j.has_partner, "", "a private 'no' changes nothing");
  await ndjson(await post(d.S, "/api/chat", { text: "i'm single", char: "buddy", via: "phone", private: false }));
  const s = (await get(d.S, "/api/settings")).j;
  eq(s.has_partner, "no", "a normal one does");
  const th = (await get(d.S, "/api/thread?after=0")).j;
  must(!JSON.stringify(th).includes("[partner"), "the tag is never kept");
  fakeTinfoil({ chat: [{ when: { stream: true }, status: 200, sse: ["[partner: noask] okay"], chunkMs: 1, done: true }] });
  await ndjson(await post(d.S, "/api/chat", { text: "stop asking", char: "buddy", via: "phone", private: true }));
  eq((await get(d.S, "/api/settings")).j.partner_noask, true, "a private noask counts");
});

test("characters: the Advisor writes them (no key: nothing asked); minors' looks refused; ids slug-xxxx; save, delete, forget", async () => {
  fakeWith("Here:\n" + CHARS());
  const n = await phone(fresh(), null);
  eq(await (await post(n.S, "/api/characters/create", { description: "three people" })).json(), { error: KIT.edition && "Buddy needs this phone's own Tinfoil key: Settings → This device's key." }, "no key: said, nothing asked");
  eq(tlog().length, 0, "Tinfoil not contacted");
  const d = await phone();
  eq((await post(d.S, "/api/characters/create", { description: "ab" })).status, 400, "too short");
  const r = await (await post(d.S, "/api/characters/create", { description: "three people" })).json();
  eq(r.created.map((c) => c.name), ["Maya", "Leo"], "Tess (a minor's looks) refused");
  must(r.created.every((c) => /^[a-z]+-[0-9a-hjkmnp-tv-z]{4}$/.test(c.id) && c.texts_first && c.texts_per_day === 1 && c.shared_facts), "slug-xxxx, texting now and then, shared facts");
  eq([r.created[0].color, r.created[1].color], ["#5b8def", "#123456"], "colours: the next one in turn (as characters.save), or the model's");
  const ask = tlog().filter((e) => e.kind === "fetch" && e.json && !e.json.stream && e.json.max_tokens !== 1).pop();
  eq([ask.json.temperature, ask.json.model], [1, "gemma4-31b"], "the Advisor, temperature 1");
  must(ask.json.messages[0].content.includes('from this request: "three people"') && ask.json.messages[0].content.includes(KIT.edition.create), "the creation prompt");
  const maya = r.created[0].id;
  eq((await post(d.S, "/api/characters/save", { character: { id: maya, appearance: "a 15-year-old" } })).status, 400, "minor's looks refused on save");
  eq((await (await post(d.S, "/api/characters/save", { character: { id: maya, tagline: "New tag", knowledge: { scope: "none" } } })).json()).character.shared_facts, false, "edited (scope none: no shared facts)");
  const buddy = await (await post(d.S, "/api/characters/save", { character: { id: "buddy", persona: KIT.builtin.persona, name: "Bud" } })).json();
  eq([buddy.character.name, buddy.character.persona], ["Bud", KIT.builtin.persona], "Buddy renamed; the shipped persona still followed");
  const rec = (await d.Lib.store.allRecs("char")).find((x) => x.body.id === "buddy");
  eq(rec.body.d.f.persona[1], "", "(stored as following the shipped persona)");
  await ndjson(await post(d.S, "/api/chat", { text: "hi maya", char: maya, via: "phone", private: false }));
  await ndjson(await post(d.S, "/api/chat", { text: "private hi", char: maya, via: "phone", private: true }));
  await post(d.S, "/api/knows/fact", { char: maya, op: "add", text: "I keep bees.", to: "mine" });
  const f = await (await post(d.S, "/api/characters/forget", { id: maya })).json();
  eq([f.ok, f.deleted, f.epoch], [true, 4, 1], "forgotten: 2 stored + 2 private messages, epoch 1");
  eq(((await get(d.S, "/api/thread?after=0")).j).filter((m) => m.char === maya).length, 0, "the conversation is gone");
  eq((await get(d.S, "/api/knows?char=" + maya)).j.facts, [], "and what they knew");
  await ndjson(await post(d.S, "/api/chat", { text: "again", char: maya, via: "phone", private: false }));
  const m = (await d.Lib.store.allRecs("msg")).find((x) => x.body.d.char === maya);
  eq(m.body.d.epoch, 1, "new messages carry the new epoch");
  eq(await (await post(d.S, "/api/characters/delete", { id: "buddy" })).json(), { ok: false }, "Buddy can't be deleted");
  eq(await (await post(d.S, "/api/characters/delete", { id: maya })).json(), { ok: true }, "Maya deleted");
  eq((await get(d.S, "/api/characters")).j.map((c) => c.name), ["Bud", "Leo"], "gone from the list");
  eq((await d.Lib.store.allRecs("msg")).filter((x) => x.body.d.char === maya).length, 0, "with everything said");
  const tomb = (await d.Lib.store.allRecs("char")).find((x) => x.body.id === maya);
  must(tomb && tomb.body.d.deleted && !Object.keys(tomb.body.d.f).length, "a tombstone stays (the id is never used again)");
  eq((await post(d.S, "/api/characters/save", { character: { id: maya, name: "Zombie" } })).status, 200, "(saving with that id makes a new character)");
  must(!(await get(d.S, "/api/characters")).j.some((c) => c.id === maya), "never the deleted id");
});

test("records: {k, v, id, a, n, h, d}; the clock only goes up; the device's counter too", async () => {
  const d = await phone();
  for (let i = 0; i < 5; i++) await post(d.S, "/api/newchat", { char: "buddy" });
  const all = (await d.Lib.store.allRecs()).map((r) => r.body).sort((a, b) => a.n - b.n);
  must(all.every((b) => b.v === 1 && /^\d{13}:\d{4}:[A-Za-z0-9_-]{22}$/.test(b.h) && typeof b.a === "string"), "the body's fields");
  for (let i = 1; i < all.length; i++) must(all[i].h > all[i - 1].h && all[i].n > all[i - 1].n, "monotonic");
});

async function richPhone() {
  fakeTinfoil();
  const d = await phone();
  await post(d.S, "/api/settings", { has_partner: "yes", tz: "Europe/Lisbon" });
  await post(d.S, "/api/knows/fact", { char: "buddy", op: "add", text: "I keep bees.", to: "mine" });
  await post(d.S, "/api/knows/fact", { char: "buddy", op: "add", text: "I live in Porto.", to: "everyone" });
  const leo = (await (await post(d.S, "/api/characters/save", { character: { name: "Leo", persona: "You are Leo." } })).json()).character;
  const up = await (await post(d.S, "/api/characters/avatar/upload", { id: leo.id, image: "data:image/jpeg;base64," + Buffer.from(jpeg(300, 300)).toString("base64") })).json();
  must(up.ok && up.avatar > 0, "an avatar uploaded");
  await ndjson(await post(d.S, "/api/chat", { text: "FILE-LINE-1", char: "buddy", via: "phone", private: false }));
  await ndjson(await post(d.S, "/api/chat", { text: "with a photo", char: "buddy", via: "phone", private: false, photo: await photo(d.S) }));
  await ndjson(await post(d.S, "/api/chat", { text: "PRIVATE-NEVER-IN-A-FILE", char: "buddy", via: "phone", private: true }));
  await new Promise((r) => setTimeout(r, 100));
  return { d, leo };
}

test("back up to a file: the key only after group 14; the file only that key opens; restore on a fresh phone, twice", async () => {
  const { d, leo } = await richPhone();
  let e = null;
  try { await d.S.exportFile(); } catch (x) { e = x; }
  eq(e && e.text, "Make your recovery key first.", "no file before the key");
  const k = await d.S.makeBackupKey();
  eq(k.groups.length, 14, "14 groups");
  for (const wrong of ["", "ZZZZ" === k.groups[13] ? "0000" : "ZZZZ"]) {
    e = null; try { await d.S.confirmBackupKey(wrong); } catch (x) { e = x; }
    must(e && /last group/.test(e.text), "wrong group 14 refused: " + (e && e.text));
  }
  eq(await d.S.confirmBackupKey(k.groups[13].toLowerCase()), { ok: true }, "confirmed (case doesn't matter)");
  const raw = dumpText(d.env), plain = JSON.stringify((await d.Lib.store.allRecs()).map((r) => r.body)) + JSON.stringify(await d.Lib.store.getSecret("acctkeys"));
  for (const f of [k.text, k.text.replace(/-/g, ""), k.groups.slice(0, 6).join("")]) must(!raw.includes(f) && !plain.includes(f), "the recovery key isn't stored");
  const out = await d.S.exportFile();
  must(/^Buddy \d{4}-\d{2}-\d{2}\.buddysync$/.test(out.name) && out.records >= 6 && out.blobs === 3, "a file: " + JSON.stringify([out.name, out.records, out.blobs]));
  const bytes = new Uint8Array(await out.blob.arrayBuffer()), text = Buffer.from(bytes).toString("latin1");
  for (const bad of ["FILE-LINE-1", "PRIVATE-NEVER", "bees", "Porto", "Leo", KEY]) must(!text.includes(bad), "no plaintext in the file: " + bad);
  eq((await d.S.backupInfo()).key, true, "Settings: the key exists");
  // a fresh phone
  const b = await phone(fresh(), null);
  await ndjson(await post(b.S, "/api/newchat", { char: "buddy" }));   // (something of its own first)
  const tryKey = async (key, file = bytes) => { try { return await b.S.importFile(file, key); } catch (x) { return { error: x.text }; } };
  const other = await b.Lib.bcrypto.keyText(b.Lib.bcrypto.rand(32), "sync"), backupKey = await b.Lib.bcrypto.keyText(b.Lib.bcrypto.rand(32), "backup");
  eq((await tryKey(other)).error, "That recovery key doesn't open this backup file.", "another sync key");
  eq((await tryKey(backupKey)).error, "That's a backup recovery key, not a sync key.", "a Mac backup key, named");
  eq((await tryKey(k.text.slice(0, -2))).error, "That recovery key isn't complete: it has 14 groups of 4 letters and numbers.", "incomplete");
  eq((await tryKey(k.text, bytes.slice(0, bytes.length - 10))).error, "That backup file is cut off.", "cut off");
  const flip = bytes.slice(); flip[200] ^= 1;
  eq((await tryKey(k.text, flip)).error, "That backup file is damaged or incomplete, so nothing was restored.", "one bit changed");
  const frames = [];                                    // (two records swapped, the trailer kept: its MAC notices the order)
  for (let i = 26; i < bytes.length;) { const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(i + 1); frames.push(bytes.slice(i, i + 5 + n)); i += 5 + n; }
  const swapped = b.Lib.bcrypto.concat(bytes.slice(0, 26), frames[1], frames[0], ...frames.slice(2));
  eq(swapped.length, bytes.length, "(the same bytes, in another order)");
  eq((await tryKey(k.text, swapped)).error, "That backup file is damaged or incomplete, so nothing was restored.", "reordered");
  eq((await get(b.S, "/api/characters")).j.length, 1, "nothing restored by the refused files");
  const r1 = await tryKey(k.text.toLowerCase().replace(/-/g, " "));
  eq([r1.ok, r1.messages, r1.skipped], [true, 4, 0], "restored (typed loosely): " + JSON.stringify(r1));
  const th = (await get(b.S, "/api/thread?after=0")).j;
  eq(th.filter((m) => m.role !== "break").map((m) => m.content), ["FILE-LINE-1", "Hi there! How are you?", "with a photo", "Hi there! How are you?"], "the conversation");
  must(th.some((m) => m.role === "break") && !th.some((m) => /PRIVATE/.test(m.content)), "its own break kept; nothing private came");
  const ph = th.find((m) => m.image);
  must(ph && ph.photo_desc === "A red square on white." && (await b.S.mediaURL(ph.image, true)) && (await b.S.mediaURL(ph.image, false)), "the photo, both copies, and its description");
  eq((await get(b.S, "/api/characters")).j.map((c) => c.name), ["Buddy", "Leo"], "the characters");
  must(b.S.avatarURL(leo.id, (await get(b.S, "/api/characters")).j[1].avatar), "Leo's picture");
  eq((await get(b.S, "/api/knows?char=buddy")).j.facts.map((f) => [f.text, f.file]), [["I keep bees.", "mine"], ["I live in Porto.", "everyone"]], "the facts");
  eq([(await get(b.S, "/api/settings")).j.has_partner, b.S.kit().tz], ["yes", "Europe/Lisbon"], "the settings");
  eq(b.S.hasKey(), false, "this phone's Tinfoil key never travels in a file");
  const r2 = await tryKey(k.text);
  eq([r2.ok, r2.messages], [true, 0], "the same file again: nothing doubled");
  eq((await get(b.S, "/api/thread?after=0")).j.length, th.length, "still the same conversation");
  eq(r1.key, "adopted", "a phone without a recovery key takes the file's (its backups open with it from now on)");
  // the restored phone backs up too, with the same keys (no new recovery key); blobs keep the account they were sealed for
  const out2 = await b.S.exportFile();
  const c = await phone(fresh(), null);
  const r3 = await c.S.importFile(out2.blob, k.text);
  eq([r3.ok, r3.messages], [true, 5], "a file from the restored phone opens with the same key (its break too)");
  const reopened = device(KIT, b.env); await reopened.S.init();
  const ph2 = (await get(reopened.S, "/api/thread?after=0")).j.find((m) => m.image);
  must(await reopened.S.mediaURL(ph2.image, true), "after a restart the photo still opens");
});

test("a fact moved to one character stays there after an older backup is restored", async () => {
  const { d, leo } = await richPhone();
  const k = await d.S.makeBackupKey(); await d.S.confirmBackupKey(k.groups[13]);
  const older = (await d.S.exportFile()).blob;
  const porto = (await get(d.S, "/api/knows?char=buddy")).j.facts.find((f) => f.text === "I live in Porto.");
  eq((await post(d.S, "/api/knows/fact", { char: "buddy", op: "move", id: porto.id, file: "everyone", to: "mine" })).status, 200, "moved to Buddy only");
  await d.S.importFile(older, k.text);
  eq((await get(d.S, "/api/knows?char=buddy")).j.facts.map((f) => [f.text, f.file]), [["I keep bees.", "mine"], ["I live in Porto.", "mine"]], "still Buddy's only");
  eq((await get(d.S, "/api/knows?char=" + leo.id)).j.facts.map((f) => f.text), [], "Leo doesn't get it back");
  must(!d.S.kit().chars.find((c) => c.id === leo.id).facts.shared.length, "nor in his prompt");
  // a set-aside taken back ("Give back") stays as a dated empty entry, so an older copy's entry loses the merge
  const F = d.Lib.facts, ctx = { hlc: () => "1792000000000:0000:dev", today: "2026-10-23", sharedOn: true };
  const own = { owner: "buddy", items: {}, del: {}, aside: { "0123456789": ["1700000000000:0000:old", { buddy: "" }] } };
  const r = await F.change({ id: "buddy", name: "Buddy" }, { op: "show", id: "0123456789" }, { own, shared: null }, ctx);
  eq(r.changed.buddy.aside["0123456789"], ["1792000000000:0000:dev", {}], "show: dated, nothing set aside");
  const c = await F.change({ id: "buddy", name: "Buddy" }, { op: "clear", file: "mine" }, { own, shared: null }, ctx);
  eq(c.changed.buddy.aside["0123456789"], ["1792000000000:0000:dev", {}], "clear: the same");
});

const mediaStore = (env) => JSON.stringify(((env.idb.dump("buddy-site") || {}).media || []).map((m) => [m.bid, Buffer.from(new Uint8Array(m.ct)).toString("base64"), m.usedAt]).sort());
test("making the recovery key never touches photos, voice notes or avatars; one cut off half way loses nothing", async () => {
  const { d, leo } = await richPhone();
  const before = mediaStore(d.env);
  must(before.length > 10, "media stored");
  const opens = async (S) => {
    const th = (await get(S, "/api/thread?after=0")).j, ph = th.find((m) => m.image), cs = (await get(S, "/api/characters")).j;
    return !!(ph && (await S.mediaURL(ph.image, true)) && (await S.mediaURL(ph.image, false)) && (await S.fetch("/api/characters/" + leo.id + "/avatar")).status === 200
      && cs.find((c) => c.id === leo.id).avatar);
  };
  // the page dies (or storage fails) while the new keys are being kept
  let k = await d.S.makeBackupKey();
  const real = d.Lib.store.setSecret;
  d.Lib.store.setSecret = async () => { throw new Error("the page went away"); };
  let e = null; try { await d.S.confirmBackupKey(k.groups[13]); } catch (x) { e = x; }
  d.Lib.store.setSecret = real;
  must(e, "it failed half way");
  eq(mediaStore(d.env), before, "media untouched");
  must(await opens(d.S), "the photo (both copies) and the avatar still open");
  const again = device(KIT, d.env); await again.S.init();
  must(await opens(again.S), "and after a restart");
  eq((await again.S.backupInfo()).key, false, "no key was kept: make one again");
  k = await again.S.makeBackupKey();
  eq(await again.S.confirmBackupKey(k.groups[13]), { ok: true }, "made");
  eq(mediaStore(again.env), before, "media still untouched (they keep their own keys, §5.3)");
  must(await opens(again.S), "everything opens");
  const third = device(KIT, d.env); await third.S.init();
  must(await opens(third.S), "after another restart too");
  const out = await third.S.exportFile(), c = await phone(fresh(), null);
  eq((await c.S.importFile(out.blob, k.text)).ok, true, "a backup made now restores");
  must(await opens(c.S), "and its photo and avatar open on the new phone");
});

test("restore onto a phone with its own recovery key: that key stays, so this phone's backups still open with it", async () => {
  const { d: a } = await richPhone();
  const ka = await a.S.makeBackupKey(); await a.S.confirmBackupKey(ka.groups[13]);
  const fileA = (await a.S.exportFile()).blob;
  const b = await phone();
  await ndjson(await post(b.S, "/api/chat", { text: "B-OWN-LINE", char: "buddy", via: "phone", private: false }));
  const kb = await b.S.makeBackupKey(); await b.S.confirmBackupKey(kb.groups[13]);
  const r = await b.S.importFile(fileA, ka.text);
  eq([r.ok, r.key], [true, "kept"], "restored; this phone kept its own key (and says so)");
  let ph = (await get(b.S, "/api/thread?after=0")).j.find((m) => m.image);
  must(ph && (await b.S.mediaURL(ph.image, true)) && (await b.S.mediaURL(ph.image, false)), "the file's photo opens here");
  const fileB = (await b.S.exportFile()).blob, c = await phone(fresh(), null);
  let e = null; try { await c.S.importFile(fileB, ka.text); } catch (x) { e = x; }
  eq(e && e.text, "That recovery key doesn't open this backup file.", "this phone's next backup doesn't open with the other phone's key");
  const r2 = await c.S.importFile(fileB, kb.text);
  eq([r2.ok, r2.key], [true, "adopted"], "it opens with this phone's own key");
  const th = (await get(c.S, "/api/thread?after=0")).j;
  must(th.some((m) => m.content === "B-OWN-LINE") && th.some((m) => m.content === "FILE-LINE-1"), "with this phone's chats and the restored ones");
  ph = th.find((m) => m.image);
  must(ph && (await c.S.mediaURL(ph.image, true)), "the photo too");
  const again = device(KIT, b.env); await again.S.init();
  ph = (await get(again.S, "/api/thread?after=0")).j.find((m) => m.image);
  must(ph && (await again.S.mediaURL(ph.image, false)), "after a restart the restored photo still opens");
});

test("restore only adds: a forget or delete on the phone that made the file deletes nothing here; a forget here stays", async () => {
  fakeTinfoil();
  const a = await phone(), msgsOf = async (S, char) => (await get(S, "/api/thread?after=0")).j.filter((m) => m.char === char && m.role === "user").map((m) => m.content);
  const say = async (S, text, char = "buddy") => ndjson(await post(S, "/api/chat", { text, char, via: "phone", private: false }));
  const ka = await a.S.makeBackupKey(); await a.S.confirmBackupKey(ka.groups[13]);
  const maya = (await (await post(a.S, "/api/characters/save", { character: { name: "Maya", persona: "You are Maya." } })).json()).character.id;
  await say(a.S, "A-MAYA-1", maya);
  const file1 = (await a.S.exportFile()).blob;
  // the old phone once deleted its conversation with Buddy, then chatted again
  await say(a.S, "A-OLD-BUDDY");
  eq((await (await post(a.S, "/api/characters/forget", { id: "buddy" })).json()).epoch, 1, "A forgot Buddy once");
  await say(a.S, "A-AFTER-FORGET");
  const file2 = (await a.S.exportFile()).blob;
  // a new phone: its own first chat, then the old phone's backup
  const b = await phone(fresh());
  await say(b.S, "B-FIRST-CHAT");
  let r = await b.S.importFile(file2, ka.text);
  eq(await msgsOf(b.S, "buddy"), ["B-FIRST-CHAT", "A-AFTER-FORGET"], "this phone's chat stays; the backup's is added");
  r = await b.S.importFile(file1, ka.text);
  await say(b.S, "B-MAYA-1", maya); await say(b.S, "B-MAYA-2", maya);
  // the old phone forgets Maya and talks again, then deletes her
  await post(a.S, "/api/characters/forget", { id: maya });
  await say(a.S, "A-MAYA-2", maya);
  r = await b.S.importFile((await a.S.exportFile()).blob, ka.text);
  eq(await msgsOf(b.S, maya), ["A-MAYA-1", "B-MAYA-1", "B-MAYA-2", "A-MAYA-2"], "a forget there deletes nothing here; what was said since is added");
  await post(a.S, "/api/characters/delete", { id: maya });
  r = await b.S.importFile((await a.S.exportFile()).blob, ka.text);
  eq([r.ok, await msgsOf(b.S, maya)], [true, ["A-MAYA-1", "B-MAYA-1", "B-MAYA-2", "A-MAYA-2"]], "a delete there deletes nothing here");
  must((await get(b.S, "/api/characters")).j.some((c) => c.id === maya), "and Maya stays here");
  // a forget here isn't undone by an older backup
  eq((await (await post(b.S, "/api/characters/forget", { id: maya })).json()).ok, true, "forgotten here");
  await b.S.importFile(file1, ka.text);
  eq(await msgsOf(b.S, maya), [], "what was forgotten here stays forgotten");
  const again = device(KIT, b.env); await again.S.init();
  eq([await msgsOf(again.S, "buddy"), await msgsOf(again.S, maya)], [["B-FIRST-CHAT", "A-AFTER-FORGET"], []], "the same after a restart");
});

await run();
