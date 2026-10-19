// Buddy for phones: the phone is the Buddy (window.BuddySolo, SPEC3 §4). On the GitHub Pages site (its page has
// <meta name="buddy-site">) web/direct.js takes its kit and conversation from here instead of a Mac, so the chat,
// photo, voice and call code runs unchanged. This file:
//   - builds the kit in phonekit()['kit']'s shape: kit.json (kitparts.static_kit("public"), built with the site) plus
//     this device's characters, facts, lives and settings (no notes, no pictures on the phone)
//   - answers the page's /api/characters*, /api/knows*, /api/lives*, /api/settings, /api/status, /api/version,
//     /api/thread, /api/newchat, /api/react, /api/media/*, /api/images (pictures "off"); anything else is direct.js's
//     shared code (chat, photos, voice messages, hearing, speech, calls) or 404 "not in Buddy for phones"
//   - learns facts while the app is open (web/solo/facts.js: facts.learn and every guard, the Mac's debounce, the
//     Advisor through direct.js's verified Tinfoil path), never from private messages or their lives
//   - lives (web/solo/life.js, SPEC3 §11): a character's day planned when the app opens (tomorrow's too after 18:00),
//     the moments that still stand written ahead as held messages and shown at their time (or at the next open, with
//     their own time); your message cancels a held moment due within 25 minutes and has the others written again
//   - real timing (§11.3): a reply that would come later is written at once and held until its time; a message before
//     then has it written again for everything you said, keeping its time. Held messages are hidden until then and
//     get their page id when shown. Texts first and late replies arrive only while Buddy is open (or at the next
//     open): notifications while it's closed need sync (P3)
//   - keeps everything in web/solo/store.js (IndexedDB, encrypted at rest); private messages and their photos and
//     audio only in this page's memory (12 h at most), never in storage, a backup file or anything synced
//   - this device's own Tinfoil key (wrapped at rest, decrypted into memory for this page load, given only to
//     direct.js, which sends it only to Tinfoil after verifying the enclave)
//   - "Back up to a file" (.buddysync, §8.9): the records and blobs exactly as the relay will keep them, under keys
//     derived from a recovery key the user keeps (§7.2); the key is shown once, checked by retyping group 14, and never
//     stored (only the keys derived from it, at rest), so a new phone needs it to open the file; a restore only adds
//     (this phone's chats, forgets, deletions and recovery key stay)
// Characters are always adults (direct.js builds the adult line in code; creation asks for adults; clean() refuses
// looks that aren't an original adult). The edition is always public (web/solo/edition.js).
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});
  const C = () => L.bcrypto, ST = () => L.store, ED = () => L.edition, CH = () => L.chars, F = () => L.facts, LF = () => L.life;
  const D = () => root.BuddyDirect || null;
  const EVERYONE = "_everyone";
  const T = {
    site: "not in Buddy for phones",
    keyfmt: "that doesn't look like an API key",
    store: "Couldn't save on this phone (storage is full or blocked), so nothing was sent.",
    storeReply: "Couldn't save their reply on this phone (storage is full or blocked).",
    solokey: "Buddy needs this phone's own Tinfoil key: Settings → This device's key.",
    nochar: "no such character",
    pictures: "Buddy for phones can't make pictures: upload one instead.",
    notready: "Buddy for phones is still starting. Try again in a moment.",
    nostorage: "Buddy needs normal browsing (not Private) to keep your chats.",
    lost: "This phone's copy can't be opened any more.",
    nokit: "Buddy for phones couldn't load its files. Check the connection and open it again.",
    wrongkey: "That recovery key doesn't open this backup file.",
    damaged: "That backup file is damaged or incomplete, so nothing was restored.",
    group: "That isn't the last group of your key. Have a look at it again.",
    nofilekey: "Make your recovery key first.",
  };
  const CHAR_FIELDS = ["name", "tagline", "persona", "appearance", "style", "voice", "brain", "texts_first", "texts_per_day",
                       "life", "life_seed", "learns", "color", "shared_facts", "created"];
  const SET_DEFAULTS = { name: "", voice: "", language: "", real_timing: true, lives: true, life_texts: "some", quiet_from: 23,
    quiet_until: 8.5, push_preview: true, see_photos: true, learn_facts: true, advisor_model: null, companion_tinfoil_model: null,
    tz: "", media_full: "recent", keep_messages: 3000, has_partner: "", partner_at: null, partner_noask: false };
  const CID = /^[A-Za-z0-9_-]{16,64}$/, BID = /^[A-Za-z0-9_-]{22}$/, ID = /^[a-z0-9-]{1,40}$/, HLC = /^\d{13}:\d{4}:[A-Za-z0-9_-]{1,64}$/;
  const LIFE_FIELDS = ["sig", "about", "people", "ongoing", "weeks", "months", "calls", "edited", "attempt"];
  const DAYID = /^([a-z0-9-]{1,40})\/(\d{4}-\d\d-\d\d)$/, LIFEREF = /^\d{4}-\d\d-\d\d\/[A-Za-z0-9_-]{1,6}$/;
  const TYPING_S = 6, REWRITE_MS = 90000, TICK_MS = 20000, LIFE_TICK_MS = 60000, AGAIN_MS = 5000;
  const TZ_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

  // ---------- state (this page load) ----------
  let initP = null, ready = false, base = null, kitC = null, version = "", error = "";
  let dev = null, n = 0, last = "", nextId = 0, secret = "";
  let setRec = { f: {} };
  const chars = new Map();                              // id -> char record data {id, f: {field: [hlc, value]}, epoch, deleted}
  const facts = new Map();                              // owner -> facts record data
  let msgs = [];                                        // the stored conversation, as the page sees it (by id)
  const recOf = new Map();                              // cid -> its msg record data
  let priv = [];                                        // private messages: this page's memory only (12 h)
  const mem = new Map();                                // cid -> {view, full, audio} Blobs (private ones; fresh ones)
  const urls = new Map();                               // "cid|v" -> blob: URL (made once per load)
  const pics = new Map();                               // "avatar|id" / "wall|id" -> {v, url}
  let tkey = null, hasKey = false, keys = null, pending = null, prefs = {}, prefT = 0;
  // lives, learning and held messages
  const lifeRecs = new Map(), dayRecs = new Map(), tieRecs = new Map(), learnRecs = new Map();   // (records' data)
  let held = [];                                        // messages written ahead / held back: {cid, char, at (s), priv, m, life}
  const replies = new Map();                            // char -> a reply on its way {at, token, cids, priv} (reply:<char>)
  const kicks = new Map(), holdLearn = new Map(), rewriteT = new Map();
  let learnMeta = { boot: 0, runs: [] }, learnRunning = false, lifeRunning = false, planning = false, writing = false;
  let timerT = 0, tickT = 0, lifeT = 0, kitAt = 0, started = false, againT = 0;   // (started: the page asked for background work)
  // what a text first being written ahead was written for: anything that could change it (your message, a forget, an
  // edit of the character or their life, the lives settings) moves these on, and a text written meanwhile is let go
  const gens = new Map();
  let genAll = 0;
  const genOf = (cid) => genAll + ":" + (gens.get(cid) || 0);
  const bump = (cid) => { gens.set(cid, (gens.get(cid) || 0) + 1); };
  const bumpAll = () => { genAll++; };
  let q = Promise.resolve();
  const serial = (fn) => { const p = q.then(fn, fn); q = p.catch(() => {}); return p; };   // writes, one at a time
  const nowS = () => Date.now() / 1000;
  const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } });
  const hasOwn = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const acct = () => (keys ? keys.acct : "");           // (blobs made before any recovery key: "")
  const ACCT = /^[0-9a-z]{26}$/;
  // A blob is sealed for the account id it was made under (§7.5's aad) and its reference says which (ref.a), so a new
  // recovery key (or a restored file) never has to touch media: they keep their own keys and stay as they are (§5.3).
  // (A reference without one, from before: the account id of this phone now.)
  const sealedFor = (ref) => (ref && typeof ref.a === "string" ? ref.a : acct());
  const openRef = (ref, ct) => C().openBlob(sealedFor(ref), ref, ct);
  const newCid = () => C().b64e(C().rand(16));
  const isoDay = (d = new Date()) => `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function bad(status, text) { const e = new Error(text); e.status = status; e.text = text; return e; }

  // ---------- records ----------
  function hlc() {                                      // "<13-digit ms>:<4-digit counter>:<device>" (sorts as text)
    const m = /^(\d{13}):(\d{4}):/.exec(last);
    let w = m ? Number(m[1]) : 0, c = m ? Number(m[2]) : 0;
    const now = Date.now();
    if (now > w) { w = now; c = 0; } else if (++c > 9999) { w++; c = 0; }
    last = `${String(w).padStart(13, "0")}:${String(c).padStart(4, "0")}:${dev.id}`;
    return last;
  }
  const metaRows = () => [{ k: "lid", n: nextId }, { k: "n", n }, { k: "hlc", h: last }];
  const bodyOf = (kind, id, d) => ({ k: kind, v: 1, id, a: dev.id, n: ++n, h: hlc(), d });
  const save = (list) => ST().putRecs(list.map((x) => ({ body: bodyOf(x.kind, x.id, x.d), opts: x.opts })), metaRows());
  const val = (f, k, d) => (f && Array.isArray(f[k]) && f[k].length === 2 ? f[k][1] : d);

  // ---------- settings ----------
  function settings() { const s = {}; for (const [k, d] of Object.entries(SET_DEFAULTS)) s[k] = val(setRec.f, k, d); return s; }
  async function setSettings(patch) {
    if (!Object.keys(patch).length) return;
    await serial(async () => {
      const f = { ...setRec.f };
      for (const [k, v] of Object.entries(patch)) f[k] = [hlc(), v];
      const d = { f };
      await save([{ kind: "set", id: "set", d }]);
      setRec = d; kitC = null;
    });
  }
  const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } };

  // ---------- characters ----------
  const blobVer = (f, k) => (f && Array.isArray(f[k]) && f[k][1] ? Number(String(f[k][0]).slice(0, 13)) || 1 : 0);
  function defaultsFor(id) {
    if (id === "buddy") return { name: base.builtin.name || "Buddy", tagline: "Your closest friend", persona: "", appearance: "",
      style: "photo", voice: base.voice.default, brain: "advisor", texts_first: true, texts_per_day: null, life: true, life_seed: "",
      learns: true, color: CH().COLORS[0], shared_facts: true, created: 0 };
    return { name: "Unnamed", tagline: "", persona: "", appearance: "", style: "photo", voice: "casual_female", brain: "advisor",
      texts_first: false, texts_per_day: null, life: true, life_seed: "", learns: true, color: CH().COLORS[0], shared_facts: true, created: 0 };
  }
  function charOf(id) {                                 // a character as one object (null: none, or deleted)
    if (typeof id !== "string") return null;
    const r = chars.get(id);
    if (id !== "buddy" && (!r || r.deleted)) return null;
    const dflt = defaultsFor(id), c = { id, builtin: id === "buddy" };
    for (const k of CHAR_FIELDS) c[k] = val(r && r.f, k, dflt[k]);
    c.epoch = (r && r.epoch) || 0;
    c.avatar = blobVer(r && r.f, "avatar"); c.wallpaper = blobVer(r && r.f, "wallpaper");
    c.avatarRef = val(r && r.f, "avatar", null); c.wallRef = val(r && r.f, "wallpaper", null);
    return c;
  }
  function list() {                                     // Buddy first, then by when they were made
    const out = [charOf("buddy")];
    for (const id of chars.keys()) if (id !== "buddy") { const c = charOf(id); if (c) out.push(c); }
    return [out[0], ...out.slice(1).sort((a, b) => (a.created - b.created) || (a.id < b.id ? -1 : 1))];
  }
  const fullPersona = (c) => (c.builtin ? c.persona || base.builtin.persona : c.persona);
  function pageChar(c) {
    return { id: c.id, name: c.name, tagline: c.tagline, persona: fullPersona(c), appearance: c.appearance, style: c.style,
      voice: c.voice, brain: c.brain, knowledge: { scope: c.shared_facts ? "all" : "none", folders: [], avoid: "" },
      texts_first: c.texts_first, learns: c.learns, life: c.life, texts_per_day: c.texts_per_day, life_seed: c.life_seed,
      color: c.color, created: c.created, builtin: c.builtin, avatar: c.avatar, avatar_prev: 0, wallpaper: c.wallpaper,
      avatar_job: null, wall_job: null, shared_facts: c.shared_facts, epoch: c.epoch };
  }
  function usedIds() {
    const s = new Set(["buddy", EVERYONE, ...chars.keys(), ...facts.keys()]);
    for (const d of recOf.values()) s.add(d.char);
    return s;
  }

  // ---------- the kit (phonekit()['kit']'s shape) ----------
  function kitChar(c) {
    const ka = base.templates.knows_ask, nm = (t) => String(t).split("{name}").join(c.name);
    const v = F().visible(c.id, facts.get(c.id) || null, facts.get(EVERYONE) || null, !!c.shared_facts);
    const pick = (fs) => fs.map((f) => ({ text: f.text, date: f.date }));
    return { id: c.id, name: c.name, tagline: c.tagline || "", color: c.color, avatar: c.avatar, wallpaper: c.wallpaper,
      builtin: !!c.builtin, brain: c.brain, voice: c.voice, persona: CH().personaOf({ ...c, persona: c.persona }, base.builtin.persona),
      facts: { own: pick(v.own), shared: pick(v.shared) },
      knows_ask: { phone: { have: nm(ka.phone.have), none: nm(ka.phone.none) }, call: { have: nm(ka.call.have), none: nm(ka.call.none) } },
      life: lifeOfKit(c) };
  }
  function lifeOfKit(c) {                               // phonekit()'s life: their log as context() reads it, friends' days
    if (!hasLife(c)) return null;
    const now = nowS(), z = zone(), w = world(), lc = lifeChars();
    return { log: LF().slim(logOf(c.id), now, false, z),
             friends: LF().ties(c.id, lc, w).slice(0, 4).map(([o, how]) => ({ id: o.id, name: o.name, how, log: LF().slim(LF().without(logOf(o.id), []), now, true, z) })) };
  }
  function kit() {
    if (!ready) return null;
    if (kitC && Date.now() - kitAt < 10 * 60 * 1000) return kitC;   // (their day moves on: built again now and then)
    kitAt = Date.now();
    const k = JSON.parse(JSON.stringify(base)), s = settings();
    if (!ED().check(k.edition)) return null;            // (the public edition's texts are missing: nothing is answered)
    const tz = s.tz && TZ_RE.test(s.tz) ? s.tz : localZone();
    kitC = { ...k, name: k.builtin.name || "Buddy", tz: TZ_RE.test(tz) ? tz : "", see_photos: !!s.see_photos, companion_on_phala: false,
      chars: list().map(kitChar),
      voice: { default: s.voice && k.voice.ids.includes(s.voice) ? s.voice : k.voice.default, ids: k.voice.ids },
      models: { ...k.models, advisor: { preferred: s.advisor_model || null, ...k.models.advisor },
                companion: { preferred: s.companion_tinfoil_model || null, ...k.models.companion } },
      tinfoil: { ids: [], meta: {} }, stt: { language: /^[a-z]{2,3}$/.test(s.language) ? s.language : "", model: "" },
      edition: { ...k.edition, public: ED().PUBLIC, partner: ED().partnerOf(s) } };
    return kitC;
  }

  // ---------- the conversation ----------
  function livePriv() {                                 // private ones fade after 12 h (memory only)
    const edge = nowS() - 12 * 3600;
    if (priv.some((m) => m.ts < edge)) { for (const m of priv.filter((x) => x.ts < edge)) dropMedia(m.cid); priv = priv.filter((m) => m.ts >= edge); }
    return priv;
  }
  const byId = (a, b) => a.id - b.id;
  function thread(after) {
    revealDue();                                        // (held ones whose time has come are shown, also without timers)
    const out = msgs.concat(livePriv());
    return (after === undefined ? out : out.filter((m) => m.id > after)).sort(byId);
  }
  const idOfCid = (cid) => { const m = msgs.find((x) => x.cid === cid) || priv.find((x) => x.cid === cid); return m ? m.id : null; };
  function pageOf(d, id, isPriv, target) {             // a record as the page sees it (direct.js's pageMsg shape)
    const m = { id, role: d.role, content: d.content || "", ts: d.ts, char: d.char };
    if (d.role === "user" || d.role === "assistant") { m.private = !!isPriv; m.via = d.via === "call" ? "call" : "phone"; }
    if (d.role === "user" && d.via === "call") m.from = "phone";
    if (d.role === "assistant") {
      m.mode = d.mode; if (d.sources && d.sources.length) m.sources = d.sources; if (d.knows) m.knows = true;
      if (d.proactive) m.proactive = true;              // (a text first; life: the moment in their day it's about)
      if (d.life) m.life = d.life;
      if (d.late) m.late = true;
      if (d.reply_to) m.reply_to = d.reply_to;
    }
    if (d.photo) {
      m.image = "local:" + d.cid; m.w = d.photo.w; m.h = d.photo.h;
      if (d.photo.desc) { m.photo_desc = d.photo.desc; if (d.photo.seen_by) m.seen_by = d.photo.seen_by; }
      else if (d.photo.seen === false) m.seen = false;
    }
    if (d.voice) { m.voice = "local:" + d.cid; m.dur = d.voice.dur; }
    if (d.role === "reaction") { m.target = target !== undefined ? target : idOfCid(d.target); m.emoji = d.emoji; m.by = d.by; if (isPriv) m.private = true; }
    m.cid = d.cid; m.local = true;
    return m;
  }
  function recFrom(it, epoch) {                         // a new message (an outbox item's shape) -> its record data
    const d = { cid: it.cid, char: String(it.char || "buddy"), epoch, role: it.role, content: String(it.content || ""), ts: Number(it.ts) || nowS() };
    if (it.role === "user" || it.role === "assistant") d.via = it.call ? "call" : "phone";
    if (it.role === "assistant") {
      if (it.mode) d.mode = it.mode;
      if (it.reply_to) d.reply_to = it.reply_to;
      const src = Array.isArray(it.sources) ? it.sources.filter((x) => x && x.kind === "facts") : [];
      if (src.length) d.sources = src.map((x) => ({ kind: "facts", path: String(x.path || ""), n: Number(x.n) || 0 }));
      if (it.knows) d.knows = true;
    }
    if (it.role === "reaction") { d.emoji = String(it.emoji || ""); d.by = it.by; if (it.target_cid) d.target = it.target_cid; }
    if (it.role === "assistant") {
      if (it.proactive) d.proactive = true;
      if (typeof it.life === "string" && LIFEREF.test(it.life)) d.life = it.life;
      if (it.late) d.late = true;
    }
    if (it.held) { d.held = true; d.at = Math.round(Number(it.at) * 1000); }   // (hidden until then, on every device)
    if (it.photo) d.photo = { w: it.photo.w, h: it.photo.h };
    if (it.voice) d.voice = { dur: Number(it.voice.dur) || 0, t: it.voice.type || "audio/wav" };
    return d;
  }
  const u8 = (x) => C().u8(x);
  function keepMem(cid, it, isPriv) {
    const e = {};
    if (it.photo) { e.view = new Blob([u8(it.photo.view)], { type: "image/jpeg" }); if (isPriv) e.full = new Blob([u8(it.photo.full)], { type: "image/jpeg" }); }
    if (it.voice) e.audio = new Blob([u8(it.voice.data)], { type: it.voice.type || "audio/wav" });
    if (e.view || e.audio || e.full) mem.set(cid, e);
  }
  function dropMedia(cid) {
    for (const k of ["v", "a"]) { const u = urls.get(cid + "|" + k); if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } urls.delete(cid + "|" + k); } }
    mem.delete(cid);
  }
  async function add(it, isPriv, keepOnFail) {          // (source) a new message: stored first (unless private), then shown
    if (!ready) return null;
    it.cid = it.cid || newCid();
    if (it.held) return addHeld(it, isPriv);            // (a reply held back until its time)
    const id = ++nextId;
    const c = charOf(String(it.char || "buddy"));
    if (isPriv) {
      keepMem(it.cid, it, true);
      const m = pageOf(recFrom(it, 0), id, true, it.role === "reaction" ? it.target : undefined);
      priv.push(m); afterAdd(m, true); return m;
    }
    const d = recFrom(it, c ? c.epoch : 0);
    try {
      await serial(async () => {
        const blobs = [], a = acct();
        if (it.photo) {
          const full = await C().sealBlob(a, C().newBid(), it.photo.full), view = await C().sealBlob(a, C().newBid(), it.photo.view);
          d.photo.full = { ...full.ref, t: "image/jpeg", a }; d.photo.view = { ...view.ref, t: "image/jpeg", a };
          blobs.push({ bid: full.ref.bid, ct: full.ct }, { bid: view.ref.bid, ct: view.ct });
        }
        if (it.voice) {
          const v = await C().sealBlob(a, C().newBid(), it.voice.data);
          Object.assign(d.voice, v.ref, { a }); blobs.push({ bid: v.ref.bid, ct: v.ct });
        }
        if (blobs.length) await ST().putMedia(blobs);
        await save([{ kind: "msg", id: d.cid, d, opts: { char: d.char, lid: id } }]);
      });
      if (error === T.store || error === T.storeReply) error = "";
    } catch (e) {
      error = keepOnFail ? T.storeReply : T.store;      // (theirs stays on screen for this load, and says so; yours isn't sent)
      if (!keepOnFail) return null;
      keepMem(it.cid, it, true);
      const m = pageOf(d, id, false); msgs.push(m); return m;
    }
    recOf.set(d.cid, d);
    keepMem(it.cid, it, false);
    const m = pageOf(d, id, false); msgs.push(m);
    afterAdd(m, false);
    return m;
  }
  function afterAdd(m, isPriv) {                        // after a message is kept: the moments written ahead, the plan, learning
    if (m.role === "user") {
      onYourMessage(m.char, m.ts);
      const c = charOf(m.char);
      if (started && c && hasLife(c) && m.via !== "call") setTimeout(() => { planDay(c, { lazy: true }).catch(() => {}); }, 0);   // (their day, if
    } else if (m.role === "assistant" && !isPriv && !m.life) kickFor(m);                                                 //  it isn't yet)
  }
  async function annotate(cid, f, isPriv) {             // (source) what was in a photo
    const m = (isPriv ? priv : msgs).find((x) => x.cid === cid);
    if (m) Object.assign(m, f);
    const d = recOf.get(cid);
    if (isPriv || !d || !d.photo) return;
    const nd = { ...d, photo: { ...d.photo } };
    if (f.photo_desc) { nd.photo.desc = String(f.photo_desc); if (f.seen_by) nd.photo.seen_by = String(f.seen_by); delete nd.photo.seen; }
    else if (f.seen === false) nd.photo.seen = false;
    try { await serial(() => save([{ kind: "msg", id: cid, d: nd, opts: { char: d.char, lid: m ? m.id : undefined } }])); recOf.set(cid, nd); }
    catch (e) { error = T.store; }
  }
  function forgetMemory(char) {                         // (source) a forgotten character's private messages go too
    for (const m of priv.filter((x) => x.char === char)) dropMedia(m.cid);
    priv = priv.filter((m) => m.char !== char);
  }
  async function blobOf(cid, which) {                   // "view" | "full" | "audio" -> a Blob (memory, or decrypted now)
    const e = mem.get(cid);
    if (e && e[which]) return e[which];
    const d = recOf.get(cid);
    const ref = d ? (which === "audio" ? d.voice : d.photo && d.photo[which]) : null;
    if (!ref || !ref.bid) return null;
    try {
      const ct = await ST().getMedia(ref.bid);
      if (!ct) return null;
      return new Blob([await openRef(ref, ct)], { type: ref.t || (which === "audio" ? "audio/wav" : "image/jpeg") });
    } catch (x) { return null; }                        // (a blob whose hash doesn't match is never shown)
  }
  async function mediaURL(id, view) {                   // -> a blob: URL ("local:<cid>"); the full photo: a new URL each time
    const cid = typeof id === "string" && id.startsWith("local:") ? id.slice(6) : null;
    if (!cid) return null;
    const m = msgs.find((x) => x.cid === cid) || priv.find((x) => x.cid === cid);
    const which = view ? "view" : m && m.image ? "full" : "audio";
    const key = cid + "|" + (which === "view" ? "v" : "a");
    if (which !== "full" && urls.has(key)) return urls.get(key);
    const b = await blobOf(cid, which);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    if (which !== "full") urls.set(key, u);
    return u;
  }

  // ---------- lives: life:<char> (per field), day:<char>/<date>, tie:<a+b>, read and written as lives.py's log ----------
  const J = (x) => JSON.stringify(x);
  const zone = () => { const s = settings(); return s.tz && TZ_RE.test(s.tz) ? s.tz : localZone(); };
  function cfgL() {                                     // what lives.py and facts.py read of the settings
    const s = settings();
    return { lives: !!s.lives, life_texts: s.life_texts, quiet_from: s.quiet_from, quiet_until: s.quiet_until, real_timing: !!s.real_timing,
             learn_facts: !!s.learn_facts, proactive: true };   // (on a phone texting first is each character's own setting)
  }
  const hasLife = (c) => !!settings().lives && c.life !== false;
  const lifeChar = (c) => ({ ...c, persona: fullPersona(c) });   // (a character as lives.py reads it: the persona it uses)
  function lifeChars() { return settings().lives ? list().filter((c) => c.life !== false).map(lifeChar) : []; }
  function logOf(cid) {
    const r = lifeRecs.get(cid), f = (r && r.f) || {}, log = { v: 1, char: cid, days: [] };
    for (const k of LIFE_FIELDS) if (Array.isArray(f[k]) && f[k].length === 2) log[k] = f[k][1];
    for (const [id, d] of dayRecs) { const m = DAYID.exec(id); if (m && m[1] === cid) log.days.push(d); }
    log.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return LF().clean(log, cid);
  }
  async function saveLog(cid, log) {                    // (inside serial) what changed; days folded into weeks go
    log = LF().clean(log, cid);
    const r = lifeRecs.get(cid) || { char: cid, f: {} }, f = { ...r.f }, list0 = [], days = [], keep = new Set();
    let changed = false;
    for (const k of LIFE_FIELDS) if (!Array.isArray(f[k]) || J(f[k][1]) !== J(log[k])) { f[k] = [hlc(), log[k]]; changed = true; }
    if (changed) list0.push({ kind: "life", id: cid, d: { char: cid, f }, opts: { char: cid } });
    for (const d of log.days) {
      const id = cid + "/" + d.date, nd = { char: cid, ...d };
      keep.add(id);
      if (J(dayRecs.get(id)) !== J(nd)) { list0.push({ kind: "day", id, d: nd, opts: { char: cid } }); days.push([id, nd]); }
    }
    const gone = [...dayRecs.keys()].filter((id) => { const m = DAYID.exec(id); return m && m[1] === cid && !keep.has(id); });
    if (list0.length) await save(list0);
    if (gone.length) await ST().delRecs(gone.map((id) => ["day", id]));
    if (changed) lifeRecs.set(cid, { char: cid, f });
    for (const [id, nd] of days) dayRecs.set(id, nd);
    for (const id of gone) dayRecs.delete(id);
    if (list0.length || gone.length) kitC = null;
    return log;
  }
  const changeLog = (cid, fn) => serial(async () => saveLog(cid, fn(logOf(cid))));   // (lives.change: one step)
  async function dropLife(cid, ties) {                  // (inside serial) their life; a deleted character's ties too
    const dl = [...dayRecs.keys()].filter((id) => { const m = DAYID.exec(id); return m && m[1] === cid; }).map((id) => ["day", id]);
    if (lifeRecs.has(cid)) dl.push(["life", cid]);
    if (ties) for (const k of tieRecs.keys()) if (k.split("+").includes(cid)) dl.push(["tie", k]);
    if (dl.length) await ST().delRecs(dl);
    for (const [k, id] of dl) (k === "day" ? dayRecs : k === "life" ? lifeRecs : tieRecs).delete(id);
    kitC = null;
  }
  function world() { const o = {}; for (const [k, v] of tieRecs) o[k] = v; return LF().world(o); }
  async function saveTie(ch) {                          // (inside serial) {k, v} from life.js (v null: the AI decides again)
    if (!ch) return;
    if (ch.v === null) { if (tieRecs.has(ch.k)) { await ST().delRecs([["tie", ch.k]]); tieRecs.delete(ch.k); } }
    else { const d = { pair: ch.k, know: ch.v.know, how: ch.v.how, by: ch.v.by }; await save([{ kind: "tie", id: ch.k, d }]); tieRecs.set(ch.k, d); }
    kitC = null;
  }
  const momentOf = (cid, date, mid) => { const d = dayRecs.get(cid + "/" + date); return d ? (d.moments || []).find((m) => m.id === mid) || null : null; };

  // ---------- held messages: written now, shown at their time (late replies, moments written ahead) ----------
  function changed() {                                  // (the page looks again: something was shown or is coming)
    try { if (typeof root.dispatchEvent === "function" && typeof root.Event === "function") root.dispatchEvent(new root.Event("buddysolo")); } catch (e) { /* no page */ }
  }
  function heldPage(d, isPriv, target) { const m = pageOf(d, 0, isPriv, target); m.id = null; return m; }
  // -> the held entry, or null when guard() (checked in the same step as the write, so nothing can change in between)
  // says it no longer stands; stored first (private: memory only). extra(): more records in the same write
  async function storeHeld(it, isPriv, extra, guard) {
    let h = null;
    const put = (d) => {                                // (memory, in the same step)
      h = { cid: d.cid, char: d.char, at: d.at / 1000, priv: !!isPriv, life: d.life || null, d,
            m: heldPage(d, isPriv, it.role === "reaction" && isPriv ? it.target : undefined) };
      held = held.filter((x) => x.cid !== h.cid).concat([h]);
    };
    const recNow = () => { const c = charOf(String(it.char || "buddy")); return recFrom(it, c ? c.epoch : 0); };
    if (isPriv) {
      if (guard && !guard()) return null;
      const d = recNow();
      keepMem(it.cid, it, true); put(d);
    } else {
      const ok = await serial(async () => {
        if (guard && !guard()) return false;
        const d = recNow(), old = held.find((x) => x.cid === d.cid);
        if (it.voice) { const a = acct(), v = await C().sealBlob(a, C().newBid(), it.voice.data); Object.assign(d.voice, v.ref, { a }); await ST().putMedia([{ bid: v.ref.bid, ct: v.ct }]); }
        const more = extra ? extra() : [];
        await save([{ kind: "msg", id: d.cid, d, opts: { char: d.char, at: d.at } }].concat(more));
        for (const r of more) if (r.kind === "day") { dayRecs.set(r.id, r.d); kitC = null; }
        recOf.set(d.cid, d); dropMedia(d.cid); keepMem(it.cid, it, false); put(d);
        if (old && old.d.voice && old.d.voice.bid && (!d.voice || d.voice.bid !== old.d.voice.bid)) await ST().delMedia([old.d.voice.bid]);
        return true;
      });
      if (!ok) return null;
    }
    armTimer(); changed();
    return h;
  }
  async function addHeld(it, isPriv) {                  // a held reply from direct.js's chat(): only the newest one counts
    const p = replies.get(String(it.char || "buddy"));
    if (!p || p.token !== it.hold) return null;         // (written again for a newer message, or the chat was deleted)
    try { const h = await storeHeld(it, isPriv); p.cids.push(h.cid); return h.m; }
    catch (e) { error = T.storeReply; return null; }
  }
  function revealDue(now) {                             // held messages whose time has come: shown, with their own time
    if (!ready) return false;
    now = now === undefined ? nowS() : now;
    const due = held.filter((h) => h.at <= now).sort((a, b) => a.at - b.at || (a.cid < b.cid ? -1 : 1));
    if (!due.length) return false;
    held = held.filter((h) => !due.includes(h));
    const lids = [], marks = [], gone = [];
    for (const h of due) {
      if (h.life && !stillStands(h)) { gone.push(h); continue; }   // (texting first turned off, a life ended, a quota lowered…)
      const m = h.m; m.id = ++nextId;
      if (m.role === "reaction" && !h.priv) m.target = idOfCid(h.d.target);
      (h.priv ? priv : msgs).push(m);
      if (!h.priv) lids.push(["msg", h.cid, m.id]);
      if (h.life) marks.push([h.char, h.life, m.id]);
      const p = replies.get(h.char);
      if (p && p.cids.includes(h.cid)) replies.delete(h.char);
      if (!h.priv && m.role === "assistant" && !h.life) kickFor(m);
    }
    serial(async () => {
      if (lids.length) await ST().setLids(lids, metaRows());
      for (const [char, ref, id] of marks) {            // (the moment was sent: its day says so)
        const [date, mid] = ref.split("/"), log = logOf(char);
        if (LF().day(log, date)) await saveLog(char, LF().mark(log, date, mid, "sent", id));
      }
      if (gone.length) await dropGone(gone);
    }).catch(() => { error = T.storeReply; });
    armTimer(); changed();
    return true;
  }
  function stillStands(h) {                             // a held text first, at its time: as lives.pick would still send it
    const c = charOf(h.char);
    if (!c || !c.texts_first || !hasLife(c)) return false;
    if (!h.priv && h.d && h.d.epoch !== c.epoch) return false;
    if (LF().quietAt(h.at, cfgL(), zone())) return false;
    const st = LF().threadState(msgs, h.at, zone());
    return (st.sent_today[c.id] || 0) < LF().quota(lifeChar(c), cfgL(), st.unanswered[c.id] || 0);
  }
  async function dropGone(list0) {                      // (inside serial) held texts first that won't be shown: gone, skipped
    const st = list0.filter((h) => !h.priv), bids = st.map((h) => h.d.voice && h.d.voice.bid).filter(Boolean);
    for (const h of list0) { recOf.delete(h.cid); dropMedia(h.cid); }
    if (st.length) await ST().delRecs(st.map((h) => ["msg", h.cid]));
    if (bids.length) await ST().delMedia(bids);
    for (const h of list0) if (h.life) {
      const [date, mid] = h.life.split("/"), log = logOf(h.char);
      if (LF().day(log, date)) await saveLog(h.char, LF().mark(log, date, mid, "skipped"));
    }
  }
  function armTimer() {                                 // wake up for the next one ("typing…" first, then shown)
    clearTimeout(timerT);
    if (!ready || !started || !held.length) return;
    let wait = Math.min(...held.map((h) => h.at)) - nowS();
    if (wait > TYPING_S) wait -= TYPING_S;
    timerT = setTimeout(() => { revealDue(); changed(); armTimer(); }, Math.min(2147483000, Math.max(250, Math.ceil(wait * 1000))));
  }
  function typing() {                                   // who's "typing…": a held message of theirs is due in a few seconds
    const now = nowS();
    return held.filter((h) => h.at > now && h.at - now <= TYPING_S).map((h) => ({ char: h.char, voice: !!h.m.voice, private: h.priv }));
  }
  async function dropHeldRaw(cids) {                    // (inside serial) held messages that won't be shown (tombstones)
    const gone = held.filter((h) => cids.includes(h.cid));
    if (!gone.length) return;
    held = held.filter((h) => !cids.includes(h.cid));
    const st = gone.filter((h) => !h.priv), bids = st.map((h) => h.d.voice && h.d.voice.bid).filter(Boolean);
    for (const h of gone) { recOf.delete(h.cid); dropMedia(h.cid); }
    if (st.length) await ST().delRecs(st.map((h) => ["msg", h.cid]));
    if (bids.length) await ST().delMedia(bids);
    armTimer(); changed();
  }
  const dropHeld = (cids) => serial(() => dropHeldRaw(cids));

  // ---------- real timing (SPEC3 §11.3): the source's late() hook for direct.js's chat() ----------
  async function late(o) {                              // -> {at, token, note, done(ok)} to hold this reply back, or null
    if (!ready || !o || o.via === "call") return null;
    revealDue();
    const c = charOf(String(o.char || "buddy"));
    if (!c) return null;
    const now = nowS(), p = replies.get(c.id);
    if (p && p.at > now && p.priv !== !!o.priv) return null;   // (a private chat and an everyday one never share an answer)
    if (p && p.at > now) {                              // their answer is on its way: written again for this too, same time
      p.token++;
      const old = p.cids; p.cids = [];
      await dropHeld(old);
      return holdOf(c, p);
    }
    if (o.photo || o.voice) return null;                // (never for photos or voice messages)
    const busy = LF().lifeBusy(lifeChar(c), logOf(c.id), now, cfgL(), zone());
    const delay = LF().replyDelay(c, o.via, thread(), now, cfgL(), busy, LF().makeRnd());
    if (!delay) return null;
    const q = { at: now + delay, token: 1, cids: [], priv: !!o.priv };
    replies.set(c.id, q);
    return holdOf(c, q);
  }
  function holdOf(c, p) {
    const token = p.token, busy = LF().lifeBusy(lifeChar(c), logOf(c.id), p.at, cfgL(), zone());   // (busy when it arrives)
    return { at: p.at, token, note: LF().lateNote(base.prompts.late_note, busy),
      done: (ok) => { if (!ok && replies.get(c.id) === p && p.token === token && !p.cids.length) replies.delete(c.id); armTimer(); changed(); } };
  }

  // ---------- texts first: moments written ahead (SPEC3 §11.2) ----------
  const speechOK = () => !!(D() && D()._pure && D()._pure.consts && D()._pure.consts.PM_SPEECH && D().voiceNote);
  function paused() { try { const st = D() ? D().status() : {}; return !!st.credits; } catch (e) { return false; } }   // (credits ran out)
  function onCall(cid) {                                // a call on, or a call turn in the last 2 minutes (buddy_server.on_call)
    const now = nowS();
    if (D() && D().inCall && D().inCall()) return true;
    return thread().some((m) => (!cid || m.char === cid) && m.via === "call" && now - m.ts < 120);
  }
  const canWork = () => ready && hasKey && !paused() && !onCall();
  function exclusive(fn) {                              // one tab at a time does the background work (navigator.locks)
    const lk = root.navigator && root.navigator.locks;
    if (!lk || typeof lk.request !== "function") return fn();
    return lk.request("buddy-work", { ifAvailable: true }, (l) => (l ? fn() : null));
  }
  async function firstText(c, log, date, m, at) {       // buddy_server.first_text for a moment -> {text, voice, sources, mode} | null
    const d = D(), k = kit();
    if (!d || !k || !d.complete) return null;
    const P = d._pure, kc = k.chars.find((x) => x.id === c.id);
    if (!kc) return null;
    const t = thread().filter((x) => x.char === c.id).concat(held.filter((h) => h.char === c.id && !h.priv && h.at < at)
      .sort((a, b) => a.at - b.at).map((h) => ({ ...h.m, ts: h.at })));   // (written ahead before it: as it will be by then)
    let lastTs = 0, lastRole = "", lastYou = 0;
    for (const x of t) if ((x.role === "user" || x.role === "assistant") && x.ts >= lastTs) { lastTs = x.ts; lastRole = x.role; }
    for (const x of thread()) if (x.role === "user" && x.ts > lastYou) lastYou = x.ts;
    const idle = lastYou ? Math.max(0, (at - lastYou) / 60) : 24 * 60;   // (how long since you last texted anyone)
    const instr = LF().instruction(base.templates, lifeChar(c), log, date, m, at, false, idle, zone());
    const r6 = P.recentMessages(t, 6, false, c.id), r20 = P.recentMessages(t, 20, false, c.id), mode = c.brain === "companion" ? "companion" : "advisor";
    const sp = P.systemPrompt({ kit: k, kchar: kc, modeUsed: mode, via: "phone", extra: [], asking: false, lastTs, lastRole, nowSec: at, length: "",
      query: r6.map((x) => x.content).join(" ") || "recent plans, people, worries, events in my life", partner: k.edition.partner, proactive: true });
    const messages = [{ role: "system", content: sp.text }].concat(P.alternate(r20.concat([{ role: "user", content: instr }])));
    let txt;
    try { txt = await d.complete(null, { messages, mode, temperature: 1.0, cap: 400, timeout: 120000 }); } catch (e) { return null; }
    txt = LF().cleanFirst(P.noTags(P.picTags(txt)[0]));  // (however they wrote a photo: never shown as words; phones make none)
    let voice = null;
    if (m.angle === "voice" && txt && speechOK()) { try { voice = await d.voiceNote(txt, c.voice); } catch (e) { voice = null; } }
    return { text: LF().parts(txt, !!voice).join("\n\n"), voice, sources: sp.used, mode };
  }
  const momentItem = (c, date, mid, at, out, cid) => ({ cid, role: "assistant", content: out.text, char: c.id, ts: at, mode: out.mode,
    proactive: true, life: date + "/" + mid, held: true, at, ...(out.sources && out.sources.length ? { sources: out.sources } : {}),
    ...(out.voice ? { voice: out.voice } : {}) });
  // a moment's id: per plan (the day's `planned`), so a day planned again ("Redo today", "Start over") never reuses the
  // id of a text first already shown; devices sharing the day record still agree on it
  const momentId = (cid, date, mid) => { const d = dayRecs.get(cid + "/" + date); return LF().momentCid(cid, date, mid + "@" + Math.round(Number((d && d.planned) || 0) * 1000)); };
  async function writeMoment(c, date, mid, at) {        // one text first, written now and held until its time
    const m = momentOf(c.id, date, mid);
    if (!m || m.state !== "pending") return true;
    const g0 = genOf(c.id), e0 = c.epoch;               // (what it's written for)
    const out = await firstText(c, logOf(c.id), date, m, at);
    if (out === null) return false;                     // (couldn't reach Tinfoil: tried again at the next look)
    const cid = await momentId(c.id, date, mid);
    let why = "";
    const stands = () => {                              // (in the write's own step)
      const cn = charOf(c.id), mm = momentOf(c.id, date, mid);
      if (!cn || cn.epoch !== e0 || genOf(c.id) !== g0 || !cn.texts_first || !hasLife(cn) || !mm || mm.state !== "pending") { why = "changed"; return false; }
      if (recOf.has(cid) && !held.some((x) => x.cid === cid)) { why = "shown"; return false; }   // (never written over one shown)
      if (!out.text && !out.voice) { why = "empty"; return false; }
      return true;
    };
    const h = await storeHeld(momentItem(c, date, mid, at, out, cid), false, () => {
      const lg = logOf(c.id), d = LF().day(lg, date), mm = d && d.moments.find((x) => x.id === mid);
      if (!mm) return [];
      mm.state = "scheduled"; mm.cid = cid;             // (pending → scheduled: written, waiting for its time)
      return [{ kind: "day", id: c.id + "/" + date, d: { char: c.id, ...d }, opts: { char: c.id } }];
    }, stands);
    if (h) return true;
    if (why === "empty" || why === "shown") { await changeLog(c.id, (lg) => LF().mark(lg, date, mid, "skipped")); return true; }
    writeSoon();                                        // (things changed while it was written: let go, written again with
    return false;                                       //  what's true now, by schedule()'s rules)
  }
  function writeSoon() {
    if (!started) return;
    clearTimeout(againT);
    againT = setTimeout(() => { exclusive(() => writeAhead()).catch(() => {}); }, AGAIN_MS);
  }
  async function writeAhead() {                         // the moments that still stand, within 48 h, written ahead
    if (writing) return;
    writing = true;
    try { await writeAhead1(); } finally { writing = false; }
  }
  async function writeAhead1() {
    const now = nowS(), z = zone(), cs = lifeChars(), s = cfgL();
    if (!cs.length) return;
    const logs = {}, cm = {};
    for (const c of cs) { logs[c.id] = logOf(c.id); cm[c.id] = c; }
    const conv = thread().concat(held.map((h) => ({ role: h.m.role, char: h.char, ts: h.at, proactive: !!h.m.proactive,
      content: h.m.content || (h.m.voice ? "(voice)" : ""), via: "phone" })));    // (what's written ahead counts at its time)
    const plan = LF().schedule(logs, cm, now, s, conv, z), today = LF().lifeDate(now, z);
    for (const x of plan.expired) {                     // (let go only once its time has really passed)
      const m = momentOf(x.cid, x.date, x.mid);
      if (m && m.state === "pending" && (x.date < today || now - m.due > LF().LATE)) await changeLog(x.cid, (lg) => LF().mark(lg, x.date, x.mid, "skipped"));
    }
    for (const x of plan.send) {
      if (!canWork()) break;
      if (!(await writeMoment(cm[x.cid], x.date, x.mid, x.at))) break;
    }
  }
  const afterChat = () => { const v = cfgL().life_after_chat_min; return (typeof v === "number" && v >= 0 ? v : 25) * 60; };   // (pick()'s wait)
  function onYourMessage(char, ts) {                    // you texted them: their held moments within 25 min go, the others
    const near = afterChat(), drop = [], move = [];     // are written again; other characters' wait until 25 min after it
    let again = false;
    bumpAll();                                          // (a text first being written now didn't see this: let go)
    for (const h of held) {
      if (!h.life || h.at <= ts) continue;
      if (h.char === char) { if (h.at - ts < near) drop.push(h); else again = true; }
      else if (h.at - ts < near) move.push(h);
    }
    if (drop.length) cancelMoments(drop).catch(() => {});
    for (const h of move) postpone(h, ts + near).catch(() => {});
    if (again) rewriteLater(char);
  }
  function rewriteLater(char) {
    if (!started) return;
    clearTimeout(rewriteT.get(char));
    rewriteT.set(char, setTimeout(() => { rewriteT.delete(char); exclusive(() => rewrite(char)).catch(() => {}); }, REWRITE_MS));
  }
  function cancelMoments(list0) {                       // (one step, queued at once: a look right after sees it)
    return serial(async () => {
      await dropHeldRaw(list0.map((h) => h.cid));
      for (const h of list0) { const [date, mid] = h.life.split("/"); await saveLog(h.char, LF().mark(logOf(h.char), date, mid, "skipped")); }
    });
  }
  async function postpone(h, at) {                      // later, as pick() waits 25 minutes after any message
    const [date, mid] = h.life.split("/"), m = momentOf(h.char, date, mid);
    if (!m || at - m.due > LF().LATE || LF().quietAt(at, cfgL(), zone())) return cancelMoments([h]);   // (pick() would let it go)
    const d = { ...h.d, at: Math.round(at * 1000), ts: at };
    await serial(() => save([{ kind: "msg", id: h.cid, d, opts: { char: h.char, at: d.at } }]));
    h.d = d; h.at = at; h.m.ts = at; recOf.set(h.cid, d);
    armTimer();
  }
  async function rewrite(char) {                        // their held moments written again with what's been said since
    const c = charOf(char);
    if (!c || !canWork()) return;
    for (const h of held.filter((x) => x.char === char && x.life && !x.priv && x.at - nowS() >= afterChat())) {
      const [date, mid] = h.life.split("/"), m = momentOf(char, date, mid);
      if (!m) continue;
      const g0 = genOf(char), e0 = c.epoch;
      const out = await firstText(lifeChar(c), logOf(char), date, m, h.at);
      if (!out || (!out.text && !out.voice)) continue;
      const done = await storeHeld(momentItem(c, date, mid, h.at, out, h.cid), false, null, () => {   // (it went, or things
        const cn = charOf(char);                                                                      //  changed meanwhile)
        return held.includes(h) && !!cn && cn.epoch === e0 && genOf(char) === g0;
      });
      if (!done && held.includes(h)) { rewriteLater(char); return; }   // (something was said meanwhile: again, with that too)
    }
  }

  // ---------- planning a day (buddy_server.plan_day) ----------
  function morningAfter(now) {                          // tomorrow, as its day starts (planned the evening before)
    const z = zone(), s = settings(), q0 = Number(s.quiet_until), q = q0 >= 4 && q0 <= 14 ? q0 : 8;
    const h = Math.floor(q), mi = Math.round((q - h) * 60) % 60;
    return LF().ts(LF().addDays(LF().lifeDate(now, z), 1), `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, z);
  }
  async function planDay(c0, o) {                       // one model call (their brain, thinking off); -> true if planned
    o = o || {};
    if (planning || !ready || !hasKey || onCall() || (paused() && !o.asked)) return false;
    planning = true;
    try {
      const c1 = charOf(c0.id);
      if (!c1 || !hasLife(c1)) return false;
      const c = lifeChar(c1), z = zone(), s = cfgL(), now = o.tomorrow ? morningAfter(nowS()) : nowS();
      const t = thread(), st = LF().threadState(t, now, z);
      if (!LF().needsPlan(logOf(c.id), c, s, now, st, z, !!o.lazy)) return false;
      const log = await changeLog(c.id, (lg) => LF().attempted(lg, now, z));
      const cs = lifeChars(), w = world(), logs = {};
      for (const x of cs) logs[x.id] = logOf(x.id);
      const today = LF().lifeDate(now, z), yday = LF().addDays(today, -1);
      let n = c.texts_first ? LF().quota(c, s, st.unanswered[c.id] || 0) : 0;
      if (n === 2 && Math.random() < 0.3) n = 3;        // ("some": now and then a chattier day)
      const others = [];
      for (const [id, lg] of Object.entries(logs)) if (id !== c.id) { const d = LF().day(lg, today); if (d) for (const m of d.moments) if (m.state === "pending" || m.state === "scheduled") others.push(m.due); }
      const rh = LF().rhythm(t, now, z), strangers = LF().undecided(c.id, cs, w), voice = speechOK(), sigNow = await LF().sig(c);
      const own = (date) => t.filter((m) => m.char === c.id && m.role === "assistant" && !m.private && m.content && LF().lifeDate(m.ts, z) === date).map((m) => m.content);
      const prompt = LF().planPrompt(base.templates.plan, c, log, now, s, { ownYesterday: own(yday), nMoments: n, photos: false, ownToday: own(today),
        friends: LF().friendsText(c.id, cs, logs, now, w, [], z), strangers: strangers.map((x) => [x.name, x.tagline || ""]),
        active: LF().activeText(rh, s), voice, sigNow, tz: z }).prompt;
      const j = LF().parse(await D().complete(prompt, { mode: c.brain === "companion" ? "companion" : "advisor", temperature: 0.9, cap: 1500 }));
      if (!charOf(c.id)) return false;                  // (deleted while it was being planned)
      const at = o.tomorrow ? now : nowS();
      await changeLog(c.id, (lg) => LF().applyPlan(lg, j, c, at, s, { nMoments: n, othersDue: others, photos: false, rnd: LF().makeRnd(), rh, voice, sigNow, tz: z }));
      if (strangers.length) await serial(async () => { for (const ch of LF().decide(c.id, j, strangers, world())) await saveTie(ch); });
      if (started && o.lazy) setTimeout(() => { exclusive(() => writeAhead()).catch(() => {}); }, 0);   // (planned on a chat: its moments)
      return true;
    } catch (e) { return false; }                       // (tried again in 20 minutes, at most 3 times a day)
    finally { planning = false; }
  }
  async function lifeTick() {                           // plan what's due (one at a time), then write the moments ahead
    if (!ready || lifeRunning) return;
    lifeRunning = true;
    try {
      revealDue();
      if (!settings().lives || !canWork()) return;
      const z = zone(), s = cfgL();
      for (const c of lifeChars()) {
        if (onCall()) return;
        const now = nowS();
        if (LF().needsPlan(logOf(c.id), c, s, now, LF().threadState(thread(), now, z), z, false)) await planDay(c, {});
      }
      const h = LF().lt(nowS(), z).h;
      if (h >= 18 || h < LF().DAY_STARTS) for (const c of lifeChars()) {   // after 18:00 tomorrow too
        if (onCall()) return;
        const m = morningAfter(nowS());
        if (LF().needsPlan(logOf(c.id), c, s, m, LF().threadState(thread(), m, z), z, false)) await planDay(c, { tomorrow: true });
      }
      await writeAhead();
      revealDue();
    } catch (e) { /* tried again at the next look */ }
    finally { lifeRunning = false; armTimer(); }
  }

  // ---------- learning (facts.learn while the app is open; facts.tick's rules) ----------
  const learnState = (cid) => F().cstate(learnRecs.get(cid), learnMeta.boot);
  async function saveLearn(cid, st) {                   // (inside serial) the bookmark: ids and times only
    const d = { char: cid, seen: st.seen, off: st.off, last: st.last, fails: st.fails, next: st.next, why: st.why || "", pre: false, claim: null };
    await save([{ kind: "learn", id: cid, d, opts: { char: cid } }]); learnRecs.set(cid, d);
  }
  const saveRuns = () => ST().setMeta("learn", { boot: learnMeta.boot, runs: learnMeta.runs });
  function kick(cid, urgent) {                          // a reply was kept (never a private one): maybe learn now
    kicks.set(cid, kicks.get(cid) || !!urgent);
    if (started) setTimeout(() => { exclusive(() => learnTick()).catch(() => {}); }, 1500);
  }
  function kickFor(m) {                                 // urgent when you asked them to remember something
    const u = m.reply_to ? msgs.find((x) => x.cid === m.reply_to) : null;
    kick(m.char, !!(u && F().remembered(u.content || "")) && !m.knows);
  }
  async function skipLearn(cid, ms) {                   // learning is off: the bookmark moves past what's said meanwhile
    const st2 = F().skipTo(cid, learnState(cid), ms);
    if (st2) await serial(() => saveLearn(cid, st2));
  }
  async function resumeLearn(ids) { const ms = thread(); for (const id of ids) await skipLearn(id, ms); }   // (facts.resume)
  async function learnTick() {                          // facts.tick: who's due (urgent 20 s after the last run, else the debounce)
    if (!ready || learnRunning) return;
    learnRunning = true;
    try {
      const s = settings(), ms = thread(), cs = list();
      for (const c of cs) if (!s.learn_facts || !c.learns) { kicks.delete(c.id); await skipLearn(c.id, ms); }
      if (!s.learn_facts || !hasKey) { kicks.clear(); return; }
      if (paused()) return;                             // (credits ran out: the kicks stay, nothing said meanwhile is missed)
      for (const c of cs) {
        if (!c.learns || !ready) continue;
        const urgent = kicks.get(c.id) || false, now = nowS(), st = learnState(c.id);
        try {
          if (now >= (holdLearn.get(c.id) || 0) && F().due(c.id, st, learnMeta.runs, ms, now, urgent, onCall(c.id))) { kicks.delete(c.id); await learnOne(c, ms, now); }
          else if (!urgent || !F().pending(c.id, ms, st.seen)) kicks.delete(c.id);   // (an urgent one is looked at again soon)
        } catch (e) { holdLearn.set(c.id, now + 600); } // (the last resort, as facts._hold)
      }
    } finally { learnRunning = false; }
  }
  async function learnOne(c, ms, now) {                 // one run: the Advisor (thinking off, Tinfoil only), every guard
    const d = D(), epoch0 = c.epoch;
    if (!d || !d.complete) return 0;
    const r = await F().learnRun({ tpl: base.templates.learn.extract, char: { id: c.id, name: c.name }, st: learnState(c.id), msgs: ms,
      lists: async () => ({ own: facts.get(c.id) || null, shared: facts.get(EVERYONE) || null }), sharedOn: !!c.shared_facts,
      ask: (p) => d.complete(p, { temperature: 0.2, cap: 800 }), now, ctx: { hlc, today: isoDay() },
      stillThere: (m) => recOf.has(m.cid) && !!charOf(c.id) && charOf(c.id).epoch === epoch0,
      locked: (fn) => serial(async () => {
        const res = await fn(), list0 = Object.entries(res.changed).map(([owner, x]) => ({ kind: "facts", id: owner, d: x }));
        if (list0.length) { await save(list0); for (const [owner, x] of Object.entries(res.changed)) facts.set(owner, x); kitC = null; }
        return res;
      }) });
    if (!r.ran) return 0;
    learnMeta.runs = learnMeta.runs.filter((t) => t > now - 3600).concat([now]);
    await serial(async () => { await saveLearn(c.id, r.st); await saveRuns(); });
    if (r.more) kick(c.id, false);
    return r.n;
  }

  // ---------- the clock: looks every so often while the app is open ----------
  const visibleNow = () => { try { return !root.document || !root.document.visibilityState || root.document.visibilityState === "visible"; } catch (e) { return true; } };
  async function tick() {                               // (the page: on open, when shown or hidden; and every so often)
    if (!ready) return;
    revealDue();
    await exclusive(async () => { await learnTick(); await lifeTick(); });
  }
  function start() {                                    // (the page, once it's up) background work while the app is open
    if (!ready || started) return;
    started = true;
    startTimers();
    setTimeout(() => { tick().catch(() => {}); }, 1500);   // (after the page has painted)
  }
  function startTimers() {
    stopTimers();
    tickT = setInterval(() => { if (visibleNow()) exclusive(() => learnTick()).catch(() => {}); }, TICK_MS);
    lifeT = setInterval(() => { if (visibleNow()) exclusive(() => lifeTick()).catch(() => {}); }, LIFE_TICK_MS);
    armTimer();
  }
  function stopTimers() {
    clearInterval(tickT); clearInterval(lifeT); clearTimeout(timerT); clearTimeout(againT);
    for (const t of rewriteT.values()) clearTimeout(t);
    rewriteT.clear();
  }

  // ---------- /api/lives* (as on the Mac) ----------
  const livesOut = (c) => ({ ...LF().info(lifeChar(c), logOf(c.id), world(), list().map(lifeChar), cfgL(), nowS(), zone()), solo: true });
  function creditsNote() { try { const st = D() ? D().status() : {}, k = kit(); return st.credits && k ? (st.credits === "limit" ? k.billing.limit : k.billing.out) : ""; } catch (e) { return ""; } }
  async function livesPost(p, j) {
    const c = charOf(String(j.char || ""));
    if (!c) return json(404, { error: T.nochar });
    bump(c.id);                                         // (a text first being written for the old day is let go)
    if (p === "/api/lives/reset") {                     // start their life over (a new one is planned when due)
      await cancelMoments(held.filter((h) => h.char === c.id && h.life));
      await serial(() => dropLife(c.id, false));
    } else if (p === "/api/lives/today") {              // redo today (one model call)
      const today = LF().lifeDate(nowS(), zone());
      await dropHeld(held.filter((h) => h.char === c.id && h.life && h.life.startsWith(today + "/")).map((h) => h.cid));
      await changeLog(c.id, (lg) => ({ ...lg, attempt: {}, days: lg.days.filter((d) => d.date !== today) }));
      if (!(await planDay(c, { lazy: true, asked: true })))
        return json(503, { error: creditsNote() || "Couldn't plan their day right now. Try again in a minute?", ...livesOut(c) });
      exclusive(() => writeAhead()).catch(() => {});
    } else {
      await changeLog(c.id, (lg) => LF().edit(lg, c.id, j, nowS()));
      const gone = held.filter((h) => { if (h.char !== c.id || !h.life) return false; const [date, mid] = h.life.split("/"), m = momentOf(c.id, date, mid); return !m || m.state === "skipped"; });
      if (gone.length) await dropHeld(gone.map((h) => h.cid));   // (a removed event isn't texted about)
      for (const t of Array.isArray(j.ties) ? j.ties : []) {
        const o = t && typeof t === "object" ? charOf(String(t.id || "")) : null;
        if (o && (t.know === true || t.know === false || t.know === null)) await serial(() => saveTie(LF().setTie(world(), c.id, o.id, t.know, String(t.how || ""), "you")));
      }
    }
    return json(200, { ok: true, ...livesOut(c) });
  }

  // ---------- pictures you put on a character (upload only: the phone makes none) ----------
  async function loadPic(kind, c) {
    const ref = kind === "avatar" ? c.avatarRef : c.wallRef, v = kind === "avatar" ? c.avatar : c.wallpaper, key = kind + "|" + c.id;
    const had = pics.get(key);
    if (had && had.v === v) return;
    if (had) { try { URL.revokeObjectURL(had.url); } catch (e) { /* gone */ } pics.delete(key); }
    if (!ref || !v) return;
    try {
      const ct = await ST().getMedia(ref.bid);
      if (ct) pics.set(key, { v, url: URL.createObjectURL(new Blob([await openRef(ref, ct)], { type: ref.t || "image/jpeg" })) });
    } catch (e) { /* the initial shows instead */ }
  }
  async function loadPics() { for (const c of list()) { await loadPic("avatar", c); await loadPic("wall", c); } }
  const avatarURL = (id, v) => { const p = pics.get("avatar|" + id); return p && (!v || p.v === v) ? p.url : null; };
  const wallURL = (id, v) => { const p = pics.get("wall|" + id); return p && (!v || p.v === v) ? p.url : null; };

  // ---------- this device's Tinfoil key ----------
  const KEY_RE = /^[\x21-\x7e]{16,400}$/;
  async function key() {                                // (source) decrypted once per page load, kept only in memory
    if (tkey) return tkey;
    if (!ready || !hasKey) return null;
    try { const k = await ST().getSecret("tinfoil"); tkey = typeof k === "string" ? k : null; return tkey; } catch (e) { return null; }
  }
  async function setKey(k) {
    k = CH().pyStrip(String(k == null ? "" : k));
    if (!KEY_RE.test(k)) return { ok: false, error: T.keyfmt };
    if (!ready) return { ok: false, error: T.notready };
    try { await ST().setSecret("tinfoil", k); } catch (e) { return { ok: false, error: T.store }; }
    tkey = k; hasKey = true;
    return { ok: true };
  }
  async function forgetKey() { tkey = null; hasKey = false; try { await ST().delSecret("tinfoil"); } catch (e) { /* next start */ } }
  async function check() {                              // attestation, the model list and a 1-token request (direct.js)
    if (!hasKey) return { ok: false, error: T.solokey };
    const d = D();
    if (!d) return { ok: false, error: T.notready };
    return d.check();
  }

  // ---------- the routes ----------
  async function bodyJSON(init) {
    const b = init && init.body;
    if (b == null || b === "") return {};
    const j = JSON.parse(typeof b === "string" ? b : await new Response(b).text());
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("bad request");
    return j;
  }
  async function route(method, p, q, init) {            // (source) -> a Response, or null for direct.js's shared routes
    if (!ready) return null;                            // (direct.js: 503 "still starting")
    try { return await routes(method, p, q, init); }
    catch (e) {
      if (e && e.status) return json(e.status, { error: e.text || e.message });
      if (e && (e.message === "bad request" || e.name === "SyntaxError")) return json(400, { error: "bad request" });
      if (e && e.looks) return json(400, { error: e.message });
      throw e;
    }
  }
  async function routes(method, p, q, init) {
    if (method === "GET") {
      if (p === "/api/status") return json(200, status());
      if (p === "/api/version") return json(200, { version: version || "dev" });
      if (p === "/api/characters") return json(200, list().map(pageChar));
      const pic = /^\/api\/characters\/([a-z0-9-]{1,40})\/(avatar|wallpaper)$/.exec(p);
      if (pic) return picRoute(pic[1], pic[2]);
      if (p === "/api/voices") return json(200, base.voices);
      if (p === "/api/settings") return json(200, settingsOut());
      if (p === "/api/thread") return json(200, thread(parseInt(q.get("after") || "0", 10) || 0));
      if (p === "/api/images") return json(200, imagesOut());
      if (p === "/api/knows") { await serial(() => null); return knowsRoute(q.get("char") || ""); }   // (after the writes queued before)
      if (p === "/api/lives") { await serial(() => null); return livesRoute(q.get("char") || ""); }
      if (p.startsWith("/api/media/")) return mediaRoute(p, q);
      return null;
    }
    if (method !== "POST") return null;
    if (p === "/api/settings") return settingsRoute(await bodyJSON(init));
    if (p === "/api/newchat") return newchatRoute(await bodyJSON(init));
    if (p === "/api/react") return reactRoute(await bodyJSON(init));
    if (p === "/api/knows/fact") return factRoute(await bodyJSON(init));
    if (p === "/api/characters/save") {
      const j = await bodyJSON(init), c0 = j.character || {}, was = typeof c0.id === "string" ? charOf(c0.id) : null;
      const out = await saveChar(c0);
      if (was && !was.learns && out.learns) await resumeLearn([out.id]);   // back on: nothing said while it was off is learned
      return json(200, { ok: true, character: out });
    }
    if (p === "/api/lives/save" || p === "/api/lives/today" || p === "/api/lives/reset") return livesPost(p, await bodyJSON(init));
    if (p === "/api/characters/create") return createRoute(await bodyJSON(init), init && init.signal);
    if (p === "/api/characters/delete") return deleteRoute(await bodyJSON(init));
    if (p === "/api/characters/forget") return forgetRoute(await bodyJSON(init));
    if (p === "/api/characters/avatar/upload") return uploadRoute(await bodyJSON(init));
    if (p === "/api/characters/wallpaper/remove") return wallRemoveRoute(await bodyJSON(init));
    if (/^\/api\/characters\/(avatar|wallpaper|avatar\/undo)$/.test(p)) return json(403, { error: T.pictures });
    return null;
  }
  function status() {
    const d = D(), st = d ? d.status() : {};
    return { name: base.builtin.name || "Buddy", voice: kit() ? kit().voice.default : base.voice.default, paired: true,
      companion_ready: hasKey, companion_provider: "tinfoil", phala_key: false, tinfoil_key: hasKey, near_key: false,
      memory_notes: 0, memory: { notes: 0 }, pid: 1, boot: "site", solo: true, edition: "public",
      credits: st.credits || null, credits_note: st.credits && kit() ? (st.credits === "limit" ? kit().billing.limit : kit().billing.out) : "",
      verified: st.verified === undefined ? null : st.verified, release: st.release || "" };
  }
  function settingsOut() {
    const s = settings(), pn = ED().partnerOf(s);
    return { proactive: false, push_ready: false, phones: 0, learn_facts: s.learn_facts, push_preview: s.push_preview, lives: s.lives,
      life_texts: s.life_texts, quiet_from: s.quiet_from, quiet_until: s.quiet_until, real_timing: s.real_timing, pictures: "off",
      see_photos: s.see_photos, free_brain: false, has_partner: pn.has, partner_at: pn.at, partner_noask: pn.noask,
      language: s.language, tz: s.tz, voice: s.voice };
  }
  async function settingsRoute(j) {
    const patch = {}, b = (k) => { if (hasOwn(j, k)) { if (typeof j[k] !== "boolean") throw bad(400, k + " is true or false"); patch[k] = j[k]; } };
    for (const k of ["see_photos", "learn_facts", "push_preview", "lives", "real_timing"]) b(k);
    if (hasOwn(j, "life_texts")) { if (!["few", "some", "lots"].includes(j.life_texts)) throw bad(400, "life_texts is few, some or lots"); patch.life_texts = j.life_texts; }
    for (const k of ["quiet_from", "quiet_until"]) if (hasOwn(j, k)) {
      const v = Number(j[k]);
      if (typeof j[k] !== "number" || !(v >= 0 && v <= 24)) throw bad(400, k + " is an hour (0-24)");
      patch[k] = v;
    }
    if (hasOwn(j, "has_partner")) {
      try { Object.assign(patch, ED().settingsChange(j.has_partner, nowS())); } catch (e) { throw bad(400, e.message); }
    }
    if (hasOwn(j, "partner_noask")) patch.partner_noask = !!j.partner_noask;
    if (hasOwn(j, "language")) { if (j.language !== "" && !/^[a-z]{2,3}$/.test(String(j.language))) throw bad(400, "language is a 2-3 letter code"); patch.language = j.language; }
    if (hasOwn(j, "tz")) { if (j.tz !== "" && !TZ_RE.test(String(j.tz))) throw bad(400, "that isn't a time zone"); patch.tz = j.tz; }
    if (hasOwn(j, "voice")) { if (!base.voice.ids.includes(j.voice)) throw bad(400, "unknown voice"); patch.voice = j.voice; }
    if (hasOwn(j, "pictures") && j.pictures !== "off") throw bad(400, T.pictures);
    if (hasOwn(j, "free_brain") && j.free_brain) throw bad(400, T.site);
    if (hasOwn(j, "proactive") && j.proactive) throw bad(400, "Texting first while Buddy is closed needs sync (coming soon).");
    const was = settings();
    if (["lives", "life_texts", "quiet_from", "quiet_until", "tz"].some((k) => hasOwn(patch, k))) bumpAll();
    await setSettings(patch);
    if (patch.learn_facts && !was.learn_facts) await resumeLearn(list().map((c) => c.id));   // (nothing said while it was off)
    if (patch.lives === false && was.lives) await cancelMoments(held.filter((h) => h.life));   // (no texts first about their lives)
    if (started && (patch.lives || patch.life_texts || hasOwn(patch, "quiet_from") || hasOwn(patch, "quiet_until"))) setTimeout(() => { tick().catch(() => {}); }, 500);
    return json(200, { ok: true, ...settingsOut() });
  }
  function imagesOut() {
    const k = kit(), see = !!(k && k.see_photos);
    return { available: false, provider: null, pictures: "off", label: null, eta_s: null, local: null, near: null, near_key: false,
      vision: { available: hasKey && see, model: hasKey && k ? k.models.vision_order[0] || null : null }, see_photos: see };
  }
  async function newchatRoute(j) {
    const c = charOf(String(j.char || "buddy")) || charOf("buddy");
    const p = replies.get(c.id);                        // (a New chat: an answer still on its way isn't given, as on the Mac)
    if (p) { replies.delete(c.id); await dropHeld(p.cids); }
    const m = await add({ role: "break", content: "", char: c.id, ts: nowS() }, false, false);
    return m ? json(200, { ok: true }) : json(503, { error: T.store });
  }
  async function reactRoute(j) {                        // your reaction to a message ("" takes it back)
    const d = D(), e = d ? d._pure.reaction(j.emoji) || "" : "";
    const m = Number.isInteger(j.id) ? msgs.find((x) => x.id === j.id) || livePriv().find((x) => x.id === j.id) : null;
    if (!m || (m.role !== "user" && m.role !== "assistant") || (j.emoji && !e)) return json(404, { error: "no such message" });
    const it = { role: "reaction", content: "", char: m.char, ts: nowS(), emoji: e, by: "you" };
    if (m.private) it.target = m.id; else it.target_cid = m.cid;
    const r = await add(it, !!m.private, false);
    return r ? json(200, { ok: true }) : json(503, { error: T.store });
  }
  async function mediaRoute(p, q) {
    let id;
    try { id = decodeURIComponent(p.slice("/api/media/".length).split("/")[0]); } catch (e) { id = ""; }
    const cid = id.startsWith("local:") ? id.slice(6) : null;
    const m = cid && (msgs.find((x) => x.cid === cid) || priv.find((x) => x.cid === cid));
    if (!m) return json(404, { error: "no picture" });
    const which = q.get("v") === "1" && m.image ? "view" : m.image ? "full" : m.voice ? "audio" : null;
    const b = which && (await blobOf(cid, which));
    if (!b) return json(404, { error: "no picture" });
    return new Response(b, { status: 200, headers: { "Content-Type": b.type || "application/octet-stream" } });
  }
  async function picRoute(id, kind) {
    const c = charOf(id), ref = c && (kind === "avatar" ? c.avatarRef : c.wallRef);
    if (!ref) return json(404, { error: "no picture" });
    try {
      const ct = await ST().getMedia(ref.bid);
      if (!ct) return json(404, { error: "no picture" });
      return new Response(new Blob([await openRef(ref, ct)], { type: ref.t || "image/jpeg" }), { status: 200, headers: { "Content-Type": ref.t || "image/jpeg" } });
    } catch (e) { return json(404, { error: "no picture" }); }
  }

  // ---------- "What X knows" (facts.change on records) ----------
  function knowsRoute(cid) {
    const c = charOf(cid);
    if (!c) return json(404, { error: T.nochar });
    const s = settings(), n0 = livePriv().filter((m) => m.char === cid);
    const fades = n0.length ? Math.max(0, Math.ceil((Math.min(...n0.map((m) => m.ts)) + 12 * 3600 - nowS()) / 3600)) : 0;
    const ls = learnState(c.id);
    return json(200, { char: c.id, name: c.name, learns: c.learns, learning: s.learn_facts, paused: ls.fails && ls.why ? ls.why : "", solo: true,
      facts: F().listing(c.id, facts.get(c.id) || null, facts.get(EVERYONE) || null, !!c.shared_facts),
      files: { mine: "only " + c.name, everyone: "every character" },
      notes: { folders: [], root: { notes: 0, readable: 0 }, own_chats: 0, avoided: 0, avoid: [], indexed: 0 }, chats: [],
      photos: { from_them: 0 }, private_now: { messages: n0.filter((m) => !m.image).length, photos: n0.filter((m) => m.image).length, fades_in_h: fades } });
  }
  async function factRoute(j) {
    const c = charOf(String(j.char || ""));
    if (!c) return json(404, { error: T.nochar });
    return serial(async () => {
      const ctx = { hlc, today: isoDay(), sharedOn: !!c.shared_facts };
      let r;
      try { r = await F().change(c, j, { own: facts.get(c.id) || null, shared: facts.get(EVERYONE) || null }, ctx); }
      catch (e) {
        if (e.status === 409) return json(409, { error: "changed", facts: F().listing(c.id, facts.get(c.id) || null, facts.get(EVERYONE) || null, !!c.shared_facts) });
        if (e.status === 400) return json(400, { error: e.message });
        throw e;
      }
      const list0 = Object.entries(r.changed).map(([owner, d]) => ({ kind: "facts", id: owner, d }));
      if (list0.length) {
        try { await save(list0); } catch (e) { return json(503, { error: T.store }); }
        for (const [owner, d] of Object.entries(r.changed)) facts.set(owner, d);
        kitC = null;
      }
      return json(200, { ok: true, facts: r.listing });
    });
  }
  function livesRoute(cid) {                            // one character's own life (and who they know)
    const c = charOf(cid);
    if (!c) return json(404, { error: T.nochar });
    return json(200, livesOut(c));
  }

  // ---------- characters ----------
  function exFields(c) {                                // a character as characters.clean's "existing"
    const o = {};
    for (const k of CHAR_FIELDS) o[k] = c[k];
    o.persona = fullPersona(c);
    o.knowledge = { scope: c.shared_facts ? "all" : "none", folders: [], avoid: "" };
    return o;
  }
  async function saveChar(c0, opts) {                   // characters.save -> the page's character (throws looks errors)
    if (!c0 || typeof c0 !== "object" || Array.isArray(c0)) throw bad(400, "bad request");
    const out = await serial(async () => {
      const id0 = typeof c0.id === "string" ? c0.id : "", ex = id0 ? charOf(id0) : null;
      const existing = ex ? exFields(ex) : {};
      let data;
      try { data = CH().clean(c0, existing, true, null); } catch (e) { if (e.looks) throw bad(400, e.message); throw e; }
      let id = ex ? id0 : null;
      if (!id) {
        id = CH().newId(data.name, usedIds());
        if (!CH().truthy(c0.color)) data.color = CH().COLORS[list().length % CH().COLORS.length];
      }
      data.created = existing.created || (opts && opts.created) || nowS();
      if (id === "buddy" && data.persona === base.builtin.persona) data.persona = "";   // (unchanged: keeps following persona.txt)
      const sc = c0.knowledge && typeof c0.knowledge === "object" ? c0.knowledge.scope : undefined;
      data.shared_facts = typeof c0.shared_facts === "boolean" ? c0.shared_facts
        : opts && typeof opts.shared === "boolean" ? opts.shared
        : CH().SCOPES.includes(sc) ? sc !== "none" : ex ? !!ex.shared_facts : true;
      const r = chars.get(id) || { id, f: {}, epoch: 0, deleted: null };
      const f = { ...r.f };
      for (const k of CHAR_FIELDS) if (!Array.isArray(f[k]) || JSON.stringify(f[k][1]) !== JSON.stringify(data[k])) f[k] = [hlc(), data[k]];
      const nd = { ...r, id, f, deleted: null };
      await save([{ kind: "char", id, d: nd }]);
      chars.set(id, nd); kitC = null; bump(id);
      return pageChar(charOf(id));
    });
    await dropUnwanted(out.id);
    return out;
  }
  async function dropUnwanted(id) {                     // their held texts first beyond what they may send now (texting first
    const c = charOf(id);                               // or their life turned off, fewer texts a day)
    const mine = held.filter((h) => h.char === id && h.life && !h.priv);
    if (!c || !mine.length) return;
    if (!c.texts_first || !hasLife(c)) { await cancelMoments(mine); return; }
    const n = LF().quota(lifeChar(c), cfgL(), 0), drop = [];
    const byDate = new Map();
    for (const h of mine.sort((a, b) => a.at - b.at)) { const date = h.life.split("/")[0]; byDate.set(date, (byDate.get(date) || []).concat([h])); }
    for (const [date, hs] of byDate) {
      const sent = msgs.filter((m) => m.char === id && m.proactive && m.life && m.life.startsWith(date + "/")).length;
      drop.push(...hs.slice(Math.max(0, n - sent)));
    }
    if (drop.length) await cancelMoments(drop);
  }
  async function createRoute(j, signal) {               // the Advisor writes 1-6 characters (through direct.js's Tinfoil path)
    const desc = CH().pyStrip(String(j.description == null ? "" : j.description));
    if (CH().cpLen(desc) < 3) return json(400, { error: "describe who you want" });
    if (!hasKey) return json(503, { error: T.solokey });
    const d = D();
    if (!d || !d.complete) return json(503, { error: T.notready });
    let text;
    try { text = await d.complete(CH().createPrompt(kit(), desc), { temperature: 1.0, cap: 4000, signal }); }
    catch (e) { return json(e.credits ? 402 : 502, { error: e.text || "Couldn't reach Tinfoil", ...(e.credits ? { credits: true } : {}) }); }
    let items;
    try { items = CH().createItems(text); } catch (e) { return json(502, { error: e.message }); }
    const made = [];
    for (const it of items) {                          // (looks were checked: each saves, as on the Mac, with its own colour)
      try { made.push(await saveChar(it, { shared: true })); } catch (e) { if (e.status !== 400) throw e; }
    }
    if (!made.length) return json(502, { error: "no characters in the reply" });
    return json(200, { created: made });
  }
  async function forgetChar(id, deleted) {              // the conversation (both sides, private too), facts; deleted: the character
    bump(id);
    return serial(async () => {
      bump(id);                                         // (again in its own step: a text first written meanwhile is let go)
      const r = chars.get(id) || { id, f: {}, epoch: 0, deleted: null };
      const nd = { ...r, id, epoch: (r.epoch || 0) + 1 };
      const bids = [];
      if (deleted) {
        for (const k of ["avatar", "wallpaper"]) { const ref = val(r.f, k, null); if (ref && ref.bid) bids.push(ref.bid); }
        nd.f = {}; nd.deleted = hlc();
      }
      const gone = msgs.filter((m) => m.char === id);
      for (const m of gone) {
        const d0 = recOf.get(m.cid);
        if (d0 && d0.photo) for (const k of ["full", "view"]) if (d0.photo[k] && d0.photo[k].bid) bids.push(d0.photo[k].bid);
        if (d0 && d0.voice && d0.voice.bid) bids.push(d0.voice.bid);
      }
      const ev = facts.get(EVERYONE), list0 = [{ kind: "char", id, d: nd }];
      let ev2 = null;
      if (ev && Object.values(ev.aside || {}).some((a) => a && a[1] && hasOwn(a[1], id))) {
        ev2 = JSON.parse(JSON.stringify(ev));
        for (const [f0, a] of Object.entries(ev2.aside)) if (a && a[1] && hasOwn(a[1], id)) F().unset(ev2.aside, f0, id, { hlc });   // (dated)
        list0.push({ kind: "facts", id: EVERYONE, d: ev2 });
      }
      await save(list0);                                // (the new count first: older messages are gone wherever they are)
      await ST().delRecs(gone.map((m) => ["msg", m.cid]).concat([["facts", id]]));
      await ST().delMedia(bids);
      await dropHeldRaw(held.filter((h) => h.char === id).map((h) => h.cid));   // (what was written ahead or held back)
      replies.delete(id); kicks.delete(id); clearTimeout(rewriteT.get(id)); rewriteT.delete(id);
      await dropLife(id, deleted);                      // their days so far (and, for a deleted one, who they know)
      if (deleted) { if (learnRecs.has(id)) { await ST().delRecs([["learn", id]]); learnRecs.delete(id); } }
      else await saveLearn(id, { seen: nextId, off: 0, last: 0, fails: 0, next: 0, why: "" });   // (learning starts afresh)
      chars.set(id, nd); facts.delete(id); if (ev2) facts.set(EVERYONE, ev2);
      for (const m of gone) { recOf.delete(m.cid); dropMedia(m.cid); }
      msgs = msgs.filter((m) => m.char !== id);
      const np = priv.filter((m) => m.char === id).length;
      forgetMemory(id);
      if (deleted) for (const k of ["avatar|", "wall|"]) { const p = pics.get(k + id); if (p) { try { URL.revokeObjectURL(p.url); } catch (e) { /* gone */ } pics.delete(k + id); } }
      kitC = null;
      return { deleted: gone.length + np, epoch: nd.epoch };
    });
  }
  async function forgetRoute(j) {
    const id = String(j.id || "");
    if (!charOf(id)) return json(404, { error: T.nochar });
    const r = await forgetChar(id, false);
    return json(200, { ok: true, deleted: r.deleted, epoch: r.epoch });
  }
  async function deleteRoute(j) {                       // a deleted character takes everything you two said with it
    const id = String(j.id || "");
    if (id === "buddy" || !ID.test(id) || !charOf(id)) return json(200, { ok: false });
    await forgetChar(id, true);
    return json(200, { ok: true });
  }
  async function uploadRoute(j) {                       // your own picture (the page cropped and re-encoded it)
    const c = charOf(String(j.id || ""));
    if (!c) return json(404, { error: T.nochar });
    const s = String(j.image || ""), m = /^data:image\/jpeg;base64,(.*)$/s.exec(s);
    const bytes = C().b64d(m ? m[1] : s);
    let clean;
    try {
      if (!bytes || bytes.length > 12000000) throw new Error("size");
      clean = D()._pure.cleanPhoto(bytes, 4096, 12000000).bytes;
    } catch (e) { return json(400, { error: "that isn't a picture Buddy can use" }); }
    const kind = j.wallpaper ? "wallpaper" : "avatar";
    return serial(async () => {
      const r = chars.get(c.id) || { id: c.id, f: {}, epoch: 0, deleted: null };
      const old = val(r.f, kind, null), a = acct();
      const b = await C().sealBlob(a, C().newBid(), clean);
      await ST().putMedia([{ bid: b.ref.bid, ct: b.ct }]);
      const nd = { ...r, f: { ...r.f, [kind]: [hlc(), { ...b.ref, t: "image/jpeg", a }] } };
      await save([{ kind: "char", id: c.id, d: nd }]);
      chars.set(c.id, nd); kitC = null;
      if (old && old.bid) await ST().delMedia([old.bid]);
      const now = charOf(c.id);
      await loadPic(kind === "avatar" ? "avatar" : "wall", now);
      return json(200, { ok: true, [kind]: kind === "avatar" ? now.avatar : now.wallpaper });
    });
  }
  async function wallRemoveRoute(j) {
    const c = charOf(String(j.id || ""));
    if (!c) return json(404, { error: T.nochar });
    return serial(async () => {
      const r = chars.get(c.id) || { id: c.id, f: {}, epoch: 0, deleted: null };
      const old = val(r.f, "wallpaper", null);
      const nd = { ...r, f: { ...r.f, wallpaper: [hlc(), null] } };
      await save([{ kind: "char", id: c.id, d: nd }]);
      chars.set(c.id, nd); kitC = null;
      if (old && old.bid) await ST().delMedia([old.bid]);
      await loadPic("wall", charOf(c.id));
      return json(200, { ok: true });
    });
  }

  // ---------- a reply's [partner: …] (the public edition: your status, never the words) ----------
  async function partner(said, isPriv) {
    const patch = ED().partnerChange(said, isPriv, nowS());
    try { await setSettings(patch); } catch (e) { error = T.store; }
  }

  // ---------- incoming data is untrusted (a backup file now; sync later): checked like the Mac checks imports ----------
  const isRef = (r) => !!r && typeof r === "object" && BID.test(r.bid) && typeof r.key === "string" && (C().b64d(r.key) || []).length === 32 &&
    typeof r.sha === "string" && Number.isInteger(r.n) && r.n >= 0 && r.n <= 16000000;
  const cleanRef = (r, types, a0) => (isRef(r) && types.includes(r.t || types[0]) && (r.a === undefined || r.a === "" || ACCT.test(String(r.a)))
    ? { bid: r.bid, key: r.key, sha: r.sha, n: r.n, t: r.t || types[0], a: typeof r.a === "string" ? r.a : a0 } : null);   // (a0: the file's account)
  function okSet(d) {
    if (!d || typeof d.f !== "object") return null;
    const f = {};
    for (const [k, v] of Object.entries(d.f)) {
      if (!hasOwn(SET_DEFAULTS, k) || !Array.isArray(v) || v.length !== 2 || !HLC.test(String(v[0]))) continue;
      const dv = SET_DEFAULTS[k], x = v[1];
      const okv = typeof dv === "boolean" ? typeof x === "boolean" : typeof dv === "number" ? typeof x === "number" && Number.isFinite(x)
        : k === "partner_at" ? x === null || (typeof x === "number" && Number.isFinite(x)) : x === null || typeof x === "string";
      if (okv) f[k] = [v[0], x];
    }
    if (f.has_partner && !["yes", "no", ""].includes(f.has_partner[1])) delete f.has_partner;
    return { f };
  }
  function okChar(id, d, a0) {
    if (!ID.test(id) || id === EVERYONE || !d || typeof d !== "object") return null;
    const epoch = Number.isInteger(d.epoch) && d.epoch >= 0 ? d.epoch : 0;
    if (d.deleted) return { id, f: {}, epoch, deleted: HLC.test(String(d.deleted)) ? d.deleted : "0000000000000:0000:x" };
    const f = {}, src = d.f && typeof d.f === "object" ? d.f : {}, plain = {};
    for (const k of CHAR_FIELDS) if (Array.isArray(src[k]) && src[k].length === 2 && HLC.test(String(src[k][0]))) plain[k] = src[k][1];
    let c;
    try { c = CH().clean(plain, defaultsFor(id), false, null); } catch (e) { return null; }   // (looks that fail: kept, no pictures)
    for (const k of CHAR_FIELDS) {
      if (!hasOwn(plain, k)) continue;
      const v = k === "shared_facts" ? !!plain[k] : k === "created" ? (typeof plain[k] === "number" && Number.isFinite(plain[k]) ? plain[k] : 0) : c[k];
      f[k] = [src[k][0], v];
    }
    for (const k of ["avatar", "wallpaper"]) if (Array.isArray(src[k]) && src[k].length === 2 && HLC.test(String(src[k][0])))
      f[k] = [src[k][0], src[k][1] === null ? null : cleanRef(src[k][1], ["image/jpeg"], a0)];
    return { id, f, epoch, deleted: null };
  }
  function okFacts(owner, d) {
    if (!F().isOwner(owner) || !d || typeof d !== "object") return null;
    const out = F().empty(owner);
    for (const [fid0, it] of Object.entries(d.items || {})) {
      if (!/^[0-9a-f]{10}$/.test(fid0) || !it || typeof it !== "object" || !HLC.test(String(it.hlc))) continue;
      let t;
      try { t = F().cleanText(it.text); } catch (e) { continue; }
      if (F().secretish(t)) continue;
      out.items[fid0] = { text: t, date: /^\d{4}-\d{2}-\d{2}$/.test(it.date || "") ? it.date : "", how: it.how === "learned" ? "learned" : "added",
        from: typeof it.from === "string" ? CH().cp(it.from, 40) : "", hlc: it.hlc, o: Number.isFinite(it.o) ? it.o : 0 };
    }
    for (const [fid0, h] of Object.entries(d.del || {})) if (/^[0-9a-f]{10}$/.test(fid0) && HLC.test(String(h))) out.del[fid0] = h;
    for (const [fid0, a] of Object.entries(d.aside || {}))
      if (/^[0-9a-f]{10}$/.test(fid0) && Array.isArray(a) && HLC.test(String(a[0])) && a[1] && typeof a[1] === "object") {
        const m = {};
        for (const [cid, nf] of Object.entries(a[1])) if (ID.test(cid) && (nf === "" || /^[0-9a-f]{10}$/.test(nf))) m[cid] = nf;
        out.aside[fid0] = [a[0], m];
      }
    return out;
  }
  function okMsg(d, a0) {
    if (!d || typeof d !== "object" || !CID.test(String(d.cid)) || !ID.test(String(d.char))) return null;
    if (!["user", "assistant", "reaction", "break"].includes(d.role) || typeof d.content !== "string" || CH().cpLen(d.content) > 20000) return null;
    if (typeof d.ts !== "number" || !Number.isFinite(d.ts) || d.ts <= 0) return null;
    const o = { cid: d.cid, char: d.char, epoch: Number.isInteger(d.epoch) && d.epoch >= 0 ? d.epoch : 0, role: d.role, content: d.content, ts: d.ts };
    if (d.role === "user" || d.role === "assistant") o.via = d.via === "call" ? "call" : "phone";
    if (d.role === "assistant") {
      if (d.mode === "advisor" || d.mode === "companion") o.mode = d.mode;
      if (typeof d.reply_to === "string" && CID.test(d.reply_to)) o.reply_to = d.reply_to;
      if (Array.isArray(d.sources)) { const s = d.sources.filter((x) => x && x.kind === "facts").map((x) => ({ kind: "facts", path: String(x.path || "").slice(0, 80), n: Number(x.n) || 0 })); if (s.length) o.sources = s; }
      if (d.knows) o.knows = true;
      if (d.proactive) o.proactive = true;
      if (typeof d.life === "string" && LIFEREF.test(d.life)) o.life = d.life;
      if (d.late) o.late = true;
    }
    if (d.held && Number.isFinite(d.at) && d.at > 0) { o.held = true; o.at = Math.round(d.at); }
    if (d.role === "reaction") {
      const e = d.emoji === "" ? "" : D() ? D()._pure.reaction(d.emoji) : null;
      if (e === null || (d.by !== "you" && !ID.test(String(d.by))) || !CID.test(String(d.target))) return null;
      Object.assign(o, { emoji: e, by: d.by, target: d.target });
    }
    if (d.photo) {
      const full = cleanRef(d.photo.full, ["image/jpeg"], a0), view = cleanRef(d.photo.view, ["image/jpeg"], a0);
      if (!full || !view || d.role !== "user") return null;
      o.photo = { w: Number(d.photo.w) || 0, h: Number(d.photo.h) || 0, full, view };
      if (typeof d.photo.desc === "string" && d.photo.desc) { o.photo.desc = CH().cp(d.photo.desc, 600); if (/^[A-Za-z0-9._-]{1,64}$/.test(String(d.photo.seen_by || ""))) o.photo.seen_by = d.photo.seen_by; }
      else if (d.photo.seen === false) o.photo.seen = false;
    }
    if (d.voice) {
      const r = cleanRef(d.voice, ["audio/wav", "audio/webm", "audio/ogg", "audio/mp4"], a0);
      if (!r) return null;
      o.voice = { ...r, dur: Math.min(600, Math.max(0, Number(d.voice.dur) || 0)) };
    }
    return o;
  }

  function okLife(id, d) {                              // a life record: each field through lives.clean
    if (!ID.test(id) || !d || typeof d.f !== "object" || !d.f) return null;
    const f = {};
    for (const k of LIFE_FIELDS) {
      const v = d.f[k];
      if (!Array.isArray(v) || v.length !== 2 || !HLC.test(String(v[0]))) continue;
      try { f[k] = [v[0], LF().clean({ [k]: v[1] }, id)[k]]; } catch (e) { /* skipped */ }
    }
    return { char: id, f };
  }
  function okDay(id, d) {                               // a day: through lives.clean (nothing about you, no minors)
    const m = DAYID.exec(id);
    if (!m || !d || typeof d !== "object" || d.date !== m[2]) return null;
    try { const x = LF().clean({ days: [d] }, m[1]).days[0]; return x ? { char: m[1], ...x } : null; } catch (e) { return null; }
  }
  function okTie(k, d) {
    if (!/^[a-z0-9-]{1,40}\+[a-z0-9-]{1,40}$/.test(k) || !d || typeof d !== "object") return null;
    const w = LF().world({ [k]: d })[k];
    return w && w.know !== null ? { pair: k, ...w } : null;
  }

  // ---------- recovery key (for backup files now; sync later) ----------
  async function makeBackupKey() {                      // shown once; nothing is kept until group 14 is typed back
    if (!ready) throw bad(503, T.notready);
    if (pending) pending.K.fill(0);
    const K = C().rand(32), text = await C().keyText(K, "sync");
    pending = { K, text };
    return { text, groups: text.split("-") };
  }
  function cancelBackupKey() { if (pending) pending.K.fill(0); pending = null; }
  async function adopt(newKeys) {                       // (inside serial) this device's keys from now on; media aren't touched
    const from = acct();
    if (from !== newKeys.acct) {                        // references from before ref.a say which account their blob was sealed
      const fix = (ref) => (ref && ref.bid && typeof ref.a !== "string" ? { ...ref, a: from } : ref);   // for (records first:
      const recs = [];                                  // until the keys are written, both ways open them)
      for (const [cid, d] of recOf) {
        if (!d.photo && !d.voice) continue;
        const nd = { ...d };
        if (d.photo) nd.photo = { ...d.photo, full: fix(d.photo.full), view: fix(d.photo.view) };
        if (d.voice) nd.voice = fix(d.voice);
        if (JSON.stringify(nd) === JSON.stringify(d)) continue;
        const m = msgs.find((x) => x.cid === cid);
        recs.push({ kind: "msg", id: cid, d: nd, opts: d.held ? { char: d.char, at: d.at } : { char: d.char, lid: m ? m.id : undefined } });
      }
      const charsNow = [];
      for (const [id, r] of chars) {
        const f = { ...r.f };
        let ch = false;
        for (const k of ["avatar", "wallpaper"]) if (Array.isArray(f[k]) && f[k][1] && typeof f[k][1].a !== "string") { f[k] = [f[k][0], fix(f[k][1])]; ch = true; }
        if (ch) { const nd = { ...r, f }; charsNow.push([id, nd]); recs.push({ kind: "char", id, d: nd }); }
      }
      if (recs.length) {
        await save(recs);
        for (const x of recs) if (x.kind === "msg") { recOf.set(x.id, x.d); const h = held.find((y) => y.cid === x.id); if (h) h.d = x.d; }
        for (const [id, nd] of charsNow) chars.set(id, nd);
      }
    }
    const enc = (x) => C().b64e(x);
    await ST().setSecret("acctkeys", { acct: newKeys.acct, kdata: enc(newKeys.kdata), kname: enc(newKeys.kname), kfile: enc(newKeys.kfile), kid: enc(newKeys.kid) });
    keys = newKeys;
  }
  async function confirmBackupKey(lastGroup) {          // group 14 typed back: the keys it gives are kept, the key itself never
    if (!pending) throw bad(400, T.nofilekey);
    const want = C().norm(pending.text).slice(-4), got = C().norm(lastGroup);
    if (!got) throw bad(400, "Type the last group first.");
    if (got !== want) throw bad(400, T.group);
    const K = pending.K;
    try { await serial(async () => adopt(await C().accountKeys(K))); }
    finally { K.fill(0); pending = null; }
    return { ok: true };
  }
  async function backupInfo() {
    const b = await ST().getMeta("backup").catch(() => null);
    return { key: !!keys, pending: !!pending, last: b ? b.at || 0 : 0, count: b ? b.n || 0 : 0 };
  }

  // ---------- "Back up to a file" (.buddysync, §8.9) ----------
  async function exportFile() {                         // -> {blob, name, records, blobs}; never anything private
    if (!keys) throw bad(400, T.nofilekey);
    return serial(async () => {
      const k = { acct: keys.acct, kdata: keys.kdata, kname: keys.kname };
      const w = C().fileWriter(keys.kid, Date.now());
      let nr = 0, nb = 0;
      const refs = new Set();
      for (const r of await ST().allRecs()) {
        const b = r.body;
        if (ST().hasPrivate(b)) continue;               // (never: put() refuses them; checked again here)
        const rid = await C().rid(keys.kname, b.k, b.id), ver = Math.max(1, r.ver || 0);
        await w.record(rid, ver, await C().sealRecord(k, rid, ver, b)); nr++;
        const d = b.d || {};
        if (b.k === "msg") { if (d.photo) { for (const x of ["full", "view"]) if (d.photo[x] && d.photo[x].bid) refs.add(d.photo[x].bid); } if (d.voice && d.voice.bid) refs.add(d.voice.bid); }
        if (b.k === "char") for (const x of ["avatar", "wallpaper"]) { const ref = val(d.f, x, null); if (ref && ref.bid) refs.add(ref.bid); }
      }
      for (const bid of refs) { const ct = await ST().getMedia(bid); if (ct) { await w.blob(bid, ct); nb++; } }
      const parts = await w.end(keys.kfile);
      const now = new Date();
      await ST().setMeta("backup", { at: Date.now(), n: nr });
      return { blob: new Blob(parts, { type: "application/octet-stream" }), name: `Buddy ${isoDay(now)}.buddysync`, records: nr, blobs: nb };
    });
  }
  async function importFile(file, keyText) {            // restore: only adds (what's here stays, its key too); -> counts
    if (!ready) throw bad(503, T.notready);
    let K;
    try { K = await C().parseKey(keyText, "sync"); } catch (e) { throw bad(400, e.text || e.message); }
    let f, keys2;
    try {
      const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : C().u8(file);
      try { f = C().readFile(bytes); } catch (e) { throw bad(400, e.message); }
      keys2 = await C().accountKeys(K);
    } finally { K.fill(0); }
    if (!C().same(f.kid, keys2.kid)) throw bad(400, T.wrongkey);
    if (!(await f.check(keys2.kfile))) throw bad(400, T.damaged);
    const k = { acct: keys2.acct, kdata: keys2.kdata, kname: keys2.kname }, got = { set: null, char: [], facts: [], msg: [], life: [], day: [], tie: [] };
    let skipped = 0;
    for (const r of f.records) {
      let b;
      try { b = await C().openRecord(k, r.rid, r.ver, r.ct); } catch (e) { skipped++; continue; }
      if (!b || b.v !== 1 || ST().hasPrivate(b)) { skipped++; continue; }
      if (b.k === "learn") continue;                    // (a bookmark of the phone that made it: learning here starts from now)
      const d = b.k === "set" ? okSet(b.d) : b.k === "char" ? okChar(String(b.id), b.d, keys2.acct) : b.k === "facts" ? okFacts(String(b.id), b.d)
        : b.k === "msg" ? okMsg(b.d, keys2.acct) : b.k === "life" ? okLife(String(b.id), b.d) : b.k === "day" ? okDay(String(b.id), b.d)
        : b.k === "tie" ? okTie(String(b.id), b.d) : null;
      if (!d || (b.k === "msg" && d.cid !== b.id)) { skipped++; continue; }
      if (b.k === "set") got.set = d; else got[b.k].push(d);
    }
    const blobs = new Map(f.blobs.map((x) => [x.bid, x.ct]));
    return serial(async () => {
      // This phone's recovery key stays: the file's key only opened the file (its blobs keep the account they were sealed
      // for, ref.a). Only a phone without one yet (a new phone restoring its backup) takes the file's key from now on.
      let key = "same";
      if (!keys) { await adopt(keys2); key = "adopted"; }
      else if (keys.acct !== keys2.acct) key = "kept";
      const recs = [], media = [];
      if (got.set) {                                    // settings: per field, the newer wins
        const fl = { ...setRec.f };
        for (const [k2, v] of Object.entries(got.set.f)) if (!fl[k2] || fl[k2][0] < v[0]) fl[k2] = v;
        setRec = { f: fl }; recs.push({ kind: "set", id: "set", d: setRec });
      }
      // A restore only adds (SPEC3 §8.9): what's on this phone stays. Characters: per field, the newer wins; this phone's
      // count of forgets (epoch) stays, and a deletion or forget on the phone that made the file deletes nothing here;
      // a character deleted here stays deleted
      const fileEpoch = new Map(got.char.map((c) => [c.id, c.epoch]));
      for (const c of got.char) {
        const mine = chars.get(c.id);
        let nd;
        if (mine && mine.deleted) continue;
        if (c.deleted) { if (mine || c.id === "buddy") continue; nd = c; }   // (an id this phone never had: kept unused)
        else if (!mine) nd = { ...c, epoch: 0 };
        else {
          const fl = { ...mine.f };
          for (const [k2, v] of Object.entries(c.f)) if (!fl[k2] || fl[k2][0] < v[0]) fl[k2] = v;
          nd = { id: c.id, f: fl, epoch: mine.epoch || 0, deleted: null };
        }
        for (const x of ["avatar", "wallpaper"]) { const ref = val(nd.f, x, null); if (ref && blobs.has(ref.bid)) media.push({ bid: ref.bid, ct: blobs.get(ref.bid) }); }
        chars.set(c.id, nd); recs.push({ kind: "char", id: c.id, d: nd });
      }
      for (const fx of got.facts) {                     // facts: an add-wins set (a newer add beats an older delete)
        const mine = facts.get(fx.owner) || F().empty(fx.owner), out = JSON.parse(JSON.stringify(mine));
        for (const [id, it] of Object.entries(fx.items)) if (!out.items[id] || out.items[id].hlc < it.hlc) out.items[id] = it;
        for (const [id, h] of Object.entries(fx.del)) if (!out.del[id] || out.del[id] < h) out.del[id] = h;
        for (const [id, a] of Object.entries(fx.aside)) if (!out.aside[id] || out.aside[id][0] < a[0]) out.aside[id] = a;
        facts.set(fx.owner, out); recs.push({ kind: "facts", id: fx.owner, d: out });
      }
      for (const lf of got.life) {                      // lives: per field, the newer wins
        const mine = lifeRecs.get(lf.char), fl = { ...((mine && mine.f) || {}) };
        for (const [k2, v] of Object.entries(lf.f)) if (!fl[k2] || fl[k2][0] < v[0]) fl[k2] = v;
        const nd = { char: lf.char, f: fl }; lifeRecs.set(lf.char, nd); recs.push({ kind: "life", id: lf.char, d: nd, opts: { char: lf.char } });
      }
      for (const dy of got.day) {                       // a day planned here stays (the first plan wins)
        const id = dy.char + "/" + dy.date;
        if (dayRecs.has(id)) continue;
        dayRecs.set(id, dy); recs.push({ kind: "day", id, d: dy, opts: { char: dy.char } });
      }
      for (const t of got.tie) {                        // who knows whom: yours beats the AI's
        const mine = tieRecs.get(t.pair);
        if (mine && !(t.by === "you" && mine.by !== "you")) continue;
        tieRecs.set(t.pair, t); recs.push({ kind: "tie", id: t.pair, d: t });
      }
      const epochOf = (c) => ((chars.get(c) || {}).epoch || 0);
      // messages: only ones this phone hasn't got; not ones older than a forget on the phone that made the file, nor than
      // one here (what was forgotten stays forgotten); taken in under this phone's count
      const fresh = got.msg.filter((d) => !recOf.has(d.cid) && !(chars.get(d.char) || {}).deleted && d.epoch >= (fileEpoch.get(d.char) || 0)
          && d.epoch >= epochOf(d.char))
        .map((d) => ({ ...d, epoch: epochOf(d.char) }))
        .sort((a, b) => (a.ts - b.ts) || (a.cid < b.cid ? -1 : 1));   // (a first full read: ids in (time, cid) order)
      let added = 0;
      for (const d of fresh) {
        const refs = [];
        if (d.photo) refs.push(d.photo.full, d.photo.view);
        if (d.voice) refs.push(d.voice);
        if (refs.some((r) => !blobs.has(r.bid))) { skipped++; continue; }
        for (const r of refs) media.push({ bid: r.bid, ct: blobs.get(r.bid) });
        recOf.set(d.cid, d);
        if (d.held) {                                   // (still to come: shown at its time)
          held = held.filter((h) => h.cid !== d.cid).concat([{ cid: d.cid, char: d.char, at: d.at / 1000, priv: false, life: d.life || null, d, m: heldPage(d, false) }]);
          recs.push({ kind: "msg", id: d.cid, d, opts: { char: d.char, at: d.at } }); added++; continue;
        }
        const id = ++nextId;
        msgs.push(pageOf(d, id, false));
        recs.push({ kind: "msg", id: d.cid, d, opts: { char: d.char, lid: id } }); added++;
      }
      if (media.length) await ST().putMedia(media);
      if (recs.length) await save(recs);
      for (const m of msgs) if (m.role === "reaction") { const d = recOf.get(m.cid); if (d) m.target = idOfCid(d.target); }
      msgs.sort(byId); kitC = null;
      for (const c of list()) if (learnState(c.id).seen < nextId) await saveLearn(c.id, { ...learnState(c.id), seen: nextId });   // (never mined)
      await loadPics();
      setTimeout(() => { revealDue(); if (started) tick().catch(() => {}); }, 0);
      return { ok: true, messages: added, characters: got.char.length, facts: got.facts.length, skipped, key };
    });
  }

  // ---------- storage, preferences, wipe ----------
  async function storage() {
    const u = await ST().usage().catch(() => ({ kinds: {}, bytes: 0, media: 0, mediaBytes: 0 }));
    let persisted = null, quota = null, used = null;
    try { if (root.navigator && root.navigator.storage) {
      if (root.navigator.storage.persisted) persisted = await root.navigator.storage.persisted();
      if (root.navigator.storage.estimate) { const e = await root.navigator.storage.estimate(); quota = e.quota || null; used = e.usage || null; }
    } } catch (e) { /* not told */ }
    return { messages: msgs.length, characters: list().length, facts: [...facts.values()].reduce((a, d) => a + F().itemsOf(d).length, 0),
      records: u.kinds, recordBytes: u.bytes, media: u.media, mediaBytes: u.mediaBytes, persisted, quota, used, private: livePriv().length };
  }
  async function persist() { try { return !!(root.navigator && root.navigator.storage && root.navigator.storage.persist && await root.navigator.storage.persist()); } catch (e) { return false; } }
  const pref = (k, d) => (hasOwn(prefs, k) ? prefs[k] : d);
  function setPref(k, v) {                              // this device's own preferences (sealed in meta "local")
    prefs = { ...prefs, [k]: v };
    clearTimeout(prefT);
    prefT = setTimeout(() => { if (ready) ST().setLocal(prefs).catch(() => {}); }, 300);
  }
  async function wipe() {                               // "Remove Buddy from this device": everything, memory too
    ready = false; tkey = null; hasKey = false; keys = null; cancelBackupKey();
    for (const u of urls.values()) try { URL.revokeObjectURL(u); } catch (e) { /* gone */ }
    for (const p of pics.values()) try { URL.revokeObjectURL(p.url); } catch (e) { /* gone */ }
    urls.clear(); pics.clear(); mem.clear(); msgs = []; priv = []; recOf.clear(); chars.clear(); facts.clear(); kitC = null; prefs = {};
    stopTimers(); started = false; held = []; replies.clear(); kicks.clear(); holdLearn.clear(); lifeRecs.clear(); dayRecs.clear(); tieRecs.clear(); learnRecs.clear();
    learnMeta = { boot: 0, runs: [] };
    const ok = await ST().wipe();
    initP = null;
    return { ok };
  }

  // ---------- start ----------
  async function loadJSON(name) {                       // a file of the site itself, next to the page
    const r = await root.fetch(new URL(name, root.document.baseURI).href, { cache: "no-cache", credentials: "same-origin" });
    if (!r.ok) throw new Error(name + " " + r.status);
    return r.json();
  }
  function kindOfDevice() {
    const ua = String((root.navigator && root.navigator.userAgent) || ""), tp = (root.navigator && root.navigator.maxTouchPoints) || 0;
    return /iPad/.test(ua) || (/Macintosh/.test(ua) && tp > 1) ? "tablet" : /iPhone|Android.*Mobile/.test(ua) ? "phone" : /Android/.test(ua) ? "tablet" : "browser";
  }
  async function init() {                               // -> {ok, key, fresh} or {ok: false, kind, error}
    if (initP) return initP;
    initP = (async () => {
      try {
        const fresh = (await ST().init()).fresh;
        try { base = await loadJSON("kit.json"); }
        catch (e) { const x = new Error(T.nokit); x.kind = "nokit"; throw x; }
        if (!base || !(base.v >= 3) || !base.templates || !base.builtin || !base.prompts) { const x = new Error(T.nokit); x.kind = "nokit"; throw x; }
        try { const v = await loadJSON("version.json"); version = v && Number.isInteger(v.v) ? "v" + v.v : ""; } catch (e) { version = ""; }
        dev = (await ST().getMeta("device")) || null;
        if (!dev) { dev = { k: "device", id: C().b64e(C().rand(16)), created: Date.now(), kind: kindOfDevice() }; await ST().setMeta("device", dev); }
        const cs = await ST().getMeta("cacheSecret");
        secret = cs && cs.v ? cs.v : C().hex(C().rand(32));
        if (!cs) await ST().setMeta("cacheSecret", { v: secret });
        nextId = ((await ST().getMeta("lid")) || {}).n || 0;
        n = ((await ST().getMeta("n")) || {}).n || 0;
        last = ((await ST().getMeta("hlc")) || {}).h || "";
        prefs = await ST().getLocal();
        hasKey = await ST().hasSecret("tinfoil");
        const ak = await ST().getSecret("acctkeys").catch(() => null);
        keys = ak && ak.acct ? { acct: ak.acct, kdata: C().b64d(ak.kdata), kname: C().b64d(ak.kname), kfile: C().b64d(ak.kfile), kid: C().b64d(ak.kid) } : null;
        const all = await ST().allRecs();
        const stored = [];
        for (const r of all) {
          const b = r.body, d = b.d;
          if (b.k === "set" && d) setRec = d;
          else if (b.k === "char" && d) chars.set(b.id, d);
          else if (b.k === "facts" && d) facts.set(b.id, d);
          else if (b.k === "msg" && d) stored.push({ d, lid: r.lid });
          else if (b.k === "life" && d) lifeRecs.set(b.id, d);
          else if (b.k === "day" && d) dayRecs.set(b.id, d);
          else if (b.k === "tie" && d) tieRecs.set(b.id, d);
          else if (b.k === "learn" && d) learnRecs.set(b.id, d);
        }
        const old = [];
        for (const x of stored) {                       // (older than its character's last forget, or of a deleted one: gone)
          const c = chars.get(x.d.char);
          if (c && (x.d.epoch < (c.epoch || 0) || c.deleted)) { old.push(["msg", x.d.cid]); continue; }
          recOf.set(x.d.cid, x.d);
        }
        if (old.length) await ST().delRecs(old);
        const kept = stored.filter((x) => recOf.has(x.d.cid)).sort((a, b) => (a.lid || 0) - (b.lid || 0));
        const later = [];                               // (held ones get their page id when they're shown)
        for (const x of kept) {
          if (x.d.held && !Number.isInteger(x.lid)) { later.push(x.d); continue; }
          const id = Number.isInteger(x.lid) ? x.lid : ++nextId; nextId = Math.max(nextId, id); msgs.push(pageOf(x.d, id, false));
        }
        held = later.map((d) => ({ cid: d.cid, char: d.char, at: (Number(d.at) || 0) / 1000, priv: false, life: d.life || null, d, m: heldPage(d, false) }));
        for (const h of held) if (!h.life) {            // (an answer still on its way: a new message has it written again)
          const p = replies.get(h.char) || { at: h.at, token: 1, cids: [], priv: false };
          p.cids.push(h.cid); replies.set(h.char, p);
        }
        const lm = await ST().getMeta("learn").catch(() => null);   // learning starts when it arrives: earlier chats are never mined
        learnMeta = lm && typeof lm.boot === "number" ? { boot: lm.boot, runs: Array.isArray(lm.runs) ? lm.runs.filter((t) => typeof t === "number") : [] } : { boot: nextId, runs: [] };
        if (!lm) await ST().setMeta("learn", learnMeta);
        ready = true;
        revealDue();                                    // (what came while Buddy was closed: shown now, with its own time)
        await loadPics();
        return { ok: true, key: hasKey, fresh: !!fresh, messages: msgs.length, characters: list().length };
      } catch (e) {
        ready = false;
        const kind = e && e.kind ? e.kind : "nokit";
        initP = null;
        return { ok: false, kind, error: T[kind] || (e && e.message) || T.nokit };
      }
    })();
    return initP;
  }

  root.BuddySolo = {
    // direct.js's source (SPEC3 §4)
    kit, thread, add, annotate, route, key, partner, late,
    forget: async (char) => { forgetMemory(char); },
    cacheSecret: () => secret,
    // the page
    init, supported: () => ST().supported(), get ready() { return ready; },
    fetch: (path, init0) => { const d = D(); return d ? d.fetch(path, init0) : Promise.reject(new Error(T.notready)); },
    hasKey: () => hasKey, setKey, forgetKey, check, error: () => error,
    mediaURL, avatarURL, wallURL,
    prefs: () => ({ ...prefs }), pref, setPref,
    makeBackupKey, cancelBackupKey, confirmBackupKey, backupInfo, exportFile, importFile,
    storage, persist, wipe, version: () => version, texts: T,
    start, tick, typing,                                // (background work while open; "typing…" before a held message)
  };
})(typeof window !== "undefined" ? window : globalThis);
