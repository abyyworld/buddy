// Buddy for phones: characters (characters.py and images.py's looks checks, ported; parity-tested against the Python,
// tests/test_solo_parity.py). Part of window.BuddySoloLib.
//   clean(c, existing, checkLooks, knownFolders)   characters.clean: only valid, bounded values; looks that aren't an
//                                   original adult (too_young, real_person, and in the public edition immodest) are
//                                   refused with the Mac's words
//   tooYoung, realPerson, fromYourPhoto, immodest   images.py's checks, pattern for pattern (Python's sources are
//                                   kept verbatim below and translated once: \b, \w, \d, \s and $ mean what they mean
//                                   in Python)
//   createPrompt(kit, desc)         characters.create_prompt with no note folders ("[]": the phone has no notes)
//   createItems(text)               characters.create's reading of the Advisor's answer -> the cleaned characters
//   newId(name, used)               a new character's id: its name as a slug + "-" + 4 random base32 characters, so a
//                                   deleted character's id is never used again
//   personaOf(c, builtinPersona)    characters.persona_of
// Characters are always adults: the "Your name is X. You are an adult." line is built in direct.js's code on every
// turn, and the creation prompt asks for adults only.
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});

  // ---------- Python's semantics, spelled out ----------
  const PYWS = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const W = "[\\p{L}\\p{N}_]", NW = "[^\\p{L}\\p{N}_]";
  const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
  const RE_LSTRIP = new RegExp(`^[${PYWS}]+`, "u"), RE_RSTRIP = new RegExp(`[${PYWS}]+$`, "u");
  const pyStrip = (s) => String(s).replace(RE_LSTRIP, "").replace(RE_RSTRIP, "");
  const cp = (s, n) => Array.from(String(s)).slice(0, n).join("");          // s[:n] counts code points
  const cpLen = (s) => { let n = 0; for (const _ of String(s)) n++; return n; };
  const hasOwn = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const getp = (o, k, d) => (hasOwn(o, k) ? o[k] : d);                     // dict.get(k, d)
  function truthy(x) {                                  // Python's bool()
    if (x === null || x === undefined || x === false) return false;
    if (typeof x === "number") return x !== 0 && !Number.isNaN(x);
    if (typeof x === "string" || Array.isArray(x)) return x.length > 0;
    if (typeof x === "object") return Object.keys(x).length > 0;
    return !!x;
  }
  function pyStr(x) {                                   // str() of what JSON can hold
    if (x === null || x === undefined) return "None";
    if (x === true) return "True";
    if (x === false) return "False";
    if (typeof x === "string") return x;
    if (typeof x === "number") return Number.isInteger(x) ? String(x) : String(x);
    if (Array.isArray(x)) return "[" + x.map(pyRepr).join(", ") + "]";
    return "{" + Object.entries(x).map(([k, v]) => pyRepr(k) + ": " + pyRepr(v)).join(", ") + "}";
  }
  function pyRepr(x) {
    if (typeof x !== "string") return pyStr(x);
    const q = x.includes("'") && !x.includes('"') ? '"' : "'";
    return q + x.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), "\\" + q).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + q;
  }
  function pyFormat(tpl, vals) {                        // str.format(**vals): one pass, so a value holding "{x}" stays
    return String(tpl).replace(/\{\{|\}\}|\{([^{}]*)\}|[{}]/g, (m, name) => {
      if (m === "{{") return "{";
      if (m === "}}") return "}";
      if (name === undefined || !hasOwn(vals, name)) throw new Error("format: unknown field");
      return String(vals[name]);
    });
  }
  // A Python regex source -> the same regex in JS (u flag): \b \w \W \d \s outside or inside a class and $ (also
  // before a final newline) as Python means them. Only what Buddy's patterns use; anything else is refused.
  function pyRe(src, flags) {
    let out = "", cls = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") {
        const n = src[++i];
        if (n === undefined) throw new Error("bad pattern");
        if (n === "b" && !cls) out += B;
        else if (n === "w") out += cls ? "\\p{L}\\p{N}_" : W;
        else if (n === "W" && !cls) out += NW;
        else if (n === "d") out += "\\p{Nd}";
        else if (n === "s") out += cls ? PYWS : `[${PYWS}]`;
        else if (n === "S" && !cls) out += `[^${PYWS}]`;
        else if ("nrtfv".includes(n)) out += "\\" + n;
        else if (n === "u" || n === "x") out += "\\" + n;
        else if (/[A-Za-z0-9]/.test(n)) throw new Error("unsupported escape in pattern: \\" + n);
        else if ("^$\\.*+?()[]{}|/".includes(n) || (n === "-" && cls)) out += "\\" + n;
        else out += n;                                  // (a needless escape of a plain character)
        continue;
      }
      if (c === "[" && !cls) { cls = true; out += c; if (src[i + 1] === "^") { out += "^"; i++; } continue; }
      if (c === "]" && cls) { cls = false; out += c; continue; }
      if (c === "$" && !cls) { out += "(?=\\n?$)"; continue; }
      out += c;
    }
    return new RegExp(out, "u" + (flags || ""));
  }

  // ---------- images.py: looks (and scenes) that are never drawn ----------
  const MINOR_SRC = String.raw`\b(child(ren)?|kids?|kiddos?|toddlers?|bab(y|ies)(?![- ]?(blue|pink)\b)|infants?|newborns?|little on` +
    String.raw`es?(?![\w-])|teen(age[rd]?s?|s)?|tweens?|pre-?teens?|adolescen(ts?|ce)|(pre)?pubescent|puberty|minor` +
    String.raw`s?|under ?-?aged?|juveniles?|boys?|girls?|sons?|daughters?|nieces?|nephews?|grand(child(ren)?|kids?|` +
    String.raw`sons?|daughters?)|step(sons?|daughters?|kids?)|school ?(girl|boy|kid|child|uniform)s?|(high|middle|e` +
    String.raw`lementary|primary|grade|nursery|pre) ?school(ers?)?|junior high|kindergart(en|ner)s?|(\d{1,2}(st|nd|` +
    String.raw`rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[- ]?grade(` +
    String.raw`rs?)?|grade (school|[1-9]|1[0-2])|sweet sixteen|quincea[nñ]era|ba[rt] mitzvah|as a (kid|child|teen(a` +
    String.raw`ger)?)|when i was (little|young|a kid|\d+)|(1[0-7]|[1-9]|one|two|three|four|five|six|seven|eight|nin` +
    String.raw`e|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[- ]?(years?|yrs?)[- ]?olds?|(1[0-7]` +
    String.raw`|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixt` +
    String.raw`een|seventeen) ?(yo|y/o|y\.o)|(1[0-7]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|` +
    String.raw`twelve|thirteen|fourteen|fifteen|sixteen|seventeen) years? of age|aged? (1[0-7]|[1-9]|one|two|three|` +
    String.raw`four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)|\d+[- ` +
    String.raw`]?(months?|weeks?|days?)[- ]?olds?|(looks?|looking|appears?) (about |around |maybe |like )?(1[0-7]|[` +
    String.raw`1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixtee` +
    String.raw`n|seventeen)|at (1[0-7]|[1-9])\b(?! ?(am|pm|o'?clock|:|h\b))|loli(ta)?|shota|child-?like|kid-?like|b` +
    String.raw`aby ?faced?|chibi|jailbait|barely legal|sailor (uniform|outfit|suit|fuku)|young-looking|looks? (very` +
    String.raw` |so )?young|looks? like a (kid|child|teen(ager)?|minor|little (girl|boy))|petite young|young (girl|` +
    String.raw`boy))\b`;
  const TENS_SRC = String.raw`\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eigh` +
    String.raw`t|nine)\b`;
  const GROWN_SRC = String.raw`\b(adult|grown[- ]?up|grown|(1[89]|[2-9]\d|eighteen|nineteen|twenty|thirty|forty|fifty)[- ]?(years?|` +
    String.raw`yrs?)[- ]?old)[- ](sons?|daughters?|nieces?|nephews?|boys?|girls?|grand(sons?|daughters?|kids?|child` +
    String.raw`ren)|step(sons?|daughters?))\b`;
  const FAMOUS_SRC = String.raw`\b(look-?alikes?|celebrit(y|ies)|famous|spitting image|doppel-?g(a|ä)ngers?|impersonat\w*|deep-?fake` +
    String.raw`s?|resembl\w*|(movie|film|tv|pop|rock|k-?pop|hollywood|bollywood|youtube|instagram|tiktok) ?(stars?|` +
    String.raw`idols?|celeb\w*|influencers?))\b`;
  const LIKE_NAME_SRC = String.raw`\b(?:[Ll]ook(?:s|ing|ed)?(?: exactly| just| a lot| a bit| kind of| sort of| so much| almost)? like|[` +
    String.raw`Tt]he real) +[A-Z]`;
  const YOURS_SRC = String.raw`\b(your|ur) (own )?(photos?|pictures?|pics?|selfies?|snaps?|images?|shots?)\b|\b(photos?|pictures?|p` +
    String.raw`ics?|selfies?|snaps?|images?|shots?|one) (that |which )?you (just )?(sent|shared|showed|posted|took)` +
    String.raw`\b|\byou (just )?(sent|shared|showed)\b|\b(from|in|like) yours\b`;
  const IMMODEST_SRC = String.raw`\b(nude|naked|nudity|topless|shirtless|bare[- ]chested|undress\w*|lingerie|bikinis?|underwear|bras?|` +
    String.raw`panties|thongs?|(?<!modest )swim ?suits?|swimwear|cleavage|see-?through|low-?cut|revealing|sexy|sedu` +
    String.raw`ctive|sensual|erotic|provocative|crop ?tops?|tank ?tops?|mini ?skirts?|short skirts?|shorts|tight\w*` +
    String.raw`|bodycon|beers?|wine(?![- ](red|colou?red))|cocktails?(?! dress)|champagne|vodka|whiske?y|pints?|alc` +
    String.raw`ohol\w*|drunk|tipsy|(?<!chocolate )(?<!candy )bars?|pubs?|night ?clubs?|clubbing|casinos?|gambling|b` +
    String.raw`acon|pork|ham)\b`;
  const RX = { minor: pyRe(MINOR_SRC, "i"), tens: pyRe(TENS_SRC, "gi"), grown: pyRe(GROWN_SRC, "gi"),
               famous: pyRe(FAMOUS_SRC, "i"), likeName: pyRe(LIKE_NAME_SRC, ""), yours: pyRe(YOURS_SRC, "i"),
               immodest: pyRe(IMMODEST_SRC, "i") };
  // str(text or ""), with Turkish İ/ı as i: Python's re.IGNORECASE matches them with i (JS's simple case folding doesn't),
  // and one letter for one keeps every check exactly as long (never toLowerCase(), which makes İ two characters)
  const foldI = (s) => String(s).replace(/[İı]/g, "i");
  const text0 = (t) => foldI(truthy(t) ? pyStr(t) : "");
  const tooYoung = (t) => RX.minor.test(text0(t).replace(RX.tens, " ").replace(RX.grown, " "));
  const realPerson = (t) => { const s = text0(t); return RX.famous.test(s) || RX.likeName.test(s); };
  const fromYourPhoto = (t) => RX.yours.test(text0(t));
  const immodest = (t) => RX.immodest.test(text0(t));
  const ONLY_MODEST = "only modest pictures: nothing revealing, no alcohol or gambling";
  const LOOKS = { young: "Looks must describe an adult: say woman or man (not girl, boy or teen), no age under 18",
                  real: "Looks must be an original person: never a real or famous one, no \"looks like …\"",
                  modest: "Looks must be modest: " + ONLY_MODEST };

  // ---------- characters.py ----------
  const COLORS = ["#d9973c", "#5b8def", "#3fa37a", "#c8566a", "#8a6de9", "#e07a3f", "#2aa3b8", "#b5843a"];
  const VOICE_IDS = ["casual_female", "cheerful_female", "neutral_female", "Vivian", "Serena", "casual_male", "neutral_male", "Ryan", "Aiden"];
  const STYLES = ["photo", "illustration", "anime", "cartoon", "painting"];
  const SCOPES = ["all", "except", "some", "none"];
  const looksError = (k) => { const e = new Error(LOOKS[k]); e.looks = k; return e; };
  function iterOf(x) {                                  // what a Python for loop goes through (lists, strings, dict keys)
    if (Array.isArray(x)) return x;
    if (typeof x === "string") return Array.from(x);
    if (x && typeof x === "object") return Object.keys(x);
    throw new Error("bad character");
  }
  const inList = (list, x) => list.includes(x);
  const perDay = (n) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 4 ? n : null);
  const FOLDER_BAD = /[/\\]|\.\./gu;
  function clean(c, existing, checkLooks = true, knownFolders = null) {
    c = c && typeof c === "object" && !Array.isArray(c) ? c : {};
    existing = existing || {};
    const looks = cp(pyStrip(pyStr(getp(c, "appearance", getp(existing, "appearance", "")))), 800);
    if (checkLooks && tooYoung(looks)) throw looksError("young");
    if (checkLooks && realPerson(looks)) throw looksError("real");
    if (checkLooks && L.edition && L.edition.PUBLIC && immodest(looks)) throw looksError("modest");
    const ck = getp(c, "knowledge", undefined);
    const know = ck && typeof ck === "object" && !Array.isArray(ck) ? ck : (getp(existing, "knowledge", {}) || {});
    const scope = inList(SCOPES, getp(know, "scope", null)) ? know.scope : "all";
    const exk = truthy(getp(existing, "knowledge", null)) ? existing.knowledge : {};
    let avoid = getp(know, "avoid", getp(exk, "avoid", ""));
    avoid = cp(pyStrip(Array.isArray(avoid) ? avoid.map(pyStr).join(", ") : truthy(avoid) ? pyStr(avoid) : ""), 1000);
    const fsrc = getp(know, "folders", null);
    let folders = iterOf(truthy(fsrc) ? fsrc : []).filter((f) => pyStrip(pyStr(f)))
      .map((f) => cp(pyStr(f).replace(FOLDER_BAD, ""), 60)).slice(0, 40);
    if (knownFolders !== null && scope === "some") folders = folders.filter((f) => knownFolders.includes(f));
    const voice = inList(VOICE_IDS, getp(c, "voice", null)) ? c.voice : getp(existing, "voice", "casual_female");
    const color = /^#[0-9a-fA-F]{6}$/.test(pyStr(getp(c, "color", ""))) ? c.color : getp(existing, "color", COLORS[0]);
    const name0 = truthy(getp(c, "name", null)) ? c.name : truthy(getp(existing, "name", null)) ? existing.name : "Unnamed";
    return {
      name: cp(pyStrip(pyStr(name0)), 40),
      tagline: cp(pyStrip(pyStr(getp(c, "tagline", getp(existing, "tagline", "")))), 90),
      persona: cp(pyStrip(pyStr(getp(c, "persona", getp(existing, "persona", "")))), 8000),
      appearance: looks,
      style: inList(STYLES, getp(c, "style", null)) ? c.style : getp(existing, "style", "photo"),
      voice,
      brain: inList(["advisor", "companion"], getp(c, "brain", null)) ? c.brain : getp(existing, "brain", "advisor"),
      knowledge: { scope, folders: scope === "some" || scope === "except" ? folders : [], avoid },
      texts_first: truthy(getp(c, "texts_first", getp(existing, "texts_first", false))),
      learns: truthy(getp(c, "learns", getp(existing, "learns", true))),
      life: truthy(getp(c, "life", getp(existing, "life", true))),
      texts_per_day: perDay(getp(c, "texts_per_day", getp(existing, "texts_per_day", null))),
      life_seed: cp(pyStrip(pyStr(getp(c, "life_seed", getp(existing, "life_seed", "")))), 600),
      color,
    };
  }
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "character";
  const ID_CHARS = "0123456789abcdefghjkmnpqrstvwxyz";
  function newId(name, used) {                          // slug-xxxx (never "buddy", never one in use or used before)
    for (;;) {
      const r = new Uint8Array(4); root.crypto.getRandomValues(r);
      const id = slug(name) + "-" + Array.from(r, (b) => ID_CHARS[b & 31]).join("");
      if (!(used && used.has(id))) return id;
    }
  }
  const personaOf = (c, builtinPersona) => c.persona || (c.builtin ? builtinPersona || ""
    : `You are ${c.name}, a friendly adult I can talk to. ${c.tagline || ""}`);
  function createPrompt(kit, desc) {                    // characters.create_prompt(desc, folders=[]) in this edition
    const t = kit.templates.create;
    if (L.edition && L.edition.PUBLIC && !(t.rules && t.companion)) throw new Error("edition texts missing");
    return pyFormat(t.prompt, { desc: cp(pyStrip(desc), 1000), folders: "[]", voices: t.voices, companion: t.companion, rules: t.rules });
  }
  const pyFind = (s, ch) => s.indexOf(ch), pyRfind = (s, ch) => s.lastIndexOf(ch);
  const pySlice = (s, a, b) => { const n = s.length, f = (i) => (i < 0 ? Math.max(0, n + i) : Math.min(i, n)); return s.slice(f(a), f(b)); };
  function createItems(txt) {                           // the Advisor's answer -> the characters to save (at most 6), each
                                                        // one whose looks pass clean() (as characters.create keeps them)
    txt = String(txt || "");
    let items;
    const a = pyFind(txt, "["), o = pyFind(txt, "{");
    try {
      if (a >= 0 && (o < 0 || a < o)) items = JSON.parse(pySlice(txt, a, pyRfind(txt, "]") + 1));
      else {
        const one = JSON.parse(pySlice(txt, o, pyRfind(txt, "}") + 1));
        items = one && typeof one === "object" && !Array.isArray(one) && Array.isArray(one.characters) ? one.characters : [one];
      }
    } catch (e) { throw new Error("no characters in the reply"); }
    if (!Array.isArray(items)) throw new Error("no characters in the reply");
    const made = [];
    for (let it of items.slice(0, 6)) {
      if (!it || typeof it !== "object" || Array.isArray(it) || !truthy(it.name) || !truthy(it.persona)) continue;
      it = { ...it };
      const f = truthy(it.folders) ? it.folders : [];
      const star = typeof f === "string" ? f.includes("*") : iterOf(f).includes("*");
      const scope = star ? "all" : truthy(f) ? "some" : "none";
      it.knowledge = { scope, folders: iterOf(f).filter((x) => x !== "*"), avoid: pyStr(truthy(it.avoid) ? it.avoid : "") };
      it.texts_first = true; it.texts_per_day = 1;        // (now and then: about things in their own day)
      for (const k of ["id", "created", "builtin", "avatar"]) delete it[k];   // (the model only ever makes new ones)
      try { clean(it, {}, true, []); made.push(it); } catch (e) { if (!e.looks) throw e; }   // (e.g. looks that aren't an adult)
    }
    if (!made.length) throw new Error("no characters in the reply");
    return made;
  }

  L.chars = { PYWS, W, B, pyStrip, cp, cpLen, hasOwn, truthy, pyStr, pyFormat, pyRe,
              SOURCES: { MINOR: MINOR_SRC, TENS: TENS_SRC, GROWN: GROWN_SRC, FAMOUS: FAMOUS_SRC, LIKE_NAME: LIKE_NAME_SRC,
                         YOURS: YOURS_SRC, IMMODEST: IMMODEST_SRC },
              tooYoung, realPerson, fromYourPhoto, immodest, foldI, ONLY_MODEST, LOOKS,
              COLORS, VOICE_IDS, STYLES, SCOPES, clean, slug, newId, personaOf, createPrompt, createItems };
})(typeof window !== "undefined" ? window : globalThis);
