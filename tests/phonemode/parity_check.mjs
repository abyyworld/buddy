// Phone-mode parity, node side: runs web/direct.js's pure ports (BuddyDirect._pure, loaded in a vm) on the cases that
// tests/test_phonemode_parity.py built with the real Python functions (fake data only) and prints every mismatch.
// Input on stdin: {kit, cases: {family: [case, ...]}}. Exit code 1 on any mismatch. Run by the Python test, not by hand.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../web/direct.js", import.meta.url), "utf8");
const sandbox = { TextEncoder, TextDecoder, atob, btoa, crypto, URL, Blob, Response, ReadableStream, DOMException,
  setTimeout, clearTimeout };
vm.createContext(sandbox);
new vm.Script(src, { filename: "direct.js" }).runInContext(sandbox);
const P = sandbox.BuddyDirect._pure;

const { kit, cases } = JSON.parse(readFileSync(0, "utf8"));
const kc = (id) => kit.chars.find((c) => c.id === id);
let n = 0, bad = 0;
const J = (x) => JSON.stringify(x === undefined ? null : x);
function check(kind, got, want, ctx) {
  n++;
  if (J(got) === J(want)) return;
  bad++;
  if (bad <= 40) console.log(`MISMATCH ${kind}: ${J(ctx).slice(0, 300)}\n  got:  ${J(got).slice(0, 600)}\n  want: ${J(want).slice(0, 600)}`);
}
const fam = (name) => cases[name] || [];
const u = (x) => (x === null ? undefined : x);
const bytes = (b64) => P.unb64(b64);

for (const c of fam("spoken")) check("spoken", P.spoken(c.in), c.out, c.in);
for (const c of fam("split")) {
  const lines = [];
  const sp = new P.Splitter(c.via, c.asking ? null : P.longEnough(kit, c.text, c.via), (s, p) => lines.push(p ? { s, p: 1 } : { s }));
  const st = P.sseState();
  let stop = false;
  const each = (d) => { sp.add(d); if (sp.stopped) { stop = true; return false; } return true; };
  for (const ch of c.chunks) { P.sseFeed(st, ch, each); if (stop) break; }
  if (!stop) P.sseEnd(st, each);
  sp.end();
  const rx = sp.reacts.map(P.reaction).find(Boolean);
  if (rx && c.via !== "call") lines.push({ react: rx });
  check("split", { lines, content: sp.full.length ? sp.said(c.via, false) : null }, { lines: c.lines, content: c.content }, [c.via, c.text, c.chunks.join("").slice(0, 120)]);
}
for (const c of fam("astext")) check("astext", P.asText(c.m), c.out, c.m);
for (const c of fam("recent")) check("recent", P.recentMessages(c.thread, c.n, c.priv, c.char), c.out, [c.char, c.n, c.priv]);
for (const c of fam("context")) check("context", P.recentMessages(c.msgs, 30, false, c.char), c.out, c.char);
for (const c of fam("alternate")) check("alternate", P.alternate(c.in), c.out, c.in);
for (const c of fam("edits")) check("edits", P.applyCallEdits(c.msgs, u(c.heard), u(c.opened)), c.out, c);
for (const c of fam("query")) check("query", P.queryOf(c.msgs), c.out, c.msgs);
for (const c of fam("heard")) { const r = P.heardOf(kit.prompts, c.msgs, c.desc, c.text); check("heard", [r.msgs, r.turn], c.out, c); }
for (const c of fam("words")) check("words", P.words(c.in), c.out, c.in);
for (const c of fam("facts")) {
  const r = P.factsForPrompt(kc(c.char), c.query, c.call, c.everything, kit.facts_paths);
  check("facts", [r.known, r.sources], c.out, [c.char, c.query, c.call, c.everything]);
}
for (const c of fam("knowsq")) check("knowsq", P.isKnowsQuestion(c.in), c.out, c.in);
for (const c of fam("voiceask")) check("voiceask", P.VOICE_ASK.test(c.in), c.out, c.in);
for (const c of fam("detail")) check("detail", P.DETAIL.test(c.in), c.out, c.in);
for (const c of fam("pictags")) check("pictags", P.picTags(c.in, c.final, c.line), c.out, [c.in, c.final, c.line]);
for (const c of fam("notags")) check("notags", P.noTags(c.in), c.out, c.in);
for (const c of fam("picopen")) check("picopen", P.PIC_OPEN.test(c.in), c.out, c.in);
for (const c of fam("deep")) check("deep", P.deepQuestion(c.in), c.out, c.in);
for (const c of fam("length")) check("length", P.lengthHint(kit, c.in, c.via), c.out, [c.in, c.via]);
for (const c of fam("cap")) check("cap", P.longEnough(kit, c.in, c.via), c.out, [c.in, c.via]);
for (const c of fam("reaction")) check("reaction", P.reaction(c.in), c.out, c.in);
for (const c of fam("rlately")) check("rlately", P.reactedLately(c.thread, c.char), c.out, [c.char, c.thread.length]);
for (const c of fam("now")) check("now", P.nowString(c.t, kit.tz), c.out, c.t);
for (const c of fam("lifedate")) check("lifedate", P.lifeDate(c.t, kit.tz), c.out, c.t);
for (const c of fam("since")) check("since", P.sinceLastTalk(c.last, c.t, c.role), c.out, c);
for (const c of fam("life")) {
  const ch = kc(c.char);
  check("life", P.lifeContext(ch.life.log, c.t, c.short, ch.life.friends, kit.tz), c.out, [c.char, c.t, c.short]);
}
for (const c of fam("prompt")) {
  const kchar = kc(c.char), turn = c.photo ? [kit.prompts.photo_safety].concat(c.cant_see ? [kit.prompts.cant_see] : []) : [];
  const r = P.systemPrompt({ kit, kchar, modeUsed: c.mode, via: c.via, extra: turn, query: c.query, asking: c.asking,
    lastTs: c.last_ts, lastRole: c.last_role, nowSec: c.t, length: c.asking ? "" : P.lengthHint(kit, c.text, c.via), partner: u(c.partner) });
  check("prompt", [r.text, r.used], [c.out, c.used], [c.char, c.mode, c.via, c.asking, c.photo, c.cant_see, c.t]);
}
const am = kit.models.always_thinks;
for (const c of fam("pick")) check("pick", P.pickModel(c.pref, c.fb, c.ids, c.spoken, am), c.out, c);
for (const c of fam("brain")) check("brain", P.brain(kit, c.mode, kc(c.char), c.ids, c.spoken), c.out, c);
for (const c of fam("extras")) check("extras", P.chatExtras(kit, c.model, c.via, new Set(c.refused), c.via !== "call" && P.deepQuestion(c.text)), c.out, c);
for (const c of fam("sttmodel")) check("sttmodel", P.sttModel(c.chosen, c.down, kit.models.stt, kit.models.stt_next), c.out, c);
for (const c of fam("vision")) check("vision", P.visionModels(c.ids, c.meta, kit.models.vision_order, c.no_vision, c.t, kit.models.always_thinks), c.out, c);
for (const c of fam("billing")) check("billing", P.creditsKind(c.code, c.text), c.out, c);
for (const c of fam("romance")) check("romance", P.romanceText(kit.edition, c.partner, c.t), c.out, c);
for (const c of fam("ptag")) check("ptag", [...c.in.matchAll(P.PARTNER_TAG)].map((m) => m[1]), c.out, c.in);
for (const c of fam("vfail")) check("vfail", P.visionFailedUntil(c.code, c.t), c.out, c);
for (const c of fam("describe")) {
  const ex = c.refused ? {} : (kit.models.no_thinking[c.model] || {});
  check("describe", [P.describeBody(kit, c.model, c.view, ex), P.cleanDescription(c.content)], [c.body, c.desc], [c.model, c.refused]);
}
for (const c of fam("tts")) {
  const r = P.ttsRequest(kit, c.text, c.voice, c.stream, new Set(c.refused));
  check("tts", r ? r.body : null, c.out, [c.voice, c.text.slice(0, 40), c.stream, c.refused]);
}
for (const c of fam("voicereply")) check("voicereply", P.voiceReplyBody(kit, c.text, c.voice), c.out, [c.voice, c.text.slice(0, 40)]);
for (const c of fam("stock")) check("stock", P.isStock(kit, P.cp(P.spoken(c.text), 2000)), c.out, c.text);
for (const c of fam("stt")) {
  const b = P.sttMultipart({ model: c.model, prompt: c.prompt, language: c.language, ct: c.ct, data: bytes(c.data), boundary: c.boundary });
  check("stt", P.b64(b), c.out, [c.ct, c.prompt, c.language]);
}
for (const c of fam("gone")) check("gone", P.WHISPER_GONE.test(c.in), c.out, c.in);
for (const c of fam("photo")) {
  let got;
  try { const r = P.cleanPhoto(bytes(c.in), c.max_side, c.max_bytes); got = { b64: P.b64(r.bytes), w: r.w, h: r.h }; }
  catch (e) { got = null; }
  check("photo", got, c.out, c.name);
}
for (const c of fam("audio")) check("audio", [P.audioMime(bytes(c.in)), P.wavSeconds(bytes(c.in))], [c.mime, c.secs], c.name);

console.log(`${n - bad}/${n} cases match`);
process.exit(bad ? 1 : 0);
