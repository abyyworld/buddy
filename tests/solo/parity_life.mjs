// Buddy for phones parity, node side, for P1c: web/solo/life.js (lives.py, buddy_server.reply_delay / life_busy /
// follow_up / first_text's cleanup) and web/solo/facts.js's learning (facts.learn and its guards) on the cases that
// tests/test_solo_lives.py built with the real Python: the same inputs, the same random numbers (a fixed stream fed
// to both sides: Python's uniform(a, b) is a + (b - a) * random()), the same home time zone. Input on stdin: {kit, tz,
// cases: {family: [case, ...]}}; prints every mismatch; exit code 1 on any. Fake data only. Run by the Python test.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const ROOT = new URL("../../", import.meta.url).pathname;
const sb = { TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto, URL, Blob, Response, ReadableStream, DOMException, Intl,
  CompressionStream, DecompressionStream, structuredClone, setTimeout, clearTimeout };
vm.createContext(sb);
for (const f of ["bcrypto", "edition", "chars", "facts", "life"]) new vm.Script(readFileSync(ROOT + `web/solo/${f}.js`, "utf8"), { filename: f }).runInContext(sb);
new vm.Script(readFileSync(ROOT + "web/direct.js", "utf8"), { filename: "direct.js" }).runInContext(sb);
const { facts: F, life: LF } = sb.BuddySoloLib;
const P = sb.BuddyDirect._pure;
const { kit, tz, cases } = JSON.parse(readFileSync(0, "utf8"));
const T = kit.templates;

let n = 0, bad = 0;
const J = (x) => JSON.stringify(x === undefined ? null : x);
function check(kind, got, want, ctx) {
  n++;
  if (J(got) === J(want)) return;
  bad++;
  if (bad <= 40) console.log(`MISMATCH ${kind}: ${J(ctx).slice(0, 400)}\n  got:  ${J(got).slice(0, 900)}\n  want: ${J(want).slice(0, 900)}`);
}
const fam = (name) => cases[name] || [];
function stream(vals) {                                  // the same random numbers Python drew, in order
  let i = 0;
  const random = () => { if (i >= vals.length) throw new Error("stream ran out"); return vals[i++]; };
  return { random, uniform: (a, b) => a + (b - a) * random(), used: () => i };
}
const attempt = (fn) => { try { return { ok: fn() }; } catch (e) { return { error: String(e && e.message) }; } };
const charsMap = (list) => Object.fromEntries(list.map((c) => [c.id, c]));

// ---------- lives.py ----------
for (const c of fam("sources")) check("sources", c.which === "facts" ? F.SOURCES[c.name] : LF.SOURCES[c.name], c.out, c.name);
for (const c of fam("constants")) check("constants", c.name.split(".").reduce((o, k) => o[k], { LF, F, STOP: [...F.STOP].sort(), NOT_NAMES: [...F.NOT_NAMES].sort(), STARTERS: [...F.STARTERS].sort() }), c.out, c.name);
for (const c of fam("s")) check("s", [LF.s_(c.in, c.n), LF.mine(c.in), LF.ownSentences(c.in, c.n), LF.hhmm(c.in)], c.out, c.in);
for (const c of fam("clean")) { const r = attempt(() => LF.clean(c.log, c.cid)); check("clean", r.error ? { error: true } : r.ok, c.error ? { error: true } : c.out, c.log); }
for (const c of fam("time")) {
  check("time", { date: LF.lifeDate(c.t, tz), hm: LF.hm(c.t, tz), dhm: LF.dayHm(c.t, tz), quiet: LF.quietAt(c.t, c.cfg, tz), season: LF.season(c.t, tz) }, c.out, c);
}
for (const c of fam("ts")) check("ts", LF.ts(c.date, c.hhmm, tz), c.out, c);
for (const c of fam("happened")) check("happened", LF.happened(c.e, c.t, tz), c.out, c);
for (const c of fam("rhythm")) {
  const rh = LF.rhythm(c.msgs, c.t, tz);
  check("rhythm", [rh === null ? null : Object.fromEntries(Object.entries(rh).map(([k, v]) => [k, v])), LF.activeText(rh, c.cfg)], c.out, c.t);
}
for (const c of fam("nudge")) {
  const r = stream(c.stream);
  check("nudge", [LF.nudge(c.due, c.rh, c.cfg, c.earliest, r, tz), r.used()], c.out, c);
}
for (const c of fam("plan_prompt")) {
  const r = LF.planPrompt(T.plan, c.char, c.log, c.t, c.cfg, { ownYesterday: c.yday, nMoments: c.n, photos: c.photos, ownToday: c.today,
    friends: c.friends, strangers: c.strangers, active: c.active, voice: c.voice, sigNow: c.sig, tz });
  check("plan_prompt", [r.prompt, r.fold], c.out, { char: c.char.id, t: c.t });
}
for (const c of fam("sig")) check("sig", await LF.sig(c.char), c.out, c.char);
for (const c of fam("apply_plan")) {
  const r = stream(c.stream);
  const got = attempt(() => LF.applyPlan(c.log, c.j, c.char, c.t, c.cfg, { nMoments: c.n, othersDue: c.others, photos: c.photos, rnd: r, rh: c.rh, voice: c.voice, sigNow: c.sig, tz }));
  check("apply_plan", got.error ? { error: true } : [got.ok, r.used()], c.error ? { error: true } : [c.out, c.used], { t: c.t, j: c.j });
}
for (const c of fam("parse")) { const r = attempt(() => LF.parse(c.in)); check("parse", r.error ? { error: true } : r.ok, c.error ? { error: true } : c.out, c.in); }
for (const c of fam("quota")) check("quota", LF.quota(c.char, c.cfg, c.un), c.out, c);
for (const c of fam("pick")) {
  const [cid, m, exp] = LF.pick(c.logs, charsMap(c.chars), c.t, c.cfg, c.st, tz, c.ahead || 0);
  check("pick", [cid, m ? m.id : null, exp], c.out, { t: c.t, st: c.st });
}
for (const c of fam("needs_plan")) check("needs_plan", LF.needsPlan(c.log, c.char, c.cfg, c.t, c.st, tz, c.lazy), c.out, c);
for (const c of fam("thread_state")) check("thread_state", LF.threadState(c.msgs, c.t, tz), c.out, c.t);
for (const c of fam("mark")) check("mark", LF.mark(JSON.parse(J(c.log)), c.date, c.mid, c.state, c.msg), c.out, c);
for (const c of fam("attempted")) check("attempted", LF.attempted(JSON.parse(J(c.log)), c.t, tz).attempt, c.out, c);
for (const c of fam("edit")) check("edit", LF.edit(c.log, c.cid, c.j, c.t), c.out, c.j);
for (const c of fam("slim")) check("slim", LF.slim(c.log, c.t, c.friend, tz), c.out, c.t);
for (const c of fam("friends")) check("friends", LF.friendsText(c.cid, c.chars, c.logs, c.t, c.w, c.avoid, tz), c.out, c.cid);
for (const c of fam("without")) check("without", LF.without(c.lg, c.avoid), c.out, c.avoid);
for (const c of fam("ties")) {
  const w = LF.world(c.ties);
  check("ties", [w, LF.ties(c.cid, c.chars, w).map(([x, how]) => [x.id, how]), LF.undecided(c.cid, c.chars, w).map((x) => x.id)], c.out, c.cid);
}
for (const c of fam("decide")) {                         // the plan's "know" answers, applied one by one as set_tie would
  const w = { ...LF.world(c.ties) };
  for (const ch of LF.decide(c.cid, c.j, c.others, w)) { if (ch.v === null) delete w[ch.k]; else w[ch.k] = ch.v; }
  check("decide", w, c.out, c.j);
}
for (const c of fam("set_tie")) {
  const w = { ...LF.world(c.ties) }, ch = LF.setTie(w, c.a, c.b, c.know, c.how, c.by);
  if (ch) { if (ch.v === null) delete w[ch.k]; else w[ch.k] = ch.v; }
  check("set_tie", [!!ch, w], c.out, c);
}
for (const c of fam("moment_prompt")) check("moment_prompt", LF.momentPrompt(T.moment, c.log, c.date, c.m, c.t, c.photos, tz), c.out, c.m);
for (const c of fam("instruction")) check("instruction", LF.instruction(T, c.char, c.log, c.date, c.m, c.t, false, c.idle, tz), c.out, c.m);
for (const c of fam("on_track")) check("on_track", [LF.keepsOnTrack(c.char), LF.followUp(T.proactive, c.char, false), LF.followUp(T.proactive, c.char, true)], c.out, c.char);
for (const c of fam("first_clean")) check("first_clean", LF.cleanFirst(P.noTags(P.picTags(c.in)[0])), c.out, c.in);
for (const c of fam("life_busy")) check("life_busy", LF.lifeBusy(c.char, c.log, c.t, c.cfg, tz), c.out, c.t);
for (const c of fam("reply_delay")) {
  const r = stream(c.stream);
  check("reply_delay", [LF.replyDelay(c.char, c.via, c.thread, c.t, c.cfg, c.busy, r), r.used()], c.out, { t: c.t, via: c.via });
}
for (const c of fam("late_note")) check("late_note", LF.lateNote(kit.prompts.late_note, c.busy), c.out, c.busy);
for (const c of fam("schedule")) {                       // Python's minute loop of pick() against schedule()
  const r = LF.schedule(c.logs, charsMap(c.chars), c.t, c.cfg, c.msgs, tz, c.horizon);
  check("schedule", r.send.map((x) => [x.cid, x.date, x.mid, x.at]), c.out, { t: c.t });
}
for (const c of fam("info")) check("info", LF.info(c.char, c.log, LF.world(c.ties), c.chars, c.cfg, c.t, tz), c.out, c.char.id);

// ---------- facts.py's learning ----------
for (const c of fam("lwords")) check("lwords", [F.words(c.in), F.remembered(c.in)], c.out, c.in);
for (const c of fam("ok_text")) check("ok_text", F.okText(c.in, c.char), c.out, c);
for (const c of fam("yours")) check("yours", F.yours(c.t, F.heard(c.said)), c.out, c);
for (const c of fam("near")) check("near", F.near(c.a, await F.fid(c.a), c.b, await F.fid(c.b)), c.out, c);
for (const c of fam("parse_reply")) {
  let got;
  try { const r = F.parseReply(c.in); got = [r.adds, r.ups, r.rems]; } catch (e) { got = { bad: true }; }
  check("parse_reply", got, c.out, c.in);
}
for (const c of fam("relevant")) check("relevant", F.relevant(c.known, c.new, c.newest, c.most).map(([, f]) => f.id), c.out, c.known.length);
for (const c of fam("due")) check("due", F.due(c.cid, F.cstate(c.st, 0), c.runs, c.msgs, c.t, c.urgent, c.busy), c.out, c);
for (const c of fam("learn")) {                          // learning runs one after another, with recorded Advisor replies
  let lists = { own: null, shared: null }, st = F.cstate(null, c.boot), i = 0;
  const hlc = () => `${String(1760000000000 + ++i).padStart(13, "0")}:0000:test`;
  const got = [];
  for (const step of c.steps) {
    for (const ed of step.edits || []) {                  // (your own sheet edits in between)
      const j = { ...ed };
      if (j.id && j.id.startsWith("@")) j.id = (F.listing(c.char.id, lists.own, lists.shared, c.shared_on).find((f) => f.text === j.id.slice(1)) || { id: "missing" }).id;
      try { const r = await F.change(c.char, j, lists, { hlc, today: c.today, sharedOn: c.shared_on }); for (const [o, d] of Object.entries(r.changed)) { if (o === c.char.id) lists.own = d; else lists.shared = d; } }
      catch (e) { /* (the Python side skips it too) */ }
    }
    const asked = [];
    const r = await F.learnRun({ tpl: T.learn.extract, char: c.char, st, msgs: step.msgs, lists: async () => lists, sharedOn: c.shared_on,
      ask: async (p) => { asked.push(p); if (step.reply === null) throw new Error("unreachable"); return step.reply; },
      now: step.t, ctx: { hlc, today: c.today }, stillThere: (m) => !step.gone });
    for (const [o, d] of Object.entries(r.changed)) { if (o === c.char.id) lists.own = d; else lists.shared = d; }
    st = r.st;
    got.push({ n: r.n, asked, more: r.more, listing: F.listing(c.char.id, lists.own, lists.shared, c.shared_on),
               state: { seen: st.seen, fails: st.fails, next: st.next, last: st.last, off: st.off } });
  }
  check("learn", got, c.out, c.name);
}

console.log(`${n - bad}/${n} cases match`);
process.exit(bad ? 1 : 0);
