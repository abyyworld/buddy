// Buddy for phones: what each character knows about you (facts.py ported, parity-tested against the Python): the sheet
// (facts.change's add, edit, delete, move, show and clear, with clean_text and the SECRET guard) and learning
// (facts.learn with every guard: secretish, _ok_text, _yours, _near, relevant, _parse_reply, _apply, due's debounce,
// UNSAY, tombstones and set-asides). Part of window.BuddySoloLib. Pure: the engine (engine.js) keeps the records and
// the bookmark, asks the Advisor through direct.js's verified Tinfoil path and writes what comes back.
// On the phone a list is a record, not a file: facts:<owner> (owner = a character id or "_everyone") holds
//   items  {fid: {text, date, how: "learned"|"added", from, hlc, o}}   (o: its place in the list, as a file's line)
//   del    {fid: hlc}         deleted (or replaced): never learned again, and an add with a newer clock brings it back
//   aside  {fid: [hlc, {char: new fid | ""}]}   a fact a character learned had changed (set aside for it only)
// fid = facts.fid: the first 10 hex of SHA-1 of the normalised text.
// Learning's bookmark (a learn:<char> record, ids only): {seen: the newest page id it learned from (the Mac's message
// id), off, last, fails, next, why, pre, claim}; "gone" (facts._gone) is a list's del; facts._state's over[char] is the
// aside entries naming that character.
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});
  const P = () => L.chars;
  const MAX_FACTS = 300, MAX_LEN = 300;
  const EVERYONE = "_everyone";
  const SECRET_SRC = String.raw`\b(?:passwords?|pass ?words?|passcodes?|pass ?codes?|pass ?phrases?|passwd|pwd?|pins?|pin ?codes?|cv` +
    String.raw`v2?|cvc2?|security codes?|iban|sort codes?|routing numbers?|account numbers?|card numbers?|social se` +
    String.raw`curity|ssn|api ?keys?|secret ?keys?|private ?keys?|seed phrases?|recovery (?:phrases?|codes?)|2fa|ot` +
    String.raw`p|one-time codes?|log[ -]?ins?|login codes?|credentials?|maiden names?|memorable (?:words?|answers?|` +
    String.raw`info\w*|names?|dates?)|security (?:questions?|answers?)|(?:door|gate|alarm|garage|safe|locker|lock|e` +
    String.raw`ntry|access|wi-?fi|wlan|router|network|verification|bank|building|key ?safe|lock ?box|key ?box) ?(?:` +
    String.raw`codes?|keys?|pins?|passwords?)|(?:phone|laptop|computer|tablet|ipad|mac)(?:'s)? (?:unlock|codes?|pin` +
    String.raw`s?|passcodes?|passwords?)|unlock (?:codes?|patterns?|pins?|numbers?|passwords?)|(?:lock|locker|safe|` +
    String.raw`padlock|suitcase|bike|door|gate) ?combinations?|combinations? (?:is|to|for|lock|code)|passports? (?:` +
    String.raw`numbers?|no|nr)|licen[cs]es? (?:numbers?|no|nr)|national (?:id|identity|insurance) (?:numbers?|no|nr` +
    String.raw`|cards?)|national id|ni (?:numbers?|no)|nino|tax (?:ids?|numbers?|codes?|reference)|bank (?:details|` +
    String.raw`logins?))\b|\b\d{3}-\d{2}-\d{4}\b|\bend(?:s|ing|ed)? (?:in|with) (?!(?:19|20)\d\d\b(?![ ./-]?\d))\d{` +
    String.raw`4}\b|\b(?:card|visa|mastercard|amex|debit|credit)\b[^.!?\n]{0,30}?\bend(?:s|ing)? (?:in|with) \d{4}` +
    String.raw`\b|\b(?:exp(?:ires?|iry|iration|\.)?|valid (?:until|thru|through))(?: date| on| is)*:? ?\d{1,2} ?/ ?` +
    String.raw`\d{2,4}\b|\b\d{3,4} on the back\b|\b(?:codes?|numbers?|nos?\.|nr|pins?|unlock\w*|combinations?|passc` +
    String.raw`odes?|passwords?)\W+(?:\w+\W+){0,3}?[a-z]*(?!(?:19|20)\d\d\b(?![ ./-]?\d))\d(?:[ ./-]?\d){3,}|(?!(?:` +
    String.raw`19|20)\d\d\b(?![ ./-]?\d))\d(?:[ ./-]?\d){3,}\W+(?:\w+\W+){0,2}?(?:codes?|numbers?|nos?\.|nr|pins?|u` +
    String.raw`nlock\w*|combinations?|passcodes?|passwords?)\b|\b(?:codes?|numbers?|nos?\.|nr|pins?|unlock\w*|combi` +
    String.raw`nations?|passcodes?|passwords?)(?:\W+\w+){0,3}? ?(?:\bis|\bwas|=|:) ?\d(?:[ ./-]?\d){3,}|(?:\d[ -]?)` +
    String.raw`{12,19}|\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30}\b|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za` +
    String.raw`-z0-9_-]{20,}\b|\b(?:sk|pk|ghp|xox[abp])[-_][A-Za-z0-9]{8,}`;
  const SUFFIX_SRC = String.raw`\s*\((learned|added) (\d{4}-\d{2}-\d{2})(?: from ([^()]{1,40}))?\)\s*$`;
  let RX = null;
  const rx = () => RX || (RX = { secret: P().pyRe(SECRET_SRC, "i"), suffix: P().pyRe(SUFFIX_SRC, "g"), nonword: P().pyRe("\\W+", "g"),
    crlf: /[\r\n\t]/g, html: /[<>`]/g, md: /!\[|\]\(|\[\[|\]\]/g, ws: P().pyRe("\\s+", "g"),
    lead: P().pyRe("^(?:[-*+]\\s+|\\[[ xX]\\]\\s+)+", "") });
  const apos = (t) => String(t == null ? "" : t).replace(/[’‘]/g, "'");
  const fold = (t) => P().foldI(apos(t));              // (for case-blind checks only: İ/ı as Python's re.I sees them)
  const secretish = (text) => rx().secret.test(fold(text));
  const norm = (text) => P().pyStrip(String(text).toLowerCase().replace(/’/g, "'").replace(rx().nonword, " "));
  async function fid(text) {
    const h = new Uint8Array(await root.crypto.subtle.digest("SHA-1", new TextEncoder().encode(norm(text))));
    return Array.from(h.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function badInput(text) { const e = new Error(text); e.status = 400; return e; }
  function cleanText(text) {                            // one line, nothing a preview could load or run, at most 300
    const p = P();
    let t = (p.truthy(text) ? p.pyStr(text) : "").replace(rx().crlf, " ");
    t = t.replace(rx().html, "").replace(rx().md, " ");
    t = p.pyStrip(t.replace(rx().ws, " "));
    t = p.pyStrip(t.replace(rx().suffix, "").replace(rx().lead, ""));
    const n = p.cpLen(t);
    if (n < 1 || n > MAX_LEN) throw badInput("Keep it to one line of up to 300 characters.");
    return t;
  }

  // ---------- one list (a facts record's data) ----------
  const empty = (owner) => ({ owner, items: {}, del: {}, aside: {} });
  const isOwner = (o) => o === EVERYONE || /^[a-z0-9-]{1,40}$/.test(String(o || ""));
  function itemsOf(d) {                                 // visible items in list order: [{id, text, by, date, from}]
    if (!d) return [];
    return Object.entries(d.items || {}).filter(([id, it]) => it && !(d.del && d.del[id] && d.del[id] >= it.hlc))
      .sort((a, b) => (a[1].o - b[1].o) || (a[0] < b[0] ? -1 : 1))
      .map(([id, it]) => ({ id, text: it.text, by: it.how === "learned" ? "chat" : "you", date: it.date || "", from: it.from || "" }));
  }
  function setAside(cid, own, recs) {                   // {fid: "replaced"|"dropped"} for this character (facts._set_aside)
    const ids = new Set(own.map((f) => f.id)), out = {};
    for (const d of recs) for (const [f, v] of Object.entries((d && d.aside) || {})) {
      const n = v && v[1] && P().hasOwn(v[1], cid) ? v[1][cid] : undefined;
      if (n === undefined) continue;
      if (!n || ids.has(n)) out[f] = n ? "replaced" : "dropped";
    }
    return out;
  }
  // own: this character's list, shared: _everyone's; sharedOn: false when it sees only its own (facts' scope "none")
  function visible(cid, own, shared, sharedOn) {
    const o = itemsOf(own), s = sharedOn ? itemsOf(shared) : [], aside = setAside(cid, o, [own, shared]);
    const keep = (fs) => fs.filter((f) => !aside[f.id]);
    return { own: keep(o), shared: keep(s) };
  }
  function listing(cid, own, shared, sharedOn) {        // every own fact, then every shared one (flagged when hidden)
    const o = itemsOf(own), aside = setAside(cid, o, [own, shared]), out = [];
    for (const [file, fs] of [["mine", o], ["everyone", itemsOf(shared)]])
      for (const f of fs) {
        const row = { ...f, file, hidden: false };
        if (file === "everyone" && !sharedOn) Object.assign(row, { hidden: true, why: "scope" });
        else if (aside[f.id]) Object.assign(row, { hidden: true, why: aside[f.id] });
        out.push(row);
      }
    return out;
  }

  // A set-aside taken back: the entry stays, dated now ({} = nothing set aside), so a merge with an older copy (a restored
  // backup, later sync: the newer entry wins) doesn't set it aside again
  function unset(aside, f, cid, ctx) {
    const a = aside[f], m = { ...((a && a[1]) || {}) };
    delete m[cid];
    aside[f] = [ctx.hlc(), m];
  }

  // ---------- facts.change: one edit from the sheet ----------
  // lists: {own, shared} (record data or null); ctx: {hlc(), today: "YYYY-MM-DD", sharedOn}
  // -> {changed: {owner: data}, listing}; throws {status: 400} for bad input, {status: 409} when the fact is gone
  async function change(char, j, lists, ctx) {
    const cid = char.id, op = j && j.op;
    const data = { [cid]: lists.own ? structuredClone(lists.own) : empty(cid),
                   [EVERYONE]: lists.shared ? structuredClone(lists.shared) : empty(EVERYONE) };
    const changed = new Set();
    const ownerOf = (file) => { if (file === "mine") return cid; if (file === "everyone") return EVERYONE; throw badInput("file must be mine or everyone"); };
    const full = (owner) => badInput((owner === EVERYONE ? "The shared list" : `${char.name}'s list`) + " is full: delete some first.");
    const text = () => {
      const t = cleanText(j.text);
      if (secretish(t)) throw badInput("That looks like a password, code or card number. Buddy never keeps those.");
      return t;
    };
    const nextO = (d) => Object.values(d.items).reduce((m, it) => Math.max(m, it.o || 0), 0) + 1;
    const visibleIds = (d) => itemsOf(d).map((f) => f.id);
    const gone = () => { const e = new Error("changed"); e.status = 409; return e; };
    const id = String((j && j.id) || "");
    if (op === "add") {
      const t = text(), owner = ownerOf(j.to === undefined ? "mine" : j.to), d = data[owner], f = await fid(t);
      if (d.del[f]) { delete d.del[f]; changed.add(owner); }            // saying it yourself un-deletes it
      if (!visibleIds(d).includes(f)) {
        if (visibleIds(d).length >= MAX_FACTS) throw full(owner);
        d.items[f] = { text: t, date: ctx.today, how: "added", from: "", hlc: ctx.hlc(), o: nextO(d) };
        changed.add(owner);
      }
    } else if (op === "show") {                         // give a set-aside fact back to this character
      for (const owner of [cid, EVERYONE]) {
        const a = data[owner].aside[id];
        if (a && a[1] && P().hasOwn(a[1], cid)) { unset(data[owner].aside, id, cid, ctx); changed.add(owner); }
      }
    } else if (op === "edit" || op === "delete" || op === "move") {
      const owner = ownerOf(j.file), d = data[owner];
      if (!visibleIds(d).includes(id)) throw gone();
      const old = d.items[id];
      if (op === "edit") {
        const t = text(), f = await fid(t);
        delete d.items[id];
        if (f !== id) d.del[id] = ctx.hlc();
        delete d.del[f];
        d.items[f] = { text: t, date: ctx.today, how: "added", from: "", hlc: ctx.hlc(), o: old.o };
        changed.add(owner);
      } else if (op === "delete") {
        delete d.items[id]; d.del[id] = ctx.hlc(); changed.add(owner);
      } else {
        const to = ownerOf(j.to);
        if (to === owner) throw badInput("It's already there.");
        const td = data[to];
        if (!visibleIds(td).includes(id)) {
          if (visibleIds(td).length >= MAX_FACTS) throw full(to);
          delete td.del[id];
          td.items[id] = { ...old, hlc: ctx.hlc(), o: nextO(td) };
          changed.add(to);
        }
        delete d.items[id]; d.del[id] = ctx.hlc(); changed.add(owner);   // (gone from here: an older copy doesn't bring it back)
      }
    } else if (op === "clear") {
      if (j.file !== "mine") throw badInput("Only a character's own list can be cleared.");
      const d = data[cid];
      for (const f of visibleIds(d)) d.del[f] = ctx.hlc();
      d.items = {};
      for (const f of Object.keys(d.aside)) d.aside[f] = [ctx.hlc(), {}];   // (dated: nothing set aside, newer than any copy)
      for (const [f, a] of Object.entries(data[EVERYONE].aside)) if (a && a[1] && P().hasOwn(a[1], cid)) unset(data[EVERYONE].aside, f, cid, ctx);
      changed.add(cid); changed.add(EVERYONE);
    } else throw badInput("unknown op");
    const out = {};
    for (const o of changed) out[o] = data[o];
    return { changed: out, listing: listing(cid, data[cid], data[EVERYONE], ctx.sharedOn) };
  }

  // ---------- learning (facts.learn and its guards) ----------
  // memory.STOP and memory._words (the words that carry meaning), facts.py's patterns verbatim (translated by pyRe)
  const STOP = new Set(("a an and are as at be but by for from had has have he her his i if in into is it its me my of on or our " +
    "she so that the their them there they this to was we were what when where which who will with you your am do did not " +
    "just about how why can could would should been being than then too very also any all").split(" "));
  const NOT_NAMES = new Set(("i i'm i've i'd i'll january february march april may june july august september october november " +
    "december monday tuesday wednesday thursday friday saturday sunday").split(" "));
  const STARTERS = new Set([...STOP, ...("every each since last next both most some usually sometimes often always never today " +
    "tomorrow yesterday once twice until during after before right now currently recently lately").split(" ")]);
  const FIRST_PERSON_SRC = String.raw`\b(?:i|i'm|i've|i'd|i'll|me|my|mine|myself)\b`;
  const ABOUT_THEM_SRC = String.raw`\b(?:you|your|you're|yours|yourself)\b`;
  const REMEMBER_SRC = String.raw`\b(?:remember|don't forget|do not forget|keep in mind|forget (?:that|about|it)|(?:that's|it's|is) not true|no longer|not any ?more)\b`;
  const UNSAY_SRC = String.raw`\b(?:forget|no longer|not true|n't true|not right|wrong|any ?more|used to|stopped|quit|left|ended|broke up|divorced|moved|sold|gave up|delete|remove|scratch that)\b`;
  let LX = null;
  const lx = () => LX || (LX = { first: P().pyRe(FIRST_PERSON_SRC, "i"), them: P().pyRe(ABOUT_THEM_SRC, "i"),
    remember: P().pyRe(REMEMBER_SRC, "i"), unsay: P().pyRe(UNSAY_SRC, "i"), w: P().pyRe("\\w+", "g"),
    tok: P().pyRe("\\w[\\w'-]*", "g"), s: P().pyRe("'s$", "") });
  const lower = (t) => String(t).toLowerCase();
  const words = (t) => (lower(t).match(lx().w) || []).filter((w) => !STOP.has(w) && P().cpLen(w) > 1);   // memory._words
  const remembered = (text) => lx().remember.test(fold(text));                    // facts.remember_asked
  const UPPER = /^\p{Uppercase}/u;                                                 // (str.isupper of one character)

  function learnable(m, cid) {                          // facts._learnable (and never one still held back)
    return !!m && (P().hasOwn(m, "char") ? m.char : "buddy") === cid && (m.role === "user" || m.role === "assistant") &&
      !m.private && !m.life && !m.held && !!P().pyStrip(String(m.content == null ? "" : m.content));
  }
  const pending = (cid, msgs, seen) => msgs.filter((m) => learnable(m, cid) && m.id > seen && m.role === "user").length;
  function near(a, fa, b, fb) {                         // facts._near: the same fact in other words (80% of words in common)
    if (fa === fb) return true;
    const x = new Set(words(a)), y = new Set(words(b));
    if (!x.size || !y.size) return false;
    let both = 0; for (const w of x) if (y.has(w)) both++;
    return both / (x.size + y.size - both) >= 0.8;
  }
  function badReply() { const e = new Error("bad reply"); e.bad = true; return e; }
  function parseReply(txt) {                            // facts._parse_reply -> {adds, ups: [[ref, text]], rems}
    txt = String(txt == null ? "" : txt);
    const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
    if (a < 0 || b < 0) throw badReply();
    let j;
    try { j = JSON.parse(txt.slice(a, b + 1)); } catch (e) { throw badReply(); }
    const get = (k) => (P().hasOwn(j, k) ? j[k] : []);
    if (!j || typeof j !== "object" || Array.isArray(j) || !["add", "update", "remove"].every((k) => Array.isArray(get(k)))) throw badReply();
    const adds = get("add").filter((x) => typeof x === "string").slice(0, 20);
    const ups = get("update").filter((u) => u && typeof u === "object" && !Array.isArray(u) && typeof u.text === "string")
      .map((u) => [P().pyStr(P().hasOwn(u, "id") ? u.id : null), u.text]).slice(0, 20);
    const rems = get("remove").filter((r) => typeof r === "string" || typeof r === "boolean" || (typeof r === "number" && Number.isInteger(r)))
      .map((r) => P().pyStr(r)).slice(0, 20);
    return { adds, ups, rems };
  }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  function okText(t, char) {                            // facts._ok_text (the phone has no avoid list)
    try { t = cleanText(t); } catch (e) { return null; }
    const n = P().cpLen(t);
    if (n < 3 || n > 200 || secretish(t)) return null;
    const a = fold(t);
    if (!lx().first.test(a) || lx().them.test(a)) return null;
    const name = P().foldI(P().pyStrip(P().truthy(char.name) ? P().pyStr(char.name) : ""));
    if (name && new RegExp("^" + reEsc(name) + "(?![\\p{L}\\p{N}_])", "iu").test(a)) return null;
    return t;
  }
  function heard(said) {                                // facts._heard: what you said, and the starts of its words
    const t = lower(apos(said)), content = words(t).filter((w) => P().cpLen(w) >= 3);
    return { all: new Set(t.match(lx().w) || []), four: new Set(content.filter((w) => P().cpLen(w) >= 4).map((w) => P().cp(w, 4))),
             three: new Set(content.filter((w) => P().cpLen(w) === 3)), start3: new Set(content.map((w) => P().cp(w, 3))) };
  }
  function saidIt(w, h) {                               // facts._said
    if (h.all.has(w)) return true;
    const n = P().cpLen(w);
    return (n >= 4 && (h.four.has(P().cp(w, 4)) || h.three.has(P().cp(w, 3)))) || (n === 3 && h.start3.has(w));
  }
  function yours(t, h) {                                // facts._yours: from what you said, every name said by you
    const a = apos(t);
    if (!words(a).some((w) => saidIt(w, h))) return false;
    const toks = a.match(lx().tok) || [];
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i].replace(lx().s, ""), wl = lower(w);
      if (UPPER.test(w) && !NOT_NAMES.has(wl) && !(i === 0 && STARTERS.has(wl)))
        if (!(wl.match(lx().w) || []).every((x) => saidIt(x, h))) return false;
    }
    return true;
  }
  function relevant(known, newMsgs, newest = 60, most = 200) {   // facts.relevant
    if (known.length <= most) return known.slice();
    const ws = new Set(words(newMsgs.map((m) => String(m.content == null ? "" : m.content)).join(" ")));
    const hits = known.map(([, f]) => { let n = 0; for (const w of new Set(words(f.text))) if (ws.has(w)) n++; return n; });
    const idx = known.map((_, i) => i);
    const young = idx.slice().sort((i, j) => { const a = known[i][1].date || "", b = known[j][1].date || ""; return a < b ? 1 : a > b ? -1 : j - i; }).slice(0, newest);
    const close = idx.filter((i) => hits[i]).sort((i, j) => hits[j] - hits[i] || j - i);
    const pick = [...new Set([...young, ...close])].slice(0, most).sort((a, b) => a - b);
    return pick.map((i) => known[i]);
  }
  function cstate(rec, boot) {                          // facts._cstate: a character's bookmark, with its defaults
    const r = rec && typeof rec === "object" ? rec : {};
    const num = (k, d) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? r[k] : d);
    return { seen: num("seen", boot || 0), off: num("off", 0), last: num("last", 0), fails: num("fails", 0), next: num("next", 0),
             why: typeof r.why === "string" ? r.why : "", pre: !!r.pre, claim: r.claim || null };
  }
  // one learning run's question (facts.learn up to the ask) -> null (nothing new you said) or
  // {prompt, batch, rest, fmap: {f1: {owner, id}}, said, last}; msgs: the conversation by page id (held ones left out)
  function learnPlan(tpl, char, st, msgs, lists, sharedOn) {
    const cid = char.id, seen = st.seen, off = st.off || 0;
    const mine = msgs.filter((m) => learnable(m, cid));
    const fresh = mine.filter((m) => m.id > seen);
    const before = mine.filter((m) => m.id <= seen && m.role === "user").map((m) => m.id);
    if (off && before.length && before[before.length - 1] <= off)
      while (fresh.length && fresh[0].role === "assistant") fresh.shift();   // (replies to what you said while learning was off)
    if (!fresh.some((m) => m.role === "user")) return null;
    const batch = fresh.slice(0, 40), rest = fresh.slice(40);
    const ctx = mine.filter((m) => off < m.id && m.id <= seen).slice(-4);
    const say = (m) => (m.role === "user" ? "Me" : char.name) + ": " + P().cp(P().pyStr(m.content), 1000);
    const v = visible(cid, lists.own, lists.shared, sharedOn);
    const known = relevant(v.own.map((f) => ["mine", f]).concat(v.shared.map((f) => ["everyone", f])), batch);
    const fmap = {};
    known.forEach(([file, f], i) => { fmap["f" + (i + 1)] = { owner: file === "everyone" ? EVERYONE : cid, id: f.id }; });
    const prompt = P().pyFormat(tpl, { name: char.name, known: known.map(([, f], i) => `f${i + 1}. ${f.text}`).join("\n") || "(none yet)",
      context: ctx.map(say).join("\n") || "(nothing)", new: batch.map(say).join("\n") });
    const said = batch.filter((m) => m.role === "user").map((m) => P().cp(P().pyStr(m.content), 1000)).join("\n");
    return { prompt, batch, rest, fmap, said, last: batch[batch.length - 1] };
  }
  // facts._apply on the lists as they are now: learning writes only this character's own list (a fact it learned is
  // changed in place there; one you wrote, or a shared one, is set aside for it only and its newer version goes in its
  // own list); every fact from what you said; removes only when you said it's no longer so; tombstones block relearning.
  // ctx: {hlc(), today}. -> {n, changed: {owner: data}}
  async function applyLearned(char, r, fmap, said, lists, ctx) {
    const cid = char.id, h = heard(said);
    const own = lists.own ? structuredClone(lists.own) : empty(cid), sh = lists.shared ? structuredClone(lists.shared) : empty(EVERYONE);
    const recs = { [cid]: own, [EVERYONE]: sh }, touched = new Set();
    const facts = itemsOf(own), shared = itemsOf(sh);
    const isGone = (f) => [own, sh].some((d) => d.del[f] && !(d.items[f] && d.items[f].hlc > d.del[f]));
    const there = new Map();                           // "owner|id" -> {owner, f}
    for (const [owner, fs] of [[cid, facts], [EVERYONE, shared]]) for (const f of fs) if (!there.has(owner + "|" + f.id)) there.set(owner + "|" + f.id, { owner, f });
    const keyOf = (ref) => (P().hasOwn(fmap, ref) ? fmap[ref].owner + "|" + fmap[ref].id : null);
    const edits = new Map();                           // updates and removes: only facts it was shown, still there
    for (const [ref, t0] of r.ups) {
      const key = keyOf(ref), t = okText(t0, char);
      if (!key || !there.has(key) || !t || !yours(t, h)) continue;
      const ft = await fid(t);
      if (ft !== there.get(key).f.id && !isGone(ft) && !edits.has(key) && edits.size < 5) edits.set(key, t);
    }
    const nUp = edits.size;
    if (lx().unsay.test(fold(said)))
      for (const ref of r.rems) { const key = keyOf(ref); if (key && there.has(key) && !edits.has(key) && edits.size - nUp < 5) edits.set(key, null); }
    const have = [];
    for (const f of facts.concat(shared)) have.push({ text: f.text, id: f.id });
    const over = new Map();                            // old id -> its newer version's id ("": dropped), for this character
    for (const d of [own, sh]) for (const [f, a] of Object.entries(d.aside || {}))
      if (a && a[1] && P().hasOwn(a[1], cid)) over.set(f, { v: a[1][cid], h: a[0], owner: d === own ? cid : EVERYONE });
    const overSet = (oldId, owner, v) => { over.delete(oldId); over.set(oldId, { v, h: ctx.hlc(), owner, changed: true }); };
    let changed = 0, nAdd = 0;
    const put = [], add = [];                          // own learned facts rewritten (text null: deleted); new facts
    for (const [key, t] of edits) {
      const { owner, f } = there.get(key);
      if (owner === cid && f.by === "chat") {          // something it learned itself: changed in place
        put.push({ f, t }); changed++;
        if (t) { const nf = await fid(t); for (const [k, o] of [...over]) if (o.v === f.id) overSet(k, o.owner, nf); }
      } else if (t === null) { overSet(f.id, owner, ""); changed++; }          // yours or shared: set aside for it only
      else {
        const ft = await fid(t);
        if (!have.some((x) => x.text !== f.text && near(t, ft, x.text, x.id)) && facts.length + add.length < MAX_FACTS) {
          add.push({ t, id: ft }); have.push({ text: t, id: ft }); overSet(f.id, owner, ft); changed++;
        }
      }
    }
    for (const t0 of r.adds) {
      const t = okText(t0, char);
      if (!t || !yours(t, h)) continue;
      const ft = await fid(t);
      if (isGone(ft) || facts.length + add.length >= MAX_FACTS || nAdd >= 5 || have.some((x) => near(t, ft, x.text, x.id))) continue;
      add.push({ t, id: ft }); have.push({ text: t, id: ft }); changed++; nAdd++;
    }
    if (put.length || add.length) {
      for (const { f, t } of put) {
        const old = own.items[f.id];
        delete own.items[f.id]; own.del[f.id] = ctx.hlc();                       // (gone: never learned again)
        if (t !== null) { const nf = await fid(t); delete own.del[nf]; own.items[nf] = { text: t, date: ctx.today, how: "learned", from: "", hlc: ctx.hlc(), o: old ? old.o : 0 }; }
      }
      let o = Object.values(own.items).reduce((m, it) => Math.max(m, it.o || 0), 0);
      for (const { t, id } of add) own.items[id] = { text: t, date: ctx.today, how: "learned", from: "", hlc: ctx.hlc(), o: ++o };
      touched.add(cid);
    }
    if (edits.size) {                                  // (the set-asides, newest 300 kept)
      const all = [...over].map(([k, o], i) => ({ k, o, i }));
      const keep = new Set(all.slice(Math.max(0, all.length - 300)).map((x) => x.k));
      for (const d of [own, sh]) {
        const owner = d === own ? cid : EVERYONE;
        for (const [f, a] of Object.entries(d.aside || {})) {
          if (!a || !a[1] || !P().hasOwn(a[1], cid)) continue;
          if (!over.has(f) || !keep.has(f) || over.get(f).owner !== owner) { delete a[1][cid]; if (!Object.keys(a[1]).length) delete d.aside[f]; touched.add(owner); }
        }
      }
      for (const [k, o] of over) {
        if (!o.changed || !keep.has(k)) continue;
        const d = recs[o.owner], a = d.aside[k] || [o.h, {}];
        a[1] = { ...a[1], [cid]: o.v }; a[0] = o.h; d.aside[k] = a; touched.add(o.owner);
      }
    }
    const out = {};
    for (const o of touched) out[o] = recs[o];
    return { n: changed, changed: out };
  }
  function failed(st, now, advance, why = "", pre = false) {   // facts._failed: back off (4 min, doubling, an hour at most)
    const c = { ...st, fails: (st.fails || 0) + 1, last: now };
    c.next = now + Math.min(3600, 120 * 2 ** Math.min(c.fails, 12));
    c.why = why; c.pre = pre;
    if (advance !== null && advance !== undefined && c.fails >= 3) { c.seen = Math.max(c.seen, advance); c.fails = 0; }
    return c;
  }
  // facts.due: urgent (you asked to remember something) 20 s after the last run; else 2 min after it, and only once
  // you've said 6 things or the conversation has paused for 4 minutes; never during a call with them (unless urgent),
  // during backoff, or past 30 runs an hour. runs: the times of the runs in the last hour (all characters).
  function due(cid, st, runs, msgs, now, urgent, busy) {
    const next = st.pre && st.fails ? 0 : st.next || 0;   // (nothing on a phone can block saving: a pre-check failure retries)
    if (now < next || runs.filter((t) => t > now - 3600).length >= 30) return false;
    const users = pending(cid, msgs, st.seen);
    if (!users) return false;
    const since = now - (st.last || 0);
    if (urgent) return since >= 20;
    if (busy || since < 120) return false;
    let newest = 0;
    for (const m of msgs) if ((P().hasOwn(m, "char") ? m.char : "buddy") === cid && m.ts > newest) newest = m.ts;
    return users >= 6 || now - newest >= 240;
  }
  function skipTo(cid, st, msgs) {                      // facts._skip: learning is off: the bookmark moves past what's said
    let top = 0;
    for (const m of msgs) if (learnable(m, cid) && m.id > top) top = m.id;
    return top > st.seen ? { ...st, seen: top, off: top } : null;
  }

  // one learning run (facts.learn after its on/off and "already running" checks): the new messages since the bookmark
  // to the Advisor with the facts it keeps, the answer checked here before anything is written. o: {tpl (the kit's
  // EXTRACT), char, st (cstate), msgs, lists: () -> the lists as they are now (read again after the answer),
  // sharedOn, ask: (prompt) -> text, now, ctx {hlc, today}, stillThere: (message) -> bool (false: you deleted that
  // conversation while the Advisor was answering, so nothing is written), locked?: (fn) -> runs fn (read the lists,
  // check, change) and saves what it changed as one step}. -> {ran, st, n, changed: {owner: data},
  // asked, more} (ran: a run to count toward the 30 an hour; more: messages left for the next run)
  async function learnRun(o) {
    const st = o.st, plan = learnPlan(o.tpl, o.char, st, o.msgs, await o.lists(), o.sharedOn);
    if (!plan) return { ran: false, st, n: 0, changed: {}, asked: null, more: false };
    const done = (st2, n, changed) => ({ ran: true, st: st2, n, changed: changed || {}, asked: plan.prompt, more: n !== null && plan.rest.length > 0 });
    let reply;
    try { reply = await o.ask(plan.prompt); }
    catch (e) { if (e && e.name === "AbortError") throw e; return { ...done(failed(st, o.now, null), 0), more: false, error: e }; }   // (can't reach Tinfoil: later)
    let r;
    try { r = parseReply(reply); } catch (e) { return { ...done(failed(st, o.now, plan.last.id), 0), more: false }; }   // (3 odd replies: move on)
    const apply = async () => (!o.stillThere || o.stillThere(plan.last) ? applyLearned(o.char, r, plan.fmap, plan.said, await o.lists(), o.ctx) : { n: 0, changed: {} });
    let res;
    try { res = o.locked ? await o.locked(apply) : await apply(); }    // (locked: read, check and save as one step)
    catch (e) { return { ...done(failed(st, o.now, null, "Buddy couldn't save what it learned."), 0), more: false }; }
    return done({ ...st, seen: Math.max(st.seen, plan.last.id), fails: 0, next: 0, last: o.now, why: "", pre: false }, res.n, res.changed);
  }

  L.facts = { EVERYONE, MAX_FACTS, MAX_LEN, SOURCES: { SECRET: SECRET_SRC, SUFFIX: SUFFIX_SRC, FIRST_PERSON: FIRST_PERSON_SRC,
                ABOUT_THEM: ABOUT_THEM_SRC, REMEMBER: REMEMBER_SRC, UNSAY: UNSAY_SRC },
              STOP, NOT_NAMES, STARTERS, secretish, unset, norm, fid, cleanText, empty, isOwner, itemsOf, visible, listing, change,
              words, remembered, learnable, pending, near, parseReply, okText, heard, saidIt, yours, relevant, cstate,
              learnPlan, applyLearned, learnRun, failed, due, skipTo };
})(typeof window !== "undefined" ? window : globalThis);
