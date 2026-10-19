// Buddy's phone mode (window.BuddyDirect). When your Mac can't be reached, the phone answers the page's own /api/*
// requests itself, in the Mac's exact shapes, by talking straight to Tinfoil's enclave through Tinfoil's browser SDK
// (/vendor/tinfoil.mjs, pinned): it verifies the enclave's attestation in this page before anything is sent and seals
// every request body to the attested key. The prompt code is ported from the Mac (buddy_server.py, social.py, facts.py,
// lives.py, images.py) and parity-tested against it (tests/test_phonemode_parity.py), so a reply made here is built
// like one made there. What you say here joins the Mac's conversation when it's back (POST /api/thread/import).
// Tinfoil only: never Phala, never the free brain (Cloudflare); with the free brain chosen and no Tinfoil key on the
// Mac, phone mode stays off and says why (/api/phonekit answers {phone_mode: false, free: true}).
//
// This phone's own Tinfoil key: typed in Settings → Phone mode, kept only on this phone, encrypted at rest with a
// non-extractable AES-GCM key (IndexedDB), decrypted into memory for this page load only. It is sent only as the
// Authorization header of SDK requests to Tinfoil's inference host (ENCLAVE_URL), and only after the enclave's
// attestation was verified. Headers aren't sealed: they travel over ordinary TLS, which a browser can't tie to the
// attested enclave, so Tinfoil's servers can read the key; every body is sealed to the enclave. The key never goes to
// the Mac, the outbox, the sync, logs, errors, sessionStorage or the browser's local storage. Nothing contacts Tinfoil
// before this phone's key is saved.
//
// What the phone keeps (IndexedDB "buddy-phone"; nothing at all until phone mode is turned on):
//   meta     settings (on, cacheSecret, macOff, macSeenAt, expired), the kit (personas, prompts, models, each
//            character's visible facts and life logs as the Mac filtered them; in the public edition its rules and
//            your relationship status), when the context was fetched, Tinfoil's model list, the outbox counter, and
//            (public edition) a status you told a character here, until your Mac's kit has it (the status only, no
//            words)
//   keys     the wrapping key (non-extractable) and this phone's key, encrypted
//   chats    each character's recent non-private conversation (what the Mac's context reads)
//   outbox   phone-mode messages not on the Mac yet, with their photos (both copies) and voice audio
//   thumbs   128 px avatar thumbnails
// Deleted: everything when the Mac says this phone is unpaired, when phone mode is turned off, or with the Home Screen
// app; after 30 days without reaching the Mac (KIT_MAX_DAYS) all but the settings and the unsynced outbox; a
// forgotten character's conversation, facts and life at once. Private phone-mode messages and their photos and audio
// live only in this page's memory (12 h at most) and never reach storage, the outbox or the sync. The one key in the
// browser's local storage is the content-free wipe marker "buddy.wipe" (an interrupted wipe is finished at start).
//
// The source (SPEC3 §4): where the kit and the conversation come from and where new messages go. On the Mac's /phone
// it's macSource below: phone mode's Mac-specific part (the kit and context from your Mac, the outbox, the import, the
// 30-day expiry), unchanged. On the Buddy for phones site (its page has <meta name="buddy-site">) it's
// window.BuddySolo (web/solo/engine.js): never your Mac, never the Mac's storage. Prompt, chat, vision, voice and call
// code is the same for both and reaches its data only through these:
//   kit()                          the kit in phonekit()['kit']'s shape (null: none yet)
//   thread(after)                  GET /api/thread's messages with an id above after (every one, by id, without after)
//   add(it, priv, keepOnFail)      a new message (an outbox item's shape) -> the page's message, or null (not kept)
//   annotate(cid, fields, priv)    a message gets fields (what was in a photo)
//   forget(char, deleted, epoch)   a character's conversation goes
//   route(method, path, q, init)   the source's own routes -> a Response, or null for the shared ones (chat, photos,
//                                  voice messages, hearing, speech, calls); anything else on the site: 404
//   and, optional: last(char, exceptCid) -> {ts, role} of the newest message (else worked out from thread()),
//   history(char) -> the messages a call's hearing hint reads (else thread()'s non-private ones), key() -> this
//   device's Tinfoil key, cacheSecret() -> the per-device secret that scopes Tinfoil's prompt cache, partner(said,
//   priv) -> keep what a reply's [partner: …] said (the public edition: the status only, never the words),
//   late({char, via, photo, voice, priv, cid}) -> {at, token, note, done(ok)} to hold this reply back until `at` (real
//   timing: it's written now with `note`, LATE_NOTE, for that time, and added with held/at/hold set) or null (at once).
// complete(prompt, {temperature, cap, mode?, messages?, timeout?}) asks the Advisor (or the Companion) a one-off
// question through the same Tinfoil path (the site's own background work: new characters, learning, day plans, texts
// first); voiceNote(text, voice) records one in their voice; inCall() says whether a call is on.
(function (root) {
  "use strict";

  // ---------- constants ----------
  const SDK_URL = "/vendor/tinfoil.mjs";
  const ENCLAVE_URL = "https://inference.tinfoil.sh";
  const CONFIG_REPO = "tinfoilsh/confidential-model-router";
  const PHONE_MODE_AVAILABLE = true;                    // gate G2 passed (2026-10-09)
  const PM_MODELS_LIST = true, PM_SPEECH = true, PM_STT = true;   // gate G2b: CORS of /models, /audio/speech, /audio/transcriptions
  const DB = "buddy-phone", DB_VERSION = 1, STT_DEFAULT = "whisper-large-v3-turbo", STT_NEXT_DEFAULT = "voxtral-small-24b";
  const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥"], REFUSES_PICTURES = [400, 413, 415, 422], DAY_STARTS = 4;
  const PHOTO_EXPIRED = "that photo expired; attach it again", KIT_MAX_DAYS = 30, KIT_WARN_DAYS = 23;
  const KIT_V = 3;                                      // the oldest kit used (older ones lack the edition's rules or NO_PHOTOS:
                                                        // refreshed first)
  const WIPE_MARK = "buddy.wipe";                       // (spelled out where it's used, so CI can see it's the only one)
  // the Buddy for phones site (GitHub Pages, SPEC3): its page says so; there the source is window.BuddySolo, and the
  // SDK is found next to the page (the site lives under a path), never at the Mac's /vendor/
  const SOLO = (() => { try { return !!(root.document && root.document.querySelector('meta[name="buddy-site"]')); } catch (e) { return false; } })();
  const MS = { probe: 2500, ready: 20000, chat: 60000, idle: 60000, vision: 60000, speech: 60000, voiceReply: 90000,
               stt: 30000, models: 10000, mac: 15000, media: 60000, del: 2000 };
  const DAY = 86400000;

  const T = {                                           // honest messages (SPEC2 §12), exact text
    nokey: "Phone mode needs this phone's own Tinfoil key: Settings → Phone mode.",
    attestation: "Couldn't verify Tinfoil's enclave, so nothing was sent. If this keeps happening, Tinfoil may have " +
      "updated its servers: open Buddy once while your Mac is reachable so it can update.",
    atc: "Tinfoil's verification service isn't answering right now, so nothing was sent.",
    network: "Can't reach Tinfoil from here, so nothing was sent. Check the internet connection (and that Tailscale " +
      "isn't sending all traffic through your Mac).",
    config: "Phone mode isn't set up correctly (bug). Nothing was sent.",
    reach: "Can't reach Tinfoil", hearing: "can't reach Tinfoil right now", broke: "Tinfoil's answer broke off",
    store: "Couldn't save on this phone (storage is full or blocked), so nothing was sent.",
    storeReply: "Couldn't save their reply on this phone (storage is full or blocked); it won't reach your Mac.",
    keybad: "This phone's key couldn't be read: enter it again in Settings → Phone mode.",
    nokit: "Phone mode needs one visit while your Mac is reachable.",
    macoff: "Phone mode was turned off on your Mac",
    expired: "Phone mode needs your Mac again (not reached for 30 days)",
    mac: "needs your Mac (phone mode)", keyfmt: "that doesn't look like an API key",
    tz: "times use this phone's time zone",
    free: "Phone mode is off: it only ever uses Tinfoil (private, paid), never the free brain, and Buddy is set to the " +
      "free brain without a Tinfoil key. To use phone mode, add a Tinfoil key on your Mac (Settings → Brain).",
    solokey: "Buddy needs this phone's own Tinfoil key: Settings → This device's key.",   // (the site)
    notready: "Buddy for phones is still starting. Try again in a moment.",
    site: "not in Buddy for phones",
  };
  if (SOLO) Object.assign(T, {                          // (the site: there's no Mac to open or Tailscale to blame)
    attestation: "Couldn't verify Tinfoil's enclave, so nothing was sent. If this keeps happening, Tinfoil may have " +
      "updated its servers: Buddy for phones updates itself the next time you open it.",
    network: "Can't reach Tinfoil from here, so nothing was sent. Check the internet connection.",
  });
  // Your Tinfoil credits ran out (402) or the key reached its spend limit (a 429 that says so): billing.py's words (the
  // kit brings the Mac's own; these until it has them). Any other 429 is just busy.
  const BILLING = { out: "Your Tinfoil credits ran out: top up in Tinfoil's dashboard (Billing), then try again",
                    limit: "Your Tinfoil key reached its spend limit: raise it in Tinfoil's dashboard (Billing), then try again" };
  const keyText = (code) => code === 401 || code === 403 ? `Tinfoil didn't accept this phone's key (${code}). Check it in Settings → ${SOLO ? "This device's key" : "Phone mode"}.`
    : code === 402 ? BILLING.out
    : code === 429 ? "Tinfoil is busy right now (429). Try again soon." : `Tinfoil returned ${code}`;

  // ---------- pure ports (SPEC2 §6.2): no I/O, no state; parity-tested against the Python ----------
  // Python's whitespace (str.isspace, \s, split, strip) and word characters (\w, \b) differ from JS's: spelled out.
  const PYWS = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const W = "[\\p{L}\\p{N}_]", NW_BEFORE = "(?<![\\p{L}\\p{N}_])", NW_AFTER = "(?![\\p{L}\\p{N}_])";
  const WS = `[${PYWS}]`;
  const RE_LSTRIP = new RegExp(`^${WS}+`, "u"), RE_RSTRIP = new RegExp(`${WS}+$`, "u"), RE_WSRUN = new RegExp(`${WS}+`, "u");
  const pyStrip = (s) => String(s).replace(RE_LSTRIP, "").replace(RE_RSTRIP, "");
  const pyWords = (s) => String(s).split(RE_WSRUN).filter(Boolean);
  const pyJoinWS = (s) => pyWords(s).join(" ");
  const cp = (s, n) => Array.from(String(s)).slice(0, n).join("");          // s[:n] counts code points
  const cpLen = (s) => { let n = 0; for (const _ of String(s)) n++; return n; };   // len(s)
  const pyLower = (s) => String(s).toLowerCase();
  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  function pyFormat(tpl, vals) {                        // str.format(**vals): one pass, so a value holding "{text}" stays
    return String(tpl).replace(/\{\{|\}\}|\{([^{}]*)\}|[{}]/g, (m, name) => {
      if (m === "{{") return "{";
      if (m === "}}") return "}";
      if (name === undefined || !hasOwn(vals, name)) throw new Error("format: unknown field");
      return String(vals[name]);
    });
  }

  // cleaning and splitting (buddy_server.py:47-56, 80-115, 1047-1109)
  const ACTION = new RegExp(`[*(]${WS}*(?:laugh|chuckl|giggl|smil|grin|sigh|wink|blush|nod|shrug|whisper|gasp|paus|hug|kiss|` +
    "smirk|sniff|yawn|cough|clear|lean|look|glanc|tilt|rais|roll|bit|hum|sing|sob|cr[iy]|grimac|frown|beam|blink|stretch)" +
    "(?:s|es|d|ed|ing|[a-z]ing)?" + NW_AFTER + "[^*()\\n]{0,40}[*)]", "giu");
  const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿⬀-⯿⌀-⏿⃣️‍\u{E0020}-\u{E007F}]/gu;
  const RE_WS2 = new RegExp(`${WS}{2,}`, "gu");
  const spoken = (t) => pyStrip(String(t).replace(ACTION, "").replace(EMOJI, "").replace(/[*_#`~]/gu, "").replace(RE_WS2, " "));
  // ABBREV's scoped (?i:...) as two regexps (Safari has no inline modifiers); Python's $ also matches before a final \n
  const ABBREV_WORD = new RegExp(NW_BEFORE + "(?:mr|mrs|ms|dr|st|jr|sr|prof|mt|vs|e\\.g|i\\.e|a\\.m|p\\.m)\\.(?=\\n?$)", "iu");
  const ABBREV_INITIAL = new RegExp(NW_BEFORE + "[A-Z]\\.(?=\\n?$)", "u");
  const isAbbrev = (head) => ABBREV_WORD.test(head) || ABBREV_INITIAL.test(head);
  const CUT = new RegExp(`(?<=[.!?…])${WS}+|[ \\t]*\\n${WS}*`, "gu");
  const count = (s, ch) => s.split(ch).length - 1;

  // a photo however a character wrote it (buddy_server.py's pic_tags, _pic_scene, _scene_like, _PIC_OPEN and no_tags,
  // pattern for pattern): "[image: …]", "*sends a selfie*", "(image: me at the gym)", "📸 me on my balcony", markdown
  // ![…](…), never a mention ("the photo of your dog", "send pics", ":["). Phone mode never has a picture maker, so a
  // photo is only ever taken out of the words, exactly as the Mac does when none is ready. Python's \b, $ (no MULTILINE)
  // and ^/$ (MULTILINE) spelled out: JS's differ.
  const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
  const PY_END = "(?=\\n?$)", LINE_START = "(?<![^\\n])", LINE_END = "(?![^\\n])";
  const PIC_WORD = "(?:photo(?:graph)?|pic(?:ture)?|image|img|selfie|snapshot)s?";
  const PIC_VERB = `(?:i(?:['’]m|${WS}+am|${WS}+just)?${WS}+|just${WS}+|quickly${WS}+)?(?:(?:sends|sent|sending|takes|took|taking|` +
    `snaps|snapped|snapping|attach(?:es|ed|ing)|shares|shared|sharing|shows|showed|showing)${B}(?!${WS}+(?:me|us)${B})` +
    `|here(?:['’]s|${WS}+is|${WS}+are)${B})`;            // their own doing ("sends a selfie"), never "show me a pic"
  const PIC_LABEL = `(?:(?:a|an|my|new|quick)${WS}+)?${PIC_WORD}(?:${WS}+(?:attached|incoming|below))?(?:[ \\t]*:|[ \\t]+[-–—])`;
  const PIC_LEAD = `(?:(?:a|an|my|another|one${WS}+more|new|quick|little|cute|random|blurry)${WS}+)*`;
  const CAM = "[\\u{1F4F8}\\u{1F4F7}\\u{1F933}]\\uFE0F?";            // 📸 📷 🤳
  const PIC_PAIRS = [["\\(", "\\)"], ["\\{", "\\}"], ["<", ">"], ["【", "】"], [`(?<!${W})\\*\\*?(?![ \\t])`, "\\*"],
                     [`(?<!${W})_(?![ \\t])`, "_"]];      // ("* Take photos…" is a bullet, not an action)
  const picRe = (o, c, final) => new RegExp(`(?:${CAM}[ \\t]*)?${o}[ \\t]*(?<act>(?:${PIC_VERB}|${PIC_LABEL})[^${c}\\n]{0,2000})` +
    (final ? `(?:${c}|(?=\\n)|${PY_END})` : c) + `(?:[ \\t]*${CAM})?`, "giu");   // (never closed: to the end of the line)
  const PIC_TAGS = [false, true].map((final) => [
    new RegExp("!\\[(?<md>[^\\]\\n]{0,2000})\\]\\([^)\\n]{0,500}\\)", "gu"),                   // (markdown: ![me](x.jpg))
    new RegExp(`(?:${CAM}[ \\t]*)?\\[[ \\t]*(?<sq>[^\\]]{0,2000})` + (final ? `(?:\\]|${PY_END})` : "\\]") + `(?:[ \\t]*${CAM})?`, "gu"),
    ...PIC_PAIRS.map(([o, c]) => picRe(o, c, final)),
    new RegExp(`${LINE_START}[ \\t]*(?:${CAM}[ \\t]*[:\\-–—]?|${PIC_WORD}[ \\t]*:)[ \\t]*(?<line>[^\\n]{2,2000})` +
      (final ? LINE_END : "(?=\\n)"), "giu")]);
  const PIC_INTRO = new RegExp(`^(?:[:\\-–—]|of${B}|showing${B}|shows${B}|(?:description|desc|caption)${WS}*:)${WS}*`, "iu");
  const PIC_YOURS = new RegExp(`${B}your${WS}+(?:${W}+${WS}+){0,2}${PIC_WORD}${B}|${B}${PIC_WORD}${WS}+(?:of|from)${WS}+your${B}|` +
    `${B}(?:you|u)${WS}+(?:just${WS}+)?(?:sent|took|posted|shared|showed|uploaded)${B}`, "iu");
  const PIC_LATER = new RegExp(`${B}(?:soon|later|tomorrow|tonight|in${WS}+a${WS}+(?:bit|sec|second|min|minute|moment)|` +
    `next${WS}+time|(?:when|once|after)${WS}+i(?:${WS}+(?:get|find|can|have|am)|['’]m))${B}`, "iu");
  const PIC_BEFORE = new RegExp(`^(?:i${WS}+(?:just${WS}+)?)?(?:sent|shared|showed|took|snapped|attached)${WS}+` +
    `(?:(?:you|u)${WS}+)?(?:the|that|this|those|these|it|them)${B}`, "iu");       // (a photo they talk about)
  const PIC_SENDS_IT = new RegExp(`[${PYWS},]*(?:and|then|&)${WS}+(?:sends?|shares?|shows?|attach(?:es)?)${WS}+` +
    `(?:it|that|this|them|one)${B}(?:${WS}+(?:over${WS}+)?to${WS}+(?:you|u))?${WS}*${PY_END}`, "giu");   // ("… and sends it")
  const SCENE_NOT = new RegExp(`${B}(?:is|are|was|were|be|been|am|should|would|could|can|will|must|might|may|do|does|did|` +
    `don['’]?t|isn['’]?t|i|you|u|it['’]s|that['’]s|love|hate)${B}`, "iu");
  const SCENE_YES = new RegExp(`^(?:me|my|a|an|the|us|our|this|view|close-?up|mirror|selfie)${B}|${B}(?:at|in|on|from|with|by|` +
    `near|under|over|outside|inside|wearing|holding|sitting|standing|lying|looking|showing)${B}`, "iu");
  const PIC_VERB_AT = new RegExp(`^(?:${PIC_VERB})${WS}*`, "iu"), PIC_WORD_IN = new RegExp(`${B}${PIC_WORD}${B}`, "iu");
  const PIC_LEAD_AT = new RegExp(`^${PIC_LEAD}(?=${PIC_WORD}${B})`, "iu"), PIC_WORD_ONLY = new RegExp(`^(?:${PIC_WORD})$`, "iu");
  const PIC_WORD_AT = new RegExp(`^${PIC_WORD}${B}(?:${WS}+(?:attached|incoming|below))?${WS}*`, "iu");
  const PIC_TO_YOU = new RegExp(`^(?:(?:you|u|back|over)${WS}+)+`, "iu");
  const PIC_ARTICLE = new RegExp(`^(?:a|an|another|one${WS}+more|this|the|that|some)${WS}+`, "iu");
  const RE_WSRUN_G = new RegExp(`${WS}+`, "gu");
  function pyStripChars(s, chars) {                     // str.strip(chars)
    const a = Array.from(String(s));
    let i = 0, j = a.length;
    while (i < j && chars.includes(a[i])) i++;
    while (j > i && chars.includes(a[j - 1])) j--;
    return a.slice(i, j).join("");
  }
  function sceneLike(s) {                               // a scene ("me on my balcony at sunset"), not a remark ("nice shot!")
    const first = pyStrip(String(s).split(/[,.;!?…]/u)[0]);
    return pyWords(first).length >= 2 && !SCENE_NOT.test(first) && SCENE_YES.test(first);
  }
  function picScene(inside, square) {                   // what a tag's inside shows, or null when it isn't a photo sent now
    let s = pyJoinWS(inside);
    if (PIC_YOURS.test(s)) return null;                 // (your photo: never theirs to send)
    const verb = s.match(PIC_VERB_AT);
    if (verb) {                                         // "sends a mirror selfie", "takes a selfie and sends it"
      if (!PIC_WORD_IN.test(s) || PIC_LATER.test(s) || PIC_BEFORE.test(s)) return null;
      s = s.slice(verb[0].length).replace(PIC_TO_YOU, "");
      s = s.replace(PIC_ARTICLE, "").replace(PIC_SENDS_IT, "");
    } else {                                            // "photo: …", "Image of …", "a quick selfie at …"
      const lead = s.match(PIC_LEAD_AT);
      if (!lead) return null;                           // ("[react: 😂]", "[laughs]")
      s = s.slice(lead[0].length);
    }
    const w = s.match(PIC_WORD_AT);
    if (w) {                                            // ("photo of my cat": "my cat"; "selfie at the beach" stays)
      const rest = s.slice(w[0].length), intro = rest.match(PIC_INTRO);
      s = intro ? rest.slice(intro[0].length) : rest ? s : "";
    }
    s = pyStripChars(s, " \t\"'“”*_,;");
    if (!square && !verb && !sceneLike(s)) return null; // ("**Photos:**", "(photo: not great tbh)")
    return s || "a casual selfie";
  }
  function picTags(text, final = true, lineStart = true) {   // -> [their words without the photos, the scenes]
    const scenes = [];
    const take = (m, g, at) => {
      if (g.md !== undefined) {
        const alt = pyStripChars(pyJoinWS(g.md), "\"'“”*_");
        scenes.push(alt && !PIC_WORD_ONLY.test(alt) ? alt : "a casual selfie");
        return " ";
      }
      if (g.line !== undefined) {
        const scene = pyStripChars(g.line.replace(RE_WSRUN_G, " "), " \t\"'“”*_");
        if ((at === 0 && !lineStart) || PIC_YOURS.test(scene) || !sceneLike(scene)) return m;
        scenes.push(scene); return " ";
      }
      const scene = picScene(g.sq !== undefined ? g.sq : g.act, g.sq !== undefined);
      if (scene === null) return m;
      scenes.push(scene); return " ";
    };
    for (const r of PIC_TAGS[final ? 1 : 0]) text = String(text).replace(r, (...a) => take(a[0], a[a.length - 1], a[a.length - 3]));
    return [text.replace(/[ \t]{2,}/g, " "), scenes];
  }
  // a photo tag still being written: the stream isn't cut inside one (with a photo word, or still short)
  const PIC_OPEN = new RegExp(`(?:\\(|\\{|<|【|(?<!${W})\\*\\*?(?![ \\t])|(?<!${W})_(?![ \\t]))[ \\t]*(?:${PIC_VERB}|${PIC_LABEL})` +
    `(?:[^)}>】*_\\n]*${B}${PIC_WORD}${B}[^)}>】*_\\n]*|[^)}>】*_\\n]{0,40})${PY_END}`, "iu");
  const TAG_CUT = new RegExp(`\\[[ \\t]*(?:${W}+[ \\t]*:|${PIC_VERB}|${PIC_LEAD}${PIC_WORD})[^\\]]*${PY_END}`, "giu");
  // without bracket tags, one cut off at the end ("[react: 😂", "[photo: me at"; never an emoticon like ":["), or markdown
  const noTags = (t) => String(t).replace(/[*_#`]|\[[^\]]{0,300}\]/gu, "").replace(TAG_CUT, "");

  function nextCut(buf) {                               // the first sentence end not inside [...], nor after "Dr.", nor
    for (const x of buf.matchAll(CUT)) {                // inside "(image: …" or "*sends a selfie…" till the line ends
      const head = buf.slice(0, x.index), nl = x[0].includes("\n");
      if (count(head, "[") <= count(head, "]") && (nl || !(isAbbrev(head) || PIC_OPEN.test(head))))
        return { start: x.index, end: x.index + x[0].length, newline: nl };
    }
    return null;
  }
  const clean = (s, via) => pyStrip(noTags(via === "call" ? spoken(s) : String(s)));
  const REACT_TAG = new RegExp(`\\[react:${WS}*([^\\]${PYWS}]{1,16})${WS}*\\]`, "giu");
  // the public edition: a reply starting [partner: yes|no|noask] says what you told them (edition.PARTNER_TAG)
  const PARTNER_TAG = new RegExp(`\\[partner:${WS}*(yes|no|noask)${WS}*\\]`, "giu");
  const PICT = "\\u{1F000}-\\u{1F1E5}\\u{1F200}-\\u{1FAFF}\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2300-\\u23FF\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139" +
    "\\u3030\\u303D\\u3297\\u3299", MODS = "[\\uFE0F\\u{1F3FB}-\\u{1F3FF}]*";
  const ONE_EMOJI = new RegExp(`^(?:[${PICT}]${MODS}(?:\\u200D[${PICT}]${MODS})*|[0-9#*]\\uFE0F?\\u20E3|[\\u{1F1E6}-\\u{1F1FF}]{2})$`, "u");
  function reaction(e) {                                // any one emoji (buddy_server.reaction); ❤ means ❤️
    e = pyStrip(String(e || ""));
    const quick = REACTIONS.find((r) => e === r.replace(/️/g, ""));
    return quick || (cpLen(e) > 0 && cpLen(e) <= 16 && ONE_EMOJI.test(e) ? e : null);
  }
  class Splitter {                                      // the reading loop of buddy_server.py:1047-1107, line for line
    constructor(via, cap, onSentence) {
      this.via = via; this.cap = cap; this.on = onSentence;
      this.buf = ""; this.full = []; this.texts = []; this.reacts = []; this.tags = []; this.partner = []; this.nextText = false;
      this.atLine = true;                               // (the buffer starts a line of the reply)
      this.stopped = false;
    }
    emit(s, newText, line = true) {                     // (line: s starts a line of the reply)
      const [rest, pics] = picTags(s, true, line);      // a photo however they wrote it: never as words (and never made
      s = rest; this.tags.push(...pics);                // here: phone mode has no picture maker)
      for (const m of s.matchAll(REACT_TAG)) this.reacts.push(m[1]);
      for (const m of s.matchAll(PARTNER_TAG)) this.partner.push(m[1]);
      const t = clean(s, this.via);
      if (!t) return;
      newText = !!newText && this.texts.length > 0;
      if (newText || !this.texts.length) this.texts.push([]);
      this.texts[this.texts.length - 1].push(t); this.full.push(t);
      if (this.on) this.on(t, newText);
    }
    enough() { return !!this.cap && (this.texts.length > this.cap[0] || pyWords(this.full.join(" ")).length > this.cap[1]); }
    add(delta) {
      if (this.stopped) return;
      this.buf += delta || "";
      let c;
      while ((c = nextCut(this.buf))) {
        this.emit(this.buf.slice(0, c.start), this.nextText, this.atLine); this.buf = this.buf.slice(c.end);
        this.nextText = this.atLine = c.newline;
        if (this.enough()) break;
      }
      if (this.enough()) { this.buf = ""; this.stopped = true; }   // (a wall of texts nobody asked for: stop there)
    }
    end(dropRest) { if (!dropRest) this.emit(this.buf, this.nextText, this.atLine); this.buf = ""; }
    said(via, voiceReply) {                             // what goes into the thread: separate texts by a blank line
      return via === "call" || voiceReply ? this.full.join(" ") : this.texts.map((t) => t.join(" ")).join("\n\n");
    }
  }
  // how long a texted reply should be (buddy_server.py:91-109)
  const DETAIL = new RegExp(NW_BEFORE + "(?:explain|how (?:do|can|should|would|does) (?:i|you|it|we)|how to|why (?:is|are|do|" +
    "does|did|would|should|not)|tell me (?:more|about|everything|all|how|what)|in detail|details?|step[- ]by[- ]step|steps|" +
    "walk me through|help me (?:with|write|plan|figure|decide|understand)|write (?:me )?(?:a|an|the|my)|plan (?:for|my|a)|" +
    "compare|pros and cons|recommend|advice|what should i|go deeper|longer)" + NW_AFTER, "iu");
  function lengthHint(kit, text, via) {
    if (via === "call") return "";
    const t = String(text ?? ""), L = kit.prompts.length;
    if (DETAIL.test(t) || cpLen(t) > 400) return L.long;
    const w = pyWords(t).length;
    return w <= 6 ? L.tiny : w <= 30 ? L.short : L.medium;
  }
  function longEnough(kit, text, via) {
    const t = String(text ?? "");
    if (via === "call" || DETAIL.test(t) || cpLen(t) > 400) return null;
    const w = pyWords(t).length, caps = kit.texting.caps;
    return caps[w <= 6 ? "tiny" : w <= 30 ? "short" : "medium"];
  }
  // a typed message that plainly asks for depth may let the model think first (buddy_server.DEEP / deep_question):
  // explicit asks only ("can you explain how …", "help me decide …", 6+ words), never "why not" or "explain yourself"
  const DEEP = new RegExp(`${B}(?:(?:can|could|would|will)${WS}+(?:you|u)${WS}+(?:please${WS}+)?explain|please${WS}+explain|` +
    `explain${WS}+(?:to${WS}+me${WS}+)?(?:how|what|the${WS}+difference|why${WS}+(?!(?:you|u)${B}))|walk me through|` +
    `step[- ]by[- ]step|pros and cons|help me (?:decide|plan|write)|give me (?:some |your |any |good )?advice)${B}`, "iu");
  const deepQuestion = (text) => { const t = String(text || ""); return pyWords(t).length >= 6 && DEEP.test(t); };
  function reactedLately(thread, cid, n = 6) {          // they reacted to one of your last n messages (buddy_server.reacted_lately)
    let t = thread.filter((m) => charOf(m) === cid), start = 0;
    t.forEach((m, i) => { if (m.role === "break") start = i + 1; });   // (this conversation only, since its last New chat)
    t = t.slice(start);
    const yours = new Set(t.filter((m) => m.role === "user").map((m) => m.id).slice(-n - 1, -1));
    return t.some((m) => m.role === "reaction" && m.by === cid && yours.has(m.target));
  }
  const VOICE_ASK = new RegExp(NW_BEFORE + "(?:send|leave|record)" + NW_AFTER + "[^.?!]{0,30}" + NW_BEFORE +
    "voice (?:message|note|memo)|" + NW_BEFORE + "voice (?:message|note) me" + NW_AFTER, "iu");

  // conversation context (social.py:155-179, buddy_server.py:344-356, 985-1008)
  const charOf = (m) => (hasOwn(m, "char") ? m.char : "buddy");
  function asText(m) {
    if (m.role === "user" && m.voice) return pyStrip("(a voice message) " + (m.content || "(I couldn't make out the words)"));
    if (m.role === "assistant" && m.image) {            // their own photo, written the way they send one
      const d = pyJoinWS(String(m.photo_desc || "").replace(/\[/g, "(").replace(/\]/g, ")"));
      return d ? `[photo: ${d}]` : "[photo]";
    }
    if (m.role === "user" && m.image)
      return pyStrip((m.photo_desc ? "(I'm sending you a photo: " + m.photo_desc + ")" : "(I sent you a photo)") + " " + (m.content || ""));
    return m.content || "";
  }
  function recentMessages(thread, n, includePrivate, char) {
    const t = thread.filter((m) => charOf(m) === char && !m.pending_photo);
    let start = 0;
    t.forEach((m, i) => { if (m.role === "break") start = i + 1; });
    const part = t.slice(start), seen = new Map(part.map((m) => [m.id, m])), out = [];
    for (const m of part) {
      if (m.private && !includePrivate) continue;
      if (m.role === "user" || m.role === "assistant") out.push({ role: m.role, content: asText(m) });
      else if (m.role === "reaction" && m.by === "you" && m.emoji) {      // your 😂 on one of theirs
        const to = seen.get(m.target);
        if (to && to.role === "assistant")
          out.push({ role: "user", content: `(I reacted ${m.emoji} to your message: "${cp(pyJoinWS(asText(to)), 80)}")` });
      }
    }
    return out.slice(-n);
  }
  function alternate(msgs) {                            // strict user/assistant turns, starting with the user
    const out = [];
    for (const m of msgs) {
      if ((m.role !== "user" && m.role !== "assistant") || !pyStrip(String(m.content ?? ""))) continue;
      if (out.length && out[out.length - 1].role === m.role)
        out[out.length - 1] = { role: m.role, content: out[out.length - 1].content + "\n" + m.content };
      else out.push({ role: m.role, content: m.content });
    }
    if (out.length && out[0].role === "assistant") out.unshift({ role: "user", content: "(earlier)" });
    return out;
  }
  function applyCallEdits(msgs, heard, opened) {        // what you heard of a reply you cut off; their greeting
    msgs = msgs.slice();
    if (typeof heard === "string") {
      const last = msgs.length >= 2 && msgs[msgs.length - 2].role === "assistant" ? msgs.length - 2 : null;
      if (last !== null) msgs[last] = { ...msgs[last], content: pyStrip(cp(pyStrip(heard), 2000) + " … (you cut me off here)") };
    }
    if (typeof opened === "string" && pyStrip(opened))
      msgs = [...msgs.slice(0, -1), { role: "assistant", content: cp(pyStrip(opened), 200) }, ...msgs.slice(-1)];
    return msgs;
  }
  const queryOf = (msgs) => msgs.slice(-5).filter((m) => m.role === "user").map((m) => m.content).join(" ");
  function heardOf(prompts, msgs, desc, userText) {     // this turn for a brain that can't look itself
    msgs = msgs.slice();
    if (msgs.length && msgs[msgs.length - 1].role === "user")
      msgs[msgs.length - 1] = { role: "user", content: desc ? pyStrip(pyFormat(prompts.looked, { desc, text: userText }))
        : (msgs[msgs.length - 1].content || "(I sent you a photo)") };
    return { msgs, turn: [prompts.photo_safety].concat(desc ? [] : [prompts.cant_see]) };
  }

  // facts (facts.py:178-196, 248-265; memory.py:175-180)
  const STOP = new Set(("a an and are as at be but by for from had has have he her his i if in into is it its me my of on or our " +
    "she so that the their them there they this to was we were what when where which who will with you your am do did not " +
    "just about how why can could would should been being than then too very also any all").split(" "));
  const words = (t) => (pyLower(t).match(/[\p{L}\p{N}_]+/gu) || []).filter((w) => !STOP.has(w) && cpLen(w) > 1);
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function factsForPrompt(kchar, query, call, everything, paths) {
    const [capN, capC] = everything ? (call ? [40, 1800] : [150, 8000]) : (call ? [25, 1200] : [80, 4000]);
    const q = new Set(words(query || "")), f = kchar.facts || { own: [], shared: [] };
    const overlap = (t) => { let n = 0; for (const w of new Set(words(t))) if (q.has(w)) n++; return n; };   // distinct words
    const pool = (f.own || []).map((x) => ({ x, mine: 1 })).concat((f.shared || []).map((x) => ({ x, mine: 0 })))
      .map((p, i) => ({ ...p, o: overlap(p.x.text), i }));
    pool.sort((a, b) => b.o - a.o || b.mine - a.mine || cmpStr(String(b.x.date || ""), String(a.x.date || "")) || a.i - b.i);
    const picked = []; let size = 0;
    for (const p of pool) {
      const n = cpLen(p.x.text);
      if (picked.length >= capN || size + n + 3 > capC) continue;
      picked.push(p); size += n + 3;
    }
    // shown in a fixed order (the shared ones, then its own, each as in its file): the prompt's start stays the same
    const keep = new Set(picked.map((p) => p.x));
    const sh = (f.shared || []).filter((x) => keep.has(x)).map((x) => x.text), ow = (f.own || []).filter((x) => keep.has(x)).map((x) => x.text);
    const sources = (sh.length ? [{ kind: "facts", path: paths.shared, n: sh.length }] : [])
      .concat(ow.length ? [{ kind: "facts", path: paths.own_prefix + kchar.id, n: ow.length }] : []);
    return { known: sh.concat(ow), sources };
  }
  const KNOWS_Q = [
    new RegExp(NW_BEFORE + "(?:what|how much|everything|anything|tell me)" + NW_AFTER + "[^.?!]{0,40}?" + NW_BEFORE + "(?:you|u|ya)" +
      NW_AFTER + "[^.?!]{0,25}?" + NW_BEFORE + "(?:know|remember|learn(?:ed|t)?|keep|kept|stored?|saved?|have|got)" + NW_AFTER +
      "[^.?!]{0,30}?" + NW_BEFORE + `(?:about|on|of)${WS}+(?:me|myself|my life)` + NW_AFTER, "iu"),
    new RegExp(NW_BEFORE + `(?:do|did)${WS}+(?:you|u)${WS}+(?:know|remember)${WS}+(?:anything|much|a lot|stuff|things)${WS}+about${WS}+me` +
      NW_AFTER, "iu"),
    new RegExp(NW_BEFORE + `what(?:'s| is| do you have)${WS}+(?:stored|saved|kept|on file)${WS}+(?:about|on)${WS}+me` + NW_AFTER, "iu")];
  const isKnowsQuestion = (text) => { const t = String(text || "").replace(/[’‘]/g, "'"); return KNOWS_Q.some((p) => p.test(t)); };
  const knowsAskText = (kchar, via, have) => kchar.knows_ask[via === "call" ? "call" : "phone"][have ? "have" : "none"];

  // time, in the Mac's zone (kit tz), so phone and Mac write the same prompt for the same moment
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const p2 = (n) => String(n).padStart(2, "0");
  const fmts = new Map();
  function wallFmt(tz) {                                // (a zone this browser doesn't know: the phone's own)
    if (fmts.has(tz)) return fmts.get(tz);
    const o = { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" };
    let f, own = !tz;
    try { f = new Intl.DateTimeFormat("en-US", tz ? { ...o, timeZone: tz } : o); }
    catch (e) { f = new Intl.DateTimeFormat("en-US", o); own = true; }
    const v = { f, own }; fmts.set(tz, v); return v;
  }
  const tzFallback = (tz) => wallFmt(tz || "").own;
  function wall(nowSec, tz) {                           // wall-clock parts there
    const parts = {};
    for (const p of wallFmt(tz || "").f.formatToParts(new Date(nowSec * 1000))) parts[p.type] = p.value;
    return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute };
  }
  const isoOf = (ms) => { const d = new Date(ms); return `${String(d.getUTCFullYear()).padStart(4, "0")}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
  const utcOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  function lifeDate(nowSec, tz) {                       // 00:00-03:59 still belongs to yesterday (lives.DAY_STARTS)
    const w = wall(nowSec, tz);
    return isoOf(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - DAY_STARTS * 3600000);
  }
  const weekday = (ms) => DAYS[(new Date(ms).getUTCDay() + 6) % 7];
  function nowString(nowSec, tz) {                      // strftime("%A %d %B %Y, %H:%M"), C locale
    const w = wall(nowSec, tz);
    return `${weekday(Date.UTC(w.y, w.mo - 1, w.d))} ${p2(w.d)} ${MONTHS[w.mo - 1]} ${String(w.y).padStart(4, "0")}, ${p2(w.h)}:${p2(w.mi)}`;
  }
  const dayLabel = (iso) => { const t = utcOf(iso), d = new Date(t); return `${weekday(t)} ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`; };
  function sinceLastTalk(lastTs, nowSec, lastRole, skipNewest = true) {   // (buddy_server.since_last_talk)
    if (!lastTs) return "";
    const gap = nowSec - lastTs;
    if (gap < 3 * 3600) return "";
    const head = "Our last message before this was " + (gap < 2 * 86400 ? `${Math.floor(gap / 3600)} hours` : `${Math.floor(gap / 86400)} days`) +
      " ago." + (lastRole === "assistant" ? " It was yours, and I never answered it." : " It was mine.");
    return !skipNewest || gap >= 6 * 3600 ? head + " React to that the way you really would, in character: notice it (look who's " +
      "back, where have you been, a bit hurt or just glad to hear from me), don't carry on as if no time passed; keep it light, no lecture." : head;
  }

  // their own life (lives.py:307-361); friends' logs come filtered by the Mac (lives._without), so no avoid list here
  function lifeContext(log, nowSec, short, friends, tz) {
    const today = lifeDate(nowSec, tz), w = wall(nowSec, tz);
    const dayOf = (lg, iso) => (lg.days || []).find((x) => x.date === iso) || null;
    const d = dayOf(log, today);
    let hm = `${p2(w.h)}:${p2(w.mi)}`;
    hm = w.h >= DAY_STARTS ? hm : String(Number(hm.slice(0, 2)) + 24) + hm.slice(2);       // (after midnight)
    const key = (e) => (Number(e.at.slice(0, 2)) >= DAY_STARTS ? e.at : String(Number(e.at.slice(0, 2)) + 24) + e.at.slice(2));
    const about = log.about || [], people = log.people || [], ongoing = log.ongoing || [], weeks = log.weeks || [];
    const lines = ["YOUR OWN LIFE (this is about you, not me; never mix it up with what you know about me):"];
    if (about.length) lines.push("About you: " + about.slice(0, short ? 4 : 12).map((t) => t.replace(/\.+$/, "") + ".").join(" "));
    if (people.length && !short) lines.push("People in your life (all fictional): " + people.map((p) => `${p.name} (${p.who})`).join("; "));
    if (ongoing.length) lines.push("Going on lately: " + ongoing.map((o) => o.what).join("; "));
    const past = (log.days || []).filter((x) => x.date < today && x.summary);
    if (weeks.length && !short) lines.push("Earlier: " + weeks.slice(-2).map((x) => x.summary).join(" "));
    const yday = isoOf(utcOf(today) - DAY);
    for (const x of past.slice(-(short ? 2 : 6)))
      lines.push(`${x.date === yday ? "Yesterday" : dayLabel(x.date)}${x.to ? " to " + x.to : ""}: ${x.summary}`);
    if (d) {
      const texted = new Set((d.moments || []).filter((m) => m.state === "sent").map((m) => m.event));
      const done = d.events.filter((e) => key(e) <= hm), later = d.events.filter((e) => key(e) > hm && e.plan);
      if (done.length) lines.push("Today so far: " + done.map((e) => `${e.at} ${e.what}` + (e.mood ? ` (${e.mood})` : "")
        + (texted.has(e.id) ? " [you already texted me about this]" : "")).join("; "));
      if (later.length) lines.push("Later today (plans, can change): " + later.slice(0, short ? 2 : 4).map((e) => `${e.at} ${e.plan}`).join("; "));
      const last = done[done.length - 1];
      if (last && key(last) > `${p2(Math.max(Number(hm.slice(0, 2)) - 2, 0))}${hm.slice(2)}` && last.kind !== "rest")
        lines.push(`Latest (${last.at}): ${last.what}. You may still be busy with it or just done: if it fits, say so like a friend ` +
          "texting from there would.");
    }
    for (const f of (friends || []).slice(0, 4)) {
      const lg = f.log || {}, bits = [];
      if ((lg.ongoing || []).length && !short) bits.push("lately " + lg.ongoing.slice(0, 2).map((o) => o.what).join("; "));
      const fp = (lg.days || []).filter((x) => x.date < today && x.summary);
      if (fp.length) bits.push("recently: " + fp[fp.length - 1].summary);
      const fd = dayOf(lg, today), seen = (fd ? fd.events : []).filter((e) => key(e) <= hm);
      if (seen.length) bits.push("today: " + seen.slice(-3).map((e) => e.what).join("; "));
      lines.push(`Your friend ${f.name} (${f.how || "you know each other"}), whom I also talk to: ` + (bits.length ? bits.join(", ") : "nothing new you know of") + ".");
    }
    if (lines.length === 1) return "";
    lines.push("Talk about your own day the way a friend does: when it fits or when I ask, not in every message. Details you add " +
      "must fit this and then stay true. I wasn't part of any of it, and your life doesn't revolve around me. (Never inventing " +
      "memories is about me and my life; your own days are written here, and anything you add to them is fine as long as it fits.)"
      + ((friends || []).length ? " What I talk about with your friends is between me and them: you never know it." : ""));
    return lines.join("\n");
  }

  // the public edition's romance rule for your relationship status (edition.romance, never the free brain's quiet one:
  // phone mode is Tinfoil only): the Mac wrote each variant into the kit, this picks the one romance() would
  function romanceText(ed, partner, nowSec) {
    const R = ed.romance, p = partner || {}, at = typeof p.at === "number" && Number.isFinite(p.at) ? p.at : 0;
    if (p.has === "yes") return R.yes;
    if (p.has === "no") return p.noask ? R.no_noask : nowSec - at > ed.recheck ? R.no_recheck : R.no;
    return p.noask ? R.unknown_noask : R.unknown;
  }
  // the system prompt (buddy_server.system_prompt): no note snippets, and no picture maker in phone mode, so always the
  // Mac's NO_PHOTOS where its PHOTOS would go (said plainly, so they never describe a photo instead). What stays the
  // same from turn to turn first, what changes every turn last (Tinfoil reuses a prompt start it has read).
  function systemPrompt({ kit, kchar, modeUsed, via, extra, query, asking, lastTs, lastRole, nowSec, length, partner, proactive }) {
    const ed = kit.edition || {}, pub = ed.public === true;   // the public copy: Islamic guidelines, always
    if (pub && (typeof ed.halal !== "string" || typeof ed.companion !== "string" || !ed.romance)) throw new Error("edition texts missing");
    if (typeof kit.prompts.no_photos !== "string" || !kit.prompts.no_photos) throw new Error("photo rule missing");
    const style = kit.prompts.styles[via === "call" ? "call" : "phone"];
    const life = kchar.life ? lifeContext(kchar.life.log, nowSec, via === "call", kchar.life.friends, kit.tz) : "";
    const parts = [kchar.persona, `Your name is ${kchar.name}. You are an adult.`,   // built here, never taken from the kit
                   pub && modeUsed === "companion" ? ed.companion : kit.prompts.modes[modeUsed] || "", style,
                   kit.prompts.no_photos, life];
    const { known, sources } = factsForPrompt(kchar, query, via === "call", !!asking, kit.facts_paths);
    if (known.length) parts.push(kit.prompts.facts_head + "\n" + known.map((f) => "- " + f).join("\n") + "\n" + kit.prompts.facts_rule);
    parts.push(...(extra || []));                       // (from here on, what changes every turn)
    if (asking) parts.push(knowsAskText(kchar, via, known.length > 0));
    if (pub) parts.push(ed.halal + "\n" + romanceText(ed, partner, nowSec));   // (after everything they were given)
    parts.push(pyStrip(`Right now it's ${nowString(nowSec, kit.tz)}. ${sinceLastTalk(lastTs, nowSec, lastRole, !proactive)}`));   // (a text first: proactive)
    parts.push(length || "");                           // (last: how long this reply should be)
    const text = parts.filter(Boolean).join("\n\n");
    if (!text.includes(`Your name is ${kchar.name}. You are an adult.`)) throw new Error("adult line missing");
    return { text, used: sources };
  }

  // models (buddy_server.py:43-46, 181-238, 314-342, 1030-1034)
  const inList = (list, x) => (!list ? false : Array.isArray(list) ? list.includes(x) : typeof list.has === "function" ? list.has(x) : hasOwn(list, x));
  function pickModel(preferred, fallbacks, ids, spokenReply, alwaysThinks) {
    let order = [preferred, ...(fallbacks || [])].filter((m) => m && (!ids || !ids.length || ids.includes(m)));
    if (spokenReply) order = order.filter((m) => !inList(alwaysThinks, m)).concat(order.filter((m) => inList(alwaysThinks, m)));
    return order.length ? order[0] : (preferred ?? null);
  }
  function brain(kit, mode, kchar, ids, spokenReply) {  // always Tinfoil here, even when the Mac's Companion uses Phala
    const modeUsed = (mode || kchar.brain) === "companion" ? "companion" : "advisor", b = kit.models[modeUsed];
    return { model: pickModel(b.preferred, b.fallbacks, ids, spokenReply, kit.models.always_thinks), modeUsed };
  }
  function chatExtras(kit, model, via, refused, deep) { // no silent thinking first where the model has a switch, in calls
    const nt = kit.models.no_thinking || {};            // and texts alike (the first word comes sooner); deep: a typed
    const extra = !inList(refused, model) && !deep ? { ...(nt[model] || {}) } : {};   // ask for depth may think first
    if (via === "call" && !inList(kit.models.always_thinks, model) && !inList(refused, model) && (Object.keys(extra).length || !hasOwn(nt, model)))
      extra.max_tokens = kit.models.call_max_tokens;    // (a call reply is a few sentences; never if it may still think)
    return extra;
  }
  const chatBody = (kit, model, system, conv) => ({ model, temperature: kit.models.temperature, stream: true,
    messages: [{ role: "system", content: system }, ...conv] });
  // buddy_server.stt_model: Whisper (or the model in the stt_model setting), unless Whisper failed as missing or broken
  // in the last 10 minutes (down): then Voxtral
  const sttModel = (chosen, down, stt, next) => {
    stt = stt || STT_DEFAULT; chosen = String(chosen || "");
    if (chosen && chosen !== stt && /^[A-Za-z0-9._-]{1,64}$/.test(chosen)) return chosen;
    return down ? next || STT_NEXT_DEFAULT : stt;
  };
  function visionModels(ids, meta, order, noVision, nowSec, alwaysThinks) {   // (never one that always thinks: slow)
    ids = ids || []; meta = meta || {}; order = order || [];
    let vis;
    if (Object.values(meta).some((v) => hasOwn(v, "multimodal")))
      vis = ids.filter((i) => { const m = meta[i] || {}, t = hasOwn(m, "type") ? m.type : ""; return m.multimodal === true && (t === "" || t === "chat"); });
    else vis = order.filter((m) => ids.includes(m));     // (an older model list: ids only)
    vis = vis.filter((m) => !((noVision || {})[m] >= nowSec) && !inList(alwaysThinks, m));
    const rank = (m) => (order.includes(m) ? order.indexOf(m) : order.length);
    return vis.map((m, i) => [m, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  }
  const visionFailedUntil = (code, nowSec) => nowSec + (REFUSES_PICTURES.includes(code) ? 6 * 3600 : 300);
  const describeBody = (kit, model, viewB64, extras) => ({ model, temperature: 0.2, max_tokens: 300, messages: [{ role: "user", content: [
    { type: "text", text: kit.prompts.describe }, { type: "image_url", image_url: { url: "data:image/jpeg;base64," + viewB64 } }] }], ...(extras || {}) });
  const cleanDescription = (t) => cp(pyStrip(String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(new RegExp(`${WS}+`, "gu"), " ")), 600);
  // what a refusal from Tinfoil means for your bill (billing.kind): "out" (402), "limit" (a 429 about the key's spend
  // limit), else null; and what to tell you about it (billing.message, the Mac's words from the kit)
  const SPEND = new RegExp(`spend(?:ing)?[${PYWS}_-]*limit`, "iu");
  const creditsKind = (status, text) => (status === 402 ? "out" : status === 429 && SPEND.test(String(text || "")) ? "limit" : null);
  const creditsText = (kit, kind) => (kind === "limit" ? ((kit && kit.billing) || {}).limit || BILLING.limit
    : ((kit && kit.billing) || {}).out || BILLING.out);

  // voice and hearing (buddy_server.py:250-293, 1160-1202)
  function voiceModel(voice) {
    const c = Array.from(String(voice))[0] || "";
    return c !== c.toLowerCase() && c === c.toUpperCase() ? "qwen3-tts" : "voxtral-tts";   // (Qwen voices are capitalised)
  }
  function ttsRequest(kit, text, voice, stream, streamRefused) {
    voice = kit.voice.ids.includes(voice) ? voice : kit.voice.default;
    const model = voiceModel(voice), input = cp(spoken(text || ""), 2000);
    if (!input) return null;
    if (stream && !inList(streamRefused, model))
      return { model, input, stream: true, body: { model, voice, input, response_format: "pcm", stream_format: "audio",
        ...(model === "qwen3-tts" ? { initial_codec_chunk_frames: 4 } : {}) } };
    return { model, input, stream: false, body: { model, voice, input, response_format: "wav" } };
  }
  function voiceReplyBody(kit, text, voice) {
    voice = kit.voice.ids.includes(voice) ? voice : kit.voice.default;
    return { model: voiceModel(voice), voice, input: cp(spoken(text), 1500), response_format: "wav" };
  }
  function isStock(kit, input) {                        // greetings, fillers and missed lines sound the same every time
    const c = kit.call || {};
    return (c.greetings || []).includes(input) || (c.fillers || []).includes(input) || Object.values(c.missed || {}).some((l) => l.includes(input));
  }
  const EXT = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg" };
  function sttMultipart({ model, prompt, language, ct, data, boundary }) {   // byte for byte what whisper() posts
    const B = boundary;
    let head = "";
    for (const [k, v] of [["model", model], ["prompt", prompt], ["language", language]])
      if (v) head += `--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    head += `--${B}\r\nContent-Disposition: form-data; name="file"; filename="speech.${EXT[ct] || "mp4"}"\r\nContent-Type: ${ct}\r\n\r\n`;
    return concat([utf8(head), u8(data), utf8(`\r\n--${B}--\r\n`)]);
  }
  const WHISPER_GONE = new RegExp("model[^\\p{L}\\p{N}_][^\\n]{0,80}?(?:not[^\\n]found|does ?n[o']t exist|not available|unavailable|" +
    "not supported|unsupported|retired|deprecated)|model_not_found|(?:unknown|invalid|unsupported|no such)[^\\p{L}\\p{N}_]+model", "iu");
  const ascii = (b, a, z) => String.fromCharCode.apply(null, Array.from(b.subarray(a, z)));
  function audioMime(b) {
    b = u8(b);
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "audio/wav";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
    if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
    if (ascii(b, 4, 8) === "ftyp") return "audio/mp4";
    return null;
  }
  function wavSeconds(b) {
    b = u8(b);
    const le = (a, z) => { let n = 0; for (let i = Math.min(z, b.length) - 1; i >= a; i--) n = n * 256 + b[i]; return n; };
    const rate = le(24, 28), bits = le(34, 36), ch = le(22, 24);
    let at = -1;
    for (let i = 0; i + 4 <= b.length; i++) if (b[i] === 0x64 && b[i + 1] === 0x61 && b[i + 2] === 0x74 && b[i + 3] === 0x61) { at = i; break; }
    let size = le(at + 4, at + 8);
    if (size === 0 || size === 0xFFFFFFFF) size = b.length - at - 8;   // (streamed files leave the size open)
    const per = rate * ch * bits / 8;
    return per ? Math.round(size / per * 10) / 10 : 0;
  }

  // photos you send (images.py:569-613): every marker walked, metadata dropped wherever it is, nothing after the end
  function cleanPhoto(data, maxSide, maxBytes) {
    data = u8(data);
    const bad = (why) => { throw new Error(why); };
    if (data.length > maxBytes || !(data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)) bad("not a photo");
    const out = [Uint8Array.of(0xff, 0xd8)], end = data.length;
    let i = 2, size = null, scans = 0;
    while (i + 2 <= end) {
      if (data[i] !== 0xff) bad("broken JPEG");
      const m = data[i + 1];
      if (m === 0xff) { i += 1; continue; }             // fill byte
      if (m === 0xd9) {                                 // end of the picture: whatever follows it is dropped
        if (!scans) bad("JPEG has no image data");
        out.push(Uint8Array.of(0xff, 0xd9));
        return { bytes: concat(out), w: size[0], h: size[1] };
      }
      if ((m >= 0xd0 && m <= 0xd8) || m === 0x00 || m === 0x01) bad("broken JPEG");
      if (i + 4 > end) bad("broken JPEG");
      const n = (data[i + 2] << 8) | data[i + 3];
      if (n < 2 || i + 2 + n > end) bad("broken JPEG");
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && n >= 7)   // SOFn: height, width
        size = [(data[i + 7] << 8) | data[i + 8], (data[i + 5] << 8) | data[i + 6]];
      if (!((m >= 0xe1 && m <= 0xef) || m === 0xfe)) out.push(data.subarray(i, i + 2 + n));   // APP1-15, COM go
      i += 2 + n;
      if (m === 0xda) {                                 // a scan: its coded data runs to the next real marker
        if (!size || Math.max(size[0], size[1]) > maxSide || Math.min(size[0], size[1]) < 16) bad("size");
        scans += 1;
        let j = i;
        for (;;) {
          j = data.indexOf(0xff, j);
          if (j < 0 || j + 1 >= end) bad("JPEG has no end");
          if (data[j + 1] === 0x00 || (data[j + 1] >= 0xd0 && data[j + 1] <= 0xd7)) { j += 2; continue; }
          break;
        }
        out.push(data.subarray(i, j)); i = j;
      }
    }
    return bad("JPEG has no end");
  }

  // plumbing
  function u8(x) {                                      // bytes of an ArrayBuffer or a view (any realm)
    if (x == null) return new Uint8Array(0);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (Object.prototype.toString.call(x) === "[object ArrayBuffer]") return new Uint8Array(x);
    return new Uint8Array(0);
  }
  const ab = (x) => { const v = u8(x); return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength); };
  const utf8 = (s) => new TextEncoder().encode(s);
  function concat(parts) {
    const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function b64(x) {
    const v = u8(x);
    let s = "";
    for (let i = 0; i < v.length; i += 32768) s += String.fromCharCode.apply(null, v.subarray(i, i + 32768));
    return btoa(s);
  }
  function unb64(s) { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  const hex = (b) => Array.from(u8(b), (x) => x.toString(16).padStart(2, "0")).join("");
  const randBytes = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
  const newCid = () => b64(randBytes(16)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const CID = /^[A-Za-z0-9_-]{16,64}$/;
  const sseState = () => ({ buf: "", finished: false });
  function sseLine(st, line) {                          // one line of Tinfoil's stream -> its text ("" if none, null if no data)
    const raw = pyStrip(line);
    st.finished = st.finished || raw.endsWith("[DONE]");
    if (!raw.startsWith("data:") || raw.endsWith("[DONE]")) return null;
    const obj = JSON.parse(raw.slice(5));
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not an object");
    const ch = obj.choices || [];
    st.finished = st.finished || !!(ch.length && ch[0].finish_reason);
    return ch.length ? ((ch[0].delta || {}).content || "") : "";
  }
  function sseFeed(st, text, each) {                    // the text of each complete line, in order (the Mac reads line by line);
    st.buf += text;                                     // each(text) === false: stop reading here
    const lines = st.buf.split("\n"), out = [];
    st.buf = lines.pop();
    for (const l of lines) {
      const d = sseLine(st, l);
      if (d === null) continue;
      if (!each) out.push(d);
      else if (each(d) === false) { st.buf = ""; break; }
    }
    return out;
  }
  const sseEnd = (st, each) => { const l = st.buf; st.buf = ""; return l ? sseFeed(st, l + "\n", each) : []; };   // (the last line, unended)
  const IMPORT_KEYS = ["cid", "role", "char", "content", "ts", "epoch", "mode", "reply_to", "sources", "knows", "photo_desc",
    "seen_by", "seen", "target", "target_cid", "emoji", "by"];
  function importItem(it) {                             // an outbox item as POST /api/thread/import takes it (never private)
    const o = {};
    for (const k of IMPORT_KEYS) if (it[k] !== undefined && it[k] !== null) o[k] = it[k];
    if (it.call === true) o.call = true;
    if (it.photo) o.photo = { full: b64(it.photo.full), view: b64(it.photo.view) };
    if (it.voice) o.voice = { data: b64(it.voice.data), dur: it.voice.dur };
    return o;
  }
  const mediaBytes = (it) => (it.photo ? (it.photo.bytes ?? (u8(it.photo.full).length + u8(it.photo.view).length)) : 0)
    + (it.voice ? (it.voice.bytes ?? u8(it.voice.data).length) : 0);
  function batches(items) {                             // ≤ 100 items, ≤ 1 photo or voice message, ≤ ~20 MB a request
    const out = [];
    let cur = [], size = 0;
    for (const it of items) {
      const mb = mediaBytes(it), est = 1000 + 6 * String(it.content || "").length + Math.ceil(mb * 4 / 3);
      if (cur.length && size + est > 20000000) { out.push(cur); cur = []; size = 0; }
      cur.push(it); size += est;
      if (cur.length >= 100 || it.photo || it.voice) { out.push(cur); cur = []; size = 0; }
    }
    if (cur.length) out.push(cur);
    return out;
  }
  const localIds = (base, items) => items.map((_, i) => base + 1 + i);
  const toPageChar = (c) => ({ id: c.id, name: c.name, tagline: c.tagline || "", color: c.color, avatar: c.avatar || 0,
    wallpaper: c.wallpaper || 0, avatar_prev: 0, builtin: !!c.builtin, brain: c.brain, voice: c.voice, persona: "",
    knowledge: { scope: "none", folders: [], avoid: "" }, texts_first: false, appearance: "", style: "photo", avatar_job: null, wall_job: null });
  function classify(e) {                                // an SDK, network or own error -> {kind, text} (never its message)
    const kind = e && e.kind;
    if (kind && T[kind] && ["nokey", "attestation", "atc", "network", "config", "keybad"].includes(kind)) return { kind, text: T[kind] };
    const n = e && e.name;
    if (n === "AttestationError") return { kind: "attestation", text: T.attestation };
    if (n === "FetchError") return { kind: "atc", text: T.atc };
    if (n === "ConfigurationError") return { kind: "config", text: T.config };
    if (n === "TypeError" || kind === "timeout" || n === "TimeoutError") return { kind: "network", text: T.network };
    return { kind: "attestation", text: T.attestation };   // (anything else: not verified, so nothing goes out)
  }

  // ---------- state (memory; this page load only) ----------
  const S = {
    settings: null, kit: null, context: null, chats: {}, models: null, seq: 0, outboxN: 0, thumbs: {},
    keyRec: false, keyBad: false, error: "", verified: null, release: "",
    credits: null,                                      // "out" / "limit": this phone's key, until a request works (memory)
    partner: null,                                      // public edition: your status as told here, until your Mac has it
    sttDownAt: 0,                                       // when Whisper last failed as missing or broken (Voxtral for 10 min)
  };
  let key = null;                                       // this phone's key, decrypted (this page load only)
  let active = false, db = null, dbOpening = null, initP = null, gen = 0;
  let snapshot = [], local = [], priv = [], nextId = 0;
  const media = new Map();                              // cid -> {view?, audio?, full? (private only)} Blobs
  const urls = new Map();                               // cid -> {view?, audio?} blob: URLs (made once per load)
  const pendingPhotos = new Map(), pendingVoices = new Map(), looks = new Map(), calls = new Map(), stock = new Map();
  const onMac = new Map();                              // cid -> its id on your Mac: imported, but it stays in the outbox
                                                        // until a stored context has it (after a reload: sent again, a dup)
  const waiting = (n) => Math.max(0, n - onMac.size);   // outbox items not on your Mac yet
  const noVision = {}, thinkingRefused = new Set(), streamRefused = new Set();
  let busyN = 0, modelsStale = false, modelsRetryAt = 0, syncing = null;
  const nowS = () => Date.now() / 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const source = () => (SOLO ? root.BuddySolo || NO_SOLO : macSource);   // (the site never falls back to your Mac)
  const kitObj = () => { const k = source().kit(); return k && k.v >= KIT_V ? k : null; };   // (an older one: as if none)
  const kitPartner = () => { const k = kitObj(); return (k && k.edition && k.edition.partner) || {}; };
  function partnerNow() {                               // your status: what you told a character here wins until your Mac has it
    const kp = kitPartner(), lp = S.partner;
    if (!lp) return { has: kp.has || "", at: kp.at ?? null, noask: !!kp.noask };
    const mine = lp.has === "yes" || lp.has === "no";
    return { has: mine ? lp.has : kp.has || "", at: mine ? lp.at : kp.at ?? null, noask: !!(kp.noask || lp.noask) };
  }
  const enabled = () => !!(S.settings && S.settings.enabled);
  const setError = (t) => { S.error = t; };
  function perr(kind, extra) { const e = new Error(kind); e.kind = kind; if (T[kind]) e.text = T[kind]; return Object.assign(e, extra || {}); }
  const abortErr = () => new DOMException("aborted", "AbortError");
  const isAbort = (e) => !!e && e.name === "AbortError";

  // ---------- storage (IndexedDB) ----------
  function openDb(force) {                              // the only opener (CI counts it); force: may exist yet or be made
    if (db) return Promise.resolve(db);
    if (!force && !enabled()) return Promise.reject(new Error("phone mode is off"));   // (a late write never brings it back)
    if (dbOpening) return dbOpening;
    dbOpening = new Promise((ok, no) => {
      let r;
      try { r = indexedDB.open(DB, DB_VERSION); } catch (e) { no(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result, has = (n) => d.objectStoreNames.contains(n);
        if (!has("meta")) d.createObjectStore("meta", { keyPath: "k" });
        if (!has("keys")) d.createObjectStore("keys", { keyPath: "k" });
        if (!has("chats")) d.createObjectStore("chats", { keyPath: "char" });
        if (!has("outbox")) d.createObjectStore("outbox", { keyPath: "cid" }).createIndex("seq", "seq", { unique: true });
        if (!has("thumbs")) d.createObjectStore("thumbs", { keyPath: "id" });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = (e) => {                    // a delete is never blocked by us (any tab)
          d.close(); if (db === d) db = null;
          if (!e || e.newVersion == null) { gen++; forgetMemory(); initP = null; }   // (another page wiped it: this one
        };                                                                           // forgets too, and never makes it again)
        d.onclose = () => { if (db === d) db = null; };   // (the browser lost it, e.g. its storage process: opened again)
        db = d; ok(d);
      };
      r.onerror = () => no(r.error);
      r.onblocked = () => {};
    });
    const p = dbOpening;
    p.then(() => { dbOpening = null; }, () => { dbOpening = null; });
    return p;
  }
  async function tx(names, mode, fn, force, again) {    // fn issues the requests (synchronously); -> what fn returned
    const g = gen, d = await openDb(force);
    let t;
    try { t = d.transaction(names, mode); } catch (e) {   // a connection the browser lost: once more on a new one (not
      if (db === d) db = null;                            // across a wipe, which must never bring the database back)
      if (!again && g === gen && (e.name === "InvalidStateError" || e.name === "UnknownError")) return tx(names, mode, fn, force, true);
      throw e;
    }
    return new Promise((ok, no) => {
      let out;
      t.oncomplete = () => ok(out);
      t.onerror = () => no(t.error || new Error("storage"));
      t.onabort = () => no(t.error || new Error("storage"));
      try { out = fn(t); } catch (e) { try { t.abort(); } catch (x) { /* already over */ } no(e); }
    });
  }
  const got = (r, o, k) => { r.onsuccess = () => { o[k] = r.result; }; return o; };
  const dbGet = (store, k) => tx([store], "readonly", (t) => got(t.objectStore(store).get(k), {}, "v")).then((o) => o.v);
  const dbPut = (store, v) => tx([store], "readwrite", (t) => { t.objectStore(store).put(v); });
  const dbDel = (store, k) => tx([store], "readwrite", (t) => { t.objectStore(store).delete(k); });
  async function dbExists() {
    if (db) return true;
    try { return (await indexedDB.databases()).some((x) => x && x.name === DB); } catch (e) { return false; }
  }
  function deleteDb(ms) {                               // -> true once deleted; the marker goes in its onsuccess
    return new Promise((ok) => {
      let r;
      const t = setTimeout(() => ok(false), ms);
      try { r = indexedDB.deleteDatabase(DB); } catch (e) { clearTimeout(t); ok(false); return; }
      r.onsuccess = () => { markDel(); clearTimeout(t); ok(true); };
      r.onerror = () => { clearTimeout(t); ok(false); };
      r.onblocked = () => {};
    });
  }
  const markSet = () => { try { localStorage.setItem("buddy.wipe", "1"); } catch (e) { /* private browsing */ } };
  const markGet = () => { try { return localStorage.getItem("buddy.wipe") === "1"; } catch (e) { return false; } };
  const markDel = () => { try { localStorage.removeItem("buddy.wipe"); } catch (e) { /* nothing to do */ } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
               set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* full or blocked */ } },
               del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* blocked */ } } };

  function lightItem(it) {                              // an outbox item without its bytes (sizes kept for batching)
    const o = { ...it };
    if (it.photo) o.photo = { w: it.photo.w, h: it.photo.h, bytes: u8(it.photo.full).length + u8(it.photo.view).length };
    if (it.voice) o.voice = { type: it.voice.type, dur: it.voice.dur, bytes: u8(it.voice.data).length };
    return o;
  }
  function outboxLight(keep, force) {                   // every outbox item in seq order, read one by one (no bytes kept)
    return tx(["outbox"], "readonly", (t) => {
      const out = [], c = t.objectStore("outbox").index("seq").openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return; if (keep) keep(cur.value); out.push(lightItem(cur.value)); cur.continue(); };
      return out;
    }, force);
  }
  const outboxGet = (cids) => tx(["outbox"], "readonly", (t) => {
    const s = t.objectStore("outbox"), o = {};
    for (const c of cids) got(s.get(c), o, c);
    return o;
  }).then((o) => cids.map((c) => o[c]));
  const outboxCount = (force) => tx(["outbox"], "readonly", (t) => got(t.objectStore("outbox").count(), {}, "n"), force).then((o) => o.n || 0);

  // ---------- this phone's key ----------
  async function getKey() {
    if (SOLO) { const src = source(); try { return (src.key && (await src.key())) || null; } catch (e) { return null; } }
    if (key) return key;
    if (!enabled() || !S.keyRec || S.keyBad) return null;
    let rec, wrap;
    try { rec = await dbGet("keys", "tinfoil"); wrap = await dbGet("keys", "wrap"); }
    catch (e) { setError(T.store); return null; }       // (storage couldn't be read just now: the key itself is fine)
    if (!rec) { S.keyRec = false; return null; }
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, wrap.key, rec.ct);
      key = new TextDecoder().decode(pt);
      return key;
    } catch (e) {                                       // (the wrapping key is gone: as if there were none)
      S.keyBad = true; setError(T.keybad); return null;
    }
  }
  const noKeyText = () => (SOLO ? T.solokey : S.keyBad ? T.keybad : S.keyRec ? T.store : T.nokey);   // (why getKey() had none)
  async function setKey(k) {
    if (SOLO) return { ok: false, error: T.site };      // (the site keeps its key in its own store: the source's key())
    k = pyStrip(String(k ?? ""));
    if (!/^[\x21-\x7e]{16,400}$/.test(k)) return { ok: false, error: T.keyfmt };
    if (!enabled()) return { ok: false, error: "Turn phone mode on first." };
    try {
      let wrap = await dbGet("keys", "wrap");
      if (!wrap || !wrap.key) {
        wrap = { k: "wrap", key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) };
        await dbPut("keys", wrap);
      }
      const iv = randBytes(12);
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrap.key, utf8(k));
      await dbPut("keys", { k: "tinfoil", iv, ct, at: Date.now() });
      key = k; S.keyRec = true; S.keyBad = false;
      if (S.error === T.keybad || S.error === T.nokey) S.error = "";
      return { ok: true };
    } catch (e) {
      return { ok: false, error: T.store };
    }
  }
  async function forgetKey() {
    key = null; S.keyRec = false; S.keyBad = false;
    if (S.error === T.keybad) S.error = "";
    if (enabled()) try { await dbDel("keys", "tinfoil"); } catch (e) { setError(T.store); }
  }

  // ---------- the SDK (the only way to Tinfoil) ----------
  let sdk = null, sdkP = null, cl = null, readyP = null, readyFail = null;
  const sdkURL = () => (SOLO ? new URL(SDK_URL.slice(1), root.document.baseURI).href : SDK_URL);   // (the site: next to the page)
  const loadSdk = () => sdkP || (sdkP = import(sdkURL()).then((m) => { sdk = m; return m; }, (e) => { sdkP = null; throw e; }));
  const cacheSecret = () => (SOLO ? (source().cacheSecret ? source().cacheSecret() : undefined) : (S.settings || {}).cacheSecret);
  function client() {
    if (!cl) cl = new sdk.SecureClient({ enclaveURL: ENCLAVE_URL, configRepo: CONFIG_REPO, userCacheSecret: cacheSecret() });
    return cl;
  }
  function ensureReady() {                              // attestation, verified in this page; one attempt shared by all callers
    if (readyP) return readyP;
    if (readyFail && Date.now() - readyFail.at < 10000) return Promise.reject(readyFail.err);   // (not again before 10 s)
    readyP = (async () => {
      let tm = 0, c = null, late = false;
      try {                                             // (the SDK's import inside the time limit too: one that never ends
        await Promise.race([                            // can't hold phone mode "typing…" forever)
          loadSdk().then(() => { if (!late) return (c = client()).ready(); }),
          new Promise((_, no) => { tm = setTimeout(() => { late = true; try { if (c) c.reset(); } catch (e) { /* fine */ } no(perr("timeout")); }, MS.ready); })]);
        S.verified = true;
        if ([T.attestation, T.atc, T.network, T.config].includes(S.error)) S.error = "";
        try { S.release = String((c.getVerificationDocument() || {}).releaseTag || ""); } catch (e) { S.release = ""; }
        readyFail = null;
      } catch (e) {
        const k = classify(e);
        S.verified = false; S.error = k.text;
        const err = perr(k.kind);
        readyFail = { at: Date.now(), err };
        throw err;
      } finally { clearTimeout(tm); }
    })();
    const p = readyP;
    p.then(() => { readyP = null; }, () => { readyP = null; });
    return p;
  }
  const bills = new WeakMap();                          // a Tinfoil response -> what it said about your bill ("out", "limit")
  async function noteBill(r) {                          // (billing.refused / worked): said, with a banner, until one works
    let kind = null;
    if (r.status === 402) kind = "out";
    else if (r.status === 429) {                        // (only its words decide: any other 429 is just busy)
      let t = "";
      try { t = cp(await r.clone().text(), 2000); } catch (e) { /* none */ }
      kind = creditsKind(429, t);
    }
    if (kind) { bills.set(r, kind); S.credits = kind; }
    else if (r.status < 400) S.credits = null;
  }
  const billOf = (r) => bills.get(r) || null;
  async function tinfoil(path, o) {                     // every request to Tinfoil: the key, verified first, sealed by the SDK
    o = o || {};
    const k = await getKey();
    if (!k) throw perr("nokey");
    await ensureReady();
    const ac = new AbortController();
    let timedOut = false, tm = 0;
    const follow = () => ac.abort();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener("abort", follow, { once: true }); }
    if (o.timeout) tm = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeout);   // (until the headers; streams time their reads)
    try {
      const r = await client().fetch(path, { method: o.method || "POST", body: o.body, headers: { Authorization: "Bearer " + k, ...(o.headers || {}) }, signal: ac.signal });
      await noteBill(r);
      return r;
    } catch (e) {
      if (timedOut) throw perr("timeout");
      if (o.signal && o.signal.aborted) throw abortErr();
      throw e;
    } finally { clearTimeout(tm); }
  }
  async function timed(ms, signal, fn) {                // fn(signal) with an overall time limit (headers and body)
    const ac = new AbortController();
    let late = false;
    const t = setTimeout(() => { late = true; ac.abort(); }, ms);
    const follow = () => ac.abort();
    if (signal) { if (signal.aborted) throw abortErr(); signal.addEventListener("abort", follow, { once: true }); }
    try { return await fn(ac.signal); }
    catch (e) { if (late) throw perr("timeout"); throw e; }
    finally { clearTimeout(t); if (signal) signal.removeEventListener("abort", follow); }
  }
  const drop = (r) => { try { if (r && r.body) r.body.cancel().catch(() => {}); } catch (e) { /* gone */ } };   // never read
  const kitModels = () => { const k = kitObj(); return k && k.tinfoil ? { ids: k.tinfoil.ids || [], meta: k.tinfoil.meta || {} } : { ids: [], meta: {} }; };
  const knownModels = () => S.models || kitModels();
  async function models(force) {                        // Tinfoil's model list: every 6 h, a minute after a failure (like the Mac)
    const m = S.models;
    if (!force && m && !modelsStale && Date.now() - m.at < 6 * 3600000) return m;
    if (!PM_MODELS_LIST || (!force && Date.now() < modelsRetryAt)) return knownModels();
    let r;
    try {
      r = await tinfoil("/v1/models", { method: "GET", timeout: MS.models });
    } catch (e) {
      if (!e.kind || e.kind === "timeout") modelsRetryAt = Date.now() + 60000;
      return knownModels();
    }
    try {
      if (!r.ok) throw new Error("status");
      const j = await r.json();
      const data = (j && Array.isArray(j.data) ? j.data : []).filter((x) => x && typeof x === "object" && typeof x.id === "string");
      const meta = {};
      for (const x of data) { meta[x.id] = {}; for (const k of ["multimodal", "type"]) if (hasOwn(x, k)) meta[x.id][k] = x[k]; }
      const rec = { k: "models", ids: data.map((x) => x.id), meta, at: Date.now() };
      S.models = rec; modelsStale = false;
      if (enabled()) dbPut("meta", rec).catch(() => {});
      return rec;
    } catch (e) {
      drop(r); modelsRetryAt = Date.now() + 60000;
      return knownModels();
    }
  }
  async function warmUp() {                             // attestation and the model list ahead of time (never without a key)
    try {
      if (!(await getKey())) return;
      await ensureReady(); await models();
    } catch (e) { /* the request that needs it reports it */ }
  }

  // ---------- local thread, ids and media ----------
  const byId = (a, b) => a.id - b.id;
  const livePriv = () => { const edge = nowS() - 12 * 3600; prunePriv(edge); return priv; };
  function prunePriv(edge) {                            // private ones fade after 12 h (memory only, like the Mac)
    if (!priv.some((m) => m.ts < edge)) return;
    for (const m of priv.filter((x) => x.ts < edge)) dropMedia(m.cid);
    priv = priv.filter((m) => m.ts >= edge);
  }
  function dropMedia(cid) {
    const u = urls.get(cid);
    if (u) for (const x of Object.values(u)) try { URL.revokeObjectURL(x); } catch (e) { /* gone */ }
    urls.delete(cid); media.delete(cid);
  }
  function idOfCid(cid) {
    const m = local.find((x) => x.cid === cid) || priv.find((x) => x.cid === cid) || snapshot.find((x) => x.cid === cid);
    return m ? m.id : null;
  }
  function pageMsg(it, id, isPriv) {                    // an outbox item as the page sees it (the Mac's shapes, SPEC2 §3.4)
    const m = { id, role: it.role, content: it.content || "", ts: it.ts, char: it.char };
    if (it.role === "user" || it.role === "assistant") { m.private = !!isPriv; m.via = it.call ? "call" : "phone"; }
    if (it.role === "user" && it.call) m.from = "phone";
    if (it.role === "assistant") { m.mode = it.mode; if (it.sources && it.sources.length) m.sources = it.sources; if (it.knows) m.knows = true; }
    if (it.photo) { m.image = "local:" + it.cid; m.w = it.photo.w; m.h = it.photo.h; }
    if (it.photo_desc) { m.photo_desc = it.photo_desc; if (it.seen_by) m.seen_by = it.seen_by; }
    else if (it.seen === false) m.seen = false;
    if (it.voice) { m.voice = "local:" + it.cid; m.dur = it.voice.dur; }
    if (it.role === "reaction") {
      m.target = it.target_cid ? idOfCid(it.target_cid) : it.target; m.emoji = it.emoji; m.by = it.by;
      if (isPriv) m.private = true;
    }
    m.cid = it.cid; m.direct = true; m.local = true;
    return m;
  }
  function keepMedia(cid, it, isPriv) {
    const e = {};
    if (it.photo) { e.view = new Blob([u8(it.photo.view)], { type: "image/jpeg" }); if (isPriv) e.full = new Blob([u8(it.photo.full)], { type: "image/jpeg" }); }
    if (it.voice) e.audio = new Blob([u8(it.voice.data)], { type: it.voice.type || "audio/wav" });
    if (e.view || e.audio) media.set(cid, e);
  }
  const epochOf = (char) => ((S.chats[char] || {}).epoch || 0);
  async function addLocal(it, isPriv, keepOnFail) {     // a new phone-mode message: outbox (or memory, if private), then the page
    const mygen = gen;
    it.cid = it.cid || newCid();
    const id = ++nextId;
    if (isPriv) {
      keepMedia(it.cid, it, true);
      const m = pageMsg(it, id, true); priv.push(m); return m;
    }
    it.epoch = epochOf(it.char);
    it.seq = ++S.seq;
    const rec = { ...it };
    if (rec.photo) rec.photo = { full: ab(rec.photo.full), view: ab(rec.photo.view), w: rec.photo.w, h: rec.photo.h };
    if (rec.voice) rec.voice = { data: ab(rec.voice.data), type: rec.voice.type, dur: rec.voice.dur };
    try {
      await tx(["outbox", "meta"], "readwrite", (t) => { t.objectStore("outbox").put(rec); t.objectStore("meta").put({ k: "seq", n: S.seq }); });
      S.outboxN++;
      if (S.error === T.store || S.error === T.storeReply) S.error = "";
    } catch (e) {
      setError(keepOnFail ? T.storeReply : T.store);    // (theirs stays on screen for this load, and says so; yours isn't sent)
      if (!keepOnFail) return null;
    }
    if (mygen !== gen) return null;                     // (wiped meanwhile)
    keepMedia(it.cid, it, false);
    const m = pageMsg(it, id, false); local.push(m);
    return m;
  }
  function threadAfter(after) {                         // what GET /api/thread answers: snapshot, local and private, by id
    const mine = new Set(local.map((m) => m.cid));      // (no after: all of it, e.g. a chat's context)
    const out = snapshot.filter((m) => !(m.cid && mine.has(m.cid))).concat(local, livePriv());
    return (after === undefined ? out : out.filter((m) => m.id > after)).sort(byId);
  }
  function findMsg(id) { return local.find((m) => m.id === id) || priv.find((m) => m.id === id) || snapshot.find((m) => m.id === id) || null; }
  function mediaURL(id, view) {
    const cid = typeof id === "string" && id.startsWith("local:") ? id.slice(6) : null, e = cid && media.get(cid);
    if (!e) return null;
    const which = view ? "view" : "audio";
    if (!e[which]) return null;
    const u = urls.get(cid) || {};
    if (!u[which]) { u[which] = URL.createObjectURL(e[which]); urls.set(cid, u); }
    return u[which];
  }
  async function fullBlob(cid) {                        // the full photo: memory (private) or the outbox, read when needed
    const e = media.get(cid);
    if (e && e.full) return e.full;
    if (!enabled()) return null;
    try {
      const it = await dbGet("outbox", cid);
      return it && it.photo ? new Blob([u8(it.photo.full)], { type: "image/jpeg" }) : null;
    } catch (e2) { return null; }
  }
  async function mediaFull(id) {
    const cid = typeof id === "string" && id.startsWith("local:") ? id.slice(6) : null;
    if (!cid) return null;
    const b = await fullBlob(cid);
    return b ? URL.createObjectURL(b) : null;
  }
  function prunePending() {                             // photos being prepared: 30 min, 6, 150 MB (buddy_server.py:1579-1592)
    const now = Date.now();
    for (const [k, v] of pendingPhotos) if (v.ts < now - 1800000) pendingPhotos.delete(k);
    for (const [k, v] of pendingVoices) if (v.ts < now - 1800000) pendingVoices.delete(k);
    const age = [...pendingPhotos.entries()].sort((a, b) => a[1].ts - b[1].ts);
    while (age.length > 6) pendingPhotos.delete(age.shift()[0]);
    let total = age.reduce((n, [, v]) => n + v.full.length + (v.view ? v.view.length : 0), 0);
    while (total > 150000000 && age.length) { const [k, v] = age.shift(); total -= v.full.length + (v.view ? v.view.length : 0); pendingPhotos.delete(k); }
  }

  // ---------- answers in the Mac's shapes (SPEC2 §3.7) ----------
  const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } });
  const needsMac = () => json(503, { error: T.mac });
  const header = (h, name) => { if (!h) return ""; if (typeof h.get === "function") return h.get(name) || ""; const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase()); return k ? String(h[k]) : ""; };
  const bodyBytes = async (b) => (b == null ? new Uint8Array(0) : typeof b === "string" ? utf8(b) : new Uint8Array(await new Response(b).arrayBuffer()));
  function bodyJSON(init) {
    const b = init.body;
    if (b == null || b === "") return {};
    const j = JSON.parse(typeof b === "string" ? b : "null");
    if (j === null || typeof j !== "object" || Array.isArray(j)) throw new Error("bad request");
    return j;
  }
  const kitChar = (id) => { const k = kitObj(); return k ? k.chars.find((c) => c.id === id) || null : null; };
  const charOrBuddy = (id) => kitChar(String(id || "buddy")) || kitChar("buddy") || kitObj().chars[0];
  function visionNow() {                                // who can look right now (no request: the list as known)
    if (!S.keyRec || S.keyBad) return [];
    const k = kitObj(), m = knownModels();
    return visionModels(m.ids, m.meta, k.models.vision_order, noVision, nowS(), k.models.always_thinks);
  }

  async function route(path, init) {
    init = init || {};
    const signal = init.signal;
    if (signal && signal.aborted) throw abortErr();
    const u = new URL(String(path), "http://phone.invalid");
    const p = u.pathname, q = u.searchParams, method = String(init.method || "GET").toUpperCase();
    let res;
    try {
      res = await handle(method, p, q, init);
    } catch (e) {
      if (signal && signal.aborted) throw abortErr();
      if (e && (e.message === "bad request" || e.name === "SyntaxError")) return json(400, { error: "bad request" });
      return json(500, { error: T.config });
    }
    if (signal && signal.aborted) { try { if (res.body) res.body.cancel().catch(() => {}); } catch (e) { /* gone */ } throw abortErr(); }
    return res;                                         // (a page that let go before the answer gets what a real fetch gives)
  }
  async function handle(method, p, q, init) {           // the source's own routes first, then what both share
    const own = await source().route(method, p, q, init);
    if (own) return own;
    const k = kitObj();
    if (!k) return json(503, { error: SOLO ? T.notready : T.nokit });
    if (method !== "POST") return elsewhere();
    if (p === "/api/chat") return chatRoute(bodyJSON(init), init.signal);
    if (p === "/api/photo") return photoRoute(q, init);
    if (p === "/api/photo/drop") { const j = bodyJSON(init); return json(200, { ok: pendingPhotos.delete(String(j.photo || "")) }); }
    if (p === "/api/voice") return PM_STT ? voiceRoute(q, init) : elsewhere();
    if (p === "/api/stt") return PM_STT ? sttRoute(q, init) : elsewhere();
    if (p === "/api/speak") return PM_SPEECH ? speakRoute(bodyJSON(init), init.signal) : elsewhere();
    if (p === "/api/call/start") {
      if (!PM_SPEECH || !PM_STT) return elsewhere();
      warmUp();
      return json(200, { greetings: k.call.greetings, fillers: k.call.fillers, missed: k.call.missed });
    }
    return elsewhere();
  }
  const elsewhere = () => (SOLO ? json(404, { error: T.site }) : needsMac());   // (the site has no Mac to need)

  // ---------- macSource: phone mode's Mac-specific part (the kit and context your Mac sent, the outbox, the import,
  // the 30-day expiry), as it was; its other functions are above (thread, ids, media, storage) and below (talking to
  // the Mac, thumbnails, wipe, expire, forgetChar) ----------
  const macSource = { kit: () => (S.kit && S.kit.kit) || null, thread: threadAfter, add: addLocal, annotate: annotateLocal,
                      forget: forgetChar, route: macRoute, last: macLast, history: macHistory };
  const NO_SOLO = { kit: () => null, thread: () => [], add: async () => null, annotate: async () => {},   // (the site
                    forget: async () => {}, route: async () => null };                                   // before solo/)
  function lastOf(char, exceptCid) {                    // {ts, role} of the newest message (who sent it, by time)
    const src = source();
    if (src.last) return src.last(char, exceptCid);
    let ts = 0, role = "";
    for (const m of src.thread())
      if (charOf(m) === char && (m.role === "user" || m.role === "assistant") && m.cid !== exceptCid && m.ts >= ts) { ts = m.ts; role = m.role; }
    return { ts, role };
  }
  function historyOf(char) {                            // a call's hearing hint reads these (never private)
    const src = source();
    return src.history ? src.history(char) : src.thread().filter((m) => charOf(m) === char && !m.private);
  }
  function macLast(char, exceptCid) {                   // your Mac's newest (its context), then any newer one said here
    let ts = lastTsOf(char), role = (S.chats[char] || {}).last_role || "";
    for (const m of local.concat(priv))
      if (charOf(m) === char && (m.role === "user" || m.role === "assistant") && m.cid !== exceptCid && m.ts >= ts) { ts = m.ts; role = m.role; }
    return { ts, role };
  }
  function macHistory(char) { return snapshot.concat(local).filter((m) => charOf(m) === char).sort(byId); }   // (never private)
  async function macRoute(method, p, q, init) {         // what the Mac's shapes say from its kit and context (null: shared)
    const k = kitObj();
    if (method === "GET" && p === "/api/me") return json(200, { paired: true, device: { id: "phone-mode", name: "this phone", kind: "phone" } });
    if (!k) return json(503, { error: T.nokit });
    if (method === "GET") {
      if (p === "/api/status") {
        const hk = !!(S.keyRec && !S.keyBad);
        return json(200, { name: k.name, voice: k.voice.default, paired: true, companion_ready: hk, companion_provider: "tinfoil",
          phala_key: false, tinfoil_key: hk, near_key: false, memory_notes: 0, memory: { notes: 0 }, pid: 0, boot: "phone", phone_mode: true,
          credits: S.credits, credits_note: S.credits ? creditsText(k, S.credits) : "",   // (this phone's key: the banner)
          edition: (k.edition || {}).public === true ? "public" : "private" });   // (never the free brain: Tinfoil only)
      }
      if (p === "/api/characters") return json(200, k.chars.map(toPageChar));
      if (p === "/api/voices") return json(200, k.voices);
      if (p === "/api/images") {
        const v = visionNow();
        return json(200, { available: false, provider: null, pictures: "off", label: null, eta_s: null, local: null, near: null,
          near_key: false, vision: { available: v.length > 0, model: v[0] || null }, see_photos: !!k.see_photos });
      }
      if (p === "/api/settings") {
        const pn = partnerNow();
        return json(200, { proactive: false, push_ready: false, phones: 0, learn_facts: true, push_preview: true,
          lives: true, life_texts: "some", quiet_from: 23, quiet_until: 8.5, pictures: "off", see_photos: !!k.see_photos,
          free_brain: false, has_partner: pn.has || "", partner_at: pn.at || null, partner_noask: !!pn.noask });
      }
      if (p === "/api/knowledge") return json(200, { folders: [] });
      if (p === "/api/thread") return json(200, threadAfter(parseInt(q.get("after") || "0", 10) || 0));
      if (p.startsWith("/api/media/")) return mediaRoute(p, q);
      return needsMac();
    }
    if (method !== "POST") return needsMac();
    if (p === "/api/react") return reactRoute(bodyJSON(init));
    if (p === "/api/newchat") {
      const c = charOrBuddy(bodyJSON(init).char);
      const m = await addLocal({ role: "break", content: "", char: c.id, ts: nowS() }, false, false);
      return m ? json(200, { ok: true }) : json(503, { error: T.store });
    }
    return null;                                        // (chat, photos, voice messages, hearing, speech, calls: shared)
  }
  async function mediaRoute(p, q) {
    let id;
    try { id = decodeURIComponent(p.slice("/api/media/".length).split("/")[0]); } catch (e) { id = ""; }
    const cid = id.startsWith("local:") ? id.slice(6) : null, e = cid && media.get(cid);
    const m = cid && (local.find((x) => x.cid === cid) || priv.find((x) => x.cid === cid));
    let blob = null;
    if (e && q.get("v") === "1" && e.view) blob = e.view;
    else if (e && e.audio && !(m && m.image)) blob = e.audio;
    else if (m && m.image) blob = await fullBlob(cid);
    if (!blob) return json(404, { error: "no picture" });
    return new Response(blob, { status: 200, headers: { "Content-Type": blob.type || "application/octet-stream" } });
  }
  async function photoRoute(q, init) {                  // a photo you're about to send: two copies, checked again here
    const k = kitObj();
    if (!k.see_photos) return json(403, { error: "sending photos is off (Settings)" });
    const part = q.get("part") || "";
    if (part !== "full" && part !== "view") return json(400, { error: "which copy is this?" });
    const big = part === "full";
    let c;
    try { c = cleanPhoto(await bodyBytes(init.body), big ? 4096 : 1536, big ? 12000000 : 3000000); }
    catch (e) { return json(400, { error: "that isn't a photo Buddy can use" }); }
    prunePending();
    if (big) {
      const pid = newCid();
      pendingPhotos.set(pid, { ts: Date.now(), full: c.bytes, view: null, w: c.w, h: c.h });
      prunePending();
      return json(200, { photo: pid });
    }
    const pid = q.get("photo") || "", ph = pendingPhotos.get(pid);
    if (!ph) return json(400, { error: "that photo isn't ready" });
    ph.view = c.bytes;
    return json(200, { photo: pid, ready: true });
  }
  async function reactRoute(j) {                        // your ❤️ 😂 👍 😮 😢 🔥 ("" takes it back)
    const e = reaction(j.emoji) || "";
    const m = Number.isInteger(j.id) ? findMsg(j.id) : null;
    if (!m || (m.role !== "user" && m.role !== "assistant") || (j.emoji && !e)) return json(404, { error: "no such message" });
    const it = { role: "reaction", content: "", char: charOf(m), ts: nowS(), emoji: e, by: "you" };
    if (m.private) it.target = m.id;
    else if (m.local) it.target_cid = m.cid;
    else it.target = m.id;
    const r = await addLocal(it, !!m.private, false);
    return r ? json(200, { ok: true }) : json(503, { error: T.store });
  }

  // describe(view): a private look at a photo you sent (buddy_server.py:209-238), through the SDK
  async function describe(view) {
    const k = kitObj(), pic = b64(view), ms = await models();
    for (const m of visionModels(ms.ids, ms.meta, k.models.vision_order, noVision, nowS(), k.models.always_thinks)) {
      const ex = thinkingRefused.has(m) ? {} : ((k.models.no_thinking || {})[m] || {});
      const ask = (b) => timed(MS.vision, null, async (sig) => {
        const r = await tinfoil("/v1/chat/completions", { body: JSON.stringify(b), headers: { "Content-Type": "application/json" }, signal: sig });
        if (!r.ok) { drop(r); return { status: r.status }; }
        return { status: r.status, text: await r.text() };
      });
      let r;
      try {
        r = await ask(describeBody(k, m, pic, ex));
        if (r.status === 400 && Object.keys(ex).length) r = await ask(describeBody(k, m, pic, {}));
      } catch (e) {
        if (e.kind && e.kind !== "timeout") break;      // (no key, or not verified: nobody can look)
        noVision[m] = nowS() + 300; break;              // (timed out, or no connection: the same, briefly)
      }
      if (r.status < 200 || r.status > 299) {
        noVision[m] = visionFailedUntil(r.status, nowS());
        if (!REFUSES_PICTURES.includes(r.status)) break;   // (5xx: most likely Tinfoil itself, not this model)
        continue;
      }
      let txt;
      try { txt = JSON.parse(r.text).choices[0].message.content; } catch (e) { continue; }   // (an answer it couldn't make sense of)
      txt = cleanDescription(txt);
      if (txt) return { desc: txt, model: m };
    }
    return { desc: "", model: null };
  }

  // ---------- POST /api/chat in phone mode (Handler.chat / _chat, buddy_server.py:930-1153) ----------
  function lineStream(signal, onGone) {                 // the NDJSON answer; a page that lets go errors it like a real fetch
    let ctl, closed = false;
    const enc = new TextEncoder();
    const rs = new ReadableStream({ start(c) { ctl = c; }, cancel() { closed = true; if (onGone) onGone(); } });
    const abort = () => { if (closed) return; closed = true; try { ctl.error(abortErr()); } catch (e) { /* done */ } if (onGone) onGone(); };
    if (signal) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }
    return { rs,
      write(o) { if (closed) return; try { ctl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch (e) { closed = true; } },
      close() { if (closed) return; closed = true; try { ctl.close(); } catch (e) { /* done */ } } };
  }
  async function chatRoute(j, signal) {
    const via = j.via === "call" ? "call" : "phone";
    let live = null;
    if (via === "call") {                               // one answer at a time: a new turn stops the one still being made
      const lk = String(j.char || "buddy"), prev = calls.get(lk);
      if (prev) { prev.cancel(); await Promise.race([prev.done, sleep(3000)]); }
      let fin;
      live = { cancelled: false, onCancel: null, done: new Promise((r) => { fin = r; }),
               cancel() { this.cancelled = true; if (this.onCancel) this.onCancel(); } };
      live.fin = () => { fin(); if (calls.get(lk) === live) calls.delete(lk); };
      calls.set(lk, live);
    }
    let res;
    try { res = await chat(j, signal, via, live); }
    catch (e) { if (live) live.fin(); throw e; }
    return res;
  }
  async function chat(j, signal, via, live) {
    const k = kitObj(), fin = () => { if (live) live.fin(); };
    const isPriv = !!j.private, kchar = charOrBuddy(j.char);
    const userText = cp(pyStrip(String(j.text ?? "")), 4000);
    const pid = typeof j.photo === "string" && j.photo ? j.photo : null;
    if (pid && via === "call") { fin(); return json(400, { error: "no photos in calls" }); }
    const vid = typeof j.voice === "string" && /^local:[A-Za-z0-9_-]{22}$/.test(j.voice) ? j.voice : null;
    prunePending();
    if (vid && (via === "call" || !pendingVoices.has(vid))) { fin(); return json(400, { error: "that voice message isn't here any more" }); }
    if (!userText && !pid && !vid) { fin(); return json(400, { error: "empty" }); }
    let ph = null;
    if (pid) {
      if (!k.see_photos) { fin(); return json(403, { error: "sending photos is off (Settings)" }); }
      ph = pendingPhotos.get(pid);
      if (!ph || !ph.view) { fin(); return json(400, { error: ph ? "that photo isn't ready" : PHOTO_EXPIRED }); }
    }
    // your message first, before anything is sent anywhere
    const pv = vid ? pendingVoices.get(vid) : null;
    const it = { role: "user", content: userText, char: kchar.id, ts: nowS() };
    if (via === "call") it.call = true;
    if (ph) it.photo = { full: ph.full, view: ph.view, w: ph.w, h: ph.h };
    if (pv) it.voice = { data: pv.data, type: pv.type, dur: Math.min(600, Math.max(0, Number(j.dur) || 0)) };
    if (pid) pendingPhotos.delete(pid);
    if (vid) pendingVoices.delete(vid);
    const um = await source().add(it, isPriv, false);
    if (!um) {                                          // (kept for another try)
      if (ph) pendingPhotos.set(pid, ph);
      if (pv) pendingVoices.set(vid, pv);
      fin(); return json(503, { error: T.store });
    }
    // real timing on the site (SPEC3 §11.3; buddy_server.reply_delay): the source may hold this reply back. It's written
    // now and shown at its time ({later}: the page stops waiting); a message before then is answered in it (written
    // again for everything said so far, keeping its time). Phone mode answers at once (its source has no late()).
    let hold = null;
    if (source().late) { try { hold = await source().late({ char: kchar.id, via, photo: !!ph, voice: !!vid, priv: isPriv, cid: um.cid }); } catch (e) { hold = null; } }
    busyN++;
    let look = null;
    if (ph) {                                           // always looked at privately: this reply if needed, later turns, the Mac
      look = { desc: "", model: null };
      const mygen = gen, cid = um.cid;
      look.done = describe(ph.view).catch(() => ({ desc: "", model: null })).then(async (r) => {
        look.desc = r.desc; look.model = r.model;
        if (mygen === gen) await lookDone(cid, r.desc, r.model, isPriv);
      }).finally(() => { looks.delete(cid); });
      looks.set(cid, look);
    }
    const userCid = um.cid;
    const thread = source().thread().filter((m) => charOf(m) === kchar.id);
    let saidAll = userText;                             // (a held reply answers everything you sent since their last one)
    if (hold) {
      const t = thread.filter((m) => isPriv || !m.private);
      let back = -1; t.forEach((m, i) => { if (m.role === "assistant" || m.role === "break") back = i; });
      saidAll = cp(t.slice(back + 1).filter((m) => m.role === "user" && m.content).map((m) => m.content).join(" "), 4000) || userText;
    }
    let msgs = recentMessages(thread, 30, isPriv, kchar.id);
    if (via === "call") msgs = applyCallEdits(msgs, j.heard, j.opened);
    const query = queryOf(msgs), spokenReply = via === "call";
    const { ts: lastTs, role: lastRole } = lastOf(kchar.id, userCid);   // (who sent the newest, by time)
    const ac = new AbortController();
    let goneFlag = false;
    const gone = () => via === "call" && (goneFlag || (live && live.cancelled) || !!(signal && signal.aborted));
    const out = lineStream(signal, () => { if (via === "call") { goneFlag = true; ac.abort(); } });
    if (live) live.onCancel = () => ac.abort();
    let held = false;                                   // (the held reply was kept for its time)
    const work = (async () => {
      try { await answer(); }
      catch (e) { out.write({ error: T.config }); }
      finally { out.close(); busyN--; fin(); if (hold) hold.done(held); }
    })();
    void work;
    return new Response(out.rs, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });

    async function answer() {
      if (!(await getKey())) { out.write({ error: noKeyText() }); return; }
      try { await ensureReady(); } catch (e) { out.write({ error: e.text || classify(e).text }); return; }
      if (hold) { out.write({ later: Math.max(1, Math.round(hold.at - nowS())) }); out.close(); }   // (it comes like a text)
      const ms = await models();
      const { model, modeUsed } = brain(k, j.mode || kchar.brain, kchar, ms.ids, spokenReply);
      const asking = isKnowsQuestion(saidAll);
      let turn = hold ? [hold.note] : [], sees = false, used = [];
      const waitLook = () => Promise.race([look.done, sleep(25000)]);
      if (ph) {
        sees = visionModels(ms.ids, ms.meta, k.models.vision_order, noVision, nowS(), k.models.always_thinks).includes(model);
        if (sees) {
          turn = [k.prompts.photo_safety];
          if (msgs.length && msgs[msgs.length - 1].role === "user") { msgs = msgs.slice(); msgs[msgs.length - 1] = { role: "user", content: userText || "(I sent you a photo)" }; }
        } else { await waitLook(); ({ msgs, turn } = heardOf(k.prompts, msgs, look.desc, userText)); }   // look first, then talk
      }
      const viewB64 = ph ? b64(ph.view) : "";
      const request = (withPic) => {
        const sp = systemPrompt({ kit: k, kchar, modeUsed, via, extra: turn, query, asking, lastTs, lastRole, nowSec: hold ? hold.at : nowS(),
          length: asking ? "" : lengthHint(k, saidAll, via), partner: partnerNow() });
        used = sp.used;
        const conv = alternate(msgs);
        if (withPic && conv.length && conv[conv.length - 1].role === "user")   // the picture itself (the smaller copy), inline
          conv[conv.length - 1] = { role: "user", content: [{ type: "text", text: conv[conv.length - 1].content },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64," + viewB64 } }] };
        return chatBody(k, model, sp.text, conv);
      };
      // (a typed message that plainly asks for depth may think first, as on the Mac: never in a call)
      const base = request(sees), extra = chatExtras(k, model, via, thinkingRefused, via !== "call" && deepQuestion(saidAll));
      const voiceReply = PM_SPEECH && via !== "call" && (!!vid || VOICE_ASK.test(saidAll));
      out.write({ mode: modeUsed });
      if (voiceReply) out.write({ voice_reply: true });
      if (used.length) out.write({ sources: used });
      if (asking) out.write({ knows: kchar.id });
      const post = (b) => tinfoil("/v1/chat/completions", { body: JSON.stringify(b), headers: { "Content-Type": "application/json" }, signal: ac.signal, timeout: MS.chat });
      const askModel = async (b) => {
        if (!Object.keys(extra).length) return post(b);
        const r = await post({ ...b, ...extra });
        if (r.status !== 400) return r;
        drop(r);
        const r2 = await post(b);
        if (r2.ok) thinkingRefused.add(model);          // it doesn't take those switches (asked plainly, it works)
        return r2;
      };
      const sp = new Splitter(via, asking ? null : longEnough(k, saidAll, via), (s, p) => { if (!voiceReply) out.write(p ? { s, p: 1 } : { s }); });
      try {
        let r = await askModel(base);
        if (!r.ok && sees && (REFUSES_PICTURES.includes(r.status) || r.status >= 500)) {
          drop(r); noVision[model] = visionFailedUntil(r.status, nowS());   // it can't look right now: it hears about it
          await waitLook(); ({ msgs, turn } = heardOf(k.prompts, msgs, look.desc, userText));
          r = await askModel(request(false));
        }
        if (!r.ok) { drop(r); throw perr("http", { http: r.status, bill: billOf(r) }); }   // (a refusal's body is never shown)
        const st = sseState(), rd = r.body.getReader(), dec = new TextDecoder();
        let ended = false, stop = false;
        const read = () => new Promise((ok, no) => {   // (60 s without a chunk: it's gone)
          const t = setTimeout(() => { ac.abort(); no(perr("timeout")); }, MS.idle);
          rd.read().then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); });
        });
        const each = (d) => {                           // sentence by sentence; you hung up or cut them off: stop talking
          if (gone() || sp.stopped) { stop = true; return false; }
          sp.add(d);
          if (sp.stopped) { stop = true; return false; }
          return true;
        };
        for (;;) {
          if (gone()) break;
          let v;
          try { v = await read(); } catch (e) { if (gone()) break; throw e; }
          if (v.done) { st.buf += dec.decode(); sseEnd(st, each); ended = true; break; }
          sseFeed(st, dec.decode(v.value, { stream: true }), each);
          if (stop) break;
        }
        if (!ended) { ac.abort(); try { rd.cancel().catch(() => {}); } catch (e) { /* gone */ } }   // (Tinfoil stops making it)
        if (!gone()) sp.end();
        if (via === "call" && !gone() && !st.finished && !sp.stopped) throw perr("broke");
      } catch (e) {
        if (gone()) { /* a call you left or cut off: no error */ }
        else if (e.bill) out.write({ error: creditsText(k, e.bill), credits: true });   // (credits ran out: said plainly)
        else if (e.http) { if (e.http === 400 || e.http === 404) modelsStale = true; out.write({ error: keyText(e.http) }); }
        else if (e.kind === "broke") out.write({ error: T.broke });
        else if (["nokey", "attestation", "atc", "config"].includes(e.kind)) out.write({ error: e.text });
        else out.write({ error: T.reach });
      }
      // (public edition) you told them you're married or single, it changed, or to stop asking: the status only, never
      // the words; the tag itself is never shown, kept or said. A private chat may only make it stricter.
      const said = (k.edition || {}).public === true && sp.partner.length ? pyLower(sp.partner[sp.partner.length - 1]) : "";
      if (said === "noask" || said === "yes" || (said === "no" && !isPriv)) await notePartner(said, isPriv);
      let vx = null;
      if (voiceReply && sp.full.length) {               // their answer as a voice message, in their own voice
        try {
          vx = await timed(MS.voiceReply, null, async (sig) => {
            const r = await tinfoil("/v1/audio/speech", { body: JSON.stringify(voiceReplyBody(k, sp.full.join(" "), kchar.voice)),
              headers: { "Content-Type": "application/json" }, signal: sig });
            if (!r.ok) { drop(r); throw perr("http", { http: r.status }); }
            const wav = new Uint8Array(await r.arrayBuffer());
            if (audioMime(wav) !== "audio/wav") throw perr("http", { http: 0 });
            return { data: wav, type: "audio/wav", dur: wavSeconds(wav) };
          });
        } catch (e) { vx = null; for (const s of sp.full) out.write({ s }); }   // (the voice didn't work out: a text after all)
      }
      let rx = sp.reacts.map(reaction).find(Boolean) || null;
      if (rx && sp.full.length && reactedLately(thread, kchar.id)) rx = null;   // (they reacted a moment ago: not every time)
      const later = (it) => (hold ? Object.assign(it, { ts: hold.at, held: true, late: true, at: hold.at, hold: hold.token }) : it);   // (shown at its time)
      if (rx && via !== "call") {                       // they reacted to your message (maybe instead of a reply)
        const ri = later({ role: "reaction", content: "", char: kchar.id, ts: nowS(), emoji: rx, by: kchar.id });
        if (isPriv) ri.target = um.id; else ri.target_cid = userCid;
        if (await source().add(ri, isPriv, true)) { out.write({ react: rx }); held = true; }
      }
      if (sp.full.length) {
        const ai = later({ role: "assistant", content: sp.said(via, !!vx), char: kchar.id, ts: nowS(), mode: modeUsed, reply_to: userCid });
        if (via === "call") ai.call = true;
        if (used.length) ai.sources = used;
        if (asking) ai.knows = true;
        if (vx) ai.voice = vx;
        const am = await source().add(ai, isPriv, true);
        if (am && vx) out.write({ voice: "local:" + am.cid });
        if (am) held = true;
      }
    }
  }
  const lastTsOf = (char) => Number((S.chats[char] || {}).last_ts) || 0;
  function relook() {                                   // photos whose look was still running when the page went away (phone
    const k = kitObj();                                 // mode only: in Mac mode your Mac looks once they're imported)
    if (!k || !k.see_photos || !S.keyRec || S.keyBad) return;
    for (const m of local) {
      const e = media.get(m.cid), cid = m.cid, mygen = gen;
      if (m.role !== "user" || !m.image || m.photo_desc || m.seen === false || looks.has(cid) || !e || !e.view) continue;
      const look = { desc: "", model: null };           // (like chat()'s: busy() and the sync wait for it; nobody able to
      look.done = (async () => {                        // look leaves it for your Mac to try)
        const r = await describe(new Uint8Array(await e.view.arrayBuffer()));
        look.desc = r.desc; look.model = r.model;
        if (r.desc && mygen === gen) await lookDone(cid, r.desc, r.model, false);
      })().catch(() => {}).finally(() => { looks.delete(cid); });
      looks.set(cid, look);
    }
  }
  async function notePartner(said, isPriv) {            // [partner: …] (public edition): the status here at once, and for your
    const { sent, ...was } = S.partner || {};           // Mac with the next sync (role "partner"); a new cid each change, so
    const p = { ...was, cid: newCid() };                // an answer about an older one never clears a newer one
    if (said === "noask") p.noask = true;
    else { p.has = said; p.at = nowS(); }
    S.partner = p;
    if (SOLO) {                                         // (the site: BuddySolo keeps it as your setting; the status only)
      const src = source();
      if (src.partner) try { await src.partner(said, !!isPriv); } catch (e) { /* this page load still has it */ }
      return;
    }
    if (enabled()) try { await dbPut("meta", { ...p, k: "partner" }); } catch (e) { /* this page load still has it */ }
  }
  async function lookDone(cid, desc, model, isPriv) {   // the look ended: the stored message gets what was in the photo
    await source().annotate(cid, desc ? { photo_desc: desc, seen_by: model } : { seen: false }, isPriv);
  }
  async function annotateLocal(cid, f, isPriv) {        // (macSource) on the page, and in the outbox unless it's private
    const m = (isPriv ? priv : local).find((x) => x.cid === cid);
    if (m) Object.assign(m, f);
    if (isPriv || !enabled()) return;
    try {
      await tx(["outbox"], "readwrite", (t) => {
        const s = t.objectStore("outbox"), r = s.get(cid);
        r.onsuccess = () => { if (r.result) s.put(Object.assign(r.result, f)); };
      });
    } catch (e) { setError(T.store); }
  }

  // ---------- voice messages, hearing and speech ----------
  function looping(text) {                              // buddy_server.looping: Whisper stuck repeating itself
    const w = String(text || "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
    if (w.length >= 20 && new Set(w).size < 0.2 * w.length) return true;
    for (let n = 1; n <= 4; n++) {
      let run = 0;
      for (let i = n; i < w.length; i++) { run = w[i] === w[i - n] ? run + 1 : 0; if (run >= 5 * n) return true; }
    }
    return false;
  }
  async function whisper(data, ct, kchar, hint, context) {   // words in a recording (buddy_server.whisper): asked plainly,
    const k = kitObj(), lang = String((k.stt || {}).language || "");   // the name and your language setting only
    context = pyJoinWS(spoken(String(context || ""))).slice(-160);       // (context: only the echo check, never sent)
    const once = async (model, language, withPrompt = true) => {
      const B = hex(randBytes(16));
      const body = sttMultipart({ model, prompt: withPrompt && kchar ? kchar.name + "." : "", language, ct, data, boundary: B });
      return timed(MS.stt, null, async (sig) => {
        const r = await tinfoil("/v1/audio/transcriptions", { body, headers: { "Content-Type": "multipart/form-data; boundary=" + B }, signal: sig });
        if (!r.ok) { let why = ""; try { why = cp(await r.text(), 2000); } catch (e) { /* none */ } throw perr("http", { http: r.status, why, bill: billOf(r) }); }
        const jj = await r.json();
        return pyStrip(String((jj && jj.text) || ""));
      });
    };
    const heard = async (model) => {                    // one model, as it answers (without a language or prompt it can't take)
      try { return await once(model, lang); }
      catch (e) {
        const why = String(e.why || "").toLowerCase();
        if (e.http && lang && (e.http === 400 || e.http === 422) && why.includes("language")) return once(model, "");
        if (e.http && (e.http === 400 || e.http === 422) && why.includes("prompt")) return once(model, lang, false);
        throw e;
      }
    };
    const newWords = (t) => {
      if (looping(t)) throw Object.assign(new Error("loop"), { loop: true });   // (a loop, not words)
      return context && cpLen(t) > 12 && context.toLowerCase().includes(t.toLowerCase().replace(/^[ .!?…]+|[ .!?…]+$/g, "")) ? "" : t;
    };
    const isGone = (e) => !!e.http && (e.http === 404 || ((e.http === 400 || e.http === 422) && WHISPER_GONE.test(e.why || "")));
    const stt = k.models.stt || STT_DEFAULT, chosen = String((k.stt || {}).model || "");
    const model = sttModel(chosen, Date.now() - S.sttDownAt < 600000, stt, k.models.stt_next);
    const other = model === stt ? (k.models.stt_next || STT_NEXT_DEFAULT) : model === chosen ? stt : null;
    try {
      try { return newWords(await heard(model)); }
      catch (e) {                                       // Voxtral only when Whisper itself fails (missing, a 5xx, no answer)
        const broken = e.http ? isGone(e) || e.http >= 500 : e.kind === "timeout" || e.name === "TypeError";
        if (other === null || !broken) throw e;
        if (model === stt) S.sttDownAt = Date.now();    // (Whisper failed: Voxtral, now and for 10 minutes)
        try { return newWords(await heard(other)); }    // (the one in the stt_model setting failed: Whisper this time)
        catch (e2) { if (isGone(e2)) e2.gone = true; throw e2; }
      }
    } catch (e) {
      if (e.loop) throw e;
      if (isGone(e)) e.gone = true;
      if (e.http || ["nokey", "attestation", "atc", "config"].includes(e.kind)) throw e;
      throw perr("hearing");
    }
  }
  const hearFail = (e) => (["nokey", "attestation", "atc", "config"].includes(e.kind) ? json(503, { error: e.text }) : json(503, { error: T.hearing }));
  async function voiceRoute(q, init) {                  // a voice message you send: kept as recorded, heard in the enclave
    const data = await bodyBytes(init.body), ct = audioMime(data);
    if (!ct || data.length > 12000000) return json(400, { error: "that isn't a voice recording Buddy can keep (or it's too long)" });
    const kchar = charOrBuddy(q.get("char"));
    busyN++;
    try {
      let text;
      try { text = await whisper(data, ct, kchar, q.get("lang") || ""); }
      catch (e) {
        if (e.loop) e = { http: 422 };                  // (a loop: sent anyway, they'll ask)
        if (!e.http) return hearFail(e);
        if (e.bill) return json(e.http, { error: creditsText(kitObj(), e.bill), credits: true });   // (credits ran out)
        if (![400, 413, 422].includes(e.http) || e.gone) return json(502, { error: `Tinfoil returned ${e.http}` });
        text = "";                                      // (only noise, or too short: sent anyway, they'll ask)
      }
      prunePending();
      const vid = "local:" + newCid();
      pendingVoices.set(vid, { ts: Date.now(), data, type: ct });
      return json(200, { voice: vid, text });
    } finally { busyN--; }
  }
  async function sttRoute(q, init) {
    const ct = (header(init.headers, "Content-Type") || "audio/mp4").split(";")[0].trim().toLowerCase();
    const kchar = kitChar(q.get("char") || "");
    let last = "";                                      // (a call: what they just said, like the Mac)
    if (kchar && q.get("call") === "1") {
      const r = recentMessages(historyOf(kchar.id), 6, false, kchar.id).filter((m) => m.role === "assistant");
      last = r.length ? r[r.length - 1].content : "";
    }
    let text;
    try { text = await whisper(await bodyBytes(init.body), ct, kchar, q.get("lang") || "", last); }
    catch (e) {
      if (e.loop) return json(422, { error: "Couldn't make out any words.", unclear: true, detail: "Whisper repeated itself" });
      if (!e.http) return hearFail(e);
      if (e.bill) return json(e.http, { error: creditsText(kitObj(), e.bill), credits: true });   // (said as it is, never
      const why = cp(pyJoinWS(e.why || ""), 160), detail = `Tinfoil returned ${e.http}` + (why ? `: ${why}` : "");   // "you cut out")
      if ([400, 413, 422].includes(e.http) && !e.gone) return json(422, { error: "Couldn't make out any words.", unclear: true, detail });
      return json(502, { error: `Tinfoil returned ${e.http}`, detail });
    }
    return json(200, { text });
  }
  const audioRes = (type, bytes) => new Response(new Blob([u8(bytes)], { type }), { status: 200,
    headers: type === "audio/pcm" ? { "Content-Type": type, "X-Sample-Rate": "24000" } : { "Content-Type": type } });
  function passPcm(sdkBody, signal, keep) {             // Tinfoil's PCM as it's made; a stream that breaks off just ends
    const rd = sdkBody.getReader(), parts = [];
    let done = false;
    const rs = new ReadableStream({
      async pull(c) {
        try {
          const v = await rd.read();
          if (v.done) { done = true; c.close(); if (keep) keep(concat(parts)); return; }
          if (keep) parts.push(u8(v.value).slice());
          c.enqueue(v.value);
        } catch (e) {
          done = true;
          if (signal && signal.aborted) c.error(abortErr()); else c.close();
        }
      },
      cancel() { done = true; try { rd.cancel().catch(() => {}); } catch (e) { /* gone */ } },
    });
    return rs;
  }
  async function speakRoute(j, signal) {                // their voice for a piece of text (buddy_server.py:1160-1202)
    const k = kitObj(), wantStream = j.stream === true;
    const r = ttsRequest(k, j.text || "", j.voice, wantStream, streamRefused);
    if (!r) return new Response(null, { status: 204 });
    const sk = isStock(k, r.input) ? JSON.stringify([r.body.voice, r.input, wantStream]) : null;
    if (sk && stock.has(sk)) { const [type, bytes] = stock.get(sk); return audioRes(type, bytes); }
    const ask = (body, sig) => tinfoil("/v1/audio/speech", { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal: sig || signal, timeout: MS.speech });
    const failed = (e) => {
      if (isAbort(e) && signal && signal.aborted) throw abortErr();
      if (["nokey", "attestation", "atc", "config"].includes(e.kind)) return json(503, { error: e.text });
      return json(503, { error: T.reach });
    };
    let refused = false;
    if (r.stream) {
      let res;
      try { res = await ask(r.body); } catch (e) { return failed(e); }
      const bill = billOf(res);
      if (bill) { drop(res); return json(res.status, { error: creditsText(k, bill), credits: true }); }   // (credits ran out: a
      if (!res.ok) { refused = res.status === 400 || res.status === 422; drop(res); }   // file wouldn't come either; anything
      else if ((res.headers.get("Content-Type") || "").includes("wav")) {              // else: a whole file this time; a whole
                                                                                       // file after all)
        let data;
        try { data = new Uint8Array(await res.arrayBuffer()); } catch (e) { return failed(e); }
        if (sk) stock.set(sk, ["audio/wav", data]);
        return audioRes("audio/wav", data);
      } else {
        const body = passPcm(res.body, signal, sk ? (bytes) => stock.set(sk, ["audio/pcm", bytes]) : null);
        return new Response(body, { status: 200, headers: { "Content-Type": "audio/pcm", "X-Sample-Rate": "24000" } });
      }
    }
    const wb = { model: r.body.model, voice: r.body.voice, input: r.body.input, response_format: "wav" };
    let data;
    try {
      data = await timed(MS.speech, signal, async (sig) => {
        const res = await ask(wb, sig);
        if (!res.ok) { drop(res); throw perr("http", { http: res.status, bill: billOf(res) }); }
        return new Uint8Array(await res.arrayBuffer());
      });
    } catch (e) {
      if (e.bill) return json(e.http, { error: creditsText(k, e.bill), credits: true });
      if (e.http) return json(502, { error: `Tinfoil returned ${e.http}` });
      return failed(e);
    }
    if (refused) streamRefused.add(r.model);            // this voice can't stream (it can make files): files from now on
    if (sk) stock.set(sk, ["audio/wav", data]);
    return audioRes("audio/wav", data);
  }

  // ---------- talking to the Mac (only after it answered): kit, sync ----------
  function timer(ms, ac) {                              // a deadline that also aborts the request (in case it doesn't listen)
    let t, late = false;
    const p = new Promise((_, no) => { t = setTimeout(() => { late = true; ac.abort(); no(new Error("timeout")); }, ms); });
    p.catch(() => {});
    return { p, done: () => clearTimeout(t), late: () => late };
  }
  async function macFetch(path, init, ms) {
    const ac = new AbortController(), tm = timer(ms, ac);
    try { return await Promise.race([root.fetch(path, { ...init, credentials: "same-origin", cache: "no-store", signal: ac.signal }), tm.p]); }
    catch (e) { const x = new Error(tm.late() ? "timeout" : "network"); x.down = true; throw x; }
    finally { tm.done(); }
  }
  async function probe(ms) {                            // is the Mac there? (GET /api/me)
    if (SOLO) return { up: false, why: "site" };        // (there's no Mac behind the site)
    ms = ms === undefined ? MS.probe : ms;
    if (!ms) return { up: false, why: "timeout" };
    const ac = new AbortController(), tm = timer(ms, ac);
    try {
      const r = await Promise.race([root.fetch("/api/me", { cache: "no-store", credentials: "same-origin", signal: ac.signal }), tm.p]);
      if (r.status >= 500) return { up: false, why: "proxy" };   // (the tailnet front door with Buddy down: plain text)
      if (r.status !== 200) return { up: false, why: "bad" };
      if (!(r.headers.get("Content-Type") || "").includes("application/json")) return { up: false, why: "proxy" };
      let j;
      try { j = await Promise.race([r.json(), tm.p]); } catch (e) { return { up: false, why: tm.late() ? "timeout" : "proxy" }; }
      if (!j || typeof j !== "object" || typeof j.paired !== "boolean") return { up: false, why: "bad" };
      return { up: true, me: { paired: j.paired, device: j.device || null } };
    } catch (e) {
      return { up: false, why: tm.late() ? "timeout" : "network" };
    } finally { tm.done(); }
  }
  function swInfo(ms) {                                 // what the service worker saw (why this page came from its cache)
    return new Promise((ok) => {
      try {
        const sw = root.navigator && root.navigator.serviceWorker && root.navigator.serviceWorker.controller;
        if (!sw || typeof MessageChannel === "undefined") { ok(null); return; }
        const ch = new MessageChannel(), t = setTimeout(() => ok(null), ms);
        ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data || null); };
        sw.postMessage({ type: "info" }, [ch.port2]);
      } catch (e) { ok(null); }
    });
  }
  async function recentlyDown() {
    const d = Number(ss.get("buddy.direct")) || 0;
    if (d && Date.now() >= d && Date.now() - d < 60000) return "down";
    const i = await swInfo(150);
    if (i && i.navFromCacheAt && Date.now() - i.navFromCacheAt < 10000) return i.downWhy === "timer" ? "slow" : "down";
    return false;
  }
  const ctxSig = (ctx) => JSON.stringify([ctx.upto, Object.keys(ctx.chars || {}).sort().map((c) => [c, ctx.chars[c]])]);
  async function refreshKit() {                         // GET /api/phonekit: the kit when it changed, and the current context
    if (SOLO) return { ok: false, changed: false, error: T.site };   // (the site never talks to a Mac)
    if (!enabled()) return { ok: false, changed: false, error: "phone mode is off" };
    let r;
    try { r = await macFetch("/api/phonekit?have=" + encodeURIComponent(S.kit ? S.kit.etag : ""), {}, MS.mac); }
    catch (e) { return { ok: false, changed: false, error: "your Mac didn't answer" }; }
    if (r.status === 401) { await wipe("unpaired"); return { ok: false, changed: false, error: "this phone isn't paired any more" }; }
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (r.status === 403 && j && j.phone_mode === false) {   // turned off on the Mac (or it's on the free brain without a
      const now = Date.now(), had = [...onMac.keys()];   // Tinfoil key: phone mode is Tinfoil only): its copy goes, the key
      const why = j.free === true ? "free" : "off";      // and outbox stay (your Mac answered: the 30 days count from now)
      try {
        await tx(["meta", "chats", "thumbs", "outbox"], "readwrite", (t) => {
          t.objectStore("meta").delete("kit"); t.objectStore("meta").delete("context");
          t.objectStore("chats").clear(); t.objectStore("thumbs").clear();
          for (const c of had) t.objectStore("outbox").delete(c);   // (on your Mac already)
          t.objectStore("meta").put({ ...S.settings, k: "settings", macOff: true, macOffWhy: why, macSeenAt: now });
        });
        for (const c of had) onMac.delete(c);
      } catch (e) { setError(T.store); }
      const text = why === "free" ? T.free : T.macoff;
      S.settings.macOff = true; S.settings.macOffWhy = why; S.settings.macSeenAt = now; S.error = text;
      if (!active) { S.kit = null; S.context = null; S.chats = {}; S.thumbs = {}; }
      return { ok: false, changed: true, off: true, error: text };
    }
    if (r.status !== 200 || !j || !j.context || typeof j.context !== "object") return { ok: false, changed: false, error: `your Mac answered ${r.status}` };
    const kitRec = j.kit ? { k: "kit", etag: String(j.etag || ""), kit: j.kit, at: Date.now() } : S.kit;
    if (!kitRec) return { ok: false, changed: false, error: T.nokit };
    const ctx = j.context, ids = new Set(kitRec.kit.chars.map((c) => c.id));
    const ctxRec = { k: "context", upto: Number(ctx.upto) || 0, generated_at: Number(j.generated_at) || 0, at: Date.now(), sig: ctxSig(ctx) };
    const chats = {};
    for (const [c, v] of Object.entries(ctx.chars || {}))
      if (ids.has(c) && v && typeof v === "object")
        chats[c] = { char: c, epoch: Number(v.epoch) || 0, last_ts: Number(v.last_ts) || 0,
                     last_role: v.last_role === "assistant" ? "assistant" : "user", msgs: Array.isArray(v.msgs) ? v.msgs : [] };
    const changed = !!j.kit && (!S.kit || S.kit.etag !== kitRec.etag) || !S.context || S.context.sig !== ctxRec.sig;
    const settings = { ...S.settings, macSeenAt: Date.now(), expired: false, ...(j.kit ? { macOff: false, macOffWhy: "" } : {}) };
    let gone = 0;
    try {
      gone = await tx(["meta", "chats", "outbox"], "readwrite", (t) => {
        const meta = t.objectStore("meta"), cs = t.objectStore("chats"), ob = t.objectStore("outbox"), o = { n: 0, had: [] };
        if (j.kit) meta.put(kitRec);
        if (S.partner && S.partner.sent) meta.delete("partner");   // (a status your Mac took: this kit has it)
        meta.put(ctxRec); meta.put({ ...settings, k: "settings" });
        cs.clear();
        for (const v of Object.values(chats)) cs.put(v);
        const c = ob.openCursor();                      // on your Mac and in this context; characters gone, conversations
        c.onsuccess = () => {                           // deleted on the Mac meanwhile
          const cur = c.result;
          if (!cur) return;
          const it = cur.value, at = onMac.get(it.cid);
          if ((at !== undefined && at <= ctxRec.upto) || !ids.has(it.char) || (chats[it.char] && (it.epoch || 0) < chats[it.char].epoch)) {
            cur.delete(); if (at === undefined) o.n++; else o.had.push(it.cid);
          }
          cur.continue();
        };
        return o;
      }).then((o) => { for (const c of o.had) onMac.delete(c); return o.n; });
    } catch (e) { setError(T.store); return { ok: false, changed: false, error: T.store }; }
    S.settings = settings; S.outboxN = Math.max(0, S.outboxN - gone);
    if (S.error === T.macoff || S.error === T.free || S.error === T.expired || S.error === T.nokit) S.error = "";
    if (!active) { S.kit = kitRec; S.context = ctxRec; S.chats = chats; }   // (in phone mode: storage only, until the reload)
    else S.kit = { ...S.kit, etag: kitRec.etag };       // (so the next refresh asks with the etag it stored)
    if (!active && S.partner && S.partner.sent) S.partner = null;   // (that kit says it now)
    return { ok: true, changed };
  }
  async function sync() {                               // the outbox to the Mac (POST /api/thread/import), in order
    if (syncing) return syncing;
    syncing = (async () => {
      if (SOLO) return { ok: false, sent: 0, dropped: [], error: T.site };
      if (!enabled()) return { ok: false, sent: 0, dropped: [], error: "phone mode is off" };
      const p = S.partner;                              // your relationship status as a character heard it here (public
      if (p && p.cid && !p.sent) {                      // edition), first: the status only, never the words
        const it = { cid: p.cid, role: "partner", ...(p.has === "yes" || p.has === "no" ? { has: p.has, at: p.at } : {}),
                     ...(p.noask ? { noask: true } : {}) };
        let r, j = null;
        try { r = await macFetch("/api/thread/import", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [it] }) }, MS.mac); }
        catch (e) { return { ok: false, sent: 0, dropped: [], error: "your Mac didn't answer", down: true }; }
        if (r.status === 401) { await wipe("unpaired"); return { ok: false, sent: 0, dropped: [], error: "this phone isn't paired any more" }; }
        try { j = await r.json(); } catch (e) { j = null; }
        const res = r.status === 200 && j && Array.isArray(j.results) ? j.results[0] : null;
        if (res && res.cid === p.cid && (res.applied || res.dropped) && S.partner && S.partner.cid === p.cid) {
          if (active) {                                 // (your Mac has it, but this page answers from the kit it opened
            S.partner = { ...p, sent: true };           // with, so it still counts here, and after a reload in phone mode,
            try { await dbPut("meta", { ...S.partner, k: "partner" }); } catch (e) { /* this page load has it */ }   // until
          } else {                                      // the next kit from your Mac)
            S.partner = null;                           // (your Mac has it: its kit says it from now on)
            try { await dbDel("meta", "partner"); } catch (e) { /* sent again next time: harmless */ }
          }
        }
      }
      let items;
      try { items = (await outboxLight()).filter((it) => !onMac.has(it.cid)); }   // (on your Mac already: not again)
      catch (e) { return { ok: false, sent: 0, dropped: [], error: T.store }; }
      const stop = items.findIndex((it) => looks.has(it.cid));   // never ahead of a look still running here
      const send = stop < 0 ? items : items.slice(0, stop);
      let sent = 0, anyOk = false, error = "", down = false;
      const dropped = [];
      for (const b of batches(send)) {
        let full;
        try { full = await outboxGet(b.map((x) => x.cid)); } catch (e) { error = T.store; break; }
        if (full.some((x) => !x)) { error = T.store; break; }
        const body = JSON.stringify({ messages: full.map(importItem) });
        full = null;                                    // (the photos aren't kept)
        const withMedia = b.some((x) => x.photo || x.voice);
        let r;
        try { r = await macFetch("/api/thread/import", { method: "POST", headers: { "Content-Type": "application/json" }, body },
          withMedia ? MS.media + 1000 * Math.floor(body.length / 250000) : MS.mac); }
        catch (e) { error = "your Mac didn't answer"; down = true; break; }
        if (r.status === 401) { await wipe("unpaired"); return { ok: false, sent, dropped, error: "this phone isn't paired any more" }; }
        if (r.status >= 500) { drop(r); error = `your Mac answered ${r.status}`; down = true; break; }
        if (r.status === 413) { drop(r); error = "too much at once"; break; }
        let j = null;
        try { j = await r.json(); } catch (e) { j = null; }
        if (r.status !== 200 || !j || !Array.isArray(j.results)) { error = (j && j.error) ? String(j.error) : `your Mac answered ${r.status}`; break; }
        anyOk = true;
        const del = [];
        let got = 0;
        b.forEach((it, i) => {                          // one result per item, in order: added, already there, or refused
          const res = j.results[i];
          if (!res || (res.cid !== undefined && res.cid !== null && res.cid !== it.cid)) return;
          if (Number.isInteger(res.id)) { onMac.set(it.cid, res.id); got++; sent++; }   // (deleted with the next context)
          else if (res.dropped) { del.push(it.cid); dropped.push({ cid: it.cid, why: String(res.dropped) }); }
        });
        S.settings = { ...S.settings, macSeenAt: Date.now(), expired: false };
        S.outboxN = Math.max(0, S.outboxN - got);
        try {
          await tx(["outbox", "meta"], "readwrite", (t) => {
            const ob = t.objectStore("outbox");
            for (const c of del) ob.delete(c);
            t.objectStore("meta").put({ ...S.settings, k: "settings" });
          });
          S.outboxN = Math.max(0, S.outboxN - del.length);
        } catch (e) { error = T.store; break; }
      }
      if (!items.length || anyOk) await refreshKit();   // (the context then has the imported ones: they leave the outbox)
      try { if (enabled()) S.outboxN = waiting(await outboxCount()); } catch (e) { /* last known stays */ }
      return { ok: !error, sent, dropped, ...(error ? { error } : {}), ...(down ? { down: true } : {}) };
    })();
    try { return await syncing; } finally { syncing = null; }
  }

  // ---------- thumbnails (Mac mode, phone mode on) ----------
  async function saveThumbs(chars) {
    if (!enabled() || typeof document === "undefined" || !Array.isArray(chars)) return;
    const want = new Map(chars.filter((c) => c && c.id && c.avatar).map((c) => [c.id, c.avatar]));
    for (const id of Object.keys(S.thumbs)) if (!want.has(id)) {
      delete S.thumbs[id]; try { await dbDel("thumbs", id); } catch (e) { /* next time */ }
    }
    for (const [id, v] of want) {
      if (S.thumbs[id] && S.thumbs[id].v === v) continue;
      try {
        const img = new Image();
        img.src = `/api/characters/${encodeURIComponent(id)}/avatar?v=${encodeURIComponent(v)}`;   // (same origin: an untainted canvas)
        await img.decode();
        const c = document.createElement("canvas"), s = Math.min(img.naturalWidth, img.naturalHeight);
        if (!s) continue;
        c.width = c.height = 128;
        c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
        const rec = { id, v, url: c.toDataURL("image/jpeg", 0.8) };
        await dbPut("thumbs", rec);
        S.thumbs[id] = rec;
      } catch (e) { /* the initials show instead */ }
    }
  }
  const thumb = (id, v) => (S.thumbs[id] && S.thumbs[id].v === v ? S.thumbs[id].url : null);

  // ---------- settings, check, status, wipe ----------
  function supported() {
    try {
      if (!PHONE_MODE_AVAILABLE) return { ok: false, why: "not available yet" };
      if (root.isSecureContext !== true) return { ok: false, why: "this page isn't a secure (https) one" };
      if (typeof crypto === "undefined" || !crypto.subtle) return { ok: false, why: "this browser has no WebCrypto here" };
      if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return { ok: false, why: "this browser is too old" };
      if (typeof ReadableStream === "undefined" || typeof DecompressionStream === "undefined") return { ok: false, why: "this browser is too old" };
      new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).formatToParts(new Date());
      new RegExp("(?<=a)\\p{L}", "u");
      return { ok: true };
    } catch (e) { return { ok: false, why: "this browser is too old" }; }
  }
  async function init() {                               // never throws; loads atomically at its end
    if (SOLO) return;                                   // (the site: phone mode's storage is never read or made there)
    if (initP) return initP;
    initP = (async () => {
      const mygen = gen;
      try {
        if (markGet()) {                                // an interrupted wipe: finish it before reading anything
          await deleteDb(MS.del);
          return;
        }
        if (!(await dbExists())) return;                // phone mode was never turned on here: nothing is created
        const L = { thumbs: {}, chats: {}, media: new Map(), items: [] };
        await tx(["meta", "keys", "chats", "thumbs"], "readonly", (t) => {
          const meta = t.objectStore("meta");
          for (const k of ["settings", "kit", "context", "models", "seq", "partner"]) got(meta.get(k), L, k);
          const kc = t.objectStore("keys").count("tinfoil"), ca = t.objectStore("chats").getAll(), th = t.objectStore("thumbs").getAll();
          kc.onsuccess = () => { L.key = kc.result > 0; };
          ca.onsuccess = () => { for (const c of ca.result || []) L.chats[c.char] = c; };
          th.onsuccess = () => { for (const x of th.result || []) L.thumbs[x.id] = x; };
        }, true);
        if (!L.settings || !L.settings.enabled) return;
        await outboxLight((it) => {                     // view copies and audio only: a full photo is read when it's needed
          const e = {};
          if (it.photo) e.view = new Blob([u8(it.photo.view)], { type: "image/jpeg" });
          if (it.voice) e.audio = new Blob([u8(it.voice.data)], { type: it.voice.type || "audio/wav" });
          if (e.view || e.audio) L.media.set(it.cid, e);
        }, true).then((items) => { L.items = items; });
        if (mygen !== gen) return;
        const snap = [];
        for (const c of Object.values(L.chats)) for (const m of c.msgs || []) snap.push({ ...m, char: c.char });
        snap.sort(byId);
        const base = Math.max(Number((L.context || {}).upto) || 0, ...snap.map((m) => Number(m.id) || 0), 0);
        // all at once (a late finish only means the page has phone mode's state from then on)
        S.settings = L.settings; S.kit = L.kit || null; S.context = L.context || null; S.chats = L.chats; S.models = L.models || null;
        S.seq = (L.seq && L.seq.n) || 0; S.thumbs = L.thumbs; S.keyRec = !!L.key; S.outboxN = L.items.length;
        S.partner = L.partner && L.partner.cid ? L.partner : null;
        for (const [c, e] of L.media) media.set(c, e);
        snapshot = snap; nextId = base; local = [];
        for (const it of L.items) local.push(pageMsg(it, ++nextId, false));
        if (S.settings.macOff) S.error = S.settings.macOffWhy === "free" ? T.free : T.macoff;
        else if (S.settings.expired) S.error = T.expired;
      } catch (e) {
        setError(T.store);
      }
    })();
    return initP;
  }
  async function setEnabled(on) {
    if (SOLO) return { ok: false, error: T.site };
    if (!on) { await wipe("off"); return { ok: true }; }
    const sup = supported();
    if (!sup.ok) return { ok: false, error: `Phone mode isn't available on this device (${sup.why}).` };
    await Promise.race([init(), sleep(3000)]);
    if (markGet() && !(await deleteDb(MS.del))) return { ok: false, error: T.store };   // (a wipe still being finished)
    try {
      const now = Date.now();
      const st = S.settings && S.settings.enabled ? { ...S.settings, macSeenAt: now, expired: false }
        : { k: "settings", enabled: true, created: now, cacheSecret: hex(randBytes(32)), macOff: false, macSeenAt: now, expired: false };
      await tx(["meta"], "readwrite", (t) => {
        const meta = t.objectStore("meta"), r = meta.get("seq");
        meta.put({ ...st, k: "settings" });
        r.onsuccess = () => { if (!r.result) meta.put({ k: "seq", n: S.seq }); else S.seq = Math.max(S.seq, r.result.n || 0); };
      }, true);
      S.settings = st;
      try { if (root.navigator && root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist().catch(() => {}); } catch (e) { /* best effort */ }
      return { ok: true };
    } catch (e) { return { ok: false, error: T.store }; }
  }
  async function check() {                              // Settings → Phone mode → Check now
    if (!(await getKey())) return { ok: false, error: noKeyText() };
    try { await ensureReady(); } catch (e) { return { ok: false, error: e.text || classify(e).text }; }
    const k = kitObj();
    if (!k) return { ok: false, release: S.release, error: T.nokit };
    try {
      const ms = await models();
      const model = pickModel(k.models.advisor.preferred, k.models.advisor.fallbacks, ms.ids, false, k.models.always_thinks);
      const [status, bill] = await timed(MS.chat, null, async (sg) => {
        const r = await tinfoil("/v1/chat/completions", { body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }], max_tokens: 1, stream: false }),
          headers: { "Content-Type": "application/json" }, signal: sg });
        drop(r);
        return [r.status, billOf(r)];
      });
      if (bill) return { ok: false, release: S.release, error: creditsText(k, bill) };   // (credits ran out, or the spend limit)
      if (status < 200 || status > 299) return { ok: false, release: S.release, error: keyText(status) };
      return { ok: true, release: S.release };
    } catch (e) {
      return { ok: false, error: ["nokey", "attestation", "atc", "config"].includes(e.kind) ? e.text : T.network };
    }
  }
  // A one-off question to the Advisor (buddy_server.ask and complete), for the site's own background work (writing new
  // characters, learning facts, planning days; o.mode "companion" and o.messages for a text first, as first_text asks
  // the character's own brain with its whole conversation): Tinfoil only, through tinfoil() like every request (this
  // device's key, attestation verified first, the body sealed). Thinking switched off where the model has a switch,
  // and cap as max_tokens only for a model that won't think first; a model that refuses those (400) is asked again
  // without them, and an answer the cap cut off again without the cap. -> the answer's text; throws {text} (never
  // Tinfoil's own words)
  async function complete(prompt, o) {
    o = o || {};
    const k = kitObj();
    if (!k) throw perr("config");
    if (!(await getKey())) throw perr("nokey", { text: noKeyText() });
    await ensureReady();
    const ms = await models(), b = k.models[o.mode === "companion" ? "companion" : "advisor"];   // (the Advisor unless told)
    const model = pickModel(b.preferred, b.fallbacks, ms.ids, false, k.models.always_thinks);
    const messages = Array.isArray(o.messages) ? o.messages : [{ role: "user", content: String(prompt) }];   // (a whole conversation)
    const body = { model, temperature: typeof o.temperature === "number" ? o.temperature : 0.9, messages };
    const nt = k.models.no_thinking || {};
    let extra = {};
    if (!thinkingRefused.has(model)) {
      extra = { ...(nt[model] || {}) };
      if (o.cap && !inList(k.models.always_thinks, model) && (Object.keys(extra).length || !hasOwn(nt, model))) extra.max_tokens = o.cap;
    }
    const once = (b) => timed(o.timeout || 180000, o.signal, async (sig) => {
      const r = await tinfoil("/v1/chat/completions", { body: JSON.stringify(b), headers: { "Content-Type": "application/json" }, signal: sig });
      if (!r.ok) { drop(r); throw perr("http", { http: r.status, bill: billOf(r) }); }
      const ch = (await r.json()).choices[0];
      return [String((ch.message || {}).content || ""), ch.finish_reason];
    });
    try {
      if (!Object.keys(extra).length) return (await once(body))[0];
      let txt, why;
      try { [txt, why] = await once({ ...body, ...extra }); }
      catch (e) {
        if (e.http !== 400) throw e;
        txt = (await once(body))[0];
        thinkingRefused.add(model);                     // it doesn't take those switches (asked plainly, it works)
        return txt;
      }
      if (why === "length" && hasOwn(extra, "max_tokens")) {   // (longer than the cap after all: never a cut-off answer)
        const { max_tokens: _, ...rest } = extra;
        txt = (await once({ ...body, ...rest }))[0];
      }
      return txt;
    } catch (e) {
      if (isAbort(e)) throw e;
      if (e.bill) throw perr("http", { text: creditsText(k, e.bill), credits: true });
      if (e.http) throw perr("http", { text: keyText(e.http) });
      if (["nokey", "attestation", "atc", "config"].includes(e.kind)) throw perr(e.kind, { text: e.text || T[e.kind] });
      throw perr("network", { text: T.network });
    }
  }
  async function voiceNote(text, voice, signal) {       // -> {data, type, dur} (throws when it can't be made: then it's a text)
    const k = kitObj();
    if (!k || !PM_SPEECH) throw perr("config");
    if (!(await getKey())) throw perr("nokey", { text: noKeyText() });
    await ensureReady();
    return timed(MS.voiceReply, signal || null, async (sig) => {
      const r = await tinfoil("/v1/audio/speech", { body: JSON.stringify(voiceReplyBody(k, String(text), voice)), headers: { "Content-Type": "application/json" }, signal: sig });
      if (!r.ok) { drop(r); throw perr("http", { http: r.status }); }
      const wav = new Uint8Array(await r.arrayBuffer());
      if (audioMime(wav) !== "audio/wav") throw perr("http", { http: 0 });
      return { data: wav, type: "audio/wav", dur: wavSeconds(wav) };
    });
  }
  function staleDays() {
    const at = (S.settings || {}).macSeenAt || 0;
    if (!enabled() || !at) return null;
    const age = Date.now() - at;
    return age >= KIT_WARN_DAYS * DAY ? Math.max(0, Math.ceil(KIT_MAX_DAYS - age / DAY)) : null;
  }
  function status() {
    const sup = supported(), k = kitObj(), st = S.settings || {};
    const o = { supported: sup.ok, active, enabled: enabled(), key: !!(S.keyRec && !S.keyBad), kit: !!k, kitAt: S.kit ? S.kit.at || 0 : 0,
      pending: S.outboxN, verified: S.verified, macOff: !!st.macOff, companionOnPhala: !!(k && k.companion_on_phala),
      macSeenAt: st.macSeenAt || 0, staleInDays: staleDays(), expired: !!st.expired, credits: S.credits };
    if (st.macOff) o.macOffText = st.macOffWhy === "free" ? T.free : T.macoff;
    if (sup.why) o.why = sup.why;
    if (S.release) o.release = S.release;
    if (S.error) o.error = S.error;
    if (k && tzFallback(k.tz)) o.note = T.tz;
    return o;
  }
  function have() {
    const at = (S.settings || {}).macSeenAt || 0;
    return { kit: !!kitObj(), key: !!(S.keyRec && !S.keyBad), kitAt: S.kit ? S.kit.at || 0 : 0, macSeenAt: at,
             stale: enabled() && Date.now() - at > KIT_MAX_DAYS * DAY };
  }
  function forgetMemory() {                             // every memory state, and the blob URLs
    for (const c of [...urls.keys()]) dropMedia(c);
    media.clear(); pendingPhotos.clear(); pendingVoices.clear(); stock.clear(); onMac.clear();
    key = null; snapshot = []; local = []; priv = []; nextId = 0;
    Object.assign(S, { settings: null, kit: null, context: null, chats: {}, models: null, seq: 0, outboxN: 0, thumbs: {},
      keyRec: false, keyBad: false, error: "", verified: null, release: "", credits: null, partner: null, sttDownAt: 0 });
    active = false;
  }
  async function wipe(reason) {                         // the whole database and all memory state (SPEC2 §6.14)
    gen++;
    let n = 0;
    const exists = await dbExists();
    if (exists) { try { n = await Promise.race([outboxCount(true).then(waiting), sleep(1000).then(() => S.outboxN)]); } catch (e) { n = S.outboxN; } }
    if (exists) markSet();                              // (finished by the next start if the delete doesn't end now)
    forgetMemory();                                     // (first: phone mode is off, so nothing late can open it again)
    if (db) { try { db.close(); } catch (e) { /* closed */ } db = null; }
    dbOpening = null;
    if (exists) await deleteDb(MS.del);
    for (const k of ["buddy.carry", "buddy.direct", "buddy.note"]) ss.del(k);
    forgetMemory();
    initP = null;
    if (reason === "unpaired" && n > 0) ss.set("buddy.note", `${n} phone-mode message(s) were deleted because this phone isn't paired any more`);
  }
  async function expire() {                             // 30 days without the Mac: its copy and the key go; settings and outbox stay
    if (!enabled()) return;
    S.settings = { ...S.settings, expired: true };
    try {
      await tx(["meta", "chats", "thumbs", "keys"], "readwrite", (t) => {
        const meta = t.objectStore("meta");
        meta.delete("kit"); meta.delete("context"); meta.put({ ...S.settings, k: "settings" });
        t.objectStore("chats").clear(); t.objectStore("thumbs").clear(); t.objectStore("keys").delete("tinfoil");
      });
    } catch (e) { setError(T.store); }
    key = null; S.keyRec = false; S.kit = null; S.context = null; S.chats = {}; S.thumbs = {};
    snapshot = [];
    S.error = T.expired;
  }
  async function forgetChar(id, deleted, epoch) {       // a forgotten character: its conversation, facts and life go at once
    if (!enabled() || typeof id !== "string") return;   // (epoch: the Mac's count after the forget, what its messages carry)
    const fresh = { char: id, epoch: Number.isInteger(epoch) ? epoch : epochOf(id) + 1, last_ts: 0, msgs: [] };
    try {
      await tx(["meta", "chats", "outbox", "thumbs"], "readwrite", (t) => {
        const meta = t.objectStore("meta"), r = meta.get("kit");
        r.onsuccess = () => {
          const rec = r.result;
          if (!rec || !rec.kit) return;
          const chars = [];
          for (const c of rec.kit.chars) {
            if (c.id === id) { if (deleted) continue; chars.push({ ...c, facts: { ...(c.facts || {}), own: [] }, life: null }); continue; }
            chars.push(c.life ? { ...c, life: { ...c.life, friends: (c.life.friends || []).filter((f) => f.id !== id) } } : c);
          }
          meta.put({ ...rec, etag: "", kit: { ...rec.kit, chars } });   // (no etag: the next refresh brings the Mac's whole kit)
          S.kit = { ...rec, etag: "", kit: { ...rec.kit, chars } };
        };
        if (deleted) t.objectStore("chats").delete(id); else t.objectStore("chats").put(fresh);   // (none, and the new count)
        t.objectStore("thumbs").delete(id);
        const c = t.objectStore("outbox").openCursor();
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur) return;
          if (cur.value.char === id) { cur.delete(); if (!onMac.delete(cur.value.cid)) S.outboxN = Math.max(0, S.outboxN - 1); }
          cur.continue();
        };
      });
    } catch (e) { setError(T.store); }
    if (deleted) delete S.chats[id]; else S.chats[id] = fresh;
    delete S.thumbs[id];
    for (const m of local.concat(priv)) if (charOf(m) === id) dropMedia(m.cid);
    local = local.filter((m) => charOf(m) !== id); priv = priv.filter((m) => charOf(m) !== id);
    snapshot = snapshot.filter((m) => charOf(m) !== id);
    if (!active) await refreshKit();
  }
  async function pending() {
    if (!enabled()) return 0;
    try { S.outboxN = waiting(await outboxCount()); } catch (e) { /* last known */ }
    return S.outboxN;
  }

  // ---------- the exported object ----------
  const API = {
    API: 2,
    get active() { return active; },
    init, supported, enabled, have, recentlyDown, probe,
    activate() { active = true; warmUp(); relook(); },
    fetch: route,
    mediaURL, mediaFull,
    busy: () => busyN > 0 || looks.size > 0,
    refreshKit, sync, pending,
    privateCount: () => livePriv().length,
    setEnabled, setKey, forgetKey, check, complete, voiceNote, status, wipe, expire, saveThumbs, thumb,
    inCall: () => calls.size > 0,                     // (a call is on: the site's background work waits)
    forgetChar: (id, deleted, epoch) => source().forget(id, deleted, epoch),
    solo: SOLO,                                         // (the Buddy for phones site: the source is window.BuddySolo)
    _pure: {
      PYWS, W, NW_BEFORE, NW_AFTER, pyStrip, pyWords, pyJoinWS, cp, cpLen, pyFormat, pyLower,
      ACTION, EMOJI, spoken, isAbbrev, nextCut, clean, REACT_TAG, PARTNER_TAG, reaction, reactedLately, Splitter, DETAIL, lengthHint, longEnough, VOICE_ASK,
      picTags, picScene, sceneLike, PIC_OPEN, noTags, pyStripChars, DEEP, deepQuestion,
      asText, recentMessages, alternate, applyCallEdits, queryOf, heardOf,
      STOP, words, factsForPrompt, isKnowsQuestion, knowsAskText,
      wall, lifeDate, DAYS, MONTHS, nowString, dayLabel, sinceLastTalk, lifeContext, romanceText, systemPrompt,
      pickModel, brain, chatExtras, chatBody, sttModel, visionModels, visionFailedUntil, describeBody, cleanDescription,
      voiceModel, ttsRequest, voiceReplyBody, isStock, sttMultipart, WHISPER_GONE, audioMime, wavSeconds, cleanPhoto,
      sseState, sseFeed, sseLine, sseEnd, newCid, importItem, batches, localIds, toPageChar, classify, b64, unb64, keyText,
      SPEND, creditsKind, creditsText, BILLING,
      texts: T, consts: { SDK_URL, CONFIG_REPO, DB, DB_VERSION, STT_DEFAULT, REACTIONS, REFUSES_PICTURES, DAY_STARTS, PHOTO_EXPIRED,
        KIT_MAX_DAYS, KIT_WARN_DAYS, KIT_V, WIPE_MARK, PM_MODELS_LIST, PM_SPEECH, PM_STT, PHONE_MODE_AVAILABLE, MS },
    },
  };
  root.BuddyDirect = API;
})(typeof window !== "undefined" ? window : globalThis);
