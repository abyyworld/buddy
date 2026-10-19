// Buddy for phones: each character's own life, texts first and real timing (lives.py and buddy_server's reply_delay,
// life_busy, follow_up and first_text's cleanup, ported; parity-tested against the Python with the same RNG streams,
// tests/test_solo_lives.py). Part of window.BuddySoloLib. Pure: every function takes the time (`now`, seconds), the
// home time zone (`tz`: Settings' zone, else this phone's) and, where Python draws random numbers, an `rnd` with
// random() and uniform(a, b) (= a + (b - a) * random(), as Python's). The engine (engine.js) keeps the records, plans a
// day with the character's brain through direct.js's verified Tinfoil path, writes moments ahead and shows held
// messages at their time. What the phone adds to lives.py:
//   - moments written ahead keep the held message's id (`cid`, made from the character, date and moment: two devices
//     writing the same moment collide on one id) and a state "scheduled" between pending and sent
//   - schedule(): Python's minute-by-minute pick(), run ahead of time over the next 48 hours, so the phone knows which
//     moments still stand and when each would be sent, and can write them before then
// Nothing about you is ever written into a life (_mine drops anything addressed to or about "you", and any minor).
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});
  const P = () => L.chars;
  const MAX_DAYS = 14, MAX_WEEKS = 12, MAX_MONTHS = 24, FOLD_DAYS = 7, FOLD_WEEKS = 4;
  const KINDS = ["mundane", "work", "social", "hobby", "errand", "rest", "notable", "setback"];
  const ANGLES = ["share", "vent", "ask", "photo", "voice", "about_you"];
  const QUOTA = { few: 1, some: 2, lots: 4 }, GLOBAL_CAP = { few: 3, some: 6, lots: 10 };
  const LATE = 90 * 60, DAY_STARTS = 4, RETRY = 20 * 60, HORIZON = 48 * 3600;
  const STATES = ["pending", "scheduled", "sent", "skipped"];
  // lives.py's patterns, verbatim (translated by pyRe: \b \w \d \s as Python means them)
  const OWNER_SRC = String.raw`(?<![\w'])(?:you|your|yours|you're|youre|you've|you'll|u|ur|the user)(?![\w'])`;
  const HHMM_SRC = String.raw`^\s*([01]?\d|2[0-3])[:.h]([0-5]\d)\s*$`;
  const MINOR_SRC = String.raw`\b(child(ren)?|kids?|toddlers?|teen(age[rd]?|s)?|minors?|under ?age|school ?(girl|boy|uniform)s?|` +
    String.raw`high ?school|little (girl|boy)|young (girl|boy)|(1[0-7]|[1-9]) ?(yo|y/o|years? ?old)|aged? (1[0-7]|[1-9])\b|preteen|` +
    String.raw`loli(ta)?|shota|child-?like|jailbait|barely legal|young-looking)\b`;
  const ON_TRACK_SRC = String.raw`\b(?:remind(?:s|ing)?\s+me\s+to\b|keep(?:s|ing)?\s+(?:me|you)\s+(?:on\s+track|accountable)|` +
    String.raw`hold(?:s|ing)?\s+(?:me|you)\s+(?:accountable|to\s+(?:what|my|it|that|account)\b)|` +
    String.raw`follow(?:s|ing)?\s+up\s+on\s+(?:what\s+i\b|whether\s+i\b|if\s+i\b|what\s+you\b|whether\s+you\b))`;
  let RX = null;
  const rx = () => RX || (RX = { owner: P().pyRe(OWNER_SRC, "i"), hhmm: P().pyRe(HHMM_SRC, ""), minor: P().pyRe(MINOR_SRC, "i"),
    onTrack: P().pyRe(ON_TRACK_SRC, "i"), tags: P().pyRe("\\[[^\\]]*\\]|[*_#`]", "g"), ws: P().pyRe("\\s+", "g"),
    sent: P().pyRe("(?<=[.!?])\\s+", ""), sp: /[ \t]+/g, dayIso: /^\d{4}-\d\d-\d\d$/, eid: /^e\d{1,2}$/, cid: /^[A-Za-z0-9_-]{16,64}$/ });
  const has = (o, k) => P().hasOwn(o, k);
  const get = (o, k, d) => (has(o, k) ? o[k] : d);
  const isDict = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const str = (x) => P().pyStr(x);
  const truthy = (x) => P().truthy(x);
  const pyInt = (x) => Number.isInteger(x) && typeof x !== "boolean";
  function pyRound(x) {                                 // round() (half to even)
    const f = Math.floor(x), d = x - f;
    return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  }
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  function pyFloat(x) {                                 // float(x or 0) for what JSON can hold (a bad one raises)
    if (!truthy(x)) return 0;
    if (typeof x === "number") return x;
    if (typeof x === "boolean") return x ? 1 : 0;
    const t = String(x).trim();
    if (typeof x === "string" && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
    throw new Error("float");
  }
  const sliceList = (x, a, b) => {                      // (x or [])[a:b] for a JSON value (a string slices to letters)
    if (!truthy(x)) return [];
    if (Array.isArray(x)) return x.slice(a, b);
    if (typeof x === "string") return Array.from(x).slice(a, b);
    throw new Error("not a list");
  };
  const tail = (x, n) => (n <= 0 ? x.slice() : x.slice(-n));   // x[-n:]

  // ---------- one clean line ----------
  const s_ = (x, n) => P().cp(P().pyStrip(str(truthy(x) ? x : "").replace(rx().tags, "").replace(rx().ws, " ")), n);   // lives._s
  const fi = (t) => P().foldI(t);                       // (İ/ı as i for the case-blind checks, as Python's re.I)
  const mine = (text) => !!text && !rx().owner.test(fi(text)) && !rx().minor.test(fi(text));                        // lives._mine
  const ownSentences = (text, n) => s_(s_(text, 2000).split(rx().sent).filter(mine).join(" "), n);                  // _own_sentences

  // ---------- time, in the home zone (time.localtime / datetime(...).timestamp(), DST as Python handles it) ----------
  const fmts = new Map();
  function fmtOf(tz) {
    if (fmts.has(tz)) return fmts.get(tz);
    const o = { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" };
    let f;
    try { f = new Intl.DateTimeFormat("en-US", tz ? { ...o, timeZone: tz } : o); }
    catch (e) { f = new Intl.DateTimeFormat("en-US", o); }   // (a zone this browser doesn't know: the phone's own)
    fmts.set(tz, f); return f;
  }
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const memo = new Map();                               // (zone|minute -> its wall clock: offsets only change on a minute)
  function lt(ts, tz) {                                 // time.localtime(ts): {y, mo, d, h, mi, s, wd (Monday 0), yday}
    const u = Math.floor(ts), m0 = Math.floor(u / 60) * 60, key = (tz || "") + "|" + m0;
    let w = memo.get(key);
    if (!w) {
      const p = {};
      for (const x of fmtOf(tz || "").formatToParts(new Date(m0 * 1000))) p[x.type] = x.value;
      const y = +p.year, mo = +p.month, d = +p.day, day0 = Date.UTC(y, mo - 1, d);
      w = { y, mo, d, h: +p.hour % 24, mi: +p.minute, wd: (new Date(day0).getUTCDay() + 6) % 7, yday: Math.round((day0 - Date.UTC(y, 0, 1)) / 86400000) + 1 };
      if (memo.size > 50000) memo.clear();
      memo.set(key, w);
    }
    return { ...w, s: u - m0 };
  }
  function wallSec(u, tz) { const t = lt(u, tz); return Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s) / 1000; }
  function mk(y, mo, d, h, mi, tz) {                    // a wall-clock time there -> epoch (CPython's local_to_seconds, fold 0)
    const t = Date.UTC(y, mo - 1, d, h, mi) / 1000, local = (u) => wallSec(u, tz);
    const a = local(t) - t, u1 = t - a, t1 = local(u1);
    let b;
    if (t1 === t) { const u2 = u1 - 86400; b = local(u2) - u2; if (a === b) return u1; }
    else b = t1 - u1;
    const u2 = t - b, t2 = local(u2);
    if (t2 === t) return u2;
    if (t1 === t) return u1;
    return Math.max(u1, u2);                            // (in a gap: as Python does)
  }
  const p2 = (n) => String(n).padStart(2, "0");
  const iso = (y, mo, d) => `${String(y).padStart(4, "0")}-${p2(mo)}-${p2(d)}`;
  function addDays(dateIso, n) { const [y, mo, d] = dateIso.split("-").map(Number), t = new Date(Date.UTC(y, mo - 1, d) + n * 86400000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  const weekdayOf = (dateIso) => { const [y, mo, d] = dateIso.split("-").map(Number); return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7; };
  function lifeDate(now, tz) {                          // 00:00-03:59 still belongs to yesterday (night owls)
    const t = lt(now, tz), x = new Date(Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi) - DAY_STARTS * 3600000);
    return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
  }
  const hm = (ts, tz) => { const t = lt(ts, tz); return `${p2(t.h)}:${p2(t.mi)}`; };            // strftime("%H:%M")
  const dayHm = (ts, tz) => { const t = lt(ts, tz); return `${DAYS[t.wd]} ${p2(t.h)}:${p2(t.mi)}`; };   // "%A %H:%M"
  function quietH(h, cfg) {
    const a = get(cfg, "quiet_from", 23.0), b = get(cfg, "quiet_until", 8.5);
    return a > b ? h >= a || h < b : a <= h && h < b;
  }
  const quietAt = (ts, cfg, tz) => { const t = lt(ts, tz); return quietH(t.h + t.mi / 60, cfg); };   // lives.quiet_at
  function ts(dateIso, hhmm, tz) {                      // lives._ts: 00:00-03:59 is the next calendar day
    const [h, m] = hhmm.split(":").map(Number), d = h < DAY_STARTS ? addDays(dateIso, 1) : dateIso, [y, mo, dd] = d.split("-").map(Number);
    return mk(y, mo, dd, h, m, tz);
  }
  const late = (x) => (Number(x.slice(0, 2)) >= DAY_STARTS ? x : `${Number(x.slice(0, 2)) + 24}${x.slice(2)}`);   // lives._late
  const happened = (e, now, tz) => late(e.at) <= late(hm(now, tz));
  function hhmm(x) { const m = rx().hhmm.exec(str(truthy(x) ? x : "")); return m ? `${p2(Number(m[1]))}:${m[2]}` : null; }

  // ---------- a log: only bounded, well-formed values (lives.clean) ----------
  const empty = (cid) => ({ v: 1, char: cid, sig: "", about: [], people: [], ongoing: [], days: [], weeks: [], months: [], calls: {},
                            edited: 0, attempt: { date: "", n: 0, at: 0 } });
  function clean(log, cid) {
    log = isDict(log) ? log : {};
    const out = empty(cid);
    out.sig = s_(get(log, "sig", null), 32);
    out.about = sliceList(get(log, "about", null), 0, 12).map((x) => s_(x, 160)).filter(mine);
    out.people = sliceList(get(log, "people", null), 0, 8).filter((p) => isDict(p) && s_(get(p, "name", null), 30) && mine(s_(get(p, "who", null), 80)))
      .map((p) => ({ name: s_(get(p, "name", null), 30), who: s_(get(p, "who", null), 80) }));
    out.ongoing = sliceList(get(log, "ongoing", null), 0, 5).filter((o) => isDict(o) && mine(s_(get(o, "what", null), 160)))
      .map((o) => ({ what: s_(get(o, "what", null), 160), since: s_(get(o, "since", null), 10) }));
    const days = [];
    for (const d of tail(sliceList(get(log, "days", null)), MAX_DAYS + FOLD_DAYS)) {
      if (!isDict(d) || !rx().dayIso.test(str(get(d, "date", "")))) continue;
      let ev = sliceList(get(d, "events", null), 0, 8).filter(isDict).map((e, i) => ({
        id: rx().eid.test(str(get(e, "id", null))) ? e.id : `e${i + 1}`, at: hhmm(get(e, "at", null)) || "12:00",
        what: s_(get(e, "what", null), 140), mood: s_(get(e, "mood", null), 30), kind: KINDS.includes(get(e, "kind", null)) ? e.kind : "mundane",
        plan: s_(get(e, "plan", null), 60) }));
      ev = ev.filter((e) => mine(e.what) && !rx().owner.test(fi(e.plan)));
      const ids = new Set(ev.map((e) => e.id));
      const mo = sliceList(get(d, "moments", null), 0, 5).filter(isDict).map((m, i) => {
        const x = { id: s_(get(m, "id", null), 6) || `m${i + 1}`, event: ids.has(get(m, "event", null)) ? m.event : null,
          at: hhmm(get(m, "at", null)) || "12:00", due: pyFloat(get(m, "due", null)), angle: ANGLES.includes(get(m, "angle", null)) ? m.angle : "share",
          state: STATES.includes(get(m, "state", null)) ? m.state : "skipped", msg: pyInt(get(m, "msg", null)) ? m.msg : null };
        if (rx().cid.test(str(get(m, "cid", "")))) x.cid = m.cid;     // (the phone: the held message written ahead)
        return x;
      });
      const evs = ev.slice().sort((a, b) => { const ka = [Number(a.at.slice(0, 2)) < DAY_STARTS ? 1 : 0, a.at], kb = [Number(b.at.slice(0, 2)) < DAY_STARTS ? 1 : 0, b.at];
        return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0); });
      days.push({ date: d.date, to: s_(get(d, "to", null), 10), summary: ownSentences(get(d, "summary", null), 300), final: truthy(get(d, "final", null)),
        moments: mo, events: evs, planned: pyFloat(get(d, "planned", null)), tries: Math.trunc(pyFloat(get(d, "tries", null))) });
    }
    out.days = days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    out.weeks = tail(sliceList(get(log, "weeks", null)), MAX_WEEKS + FOLD_WEEKS).filter(isDict)
      .map((w) => ({ from: s_(get(w, "from", null), 10), to: s_(get(w, "to", null), 10), summary: ownSentences(get(w, "summary", null), 400) }));
    out.months = tail(sliceList(get(log, "months", null)), MAX_MONTHS).filter(isDict)
      .map((m) => ({ month: s_(get(m, "month", null), 7), summary: ownSentences(get(m, "summary", null), 500) }));
    const calls = isDict(get(log, "calls", null)) ? log.calls : {};
    out.calls = {};
    for (const [k, v] of tail(Object.entries(calls), 3)) if (rx().dayIso.test(k) && pyInt(v)) out.calls[k] = v;
    out.edited = pyFloat(get(log, "edited", null));
    const a = isDict(get(log, "attempt", null)) ? log.attempt : {};
    const an = truthy(get(a, "n", null)) ? a.n : 0;
    out.attempt = { date: rx().dayIso.test(str(get(a, "date", ""))) ? a.date : "", n: /^[0-9]+$/.test(str(an)) && !(typeof an === "boolean") ? Number(an) : 0,
                    at: pyFloat(get(a, "at", null)) };
    return out;
  }
  const day = (log, dateIso) => log.days.find((d) => d.date === dateIso) || null;
  function edit(log, cid, j, now) {                     // lives.edit: your changes from the app (canon)
    log = clean(log, cid);
    if (Array.isArray(get(j, "about", null))) log.about = j.about;
    if (Array.isArray(get(j, "people", null))) log.people = j.people;
    if (Array.isArray(get(j, "ongoing", null))) log.ongoing = j.ongoing.map((o) => (isDict(o) ? o : { what: o, since: "" }));
    const days = isDict(get(j, "days", null)) ? j.days : {};
    const drop = Array.isArray(get(j, "drop", null)) ? new Set(j.drop.map(str)) : new Set();
    for (const d of log.days) {
      if (typeof get(days, d.date, null) === "string") d.summary = days[d.date];
      d.events = d.events.filter((e) => !drop.has(`${d.date}/${e.id}`));
      const ids = new Set(d.events.map((e) => e.id));
      for (const m of d.moments) if (m.event && !ids.has(m.event) && (m.state === "pending" || m.state === "scheduled")) m.state = "skipped";
    }
    log.edited = now;
    return clean(log, cid);
  }
  function mark(log, dateIso, mid, state, msg) {
    for (const d of log.days) if (d.date === dateIso) for (const m of d.moments) if (m.id === mid) { m.state = state; if (pyInt(msg)) m.msg = msg; }
    return log;
  }
  function attempted(log, now, tz) {
    const today = lifeDate(now, tz), a = log.attempt || {};
    log.attempt = { date: today, n: (a.date === today ? a.n || 0 : 0) + 1, at: now };
    return log;
  }

  // ---------- who knows whom (tie records: {"a+b": {know, how, by}}) ----------
  const pair = (a, b) => [a, b].sort().join("+");
  function world(ties) {                                // lives.world over the tie records
    const out = {};
    for (const [k, v] of Object.entries(ties || {})) {
      if (!isDict(v) || !/^[a-z0-9-]{1,40}\+[a-z0-9-]{1,40}$/.test(k)) continue;
      const know = v.know === true || v.know === false ? v.know : null;
      out[k] = { know, how: know ? s_(get(v, "how", null), 90) : "", by: v.by === "you" ? "you" : "ai" };
    }
    return out;
  }
  const okId = (x) => /^[a-z0-9-]{1,40}$/.test(String(x));
  function setTie(w, a, b, know, how = "", by = "you") {   // lives.set_tie -> the changed entry {k, v (null: removed)}, or null
    if (a === b || !(okId(a) && okId(b))) return null;
    const k = pair(a, b);
    if (by === "ai" && has(w, k)) return null;           // (decided already: by you, or by an earlier plan)
    if (know === null && by === "you") return has(w, k) ? { k, v: null } : { k, v: null };
    return { k, v: { know: !!know, how: know ? s_(how, 90) : "", by } };
  }
  const ties = (cid, chars, w) => chars.filter((c) => c.id !== cid && c.life !== false && get(w[pair(cid, c.id)] || {}, "know", null))
    .map((c) => [c, w[pair(cid, c.id)].how]);
  const undecided = (cid, chars, w) => chars.filter((c) => c.id !== cid && c.life !== false && !has(w, pair(cid, c.id))).slice(0, 6);
  function decide(cid, j, others, w) {                  // lives.decide -> the tie changes the plan's "know" answers make
    const byName = new Map(others.map((c) => [P().pyStrip(String(c.name)).toLowerCase(), c])), out = [];
    const w2 = { ...w };
    for (const k of Array.isArray(get(j, "know", null)) ? j.know.slice(0, 8) : []) {
      const c = isDict(k) && byName.get(P().pyStrip(str(get(k, "name", ""))).toLowerCase());
      if (c && typeof k.know === "boolean") {
        const how = s_(get(k, "how", null), 90), ch = setTie(w2, cid, c.id, k.know, mine(how) ? how : "", "ai");
        if (ch) { out.push(ch); w2[ch.k] = ch.v; }
      }
    }
    return out;
  }
  function without(lg, avoid) {                         // lives._without (the phone keeps no avoid lists: [] passes all)
    if (!avoid || !avoid.length) return lg;
    const pat = new RegExp("(?<![\\p{L}\\p{N}_])(?:" + avoid.map((t) => t.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&")).join("|") + ")(?![\\p{L}\\p{N}_])", "iu");
    const ok = (t) => !pat.test(t || "");
    lg = JSON.parse(JSON.stringify(lg));
    lg.ongoing = lg.ongoing.filter((o) => ok(o.what));
    for (const d of lg.days) { d.summary = ok(d.summary) ? d.summary : ""; d.events = d.events.filter((e) => ok(e.what) && ok(e.plan)); }
    return lg;
  }
  function friendsText(cid, chars, logs, now, w, avoid, tz) {   // lives.friends_text (for planning)
    const today = lifeDate(now, tz), lines = [];
    for (const [c, how] of ties(cid, chars, w)) {
      const lg = without(logs[c.id] || empty(c.id), avoid), bits = [`${c.name} (${how || "a friend"})`];
      if (lg.ongoing.length) bits.push("lately: " + lg.ongoing.slice(0, 2).map((o) => o.what).join("; "));
      const past = lg.days.filter((d) => d.date < today && d.summary);
      if (past.length) bits.push("recently: " + past[past.length - 1].summary);
      const d = day(lg, today);
      if (d && d.events.length) bits.push("today: " + d.events.slice(0, 6).map((e) => `${e.at} ${e.plan || e.what}`).join("; "));
      lines.push("- " + bits.join(", "));
    }
    if (!lines.length) return "";
    return "\nFriends of yours I also talk to (you know them in real life; their days are real too):\n" + lines.join("\n") +
      "\nNow and then (not every day) you can do something with one of them, only if it fits their day too, " +
      "and mention them like friends do. Never say what I might have told them.";
  }

  // ---------- when you usually text (the times of your own messages only, never their words) ----------
  function rhythm(msgs, now, tz, days = 28) {
    const seen = new Set(), hours = new Map();
    for (const m of msgs) {
      const t0 = pyFloat(get(m, "ts", null));
      if (get(m, "role", null) !== "user" || get(m, "via", null) === "call" || now - t0 > days * 86400) continue;
      const t = lt(t0, tz), d = t.y + ":" + t.yday;
      seen.add(d); if (!hours.has(t.h)) hours.set(t.h, new Set()); hours.get(t.h).add(d);
    }
    if (seen.size < 5) return null;
    const out = {};
    for (let h = 0; h < 24; h++) out[h] = (hours.has(h) ? hours.get(h).size : 0) / seen.size;
    return out;
  }
  function activeText(rh, cfg) {
    if (!rh) return "";
    const on = [];
    for (let h = 0; h < 24; h++) if (rh[h] >= 0.34 && !quietH(h + 0.5, cfg)) on.push(h);
    const spans = []; let a = null, b = null;
    for (const h of on.concat([99])) {
      if (a === null) { a = b = h; } else if (h === b + 1) b = h; else { spans.push([a, b]); a = b = h; }
    }
    return P().cp(spans.filter(([x]) => x !== 99).map(([x, y]) => `${x}-${y + 1}h`).join(", "), 80);
  }
  function nudge(due, rh, cfg, earliest, rnd, tz) {     // toward when you're around (90 min either way), never too early
    if (!rh) return due;
    let best = due, score = rh[lt(due, tz).h];
    for (let step = -6; step < 7; step++) {
      const t = due + step * 15 * 60, sc = rh[lt(t, tz).h] - Math.abs(step) * 0.01;
      if (t >= earliest && !quietAt(t, cfg, tz) && sc > score + 0.1) { best = t; score = sc; }
    }
    if (best === due) return due;
    const j = best + rnd.uniform(-8, 8) * 60;
    return j >= earliest && !quietAt(j, cfg, tz) ? j : best;
  }

  // ---------- what context() reads of a log, for the kit (lives.slim) ----------
  function slim(log, now, friend, tz) {
    const edge = addDays(lifeDate(now, tz), -1);
    const old = log.days.filter((d) => d.date < edge && d.summary).slice(friend ? -1 : -6);
    const ev = friend ? ["at", "what"] : ["id", "at", "what", "mood", "kind", "plan"];
    return { about: friend ? [] : log.about.slice(), people: friend ? [] : log.people.slice(),
      ongoing: friend ? log.ongoing.slice(0, 2).map((o) => ({ what: o.what })) : log.ongoing.slice(),
      weeks: friend ? [] : log.weeks.slice(-2),
      days: old.concat(log.days.filter((d) => d.date >= edge)).map((d) => ({ date: d.date, to: friend ? "" : d.to, summary: d.summary,
        events: d.events.map((e) => { const o = {}; for (const k of ev) o[k] = e[k]; return o; }),
        moments: friend ? [] : d.moments.map((m) => ({ event: m.event, state: m.state === "sent" ? "sent" : m.state === "skipped" ? "skipped" : "pending" })) })) };
  }

  // ---------- planning a day (one model call per character per day) ----------
  const SOUTH = ["Australia/", "Pacific/Auckland", "America/Argentina", "America/Santiago", "America/Sao_Paulo", "Africa/Johannesburg"];
  function season(now, tz) {
    let s = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][lt(now, tz).mo - 1];
    if (SOUTH.some((p) => String(tz || "").startsWith(p))) s = { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" }[s];
    return `It's ${s}.`;
  }
  async function sig(char) {                            // lives.sig (sha256 of persona + life seed, 16 hex)
    const t = (char.persona || "") + "\n" + (char.life_seed || "");
    const h = new Uint8Array(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
    return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // lives.plan_prompt. tpl: the kit's templates.plan; o: {ownYesterday, nMoments, photos, ownToday, friends, strangers,
  // active, voice, sigNow (await sig(char)), tz} -> {prompt, fold}
  function planPrompt(tpl, char, log, now, cfg, o) {
    const tz = o.tz || "", today = lifeDate(now, tz), nM = o.nMoments === undefined ? 2 : o.nMoments;
    const prev = log.days.filter((d) => d.date < today), last = prev.length ? prev[prev.length - 1] : null, yday = addDays(today, -1);
    const nDays = log.days.length + (day(log, today) ? 0 : 1);
    const fold = { days: nDays > MAX_DAYS };
    fold.weeks = log.weeks.length + (fold.days ? 1 : 0) > MAX_WEEKS;
    const q = get(cfg, "quiet_until", 8.5), qf = get(cfg, "quiet_from", 23.0), t = lt(now, tz);
    const first = Math.max(q, t.h + t.mi / 60 + 0.25);
    const fmt = (h) => `${p2(Math.trunc(h) % 24)}:${p2(pyRound((h % 1) * 60) % 60)}`;
    const recent = prev.slice(-3).filter((d) => d.summary).map((d) => `- ${d.date}: ${d.summary}`);
    const recentEvents = prev.slice(-5).flatMap((d) => d.events.map((e) => e.what)).slice(-20);
    const needsAbout = !log.about.length || log.sig !== o.sigNow;
    const ownY = o.ownYesterday || [], ownT = o.ownToday || [], strangers = o.strangers || [];
    const isYday = last && last.date === yday && !last.final;
    const vals = {
      name: char.name, persona: P().cp(char.persona || "", 4000) + (char.life_seed ? "\nAbout your everyday life: " + P().cp(char.life_seed, 600) : ""),
      date: today, weekday: DAYS[weekdayOf(today)], now: hm(now, tz), tz: tz || "UTC", season: season(now, tz),
      about: log.about.length ? "\nAbout you so far:\n" + log.about.map((x) => "- " + x).join("\n") : "",
      people: log.people.length ? "\nPeople in your life:\n" + log.people.map((x) => `- ${x.name}: ${x.who}`).join("\n") : "",
      ongoing: log.ongoing.length ? "\nGoing on lately:\n" + log.ongoing.map((x) => `- ${x.what} (since ${x.since})`).join("\n") : "",
      recent: recent.length ? "\nYour last days:\n" + recent.join("\n") + log.weeks.slice(-2).map((w) => `\nEarlier: ${w.summary}`).join("") : "",
      yesterday: isYday ? "\nYesterday's plan was: " + last.events.map((e) => `${e.at} ${e.what}`).join("; ") +
        (ownY.length ? "\nWhat you actually told me about your life yesterday (this is now true):\n" + ownY.slice(-20).map((m) => "- " + s_(m, 200)).join("\n") : "") : "",
      told_today: ownT.length ? "\nWhat you already told me about today (true now: fit the day around it):\n" + ownT.slice(-12).map((m) => "- " + s_(m, 200)).join("\n") : "",
      gap: last && last.date < yday ? `\nYou last wrote about your life on ${last.date}; the days since passed quietly.` : "",
      fold: (fold.days ? "\nOld days to sum up as one week:\n" + log.days.slice(0, FOLD_DAYS).map((d) => `- ${d.date}: ${d.summary}`).join("\n") : "") +
        (fold.weeks ? "\nOld weeks to sum up as one month:\n" + log.weeks.slice(0, FOLD_WEEKS).map((w) => `- ${w.from}..${w.to}: ${w.summary}`).join("\n") : ""),
      weekend: weekdayOf(today) >= 5 ? " It's the weekend: a different rhythm." : "",
      avoid: recentEvents.join("; ") || "nothing yet",
      moments: nM > 0 ? `- "moments": ${nM} times today you'd text me about something that happened (after it happened), ` +
        `between ${fmt(first)} and ${fmt(qf > q ? qf - 0.5 : 23.5)}, at least 2 hours apart.` +
        (o.active ? ` I usually text around ${o.active}: pick times when I'm likely around.` : "") +
        " angle: share, vent, ask (my opinion)" + (o.photos ? ", photo (you'd send me a picture of it)" : "") +
        (o.voice ? ", voice (you'd send me a voice message about it)" : "") + ", about_you (no event: you're curious how I'm doing)."
        : '- "moments": [] (you won\'t text me first today).',
      friends: o.friends || "", halal: tpl.halal,
      strangers: strangers.length ? "\nOther people I talk to (they're real too, but you might not know them): " +
        strangers.map(([n, tg]) => s_(n, 40) + (tg ? ` (${s_(tg, 90)})` : "")).join("; ") + ". For each, decide like real " +
        "life: most people don't know each other, so say yes only if it fits naturally (same city, work, scene, " +
        "old friends), and then how, in a few words." : "",
      ask_know: strangers.length ? ',\n "know": [{"name": "...", "know": true or false, "how": "how you know each other, or \'\'"}]' : "",
      kinds: "[" + KINDS.map((k) => JSON.stringify(k)).join(", ") + "]",
      ask_about: needsAbout ? ',\n "about": ["6-10 short lasting facts about your everyday life: home, work or study, routine, hobbies"], ' +
        '"people": [{"name": "...", "who": "in your words, e.g. my older sister, a nurse"}]' : "",
      ask_yesterday: isYday ? ',\n "yesterday": "1-2 sentences: how yesterday actually went"' : "",
      ask_gap: last && last.date < yday ? ',\n "gap": "one sentence: those days in between"' : "",
      ask_fold: (fold.days ? ',\n "week": "max 400 characters"' : "") + (fold.weeks ? ',\n "month": "max 500 characters"' : "") };
    return { prompt: P().pyFormat(tpl.prompt, vals), fold };
  }
  function parse(txt) {                                 // lives.parse: the model's JSON, even with prose or fences around it
    txt = String(txt == null ? "" : txt);
    const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("no JSON in the reply");
    const j = JSON.parse(txt.slice(a, b + 1));
    if (!isDict(j)) throw new Error("not an object");
    return j;
  }
  // lives.apply_plan: validates the day and schedules its moments (never in quiet hours, after the event, 2 h apart,
  // 40 min away from other characters' texts). o: {nMoments, othersDue, photos, rnd, rh, voice, sigNow, tz}
  function applyPlan(log, j, char, now, cfg, o) {
    const tz = o.tz || "", rnd = o.rnd, nM = o.nMoments === undefined ? 2 : o.nMoments, today = lifeDate(now, tz);
    log = clean(log, char.id);
    const prev = log.days.filter((d) => d.date < today), last = prev.length ? prev[prev.length - 1] : null;
    if (last && typeof get(j, "yesterday", null) === "string" && P().pyStrip(j.yesterday)) { last.summary = ownSentences(j.yesterday, 300) || last.summary; last.final = true; }
    else if (last) last.final = true;
    if (last && last.date < addDays(today, -1) && ownSentences(get(j, "gap", null), 200))
      log.days.push({ date: addDays(last.date, 1), to: addDays(today, -1), summary: ownSentences(j.gap, 200), final: true, events: [], moments: [], planned: now, tries: 1 });
    if (Array.isArray(get(j, "about", null)) && j.about.length) {
      log.about = j.about; log.sig = o.sigNow;
      if (Array.isArray(get(j, "people", null))) log.people = j.people;
    }
    if (Array.isArray(get(j, "ongoing", null))) log.ongoing = j.ongoing;
    const t = isDict(get(j, "today", null)) ? j.today : {};
    const ev = [];
    sliceList(get(t, "events", null), 0, 8).forEach((e, i) => { if (isDict(e) && hhmm(get(e, "at", null))) ev.push({ ...e, id: `e${i + 1}` }); });
    let d = { date: today, summary: s_(get(t, "summary", null), 300), final: false, events: ev, moments: [], planned: now,
              tries: num((day(log, today) || {}).tries) + 1 };
    d = clean({ days: [d] }, char.id).days[0];
    const taken = (o.othersDue || []).slice(), mineM = [];
    const ms = nM > 0 && Array.isArray(get(j, "moments", null)) ? j.moments.slice(0, 6) : [];
    for (const m of ms) {
      if (!isDict(m) || !hhmm(get(m, "at", null))) continue;
      let angle = ANGLES.includes(get(m, "angle", null)) ? m.angle : "share";
      if ((angle === "photo" && !o.photos) || (angle === "voice" && !o.voice)) angle = "share";
      const idx = get(m, "event", null);
      let e = pyInt(idx) ? d.events.find((x) => x.id === `e${idx}`) || null : null;
      if (angle !== "about_you" && !e) continue;          // a life text is about something that happened
      if (angle === "about_you") e = null;
      let due = ts(d.date, hhmm(m.at), tz) + rnd.uniform(-12, 12) * 60;
      if (e) due = Math.max(due, ts(d.date, e.at, tz) + rnd.uniform(5, 25) * 60);   // never before it happened
      due = nudge(due, o.rh || null, cfg, Math.max(now + 10 * 60, e ? ts(d.date, e.at, tz) + 5 * 60 : 0), rnd, tz);
      for (let k = 0; k < 3; k++) {                        // step away from other characters' texts
        const clash = taken.filter((x) => Math.abs(x - due) < 40 * 60);
        if (!clash.length) break;
        due = Math.max(...clash) + 45 * 60;
      }
      if (due < now + 10 * 60 || quietAt(due, cfg, tz) || taken.some((x) => Math.abs(x - due) < 40 * 60)) continue;
      if (mineM.some((x) => Math.abs(x.due - due) < 120 * 60)) continue;
      if (["photo", "voice", "about_you"].includes(angle) && mineM.some((x) => x.angle === angle)) continue;
      mineM.push({ id: `m${mineM.length + 1}`, event: e ? e.id : null, at: hm(due, tz), due, angle, state: "pending", msg: null });
      if (mineM.length >= nM) break;
    }
    d.moments = mineM.slice().sort((a, b) => a.due - b.due);
    log.days = log.days.filter((x) => x.date !== d.date).concat([d]);
    if (log.days.length > MAX_DAYS) {                     // rolling summaries (a plain join if the reply has none)
      const old = log.days.slice(0, FOLD_DAYS); log.days = log.days.slice(FOLD_DAYS);
      log.weeks.push({ from: old[0].date, to: old[old.length - 1].to || old[old.length - 1].date,
                       summary: ownSentences(get(j, "week", null), 400) || s_(old.map((x) => x.summary).join(" "), 400) });
    }
    if (log.weeks.length > MAX_WEEKS) {
      const old = log.weeks.slice(0, FOLD_WEEKS); log.weeks = log.weeks.slice(FOLD_WEEKS);
      log.months.push({ month: old[0].from.slice(0, 7), summary: ownSentences(get(j, "month", null), 500) || s_(old.map((x) => x.summary).join(" "), 500) });
    }
    log.months = log.months.slice(-MAX_MONTHS);
    return clean(log, char.id);
  }

  // ---------- which moment goes now ----------
  function quota(char, cfg, unanswered) {
    let base = get(char, "texts_per_day", null);
    base = pyInt(base) && base >= 0 && base <= 4 ? base : get(QUOTA, get(cfg, "life_texts", "some"), 2);
    return unanswered >= 4 ? 0 : unanswered >= 2 && base ? Math.max(1, Math.floor(base / 2)) : base;
  }
  // lives.pick. logs: {cid: log} (in this order); chars: {cid: char}; st: thread_state(). -> [cid, moment, expired]
  function pick(logs, chars, now, cfg, st, tz, ahead = 0) {
    const expired = [], cands = [];
    if (quietAt(now, cfg, tz)) return [null, null, expired];
    const today = lifeDate(now, tz);
    for (const [cid, log] of Object.entries(logs)) {
      const d = day(log, today);
      for (const m of d ? d.moments : []) {
        if (m.state !== "pending" || m.due > now + ahead) continue;
        if (now - m.due > LATE) { expired.push([cid, m.id]); continue; }
        cands.push([m.due, cid, m]);
      }
    }
    if (!cands.length || st.busy) return [null, null, expired];
    if (now - (st.last_any || 0) < get(cfg, "life_after_chat_min", 25) * 60) return [null, null, expired];
    if (now - (st.last_first || 0) < get(cfg, "life_gap_min", 60) * 60) return [null, null, expired];
    const sent = st.sent_today || {}, by = st.last_by || {}, un = st.unanswered || {};
    if (Object.values(sent).reduce((a, b) => a + b, 0) >= get(GLOBAL_CAP, get(cfg, "life_texts", "some"), 6)) return [null, null, expired];
    cands.sort((a, b) => a[0] - b[0] || (by[a[1]] || 0) - (by[b[1]] || 0));
    for (const [, cid, m] of cands) {
      const ch = chars[cid];
      if (!ch || !ch.texts_first || ch.life === false) continue;
      if ((sent[cid] || 0) >= quota(ch, cfg, un[cid] || 0)) continue;
      if (now - (by[cid] || 0) < 120 * 60) continue;
      return [cid, m, expired];
    }
    return [null, null, expired];
  }
  // lives.needs_plan: texting characters at the first look after quiet hours (if they'll text today and you've talked
  // to anyone in the last few days); the others (lazy) on the first chat or call with them that day
  function needsPlan(log, char, cfg, now, st, tz, lazy = false) {
    if (!get(cfg, "lives", true) || char.life === false) return false;
    const today = lifeDate(now, tz);
    if (day(log, today)) return false;
    const a = log.attempt || {};
    if (a.date === today && ((a.n || 0) >= 3 || now - (a.at || 0) < RETRY)) return false;
    if (lazy) return true;
    if (quietAt(now, cfg, tz) || !get(cfg, "proactive", true) || !char.texts_first) return false;
    if (now - (st.last_user || 0) > get(cfg, "life_pause_days", 3) * 86400) return false;
    return quota(char, cfg, (st.unanswered || {})[char.id] || 0) > 0;
  }
  // lives.thread_state: what pick() and needs_plan() need from the conversation
  function threadState(msgs, now, tz, callingWindow = 180) {
    const st = { last_any: 0, last_user: 0, last_first: 0, last_by: {}, sent_today: {}, unanswered: {}, busy: false };
    const today = lifeDate(now, tz);
    for (const m of msgs) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const c = has(m, "char") ? m.char : "buddy", t = pyFloat(get(m, "ts", null));
      st.last_any = Math.max(st.last_any, t);
      st.last_by[c] = Math.max(st.last_by[c] || 0, t);
      if (m.role === "user") {
        st.last_user = Math.max(st.last_user, t); st.unanswered[c] = 0;
        if (m.via === "call" && now - t < callingWindow) st.busy = true;
      } else if (m.proactive && m.content) {
        st.last_first = Math.max(st.last_first, t);
        st.unanswered[c] = (st.unanswered[c] || 0) + 1;
        if (lifeDate(t, tz) === today) st.sent_today[c] = (st.sent_today[c] || 0) + 1;
      }
    }
    return st;
  }
  // schedule(): the Mac's minute-by-minute pick() run ahead (SPEC3 §11.2): which pending moments still stand and when
  // each would be sent, from now to now + horizon, as if each picked one had been sent at its minute. msgs: the
  // conversation as it is (with the held ones written ahead: they count at their own time). -> {send: [{cid, date, mid,
  // at}], expired: [{cid, date, mid}]} (expired: let go, as pick() lets go of one 90 minutes late)
  function schedule(logs, chars, now, cfg, msgs, tz, horizon = HORIZON) {
    const send = [], expired = [], end = now + horizon;
    const L2 = JSON.parse(JSON.stringify(logs));          // (marked as it goes, like the Mac's log)
    const sims = msgs.slice();
    const cand = () => {                                // the earliest time anything pending could go
      let t = Infinity;
      for (const lg of Object.values(L2)) for (const d of lg.days) for (const m of d.moments) if (m.state === "pending") t = Math.min(t, m.due);
      return t;
    };
    let t = Math.floor(now / 60) * 60;
    if (t < now) t += 60;
    let st = threadState(sims, t, tz), stAt = t, guard = 0;
    while (t <= end && guard++ < 6000) {
      const c = cand();
      if (c === Infinity) break;
      if (c > t) { t = Math.ceil(c / 60) * 60; if (t > end) break; }
      if (t !== stAt) { st = threadState(sims, t, tz); stAt = t; }
      const [cid, m, exp] = pick(L2, chars, t, cfg, st, tz);
      const dateNow = lifeDate(t, tz);
      for (const [x, mid] of exp) {
        const d = L2[x].days.find((dd) => dd.date === dateNow);
        mark(L2[x], dateNow, mid, "skipped");
        if (d) expired.push({ cid: x, date: dateNow, mid });
      }
      if (cid) {
        mark(L2[cid], dateNow, m.id, "sent");
        send.push({ cid, date: dateNow, mid: m.id, at: t });
        sims.push({ role: "assistant", char: cid, ts: t, proactive: true, content: "x" });
        st = threadState(sims, t, tz);
      }
      t += 60;
      // (pending moments of days before today that pick() never looks at again: let go)
      for (const [x, lg] of Object.entries(L2)) for (const d of lg.days) if (d.date < lifeDate(t, tz))
        for (const mm of d.moments) if (mm.state === "pending") { mm.state = "skipped"; expired.push({ cid: x, date: d.date, mid: mm.id }); }
    }
    return { send, expired };
  }

  // ---------- what a text first says ----------
  // lives.moment_prompt: the instruction for a text about something in their day; null for an "about_you" check-in
  // (or an event edited away), which uses PROACTIVE. tpl: the kit's templates.moment
  function momentPrompt(tpl, log, dateIso, m, now, photos, tz) {
    const d = log.days.find((x) => x.date === dateIso) || null;
    const e = d ? d.events.find((x) => x.id === m.event) || null : null;
    if (m.angle === "about_you" || !e) return null;
    const what = e.what.slice(0, 2) !== "I " ? e.what.charAt(0).toLowerCase() + e.what.slice(1) : e.what.slice(2);
    return P().pyFormat(tpl.prompt, { at: e.at, what, mood: e.mood ? ` (you felt ${e.mood})` : "", now: dayHm(now, tz),
      angle: tpl.angle[m.angle === "photo" && !photos ? "share" : m.angle] });
  }
  const keepsOnTrack = (c) => rx().onTrack.test(fi(`${c.persona || ""}\n${c.tagline || ""}`));   // characters.keeps_on_track
  const followUp = (tpl, c, moment) => (keepsOnTrack(c) ? "\n" + (moment ? tpl.follow_up_moment : tpl.follow_up) : "");
  // the PROACTIVE check-in (buddy_server, reason "check in"): on a phone "away from my Mac" can't be said, so it says
  // how long since I last texted them instead (the rest word for word)
  const MAC_AWAY = "I've been\naway from my Mac for about {idle} minutes.";
  function proactiveText(tpl, idle, now, tz) {
    const p = tpl.prompt.includes(MAC_AWAY) ? tpl.prompt.replace(MAC_AWAY, "I last texted you\nabout {idle} minutes ago.") : tpl.prompt;
    return P().pyFormat(p, { reason: "check in", idle: String(Math.trunc(idle)), now: dayHm(now, tz) });
  }
  // the instruction for a moment (buddy_server.life_tick)
  function instruction(tpls, char, log, dateIso, m, now, photos, idle, tz) {
    const mp = momentPrompt(tpls.moment, log, dateIso, m, now, photos, tz);
    return mp ? mp + followUp(tpls.proactive, char, true) : proactiveText(tpls.proactive, idle, now, tz) + followUp(tpls.proactive, char, false);
  }
  // first_text's cleanup after the model wrote it (photo tags already taken out by direct.js's picTags/noTags)
  const cleanFirst = (t) => P().pyStrip(P().pyStrip(String(t).replace(rx().sp, " ")).replace(/^"+|"+$/g, ""));
  function parts(txt, voiced) {                         // a blank line = two texts (at most 2, the rest joined)
    if (voiced) return [txt];
    const ps = String(txt).split(/\n\s*\n/).map((p) => P().pyStrip(p)).filter(Boolean);
    return ps.slice(0, 2).concat(ps.length > 2 ? [ps.slice(2).join(" ")] : []);
  }
  async function momentCid(char, dateIso, mid) {        // b64url(SHA-256("buddy moment v1" ‖ char ‖ "|" ‖ date ‖ "|" ‖ mid))[:22]
    const h = new Uint8Array(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode("buddy moment v1" + char + "|" + dateIso + "|" + mid)));
    let s = ""; for (const b of h) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
  }

  // ---------- real timing (buddy_server.life_busy, reply_delay) ----------
  function lifeBusy(char, log, now, cfg, tz) {          // what they're in the middle of (an event that began < 90 min ago)
    if (!get(cfg, "lives", true) || char.life === false || !log) return "";
    const today = lifeDate(now, tz), d = day(log, today);
    const done = (d ? d.events : []).filter((e) => happened(e, now, tz));
    if (!done.length || !["work", "social", "hobby", "errand", "notable"].includes(done[done.length - 1].kind)) return "";
    const e = done[done.length - 1];
    return now - ts(today, e.at, tz) < 90 * 60 ? e.what : "";
  }
  // how long a real person would take to answer (seconds; 0: at once): never in a call or with real timing off; in the
  // middle of a conversation at once; after a quiet while sometimes a few minutes, longer when busy; 20 minutes at most.
  // thread: this conversation's messages (the newest is the one being answered); busy: lifeBusy()
  function replyDelay(char, via, thread, now, cfg, busy, rnd) {
    if (via === "call" || !get(cfg, "real_timing", true)) return 0;
    const prev = thread.filter((m) => (has(m, "char") ? m.char : "buddy") === char.id && (m.role === "user" || m.role === "assistant") && !m.pending_photo).slice(0, -1);
    const gap = prev.length ? now - Math.max(...prev.map((m) => m.ts)) : 0;
    if (gap < 10 * 60) return 0;
    let [p, lo, hi] = gap < 2 * 3600 ? [0.25, 40, 180] : gap < 86400 ? [0.45, 60, 420] : [0.6, 120, 900];
    if (busy) { p = Math.max(p, 0.7); lo += 240; hi += 480; }
    return rnd.random() < p ? Math.min(1200, rnd.uniform(lo, hi)) : 0;
  }
  const lateNote = (tplText, busy) => P().pyFormat(tplText, { busy: busy ? ` (you've been busy: ${busy})` : "" });
  function makeRnd(r) { const f = r || Math.random; return { random: f, uniform: (a, b) => a + (b - a) * f() }; }

  // ---------- what the app shows (buddy_server.life_info) ----------
  function info(char, log, w, chars, cfg, now, tz) {
    const today = lifeDate(now, tz), days = [];
    for (const d of log.days.slice(-7).reverse()) {
      const texted = new Set(d.moments.filter((m) => m.state === "sent").map((m) => m.event));
      days.push({ date: d.date, to: d.to, summary: d.summary, today: d.date === today,
        events: d.events.map((e) => ({ ...e, past: d.date !== today || happened(e, now, tz), texted: texted.has(e.id) })),
        moments: d.moments.map((m) => ({ at: m.at, angle: m.angle, state: m.state === "scheduled" ? "pending" : m.state })) });
    }
    const tl = chars.filter((x) => x.id !== char.id).map((x) => ({ id: x.id, name: x.name, life: x.life !== false,
      ...(w[pair(char.id, x.id)] || { know: null, how: "", by: "ai" }) }));
    return { char: char.id, name: char.name, on: !!get(cfg, "lives", true), life: char.life !== false, texts_first: !!char.texts_first,
      texts_per_day: char.texts_per_day === undefined ? null : char.texts_per_day, life_seed: char.life_seed || "", about: log.about,
      people: log.people, ongoing: log.ongoing, days, weeks: log.weeks.slice(-4).reverse(), months: log.months.slice(-6).reverse(),
      ties: tl, planned_today: !!day(log, today) };
  }

  L.life = { MAX_DAYS, MAX_WEEKS, MAX_MONTHS, FOLD_DAYS, FOLD_WEEKS, KINDS, ANGLES, QUOTA, GLOBAL_CAP, LATE, DAY_STARTS, RETRY, HORIZON,
    SOURCES: { OWNER: OWNER_SRC, HHMM: HHMM_SRC, MINOR: MINOR_SRC, ON_TRACK: ON_TRACK_SRC }, MAC_AWAY,
    s_, mine, ownSentences, lt, mk, lifeDate, addDays, hm, dayHm, quietAt, ts, happened, hhmm, empty, clean, day, edit, mark, attempted,
    pair, world, setTie, ties, undecided, decide, without, friendsText, rhythm, activeText, nudge, slim, season, sig, planPrompt,
    parse, applyPlan, quota, pick, needsPlan, threadState, schedule, momentPrompt, keepsOnTrack, followUp, proactiveText,
    instruction, cleanFirst, parts, momentCid, lifeBusy, replyDelay, lateNote, makeRnd, info, pyRound };
})(typeof window !== "undefined" ? window : globalThis);
