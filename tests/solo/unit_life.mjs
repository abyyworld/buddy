// Buddy for phones, P1c (SPEC3 §11.1-11.3, §12.1) in Node with a fake clock (tests/solo/clock.mjs): learning facts on the
// phone ("remember that …" is urgent; the debounce; never from private chats), real timing (a late answer written at
// once and held until its time; a message before then has it written again with LATE_NOTE, keeping its time), a day
// planned when the app opens and its moments written ahead as held messages with deterministic ids, shown at their
// time; your message cancels a held moment due within 25 minutes and has the others written again; quotas; the
// /api/lives routes; forgetting; a restart while something is held; nothing readable in storage. Fake data, fake key.
//   node tests/solo/unit_life.mjs [name…]
import vm from "node:vm";
import { FakeIDB, FakeStorage } from "../phonemode/fake_idb.mjs";
import { device, staticKit, fakeTinfoil, tlog, post, get, ndjson, dumpText, runner, FAKE } from "./harness.mjs";
import { FakeClock } from "./clock.mjs";

const { test, must, eq, run } = runner();
const KIT = staticKit();
const KEY = "sk-FAKE-solo-0123456789abcdef";
const TZ = "Europe/Berlin";
const T0 = Date.UTC(2026, 9, 23, 8, 0);                  // Fri 2026-10-23 10:00 in Berlin
const DATE = "2026-10-23";
const fresh = () => ({ idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session") });
const at = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return Date.UTC(2026, 9, 23, h - 2, m) / 1000; };   // (Berlin, CEST)
const reply = (content) => ({ status: 200, json: { choices: [{ message: { content }, finish_reason: "stop" }] } });
const PLAN = (moments = [{ at: "12:30", event: 2, angle: "vent" }, { at: "16:00", event: 3, angle: "share" }]) => JSON.stringify({
  today: { summary: "a long studio day", events: [
    { at: "09:00", what: "overslept, cold shower", plan: "", mood: "grumpy", kind: "mundane" },
    { at: "10:30", what: "the studio boiler died", plan: "studio shift", mood: "annoyed", kind: "work" },
    { at: "13:00", what: "climbing, finally sent the blue route", plan: "climbing after lunch", mood: "proud", kind: "hobby" },
    { at: "19:00", what: "dinner with Lena", plan: "dinner with my sister", mood: "happy", kind: "social" }] },
  moments, ongoing: [{ what: "training for a 10k", since: "2026-09-20" }],
  about: ["Lives in a small top-floor flat", "Mixes sound at a tiny studio", "Thinks about you all day"],
  people: [{ name: "Lena", who: "my older sister, a nurse" }] });
function rules(o = {}) {
  return [
    { when: { stream: false, text: "Facts check (for Buddy's memory)" }, ...reply(o.learn || '{"add": ["I\'m vegan."], "update": [], "remove": []}') },
    { when: { stream: false, text: "Reply with ONLY this JSON" }, ...reply(o.plan || PLAN()) },
    { when: { stream: false, text: "You're texting me first" }, ...reply(o.moment || "ugh the studio boiler died again\n\nsend help") },
    { when: { stream: false }, ...reply("ok") },
    { when: { stream: true }, status: 200, sse: o.sse || ["Hi there! ", "How are you?"], chunkMs: 1, done: true },
  ];
}
async function phone(o = {}) {
  const clock = o.clock || new FakeClock(T0);
  fakeTinfoil({ chat: rules(o) });
  const d = device(KIT, o.env || fresh(), { clock });
  eq((await d.S.init()).ok, true, "started");
  if (!o.env) {
    eq(await d.S.setKey(KEY), { ok: true }, "key saved");
    eq((await post(d.S, "/api/settings", { tz: TZ, quiet_from: 23, quiet_until: 7 })).status, 200, "home zone");
  }
  random(d, [0.5]);
  return { ...d, clock };
}
function random(d, vals) {                               // Math.random inside that phone: these numbers, round and round
  vm.runInContext(`(() => { const v = ${JSON.stringify(vals)}; let i = 0; Math.random = () => v[i++ % v.length]; })()`, d.sb);
}
const chat = async (d, text, extra = {}) => ndjson(await post(d.S, "/api/chat", { text, char: "buddy", via: "phone", private: false, ...extra }));
const thread = async (d) => (await get(d.S, "/api/thread?after=0")).j;
const asks = (text) => tlog().filter((e) => e.kind === "fetch" && e.json && !e.json.stream && JSON.stringify(e.json.messages).includes(text));
const sec = (d) => d.clock.now / 1000;
const heldRecs = async (d) => (await d.Lib.store.allRecs("msg")).map((r) => r.body.d).filter((x) => x.held).sort((a, b) => a.at - b.at);   // (store order is by hashed id)
const aheadRecs = async (d) => (await d.Lib.store.allRecs("msg")).filter((r) => r.body.d.held && !Number.isInteger(r.lid)).map((r) => r.body.d).sort((a, b) => a.at - b.at);   // (not shown yet)
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 8000) {           // (the answer is written in the background, after {later})
  const end = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error("timed out waiting for " + what); await sleepReal(5); }
}
const idle = (d) => waitFor(() => !d.D.busy(), "the answer to be written");
const quiet = async (d) => { await idle(d); await sleepReal(200); };   // (nothing of this test still on its way)

test("learning: 'remember that …' is learned at once (urgent), the rest after the Mac's debounce; never from a private chat", async () => {
  const d = await phone();
  await chat(d, "remember that I'm vegan");
  await d.S.tick();
  eq(asks("Facts check").length, 1, "the Advisor was asked once (urgent: no 2-minute wait)");
  const ask = asks("Facts check")[0].json;
  eq([ask.temperature, ask.max_tokens, ask.model], [0.2, 800, "gemma4-31b"], "the Advisor, careful and short (facts.learn_ask)");
  must(ask.messages[0].content.includes("NEW:\nMe: remember that I'm vegan\nBuddy: Hi there! How are you?"), "the new messages, said by whom");
  let k = (await get(d.S, "/api/knows?char=buddy")).j;
  eq(k.facts.map((f) => [f.text, f.by, f.file]), [["I'm vegan.", "chat", "mine"]], "learned into Buddy's own list");
  must(d.S.kit().chars[0].facts.own.some((f) => f.text === "I'm vegan."), "and it reaches the prompt (the kit)");
  // private: never learned, not even counted
  await chat(d, "remember my sister is called Lena", { private: true });
  await d.clock.advance(5 * 60 * 1000); await d.S.tick();
  eq(asks("Facts check").length, 1, "nothing from a private chat");
  // the debounce: not within 2 minutes of the last run, then only after 4 quiet minutes (or 6 things said)
  fakeTinfoil({ chat: rules({ learn: '{"add": ["I live in Porto."], "update": [], "remove": []}' }) });
  await chat(d, "I live in Porto by the way");
  await d.clock.advance(60 * 1000); await d.S.tick();
  eq(asks("Facts check").length, 0, "1 min later: the conversation might go on");
  await d.clock.advance(2 * 60 * 1000); await d.S.tick();
  eq(asks("Facts check").length, 0, "3 min: still not 4 quiet minutes, and only 1 thing said");
  await d.clock.advance(70 * 1000); await d.S.tick();
  eq(asks("Facts check").length, 1, "4 quiet minutes: learned");
  k = (await get(d.S, "/api/knows?char=buddy")).j;
  eq(k.facts.map((f) => f.text), ["I'm vegan.", "I live in Porto."], "the sheet");
  must(!asks("Facts check")[0].json.messages[0].content.includes("Lena"), "the private message was never shown to the Advisor");
  // six things said: due 2 minutes after the last run, without waiting for a pause
  fakeTinfoil({ chat: rules({ learn: '{"add": [], "update": [], "remove": []}' }) });
  for (let i = 0; i < 6; i++) { await chat(d, "thing number " + i); await d.clock.advance(10 * 1000); }
  await d.clock.advance(60 * 1000); await d.S.tick();    // (2 minutes after the last run)
  eq(asks("Facts check").length, 1, "6 things said: learned without a pause");
  // learning off: the bookmark moves past what's said, so it's never learned later
  eq((await post(d.S, "/api/settings", { learn_facts: false })).status, 200, "learning off");
  fakeTinfoil({ chat: rules({ learn: '{"add": ["I have a dog named Rex."], "update": [], "remove": []}' }) });
  await chat(d, "remember that I have a dog named Rex");
  await d.clock.advance(10 * 60 * 1000); await d.S.tick();
  eq((await post(d.S, "/api/settings", { learn_facts: true })).status, 200, "learning back on");
  await d.clock.advance(10 * 60 * 1000); await d.S.tick();
  eq(asks("Facts check").length, 0, "what was said while it was off is never learned");
  must(!dumpText(d.env).includes("vegan") && !dumpText(d.env).includes("Porto"), "facts are encrypted at rest");
  await quiet(d);
});

test("real timing: a late answer is written at once, held, shown at its time; a message before then has it written again, same time", async () => {
  const d = await phone();
  await chat(d, "morning!");
  await d.clock.advance(3 * 3600 * 1000);               // 13:00: three quiet hours
  random(d, [0.1]);                                     // (0.1 < 0.45: a delay of 60 + 360 * 0.1 = 96 s)
  const before = tlog().length;
  const out = await chat(d, "you there?");
  eq(out, [{ later: 96 }], "the page stops waiting ({later})");
  await idle(d);
  const first = tlog().slice(before).filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  must(first && first.json.messages[0].content.includes("You're answering my text a while after I sent it"), "written now, with LATE_NOTE");
  must(first.json.messages[0].content.includes("Friday 23 October 2026, 13:01"), "for the time it will be read (13:01:36)");
  eq((await thread(d)).filter((m) => m.role === "assistant").length, 1, "not shown yet");
  eq((await heldRecs(d)).length, 1, "kept (encrypted) until then");
  await d.clock.advance(50 * 1000);
  sseNext(["Sorry, just saw these! ", "Yes, here."]);
  const out2 = await chat(d, "hello??");
  eq(out2, [{ later: 46 }], "the same time");
  await idle(d);
  const second = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop();
  const conv = second.json.messages.slice(1).map((m) => m.role + ":" + m.content).join("|");
  must(conv.endsWith("user:you there?\nhello??"), "written again for everything you sent: " + conv.slice(-80));
  eq((await heldRecs(d)).length, 1, "the first one is gone (one held answer)");
  await d.clock.advance(40 * 1000);
  eq(d.S.typing().map((x) => x.char), ["buddy"], "typing… just before");
  await d.clock.advance(10 * 1000);
  const th = await thread(d), a = th.filter((m) => m.role === "assistant");
  eq(a.map((m) => [m.content, m.late || false]), [["Hi there! How are you?", false], ["Sorry, just saw these! Yes, here.", true]], "shown at its time, once");
  eq(a[1].ts, at("13:00") + 96, "with its own time");
  must(a[1].id > th.find((m) => m.content === "hello??").id, "after what you sent");
  eq((await heldRecs(d)).length, 1, "(the record keeps its time, now with a page id)");
  await waitFor(async () => (await d.Lib.store.allRecs("msg")).filter((r) => r.body.d.held).every((r) => Number.isInteger(r.lid)), "a page id once shown");
  random(d, [0.1]);
  eq(await chat(d, "great"), [{ mode: "advisor" }, { s: "Sorry, just saw these!" }, { s: "Yes, here." }], "in the middle of a conversation: at once");
  // never for a photo, a voice message or a call
  await d.clock.advance(5 * 3600 * 1000);
  eq((await chat(d, "on a call now", { via: "call" })).some((x) => x.later), false, "a call: at once");
  // real timing off
  await d.clock.advance(5 * 3600 * 1000);
  eq((await post(d.S, "/api/settings", { real_timing: false })).status, 200, "off");
  eq((await chat(d, "hey again")).some((x) => x.later), false, "off: at once");
  await quiet(d);
});
test("a held answer survives a restart (a message after it has it written again, same time); a New chat drops it", async () => {
  const d = await phone();
  await chat(d, "morning!");
  await d.clock.advance(3 * 3600 * 1000);
  random(d, [0.1]);
  eq(await chat(d, "you there?"), [{ later: 96 }], "held");
  await idle(d);
  const again = device(KIT, d.env, { clock: d.clock }); await again.S.init(); random(again, [0.1]);
  await d.clock.advance(30 * 1000);
  eq(await ndjson(await post(again.S, "/api/chat", { text: "hello?", char: "buddy", via: "phone", private: false })), [{ later: 66 }],
     "after a restart: written again, same time");
  await waitFor(() => !again.D.busy(), "written");
  eq((await heldRecs(again)).length, 1, "one held answer");
  eq((await post(again.S, "/api/newchat", { char: "buddy" })).status, 200, "New chat");
  eq((await heldRecs(again)).length, 0, "the answer still on its way is dropped (as on the Mac)");
  await d.clock.advance(120 * 1000);
  eq((await get(again.S, "/api/thread?after=0")).j.filter((m) => m.late).length, 0, "never shown");
  await quiet(again);
});
function sseNext(texts) { const c = globalThis.__FAKE_TINFOIL__; c.chat = c.chat.map((r) => (r.when && r.when.stream ? { ...r, sse: texts } : r)); }

test("lives: a day planned on open; its moments written ahead (held, deterministic ids), shown at their time; never two at once", async () => {
  const d = await phone();
  await chat(d, "hi");                                  // (you've talked lately: a texting character's day is planned)
  await d.S.tick();
  eq(asks("Reply with ONLY this JSON").length, 1, "one plan");
  const plan = asks("Reply with ONLY this JSON")[0].json;
  eq([plan.temperature, plan.max_tokens], [0.9, 1500], "the plan: temperature 0.9, 1500 tokens");
  must(plan.messages[0].content.includes("Write YOUR day today, 2026-10-23 (Friday), as JSON. It's 10:00 where you\nlive (Europe/Berlin)."), "today, in the home zone");
  must(plan.messages[0].content.includes(KIT.edition.life), "the public edition's line");
  eq(asks("You're texting me first").length, 2, "both moments written ahead");
  const m = asks("You're texting me first")[0].json;
  eq([m.temperature, m.max_tokens], [1, 400], "a text first: temperature 1, 400 tokens");
  must(m.messages[m.messages.length - 1].content.startsWith("You're texting me first, unprompted, because of something in your own day: at 10:30 you the studio boiler died (you felt annoyed)."), "moment_prompt");
  must(m.messages[0].content.includes("Right now it's Friday 23 October 2026, 12:30"), "written for its own time");
  const lv = (await get(d.S, "/api/lives?char=buddy")).j;
  eq([lv.about, lv.people.map((p) => p.name), lv.days[0].events.length, lv.planned_today], [["Lives in a small top-floor flat", "Mixes sound at a tiny studio"], ["Lena"], 4, true], "the day (nothing about you kept)");
  eq(lv.days[0].moments.map((x) => [x.at, x.state]), [["12:30", "pending"], ["16:00", "pending"]], "moments still to come");
  const h = await heldRecs(d);
  eq(h.map((x) => x.life), [DATE + "/m1", DATE + "/m2"], "two held messages");
  const planned = (await d.Lib.store.allRecs("day")).find((r) => r.body.id === "buddy/" + DATE).body.d.planned;
  const want = async (mid) => { const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("buddy moment v1buddy|" + DATE + "|" + mid + "@" + Math.round(planned * 1000)))); return Buffer.from(b).toString("base64url").slice(0, 22); };
  eq(h.map((x) => x.cid), [await want("m1"), await want("m2")], "ids made from the character, date, moment and when the day was planned (SPEC3 §11.2, per plan)");
  const m2ask = asks("You're texting me first")[1].json;
  must(m2ask.messages.some((x) => x.content.includes("ugh the studio boiler died again")), "the 16:00 one is written knowing the 12:30 one");
  must(m2ask.messages[0].content.includes("Our last message before this was 3 hours ago. It was yours"), "and that it was 3 hours before (not 6)");
  eq(h.map((x) => x.at / 1000), [at("12:30"), at("16:00")], "at their times (2 h after you last talked, as pick() waits)");
  must((await thread(d)).every((x) => !x.proactive), "not shown yet");
  await d.S.tick();
  eq(asks("You're texting me first").length, 2, "never written twice");
  must(d.S.kit().chars[0].life.log.days.length === 1 && d.S.kit().chars[0].life.log.about.length === 2, "their life is in the kit (lives.context in every chat)");
  await chat(d, "what are you up to");
  const sys = tlog().filter((e) => e.kind === "fetch" && e.json && e.json.stream).pop().json.messages[0].content;
  must(sys.includes("YOUR OWN LIFE") && sys.includes("09:00 overslept, cold shower") && sys.includes("Later today (plans, can change): 10:30 studio shift"), "their day in the chat's prompt");
  await d.clock.advance(at("12:30") * 1000 - d.clock.now - 3000);
  eq(d.S.typing().map((x) => x.char), ["buddy"], "typing… just before 12:30");
  await d.clock.advance(4000);
  const th = await thread(d), t1 = th.filter((x) => x.proactive);
  eq(t1.map((x) => [x.content, x.life, x.ts]), [["ugh the studio boiler died again\n\nsend help", DATE + "/m1", at("12:30")]], "the 12:30 text arrives at 12:30");
  const lv2 = (await get(d.S, "/api/lives?char=buddy")).j;
  eq(lv2.days[0].moments.map((x) => x.state), ["sent", "pending"], "marked sent");
  must(lv2.days[0].events.find((e) => e.what === "the studio boiler died").texted, "and they know they texted about it");
  must(!dumpText(d.env).includes("boiler") && !dumpText(d.env).includes("Lena"), "lives and held texts are encrypted at rest");
  // a restart while one is held: still held, then shown at its time (or at the next open, with its own time)
  const again = device(KIT, d.env, { clock: d.clock }); await again.S.init();
  eq((await get(again.S, "/api/thread?after=0")).j.filter((x) => x.proactive).length, 1, "after a restart: the 16:00 one is still held");
  await d.clock.advance(8 * 3600 * 1000);               // (Buddy was closed: shown at the next open)
  const third = device(KIT, d.env, { clock: d.clock }); await third.S.init();
  const late = (await get(third.S, "/api/thread?after=0")).j.filter((x) => x.proactive);
  eq(late.map((x) => [x.life, x.ts]), [[DATE + "/m1", at("12:30")], [DATE + "/m2", at("16:00")]], "at the next open, with its own time");
  await quiet(d);
});

test("your message: their held moment within 25 minutes goes; the others are written again; other characters wait 25 minutes", async () => {
  const d = await phone();
  const leo = (await (await post(d.S, "/api/characters/save", { character: { name: "Leo", persona: "You are Leo, a chef.", texts_first: true, texts_per_day: 1 } })).json()).character;
  await chat(d, "hi");
  d.S.start();                                          // (the page started it: timers on the fake clock)
  await d.clock.advance(2000);
  await waitFor(async () => (await heldRecs(d)).length === 3, "three moments written ahead");
  const when = async (who) => (await heldRecs(d)).filter((x) => x.char === who).map((x) => x.at / 1000).sort();
  eq(await when("buddy"), [at("12:30"), at("16:00")], "Buddy at 12:30 and 16:00");
  eq(await when(leo.id), [at("13:30")], "Leo's 12:30 moved off Buddy's (13:15), then an hour after Buddy's text (13:30)");
  await d.clock.advance(at("12:10") * 1000 - d.clock.now);
  sseNext(["sure"]);
  fakeTinfoil({ chat: rules({ moment: "REWRITTEN: climbing went great", sse: ["sure"] }) });
  await chat(d, "how's the studio?");                   // 12:10: Buddy's 12:30 text goes, the 16:00 one is written again
  eq(await when("buddy"), [at("16:00")], "Buddy's 12:30 moment is cancelled (within 25 minutes)");
  eq((await get(d.S, "/api/lives?char=buddy")).j.days[0].moments.map((x) => x.state), ["skipped", "pending"], "(skipped)");
  eq(await when(leo.id), [at("13:30")], "Leo's, 80 minutes away, stays");
  await idle(d);
  await d.clock.advance(95 * 1000);                     // (90 s after your message: written again)
  await waitFor(async () => ((await heldRecs(d)).find((x) => x.life === DATE + "/m2" && x.char === "buddy") || {}).content === "REWRITTEN: climbing went great", "the rewrite");
  must(asks("You're texting me first").pop().json.messages.some((x) => x.content.includes("how's the studio?")), "(it saw your message)");
  eq(await when("buddy"), [at("16:00")], "at the same time");
  await d.clock.advance(at("13:10") * 1000 - d.clock.now);
  await chat(d, "back to work", { char: "buddy" });   // 13:10: Leo's 13:30 text waits until 25 minutes after it
  await idle(d);
  eq(await when(leo.id), [at("13:35")], "Leo's waits until 13:35");
  await d.clock.advance(at("13:36") * 1000 - d.clock.now);
  eq((await thread(d)).filter((x) => x.proactive && x.char === leo.id).map((x) => x.ts), [at("13:35")], "and arrives then");
  await quiet(d);
});

test("quotas: few texts a day (3, all together), 60 minutes between anyone's, 2 h apart per character", async () => {
  const d = await phone();
  eq((await post(d.S, "/api/settings", { life_texts: "few" })).status, 200, "a little");
  for (const name of ["Maya", "Leo", "Ines"])
    await post(d.S, "/api/characters/save", { character: { name, persona: `You are ${name}.`, texts_first: true, texts_per_day: 2 } });
  await chat(d, "hi");
  await d.S.tick();
  eq(asks("Reply with ONLY this JSON").length, 4, "four days planned, one after another");
  const h = (await heldRecs(d)).filter((x) => x.life && x.life.startsWith(DATE)).sort((a, b) => a.at - b.at);
  must(h.length <= 3 && h.length >= 2, "at most 3 texts first today: " + h.length);
  for (let i = 1; i < h.length; i++) must(h[i].at - h[i - 1].at >= 59 * 60 * 1000, "an hour between them");
  const byChar = {};
  for (const x of h) byChar[x.char] = (byChar[x.char] || 0) + 1;
  must(Object.values(byChar).every((n) => n <= 2), "per character at most its own quota");
  await quiet(d);
});

test("/api/lives: the app's view; your edits are canon (a removed event isn't texted about); redo today; start over; forget", async () => {
  const d = await phone();
  await chat(d, "hi");
  await d.S.tick();
  const maya = (await (await post(d.S, "/api/characters/save", { character: { name: "Maya", persona: "You are Maya." } })).json()).character;
  let r = await (await post(d.S, "/api/lives/save", { char: "buddy", about: ["Has a grey cat", "Loves you"], drop: [DATE + "/e2"],
    ties: [{ id: maya.id, know: true, how: "old flatmates" }] })).json();
  eq([r.ok, r.about], [true, ["Has a grey cat"]], "edits kept, nothing about you");
  eq(r.days[0].events.map((e) => e.id), ["e1", "e3", "e4"], "the event removed");
  eq(r.days[0].moments.map((x) => x.state), ["skipped", "pending"], "its moment won't be sent");
  eq((await heldRecs(d)).map((x) => x.life), [DATE + "/m2"], "and its held text is gone");
  eq(r.ties.find((t) => t.id === maya.id), { id: maya.id, name: "Maya", life: true, know: true, how: "old flatmates", by: "you" }, "who knows whom, yours");
  must(d.S.kit().chars[0].life.friends.some((f) => f.name === "Maya" && f.how === "old flatmates"), "friends' days reach the kit");
  fakeTinfoil({ chat: rules({ plan: "not json" }) });
  r = await post(d.S, "/api/lives/today", { char: "buddy" });
  eq(r.status, 503, "redo today: the plan failed, said");
  fakeTinfoil({ chat: rules() });
  r = await post(d.S, "/api/lives/today", { char: "buddy" });
  eq([r.status, (await r.json()).planned_today], [200, true], "redo today");
  r = await (await post(d.S, "/api/lives/reset", { char: "buddy" })).json();
  eq([r.days, r.about, (await heldRecs(d)).length], [[], [], 0], "start over: their days, people and held texts go");
  await d.S.tick();                                     // (planned again when due)
  must((await heldRecs(d)).length > 0, "a new day");
  await chat(d, "remember that I'm vegan"); await d.S.tick();
  r = await (await post(d.S, "/api/characters/forget", { id: "buddy" })).json();
  eq(r.ok, true, "forgotten");
  eq([(await heldRecs(d)).length, (await get(d.S, "/api/lives?char=buddy")).j.days.length, (await get(d.S, "/api/knows?char=buddy")).j.facts.length], [0, 0, 0],
     "the conversation, what was written ahead, their life and what they learned go");
  const lr = (await d.Lib.store.allRecs("learn")).find((x) => x.body.id === "buddy");
  must(lr && lr.body.d.seen >= Math.max(0, ...(await thread(d)).map((m) => m.id)), "learning starts afresh (nothing before is learned)");
  eq((await post(d.S, "/api/lives/save", { char: "nobody" })).status, 404, "no such character");
  await quiet(d);
});

test("redo today or start over after a text first arrived: the one you got stays (ids per plan), after a reload too", async () => {
  const d = await phone();
  await chat(d, "hi");
  await d.S.tick();
  await d.clock.advance(at("12:31") * 1000 - d.clock.now);
  const got = (await thread(d)).filter((x) => x.proactive);
  eq(got.map((x) => [x.life, x.ts]), [[DATE + "/m1", at("12:30")]], "the 12:30 text first arrived");
  eq((await post(d.S, "/api/lives/today", { char: "buddy" })).status, 200, "redo today");
  await waitFor(async () => (await aheadRecs(d)).length === 1, "the new day's text first written ahead");
  const h = await aheadRecs(d);
  eq(h.map((x) => [x.life, x.at / 1000]), [[DATE + "/m1", at("16:00")]], "the new plan's first moment (16:00) is m1 again");
  must(h[0].cid !== got[0].cid, "with an id of its own");
  const keep = async (env) => { const r = device(KIT, env, { clock: d.clock }); await r.S.init(); return { r, firsts: (await get(r.S, "/api/thread?after=0")).j.filter((x) => x.proactive) }; };
  let again = await keep(d.env);
  eq(again.firsts.map((x) => [x.cid, x.content, x.ts]), [[got[0].cid, got[0].content, at("12:30")]], "after a reload: still there");
  eq((await post(again.r.S, "/api/lives/reset", { char: "buddy" })).status, 200, "start over");
  await again.r.S.tick();
  again = await keep(d.env);
  eq(again.firsts.map((x) => x.cid), [got[0].cid], "start over and a new day: still there");
  await quiet(d);
});

test("a text first being written when you text, forget them or turn lives off is let go (written again with what's true now, or not at all)", async () => {
  const hold = () => {                                  // (the text first's request waits until let go)
    const c = globalThis.__FAKE_TINFOIL__;
    c.chat = c.chat.map((r) => (r.when && r.when.text === "You're texting me first" ? { ...r, hold: "moment" } : r));
    c.hold = { moment: true };
    return () => { c.hold.moment = false; };
  };
  // you text while the 12:30 one is being written (as on the Mac, they then wait 2 hours: it's let go, the 16:00 one
  // is written knowing what you said)
  let d = await phone();
  await chat(d, "hi");
  await d.clock.advance(at("12:05") * 1000 - d.clock.now);
  let go = hold(), t = d.S.tick();
  await waitFor(() => asks("You're texting me first").length === 1, "the 12:30 text first being written");
  await chat(d, "you around? planning the weekend");
  go(); await t;
  eq((await heldRecs(d)).length, 0, "what was written before your message isn't kept");
  eq((await get(d.S, "/api/lives?char=buddy")).j.days[0].moments.map((x) => x.state), ["pending", "pending"], "still to come");
  await d.S.tick();
  eq((await heldRecs(d)).map((x) => x.at / 1000), [at("16:00")], "the 12:30 one isn't sent (2 h after you talked, pick()'s rule), the 16:00 one is written");
  must(asks("You're texting me first").pop().json.messages.some((x) => x.content.includes("planning the weekend")), "knowing what you said");
  await d.clock.advance(at("16:01") * 1000 - d.clock.now);
  eq((await thread(d)).filter((x) => x.proactive).map((x) => x.ts), [at("16:00")], "only the one written after your message arrives");
  await d.S.tick();
  eq((await get(d.S, "/api/lives?char=buddy")).j.days[0].moments.map((x) => x.state), ["skipped", "sent"], "the 12:30 one let go (at the next look)");
  await quiet(d);
  // forgotten while being written: nothing from that conversation comes back
  d = await phone();
  await chat(d, "my SECRET-PLAN-WORDS");
  go = hold(); t = d.S.tick();
  await waitFor(() => asks("You're texting me first").length === 1, "a text first being written");
  eq((await (await post(d.S, "/api/characters/forget", { id: "buddy" })).json()).ok, true, "forgotten");
  go(); await t;
  eq((await heldRecs(d)).length, 0, "nothing written ahead from the forgotten conversation");
  await d.clock.advance(at("16:30") * 1000 - d.clock.now);
  eq((await thread(d)).filter((x) => x.proactive).length, 0, "and nothing arrives");
  must(!dumpText(d.env).includes("SECRET-PLAN") && (await d.Lib.store.allRecs("msg")).length === 0, "nothing of it stored");
  await quiet(d);
  // lives turned off while being written
  d = await phone();
  await chat(d, "hi");
  go = hold(); t = d.S.tick();
  await waitFor(() => asks("You're texting me first").length === 1, "a text first being written");
  eq((await post(d.S, "/api/settings", { lives: false })).status, 200, "lives off");
  go(); await t;
  await d.clock.advance(at("16:30") * 1000 - d.clock.now);
  eq([(await heldRecs(d)).length, (await thread(d)).filter((x) => x.proactive).length], [0, 0], "nothing written ahead, nothing arrives");
  await quiet(d);
});

test("turning off 'can text me first' or their life, or fewer texts a day, drops texts first written ahead; checked again when one is due", async () => {
  const d = await phone();
  await chat(d, "hi");
  await d.S.tick();
  eq((await heldRecs(d)).map((x) => x.life), [DATE + "/m1", DATE + "/m2"], "two written ahead");
  eq((await post(d.S, "/api/characters/save", { character: { id: "buddy", texts_per_day: 1 } })).status, 200, "one a day");
  eq((await heldRecs(d)).map((x) => x.life), [DATE + "/m1"], "the later one goes");
  eq((await post(d.S, "/api/characters/save", { character: { id: "buddy", texts_per_day: 2, texts_first: false } })).status, 200, "texting first off");
  eq((await heldRecs(d)).length, 0, "the rest go");
  eq((await get(d.S, "/api/lives?char=buddy")).j.days[0].moments.map((x) => x.state), ["skipped", "skipped"], "skipped");
  await d.clock.advance(at("16:30") * 1000 - d.clock.now);
  eq((await thread(d)).filter((x) => x.proactive).length, 0, "nothing arrives");
  await quiet(d);
  // their life off
  const e = await phone();
  await chat(e, "hi"); await e.S.tick();
  eq((await post(e.S, "/api/characters/save", { character: { id: "buddy", life: false } })).status, 200, "no life of their own");
  eq((await heldRecs(e)).length, 0, "texts first about it go");
  await quiet(e);
  // a change that comes another way (here a restored backup; later sync): checked when it's due
  const a = await phone();
  eq((await post(a.S, "/api/characters/save", { character: { id: "buddy", texts_first: false } })).status, 200, "the other phone: off");
  const k = await a.S.makeBackupKey(); await a.S.confirmBackupKey(k.groups[13]);
  const file = (await a.S.exportFile()).blob;
  const b = await phone({ clock: a.clock });
  await chat(b, "hi"); await b.S.tick();
  eq((await heldRecs(b)).length, 2, "two written ahead here");
  await b.S.importFile(file, k.text);
  await b.clock.advance(at("16:30") * 1000 - b.clock.now);
  eq((await thread(b)).filter((x) => x.proactive).length, 0, "texting first is off now: they don't arrive");
  await waitFor(async () => (await heldRecs(b)).length === 0, "let go");
  eq((await get(b.S, "/api/lives?char=buddy")).j.days[0].moments.map((x) => x.state), ["skipped", "skipped"], "skipped");
  await quiet(b);
});

test("texting someone else right before a text first that would then fall in quiet hours lets it go (as pick() would)", async () => {
  const d = await phone({ plan: PLAN([{ at: "22:40", event: 4, angle: "share" }]) });
  const leo = (await (await post(d.S, "/api/characters/save", { character: { name: "Leo", persona: "You are Leo." } })).json()).character;
  await chat(d, "hi");
  await d.S.tick();
  eq((await heldRecs(d)).map((x) => x.at / 1000), [at("22:40")], "Buddy's 22:40 text first written ahead");
  await d.clock.advance(at("22:36") * 1000 - d.clock.now);
  await chat(d, "evening leo", { char: leo.id });
  await idle(d);
  await waitFor(async () => (await heldRecs(d)).length === 0, "not moved to 23:01 (quiet hours)");
  eq((await get(d.S, "/api/lives?char=buddy")).j.days[0].moments.map((x) => x.state), ["skipped"], "skipped");
  await d.clock.advance(at("23:40") * 1000 - d.clock.now);
  eq((await thread(d)).filter((x) => x.proactive).length, 0, "nothing in quiet hours");
  await quiet(d);
});

test("a private chat: a late answer held in memory only; nothing of it reaches storage", async () => {
  const d = await phone();
  await chat(d, "hey", { private: true });
  await d.clock.advance(3 * 3600 * 1000);
  random(d, [0.1]);
  sseNext(["PRIVATE-LATE-ANSWER"]);
  eq(await chat(d, "SECRET-PRIVATE-WORDS", { private: true }), [{ later: 96 }], "held");
  await idle(d);
  eq((await heldRecs(d)).length, 0, "not stored");
  await d.clock.advance(100 * 1000);
  const a = (await thread(d)).filter((m) => m.role === "assistant").pop();
  eq([a.content, a.private], ["PRIVATE-LATE-ANSWER", true], "shown at its time, private");
  const dump = dumpText(d.env);
  must(!dump.includes("PRIVATE-LATE") && !dump.includes("SECRET-PRIVATE"), "nothing private stored");
  await d.S.tick();
  eq(asks("Facts check").length, 0, "never learned from");
});

await run();
