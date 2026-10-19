"""What each character knows about you for sure: short first-person facts ("I live in Lisbon."), kept in your notes so
you can read and change them: ~/Buddy/Buddy knows/<character id>.md, plus _everyone.md for every character. One fact
per line starting with "- ", ending with where it came from: "(learned 2026-10-08)" from a chat, "(added …)" by you.

They're learned in the background by the Advisor in Tinfoil's enclave from what you said (never from Private messages,
never passwords, codes or card numbers), or typed in Buddy's "What X knows" sheet. They're never searched like notes
(memory.py leaves this folder out): a character is given its own facts plus the shared ones (only its own when it knows
"Only our chats"), minus every fact that mentions something on its "Doesn't know about" list.
Learning only ever writes a character's own file: a fact you wrote, or a shared one, that it learned changed is set
aside for that character only. Learning bookmarks live in .facts_state.json next to Buddy's other private files:
message ids, fact ids and why learning is paused, never anything you said."""
import datetime, hashlib, json, os, re, threading, time
import billing, characters, memory
from kitparts import EXTRACT

HERE = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.expanduser("~/Buddy")
FOLDER = "Buddy knows"
DIR = os.path.join(VAULT, FOLDER)
EVERYONE = "_everyone"                     # (an underscore is never part of a character id)
STATE = os.path.join(HERE, ".facts_state.json")
MAX_FACTS, MAX_LEN, MAX_READ = 300, 300, 256 * 1024
_lock = threading.RLock()                  # every write to a facts file or the state file
_cache = {}                                # path -> ((mtime_ns, size), lines, facts)
_wake = threading.Event()
_kicks = {}                                # char id -> urgent: a reply was saved, maybe learn now
_running = set()
_hold = {}                                 # char id -> time: no learning before then (when even the state can't be saved)

class Changed(Exception):
    """The fact isn't in the file any more (changed in Obsidian meanwhile)."""

# ---------- reading and writing the files ----------
BULLET = re.compile(r"^[-*+]\s+(.*\S)\s*$")
CHECK = re.compile(r"^\[[ xX]\]\s+")
SUFFIX = re.compile(r"\s*\((learned|added) (\d{4}-\d{2}-\d{2})(?: from ([^()]{1,40}))?\)\s*$")

def path(owner):
    """The file of a character (its id) or of everyone (EVERYONE); None for anything else."""
    if owner == EVERYONE or re.fullmatch(r"[a-z0-9-]{1,40}", str(owner or "")):
        return os.path.join(DIR, owner + ".md")
    return None

def norm(text):
    return re.sub(r"\W+", " ", str(text).lower().replace("’", "'")).strip()

def fid(text):
    return hashlib.sha1(norm(text).encode()).hexdigest()[:10]

def _parse(line):
    """A fact line -> (text, by, date, from), else None. Only unindented bullets are facts."""
    m = BULLET.match(line.rstrip("\r\n"))
    if not m:
        return None
    t = CHECK.sub("", m.group(1))
    s = SUFFIX.search(t)
    by, date, frm = ("chat" if s.group(1) == "learned" else "you", s.group(2), s.group(3) or "") if s else ("you", "", "")
    t = re.sub(r"\s+", " ", t[:s.start()] if s else t).strip()
    return (t, by, date, frm) if t else None

def _read(owner):
    """(lines with their endings, facts) of a file, cached until it changes. Lines other than facts are kept as they
    are (byte for byte: surrogateescape), so Buddy's edits never touch what you wrote around them."""
    p = path(owner)
    try:
        st = os.stat(p)
    except (OSError, TypeError):
        return [], []
    sig = (st.st_mtime_ns, st.st_size)
    hit = _cache.get(p)
    if hit and hit[0] == sig:
        return list(hit[1]), hit[2]
    with open(p, encoding="utf-8", errors="surrogateescape", newline="") as f:
        raw = f.read(MAX_READ)
    lines = raw.splitlines(keepends=True)
    if st.st_size > MAX_READ and lines and not lines[-1].endswith("\n"):
        lines = lines[:-1]                          # (a cut-off last line is never a fact)
    facts = []
    for i, line in enumerate(lines):
        got = _parse(line)
        if got:
            t, by, date, frm = got
            facts.append({"id": fid(t), "text": t[:MAX_LEN], "by": by, "date": date, "from": frm, "line": i})
    _cache[p] = (sig, lines, facts)
    return list(lines), facts

def load(owner):
    """The facts in one file, in file order: [{id, text, by: chat|you, date, from}]."""
    return [{k: v for k, v in f.items() if k != "line"} for f in _read(owner)[1]]

def _header(owner, name):
    if owner == EVERYONE:
        return ["# What every character knows about you\n", "\n",
                "Buddy keeps this up to date as you talk (never from Private messages). Edit, add or delete lines "
                "freely: one fact per line, starting with \"- \". Every character sees these, except ones set to "
                "\"Only our chats\".\n", "\n"]
    return [f"# What {name} knows about you\n", "\n",
            "Buddy keeps this up to date as you talk (never from Private messages). Edit, add or delete lines freely: "
            f"one fact per line, starting with \"- \". Only {name} sees this file; facts in _everyone.md are for every "
            "character.\n", "\n"]

def _write(owner, lines):
    p = path(owner)
    if os.path.exists(p) and os.path.getsize(p) > MAX_READ:
        raise ValueError("That facts file is too big to change here: edit it in Obsidian.")
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    try: os.chmod(DIR, 0o700)
    except OSError: pass
    tmp = p + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape", newline="") as f:
        f.write("".join(lines))
    os.replace(tmp, p)
    _cache.pop(p, None)

def _append(lines, facts, line):
    """Adds a fact line after the last fact (or at the end)."""
    at = facts[-1]["line"] + 1 if facts else len(lines)
    if at and not lines[at - 1].endswith("\n"):
        lines[at - 1] += "\n"
    lines.insert(at, line)
    return lines

def clean_text(text):
    """A fact as Buddy writes it: one line, nothing Obsidian's preview could load or run (no <html>, ![images](…),
    [[links]] or `code`), at most 300 characters."""
    t = re.sub(r"[\r\n\t]", " ", str(text or ""))
    t = re.sub(r"[<>`]", "", t)
    t = re.sub(r"!\[|\]\(|\[\[|\]\]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"^(?:[-*+]\s+|\[[ xX]\]\s+)+", "", SUFFIX.sub("", t)).strip()   # (would read back as a checkbox or a date)
    if not 1 <= len(t) <= MAX_LEN:
        raise ValueError("Keep it to one line of up to 300 characters.")
    return t

def _line(text, how):
    return f"- {text} ({how} {datetime.date.today().isoformat()})\n"

# ---------- what must never be kept ----------
_DIGITS = r"\d(?:[ ./-]?\d){3,}"                  # 4 or more digits, maybe split up (12-34-56, 482 193)
_NOYEAR = r"(?!(?:19|20)\d\d\b(?![ ./-]?\d))"    # (but not a year on its own: "I learned to code in 2015")
_NEAR = r"(?:codes?|numbers?|nos?\.|nr|pins?|unlock\w*|combinations?|passcodes?|passwords?)"
SECRET = re.compile(
    r"\b(?:passwords?|pass ?words?|passcodes?|pass ?codes?|pass ?phrases?|passwd|pwd?|pins?|pin ?codes?|cvv2?|cvc2?|"
    r"security codes?|iban|sort codes?|routing numbers?|account numbers?|card numbers?|social security|ssn|"
    r"api ?keys?|secret ?keys?|private ?keys?|seed phrases?|recovery (?:phrases?|codes?)|2fa|otp|one-time codes?|"
    r"log[ -]?ins?|login codes?|credentials?|maiden names?|memorable (?:words?|answers?|info\w*|names?|dates?)|"
    r"security (?:questions?|answers?)|"
    r"(?:door|gate|alarm|garage|safe|locker|lock|entry|access|wi-?fi|wlan|router|network|verification|bank|building|"
    r"key ?safe|lock ?box|key ?box) ?(?:codes?|keys?|pins?|passwords?)|"
    r"(?:phone|laptop|computer|tablet|ipad|mac)(?:'s)? (?:unlock|codes?|pins?|passcodes?|passwords?)|"
    r"unlock (?:codes?|patterns?|pins?|numbers?|passwords?)|"
    r"(?:lock|locker|safe|padlock|suitcase|bike|door|gate) ?combinations?|combinations? (?:is|to|for|lock|code)|"
    r"passports? (?:numbers?|no|nr)|licen[cs]es? (?:numbers?|no|nr)|national (?:id|identity|insurance) (?:numbers?|no|nr|cards?)|"
    r"national id|ni (?:numbers?|no)|nino|tax (?:ids?|numbers?|codes?|reference)|bank (?:details|logins?))\b"
    r"|\b\d{3}-\d{2}-\d{4}\b"                                                 # US social security number
    r"|\bend(?:s|ing|ed)? (?:in|with) " + _NOYEAR + r"\d{4}\b"               # "my card ends in 4242"
    r"|\b(?:card|visa|mastercard|amex|debit|credit)\b[^.!?\n]{0,30}?\bend(?:s|ing)? (?:in|with) \d{4}\b"
    r"|\b(?:exp(?:ires?|iry|iration|\.)?|valid (?:until|thru|through))(?: date| on| is)*:? ?\d{1,2} ?/ ?\d{2,4}\b"
    r"|\b\d{3,4} on the back\b"                                               # the card's security code
    r"|\b" + _NEAR + r"\W+(?:\w+\W+){0,3}?[a-z]*" + _NOYEAR + _DIGITS +      # "my door code is 4821", "NI number is
    r"|" + _NOYEAR + _DIGITS + r"\W+(?:\w+\W+){0,2}?" + _NEAR + r"\b"          #  QQ123456C", "482193 unlocks it"
    r"|\b" + _NEAR + r"(?:\W+\w+){0,3}? ?(?:\bis|\bwas|=|:) ?" + _DIGITS +     # (a year too when it IS the code)
    r"|(?:\d[ -]?){12,19}"                                                    # card / account numbers
    r"|\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30}\b"                                # IBAN
    r"|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b"  # keys, tokens
    r"|\b(?:sk|pk|ghp|xox[abp])[-_][A-Za-z0-9]{8,}", re.I)
FIRST_PERSON = re.compile(r"\b(?:i|i'm|i've|i'd|i'll|me|my|mine|myself)\b", re.I)
ABOUT_THEM = re.compile(r"\b(?:you|your|you're|yours|yourself)\b", re.I)
REMEMBER = re.compile(r"\b(?:remember|don't forget|do not forget|keep in mind|forget (?:that|about|it)|"
                      r"(?:that's|it's|is) not true|no longer|not any ?more)\b", re.I)
UNSAY = re.compile(r"\b(?:forget|no longer|not true|n't true|not right|wrong|any ?more|used to|stopped|quit|left|ended|"
                   r"broke up|divorced|moved|sold|gave up|delete|remove|scratch that)\b", re.I)   # (what a learned remove needs)
NOT_NAMES = set("""i i'm i've i'd i'll january february march april may june july august september october november
december monday tuesday wednesday thursday friday saturday sunday""".split())          # (capitalised, but not names)
STARTERS = memory.STOP | set("""every each since last next both most some usually sometimes often always never today
tomorrow yesterday once twice until during after before right now currently recently lately""".split())
KNOWS_Q = [
    re.compile(r"\b(?:what|how much|everything|anything|tell me)\b[^.?!]{0,40}?\b(?:you|u|ya)\b[^.?!]{0,25}?"
               r"\b(?:know|remember|learn(?:ed|t)?|keep|kept|stored?|saved?|have|got)\b[^.?!]{0,30}?"
               r"\b(?:about|on|of)\s+(?:me|myself|my life)\b", re.I),
    re.compile(r"\b(?:do|did)\s+(?:you|u)\s+(?:know|remember)\s+(?:anything|much|a lot|stuff|things)\s+about\s+me\b", re.I),
    re.compile(r"\bwhat(?:'s| is| do you have)\s+(?:stored|saved|kept|on file)\s+(?:about|on)\s+me\b", re.I)]

def _apos(t):
    return str(t or "").replace("’", "'").replace("‘", "'")

def secretish(text):
    """Looks like a password, PIN, card/account number, key or code (or talks about one): never kept."""
    return bool(SECRET.search(_apos(text)))

def is_knows_question(text):
    """"What do you know about me?" and the like (English only)."""
    t = _apos(text)
    return any(p.search(t) for p in KNOWS_Q)

def remember_asked(text):
    return bool(REMEMBER.search(_apos(text)))

# ---------- who sees what ----------
def _avoid(char):
    return memory.avoid_pattern(characters.avoid_terms(char))

def _scope(char):
    return (char.get("knowledge") or {}).get("scope", "all")

def _set_aside(cid, own):
    """Facts this character no longer uses because it learned they changed: {id: "replaced"|"dropped"}. Learning never
    rewrites or deletes a line you wrote, or a shared one; it sets it aside for that character only (ids in the state's
    "over"), while its newer version is still in its own file (a dropped one until you give it back)."""
    ids = {f["id"] for f in own}
    return {old: "replaced" if new else "dropped" for old, new in _state()["over"].get(cid, {}).items()
            if not new or new in ids}

def visible(char):
    """(own, shared): the facts this character may be given. Its own file always; _everyone.md unless it knows only
    your chats; never another character's; nothing that mentions what it mustn't know about, or that it set aside."""
    ban = _avoid(char)
    own = load(char["id"])
    shared = [] if _scope(char) == "none" else load(EVERYONE)
    aside = _set_aside(char["id"], own)
    keep = lambda fs: [f for f in fs if not (ban and ban.search(f["text"])) and f["id"] not in aside]
    return keep(own), keep(shared)

def listing(char):
    """Every own fact, then every shared one (also those kept from this character, flagged), for the sheet."""
    ban, out = _avoid(char), []
    aside = _set_aside(char["id"], load(char["id"]))
    for file, owner in (("mine", char["id"]), ("everyone", EVERYONE)):
        for f in load(owner):
            row = {**f, "file": file, "hidden": False}
            hit = ban.search(f["text"]) if ban else None
            if hit:
                row.update(hidden=True, why="avoid", word=hit.group(0))
            elif file == "everyone" and _scope(char) == "none":
                row.update(hidden=True, why="scope")
            elif f["id"] in aside:
                row.update(hidden=True, why=aside[f["id"]])
            out.append(row)
    return out

def paused(cid):
    """Why learning is stuck for this character (e.g. its file is too big to change), or "": for the sheet."""
    c = _state()["chars"].get(cid) or {}
    if not c.get("fails") or not c.get("why"): return ""
    return _blocked(cid) if c.get("pre") else str(c["why"])

def for_prompt(char, query, call=False, everything=False):
    """(fact lines, sources) for a reply: the most fitting ones (words in common with what you're on about, then the
    newest) within a size cap, shown in a fixed order (the shared ones, then its own, each as in its file), so this
    part of the prompt stays the same from turn to turn when they all fit (Tinfoil reuses a prompt start it has read)."""
    own, shared = visible(char)
    cap_n, cap_c = ((40, 1800) if call else (150, 8000)) if everything else ((25, 1200) if call else (80, 4000))
    q = set(memory._words(query or ""))
    pool = [(f, 1) for f in own] + [(f, 0) for f in shared]
    pool.sort(key=lambda x: (len(q & set(memory._words(x[0]["text"]))), x[1], x[0]["date"]), reverse=True)
    picked, size = [], 0
    for f, mine in pool:
        if len(picked) >= cap_n or size + len(f["text"]) + 3 > cap_c:
            continue
        picked.append((f, mine)); size += len(f["text"]) + 3
    keep = {id(f) for f, _ in picked}
    sh = [f["text"] for f in shared if id(f) in keep]
    ow = [f["text"] for f in own if id(f) in keep]
    src = ([{"kind": "facts", "path": f"{FOLDER}/{EVERYONE}", "n": len(sh)}] if sh else []) + \
          ([{"kind": "facts", "path": f"{FOLDER}/{char['id']}", "n": len(ow)}] if ow else [])
    return sh + ow, src

def counts():
    """How many facts each file holds: {owner: n}."""
    try:
        names = sorted(f[:-3] for f in os.listdir(DIR) if f.endswith(".md"))
    except OSError:
        return {}
    return {n: len(_read(n)[1]) for n in names if path(n)}

# ---------- changes made in the sheet ----------
def _owner(char, file):
    if file == "mine": return char["id"]
    if file == "everyone": return EVERYONE
    raise ValueError("file must be mine or everyone")

def change(char, j):
    """One edit from the sheet: {op: add|edit|delete|move|show|clear, ...}. Returns the new listing. Raises Changed
    when the fact isn't in the file any more, ValueError for bad input (or a password, code or card number)."""
    op, cid = j.get("op"), char["id"]
    full = lambda owner: ValueError(("The shared list" if owner == EVERYONE else f"{char['name']}'s list") +
                                    " is full: delete some first.")
    def text():
        t = clean_text(j.get("text"))
        if secretish(t):
            raise ValueError("That looks like a password, code or card number. Buddy never keeps those.")
        return t
    with _lock:
        if op == "add":
            t, owner = text(), _owner(char, j.get("to", "mine"))
            lines, facts = _read(owner)
            _ungone(owner, fid(t))                      # saying it yourself un-deletes it
            if any(f["id"] == fid(t) for f in facts):
                return listing(char)
            if len(facts) >= MAX_FACTS: raise full(owner)
            if not lines: lines = _header(owner, char["name"])
            _write(owner, _append(lines, facts, _line(t, "added")))
        elif op == "show":                              # give a set-aside fact back to this character
            st = _state(); over = st["over"].get(cid, {})
            if over.pop(str(j.get("id") or ""), 0) != 0: _save_state(st)
        elif op in ("edit", "delete", "move"):
            owner = _owner(char, j.get("file"))
            lines, facts = _read(owner)
            f = next((x for x in facts if x["id"] == str(j.get("id") or "")), None)
            if not f: raise Changed()
            if op == "edit":
                t = text()
                if fid(t) != f["id"]: _gone(owner, [f["id"]])
                _ungone(owner, fid(t))
                lines[f["line"]] = _line(t, "added")
                _write(owner, lines)
            elif op == "delete":
                del lines[f["line"]]; _write(owner, lines); _gone(owner, [f["id"]])
            else:
                to = _owner(char, j.get("to"))
                if to == owner: raise ValueError("It's already there.")
                tl, tf = _read(to)
                if not any(x["id"] == f["id"] for x in tf):
                    if len(tf) >= MAX_FACTS: raise full(to)
                    if not tl: tl = _header(to, char["name"])
                    moved = lines[f["line"]] if lines[f["line"]].endswith("\n") else lines[f["line"]] + "\n"
                    _write(to, _append(tl, tf, moved))
                del lines[f["line"]]; _write(owner, lines)
        elif op == "clear":
            if j.get("file") != "mine": raise ValueError("Only a character's own list can be cleared.")
            _gone(cid, [f["id"] for f in _read(cid)[1]])
            try: os.remove(path(cid))
            except OSError: pass
            _cache.pop(path(cid), None)
            st = _state()
            if st["over"].pop(cid, None) is not None: _save_state(st)   # (what it set aside counts again)
        else:
            raise ValueError("unknown op")
        return listing(char)

def forget(cid):
    """Delete conversation: that character's facts go too (never the shared ones, which learning never changes, and
    what it set aside counts again), and learning starts afresh."""
    p = path(cid)
    if not p or cid == EVERYONE:
        return
    with _lock:
        try: os.remove(p)
        except OSError: pass
        _cache.pop(p, None); _kicks.pop(cid, None); _hold.pop(cid, None)
        st = _state()
        st["chars"][cid] = {"seen": _newest_id(), "last": 0, "fails": 0, "next": 0}
        st["gone"].pop(cid, None); st["over"].pop(cid, None)
        _save_state(st)

# ---------- learning bookmarks (.facts_state.json: ids only, never text) ----------
def _newest_id():
    try:
        import social
        return max([m["id"] for m in social.thread()] or [0])
    except Exception:
        return 0

def _state():
    try:
        st = json.load(open(STATE))
        if not isinstance(st, dict): raise ValueError
    except Exception:
        st = {}
    st.setdefault("boot", 0)
    for k, v in (("chars", {}), ("gone", {}), ("runs", []), ("over", {})):
        if not isinstance(st.get(k), type(v)): st[k] = v
    return st

def _save_state(st):
    tmp = STATE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(st, f)
    os.replace(tmp, STATE)

def _gone(owner, ids):
    """Facts you deleted (or that were replaced) aren't learned again."""
    if not ids: return
    with _lock:
        st = _state(); g = [x for x in st["gone"].get(owner, []) if x not in ids] + list(ids)
        st["gone"][owner] = g[-500:]; _save_state(st)

def _ungone(owner, i):
    with _lock:
        st = _state()
        if i in st["gone"].get(owner, []):
            st["gone"][owner] = [x for x in st["gone"][owner] if x != i]; _save_state(st)

def _cstate(st, cid):
    return st["chars"].setdefault(cid, {"seen": st.get("boot", 0), "last": 0, "fails": 0, "next": 0})

# ---------- learning (background, Advisor in Tinfoil's enclave only) ----------
# EXTRACT (the learning prompt) lives in kitparts.py: Buddy for phones learns with the same words (web/solo/facts.js)

def _learnable(m, cid):
    return (m.get("char", "buddy") == cid and m.get("role") in ("user", "assistant") and not m.get("private")
            and not m.get("life") and str(m.get("content") or "").strip())

def kick(cid, urgent=False):
    """A reply was saved (never a private one): maybe learn now; urgent when you asked to remember something."""
    _kicks[cid] = _kicks.get(cid, False) or bool(urgent)
    _wake.set()

def _near(a, b):
    """The same fact in other words (or other punctuation): 80% of the words in common."""
    if fid(a) == fid(b): return True
    x, y = set(memory._words(a)), set(memory._words(b))
    return bool(x and y) and len(x & y) / len(x | y) >= 0.8

class _BadReply(Exception):
    pass

def _parse_reply(txt):
    try:
        j = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except Exception:
        raise _BadReply()
    if not isinstance(j, dict) or not all(isinstance(j.get(k, []), list) for k in ("add", "update", "remove")):
        raise _BadReply()
    adds = [a for a in j.get("add", []) if isinstance(a, str)][:20]       # (at most 5 of each are kept: _apply)
    ups = [(str(u.get("id")), u.get("text")) for u in j.get("update", []) if isinstance(u, dict) and isinstance(u.get("text"), str)][:20]
    rems = [str(r) for r in j.get("remove", []) if isinstance(r, (str, int))][:20]
    return adds, ups, rems

def _ok_text(t, char, ban):
    """A learned fact passes only if it's about you, in your words: cleaned, not a secret, first person, not about the
    character (or by them), and nothing it mustn't know about."""
    try: t = clean_text(t)
    except ValueError: return None
    if not 3 <= len(t) <= 200 or secretish(t): return None
    a = _apos(t)
    if not FIRST_PERSON.search(a) or ABOUT_THEM.search(a): return None
    name = str(char.get("name") or "").strip()
    if name and re.match(re.escape(name) + r"(?!\w)", a, re.I): return None
    if ban and ban.search(t): return None
    return t

def _heard(said):
    """The words you said in the new messages: all of them, and the start of each one that carries meaning."""
    t = _apos(said).lower()
    content = [w for w in memory._words(t) if len(w) >= 3]
    return (set(re.findall(r"\w+", t)), {w[:4] for w in content if len(w) >= 4}, {w for w in content if len(w) == 3},
            {w[:3] for w in content})

def _said(w, heard):
    """A word you said, or nearly: the same first 4 letters, or 3 for a short word (nurse ~ nursing, uni ~ university)."""
    alls, four, three, start3 = heard
    if w in alls: return True
    return (len(w) >= 4 and (w[:4] in four or w[:3] in three)) or (len(w) == 3 and w in start3)

def _yours(t, heard):
    """A learned fact must come from what you said in the new messages, not from the character's lines (its roleplay,
    its questions) or the earlier ones: a word in common with what you said there, and every name in it said by you."""
    a = _apos(t)
    if not any(_said(w, heard) for w in memory._words(a)): return False
    for i, w in enumerate(re.findall(r"\w[\w'-]*", a)):
        w = re.sub(r"'s$", "", w)
        if w[:1].isupper() and w.lower() not in NOT_NAMES and not (i == 0 and w.lower() in STARTERS):
            if not all(_said(x, heard) for x in re.findall(r"\w+", w.lower())): return False
    return True

def _blocked(cid):
    """Why what it learns couldn't be saved now (checked before anything goes to the Advisor), else ""."""
    try:
        if os.path.getsize(path(cid)) > MAX_READ:
            return f"{FOLDER}/{cid}.md is over 256 KB. Make it shorter in Obsidian."
    except OSError:
        pass
    for d in (DIR, VAULT):                              # (a missing folder is made, as for saved chats)
        if os.path.lexists(d):
            ok = os.path.isdir(d) and os.access(d, os.W_OK | os.X_OK)
            return "" if ok else f"Buddy can't save to {FOLDER}/ in your notes."
    return ""

def _why(e, cid):
    if isinstance(e, ValueError) and "too big" in str(e):
        return f"{FOLDER}/{cid}.md is over 256 KB. Make it shorter in Obsidian."
    if isinstance(e, OSError): return f"Buddy can't save to {FOLDER}/ in your notes."
    return "Buddy couldn't save what it learned."

def relevant(known, new, newest=60, most=200):
    """The known facts a learning run is shown: all of them up to `most` (a new fact can replace an old one that shares
    no word with it: "I moved to Berlin" vs "I live in Tashkent"); past that, the newest ones and those that share a
    word with the new messages (the most words in common first), in their usual order."""
    if len(known) <= most:
        return list(known)
    words = set(memory._words(" ".join(str(m.get("content") or "") for m in new)))
    hits = {i: len(words & set(memory._words(f["text"]))) for i, (_, f) in enumerate(known)}
    young = sorted(range(len(known)), key=lambda i: (known[i][1].get("date") or "", i), reverse=True)[:newest]
    close = sorted((i for i in hits if hits[i]), key=lambda i: (-hits[i], -i))
    pick = list(dict.fromkeys(young + close))[:most]
    return [known[i] for i in sorted(pick)]

def learn(char, cfg=None, ask=None, name_of=None, msgs=None, now=None):
    """One learning run for a character: the new (non-private) messages since its bookmark go to the Advisor with the
    facts it already keeps; what comes back is checked here before anything is written. Returns how many facts
    changed. ask(prompt) -> text (Tinfoil only); msgs: the thread (default: social.thread()). Anything that fails
    is recorded and backed off (up to an hour), so the Advisor is never asked again and again."""
    cfg, now, cid = cfg or {}, now or time.time(), char["id"]
    name_of = name_of or (lambda x: x)
    if not cfg.get("learn_facts", True) or not char.get("learns", True) or ask is None:
        return 0
    with _lock:
        if cid in _running: return 0
        _running.add(cid)
    try:
        if msgs is None:
            import social
            msgs = social.thread()
        with _lock:
            c0 = _cstate(_state(), cid); seen, off = c0["seen"], c0.get("off", 0)
        mine = [m for m in msgs if _learnable(m, cid)]
        new = [m for m in mine if m["id"] > seen]
        said_before = [m["id"] for m in mine if m["id"] <= seen and m["role"] == "user"]
        if off and said_before and said_before[-1] <= off:
            while new and new[0]["role"] == "assistant":   # (replies to what you said while learning was off)
                new.pop(0)
        if not any(m["role"] == "user" for m in new):
            return 0
        why = _blocked(cid)
        if why:                                         # it couldn't be saved: nothing goes to the Advisor
            _failed(cid, now, None, why, pre=True)
            return 0
        batch, rest = new[:40], new[40:]
        ctx = [m for m in mine if off < m["id"] <= seen][-4:]   # (never what was said while learning was off)
        say = lambda m: ("Me" if m["role"] == "user" else char["name"]) + ": " + str(m["content"])[:1000]
        own, shared = visible(char)
        known = relevant([("mine", f) for f in own] + [("everyone", f) for f in shared], batch)
        fmap = {f"f{i + 1}": (EVERYONE if file == "everyone" else cid, f["id"]) for i, (file, f) in enumerate(known)}
        prompt = EXTRACT.format(name=char["name"], known="\n".join(f"f{i + 1}. {f['text']}" for i, (_, f) in enumerate(known))
                                or "(none yet)", context="\n".join(map(say, ctx)) or "(nothing)", new="\n".join(map(say, batch)))
        try:
            reply = ask(prompt)
        except Exception:                               # can't reach Tinfoil (or not verified): try later, keep the bookmark
            _failed(cid, now, advance=None)
            return 0
        try:
            adds, ups, rems = _parse_reply(reply or "")
        except _BadReply:
            _failed(cid, now, advance=batch[-1]["id"])   # (after 3 odd replies in a row, move on)
            return 0
        said = "\n".join(str(m["content"])[:1000] for m in batch if m["role"] == "user")
        try:
            n = _apply(char, adds, ups, rems, fmap, name_of, batch[-1]["id"], said)
        except Exception as e:                          # e.g. its file grew too big meanwhile, or the folder is
            _failed(cid, now, None, _why(e, cid))       # read-only: the bookmark stays, and the sheet says why
            return 0
        with _lock:
            st = _state(); c = _cstate(st, cid)
            c.update(seen=max(c["seen"], batch[-1]["id"]), fails=0, next=0, last=now); c.pop("why", None); c.pop("pre", None)
            st["runs"] = [t for t in st["runs"] if t > now - 3600] + [now]
            _save_state(st)
        if rest: kick(cid)
        return n
    finally:
        with _lock: _running.discard(cid)

def _failed(cid, now, advance, why="", pre=False):
    """A run that didn't work: back off (4 min, doubling, at most an hour). why: what the sheet shows meanwhile.
    pre: found before asking (nothing was sent), so it's tried again as soon as that's fixed (see due)."""
    with _lock:
        st = _state(); c = _cstate(st, cid)
        c["fails"] = c.get("fails", 0) + 1; c["last"] = now
        c["next"] = now + min(3600, 120 * 2 ** min(c["fails"], 12))
        c.update(why=why, pre=pre)
        if advance is not None and c["fails"] >= 3:
            c["seen"] = max(c["seen"], advance); c["fails"] = 0
        if not pre: st["runs"] = [t for t in st["runs"] if t > now - 3600] + [now]
        _save_state(st)

def _apply(char, adds, ups, rems, fmap, name_of, last=None, said=""):
    """The checks, under the lock, on freshly re-read files. Learning only ever writes this character's own file:
    only facts it learned itself are rewritten or deleted there; one you wrote yourself, or a shared one, is set aside
    for this character only (its newer version goes in its own file), so what you tell one character never reaches
    the others and nothing you wrote is lost. Every fact must come from what you said in the new messages (said);
    removes only when you said something isn't so any more. last: the newest message it learned from; if that's gone
    (you deleted the conversation while the Advisor was answering), nothing is written."""
    cid, ban, heard, changed = char["id"], _avoid(char), _heard(said), 0
    with _lock:
        if last is not None:
            import social
            if not any(m["id"] == last for m in social.thread(last - 1)):
                return 0
        st = _state()
        gone = set(st["gone"].get(cid, [])) | set(st["gone"].get(EVERYONE, []))
        lines, facts = _read(cid)
        shared = _read(EVERYONE)[1]
        there = {}                                      # (owner, id) -> the fact, still in its file
        for owner, fs in ((cid, facts), (EVERYONE, shared)):
            for f in fs: there.setdefault((owner, f["id"]), f)
        edits = {}                                      # updates and removes: only facts it was shown, still there
        for ref, t in ups:
            key, t = fmap.get(ref), _ok_text(t, char, ban)
            if key in there and t and _yours(t, heard) and fid(t) != key[1] and fid(t) not in gone \
                    and key not in edits and len(edits) < 5:
                edits[key] = t
        n_up = len(edits)
        if UNSAY.search(_apos(said)):
            for ref in rems:
                key = fmap.get(ref)
                if key in there and key not in edits and len(edits) - n_up < 5:
                    edits[key] = None
        have = [f["text"] for f in facts + shared]
        over = st["over"].setdefault(cid, {})
        put, dead, add, n_add = {}, [], [], 0           # own lines rewritten (None: deleted); ids gone; new lines
        for (owner, i), t in edits.items():
            f = there[(owner, i)]
            if owner == cid and f["by"] == "chat":      # something it learned itself: changed in place
                put[f["line"]] = t; dead.append(i); changed += 1
                for k in [k for k, v in over.items() if v == i and t]: over[k] = fid(t)   # (still the newer version)
            elif t is None:                             # yours or shared: set aside for this character only
                over[i] = ""; changed += 1
            elif not any(_near(t, h) for h in have if h != f["text"]) and len(facts) + len(add) < MAX_FACTS:
                add.append(t); have.append(t); over[i] = fid(t); changed += 1
        for t in adds:
            t = _ok_text(t, char, ban)
            if not t or not _yours(t, heard) or fid(t) in gone or len(facts) + len(add) >= MAX_FACTS \
                    or n_add >= 5 or any(_near(t, h) for h in have):
                continue
            add.append(t); have.append(t); changed += 1; n_add += 1
        if put or add:
            for n in sorted(put, reverse=True):         # (bottom up, so the line numbers above stay right)
                if put[n] is None: del lines[n]
                else: lines[n] = _line(put[n], "learned")
            if not lines and add: lines = _header(cid, name_of(cid))
            at = max((n for n, x in enumerate(lines) if _parse(x)), default=len(lines) - 1) + 1
            if at and not lines[at - 1].endswith("\n"): lines[at - 1] += "\n"
            lines[at:at] = [_line(t, "learned") for t in add]
            _write(cid, lines)
        if dead:
            g = [x for x in st["gone"].get(cid, []) if x not in dead] + dead
            st["gone"][cid] = g[-500:]
        for k in list(over)[:max(0, len(over) - 300)]: del over[k]
        if not over: st["over"].pop(cid, None)
        if edits:
            _save_state(st)
    return changed

def _pending(cid, msgs, seen):
    """How many new things you said to this character since its bookmark."""
    return sum(1 for m in msgs if _learnable(m, cid) and m["id"] > seen and m["role"] == "user")

def due(char, msgs, now, urgent=False, busy=False):
    """Is it time to learn for this character? Urgent (you asked to remember something): 20 s after the last run.
    Else 2 min after it, and only once you've said 6 things or the conversation has paused for 4 minutes; never while
    you're on a call with them (unless urgent), during backoff, or past 30 runs an hour."""
    cid = char["id"]
    with _lock:
        st = _state(); c = _cstate(st, cid)
    if c.get("pre") and c.get("fails") and not _blocked(cid):
        c = {**c, "next": 0}                            # (what stopped it was fixed: no need to wait out the backoff)
    if now < max(c.get("next", 0), _hold.get(cid, 0)) or len([t for t in st["runs"] if t > now - 3600]) >= 30:
        return False
    users = _pending(cid, msgs, c["seen"])
    if not users:
        return False
    since = now - c.get("last", 0)
    if urgent:
        return since >= 20
    if busy or since < 120:
        return False
    newest = max((m["ts"] for m in msgs if m.get("char", "buddy") == cid), default=0)
    return users >= 6 or now - newest >= 240

def resume(cids):
    """Learning is being switched back on for these characters: first the bookmark moves past everything said while
    it was off (also since the worker last looked), so none of it is ever learned."""
    import social
    msgs = social.thread()
    for cid in cids:
        _skip(cid, msgs)

def _skip(cid, msgs):
    """Learning is off: the bookmark moves past what's said meanwhile, so it's never learned once it's back on."""
    top = max((m["id"] for m in msgs if _learnable(m, cid)), default=0)
    with _lock:
        st = _state(); c = _cstate(st, cid)
        if top > c["seen"]:
            c["seen"] = c["off"] = top; _save_state(st)

def tick(cfg_fn, ask_fn, chars_fn, busy_fn, now=None):
    """One look at every character (the worker does this every minute, or at once when kicked)."""
    import social
    cfg, now = cfg_fn(), now or time.time()
    msgs, chars = social.thread(), chars_fn()
    on = cfg.get("learn_facts", True)
    for c in chars:
        if not on or not c.get("learns", True):
            _kicks.pop(c["id"], None); _skip(c["id"], msgs)
    if not on or not os.path.exists(os.path.join(HERE, ".tinfoil_key")):
        _kicks.clear(); return
    if billing.paused():                                # (your Tinfoil credits ran out: tried again in a while; the
        return                                          #  kicks stay, so nothing said meanwhile is missed)
    names = {c["id"]: c["name"] for c in chars}
    for c in chars:
        urgent = _kicks.get(c["id"], False)
        if not c.get("learns", True):
            continue
        try:
            if due(c, msgs, now, urgent, busy_fn(c["id"])):
                _kicks.pop(c["id"], None)
                learn(c, cfg, ask_fn, lambda x: names.get(x, x), msgs, now)
            elif not urgent or not _pending(c["id"], msgs, _cstate(_state(), c["id"])["seen"]):
                _kicks.pop(c["id"], None)                # (an urgent one is looked at again in 20 s)
        except Exception:                               # (learn records and backs off its own failures; this is
            _hold[c["id"]] = now + 600                  #  the last resort, e.g. when even the state can't be saved)

def start_background(cfg_fn, ask_fn, chars_fn, busy_fn):
    """The learning worker. On the very first start, learning begins from now: your earlier chats are never mined
    (also if the bookmarks file was lost or damaged)."""
    with _lock:
        try:
            ok = isinstance(json.load(open(STATE)), dict)
            os.chmod(STATE, 0o600)
        except Exception:
            ok = False
        if not ok and _newest_id():                   # (a fresh install has nothing to skip: no file, so a restore
            st = _state(); st["boot"] = _newest_id(); _save_state(st)   # onto it has nothing to move aside)
    def loop():
        while True:
            try:
                _wake.wait(20 if any(dict(_kicks).values()) else 60)   # (an urgent one is looked at again soon)
                _wake.clear()
                tick(cfg_fn, ask_fn, chars_fn, busy_fn)
            except Exception:
                time.sleep(5)
    threading.Thread(target=loop, daemon=True).start()
