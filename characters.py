"""Characters: the different people you can talk to, each with their own voice, brain, knowledge and conversation.
"buddy" is built in (persona.txt, or your persona.local.txt). The ones you make live in my-characters/ (git-ignored,
readable only by you), so updates never touch them and they never end up in the repo."""
import json, os, re, threading, time
import edition

HERE = os.path.dirname(os.path.abspath(__file__))
MINE = os.path.join(HERE, "my-characters")
COLORS = ["#d9973c", "#5b8def", "#3fa37a", "#c8566a", "#8a6de9", "#e07a3f", "#2aa3b8", "#b5843a"]
VOICES = [("casual_female", "Casual (female)"), ("cheerful_female", "Cheerful (female)"), ("neutral_female", "Calm (female)"),
          ("Vivian", "Vivian (female)"), ("Serena", "Serena (female)"),
          ("casual_male", "Casual (male)"), ("neutral_male", "Calm (male)"), ("Ryan", "Ryan (male)"), ("Aiden", "Aiden (male)")]
VOICE_IDS = {v for v, _ in VOICES}
STYLES = ("photo", "illustration", "anime", "cartoon", "painting")    # how their pictures look (see images.STYLE)
SCOPES = ("all", "except", "some", "none")                             # what they know of your notes
_lock = threading.Lock()

def _read(name):
    stem, ext = os.path.splitext(name)
    for p in (os.path.join(HERE, stem + ".local" + ext), os.path.join(HERE, name)):
        if os.path.exists(p):
            return open(p).read().strip()
    return ""

def persona_of(c):
    """The persona exactly as the system prompt uses it (phone mode gets the same text in its kit)."""
    return c.get("persona") or (_read("persona.txt") if c.get("builtin")
                                else f"You are {c['name']}, a friendly adult I can talk to. {c.get('tagline', '')}")

def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "character"

def _per_day(n):
    return n if isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= 4 else None

def clean(c, known_folders=None, existing=None, check_looks=True):
    """Only valid, bounded values are ever stored. check_looks: refuse looks that aren't an original adult (when saving;
    a character saved before a check got stricter still loads: no pictures are made from such looks either)."""
    existing = existing or {}
    looks = str(c.get("appearance", existing.get("appearance", ""))).strip()[:800]
    try:
        import images
        if check_looks and images.too_young(looks):
            raise ValueError("Looks must describe an adult: say woman or man (not girl, boy or teen), no age under 18")
        if check_looks and images.real_person(looks):
            raise ValueError("Looks must be an original person: never a real or famous one, no \"looks like …\"")
        if check_looks and edition.PUBLIC and images.immodest(looks):
            raise ValueError("Looks must be modest: " + images.ONLY_MODEST)
    except ImportError:
        pass
    know = c.get("knowledge") if isinstance(c.get("knowledge"), dict) else existing.get("knowledge", {})
    scope = know.get("scope") if know.get("scope") in SCOPES else "all"
    avoid = know.get("avoid", (existing.get("knowledge") or {}).get("avoid", ""))
    avoid = (", ".join(map(str, avoid)) if isinstance(avoid, list) else str(avoid or "")).strip()[:1000]
    folders = [re.sub(r"[/\\\\]|\.\.", "", str(f))[:60] for f in (know.get("folders") or []) if str(f).strip()][:40]
    if known_folders is not None and scope == "some":    # (folders to leave out are kept even if not there right now)
        folders = [f for f in folders if f in known_folders]
    voice = c.get("voice") if c.get("voice") in VOICE_IDS else existing.get("voice", "casual_female")
    color = c.get("color") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(c.get("color", ""))) else existing.get("color", COLORS[0])
    return {
        "name": (str(c.get("name") or existing.get("name") or "Unnamed").strip())[:40],
        "tagline": str(c.get("tagline", existing.get("tagline", ""))).strip()[:90],
        "persona": str(c.get("persona", existing.get("persona", ""))).strip()[:8000],
        "appearance": looks,
        "style": c.get("style") if c.get("style") in STYLES else existing.get("style", "photo"),
        "voice": voice,
        "brain": c.get("brain") if c.get("brain") in ("advisor", "companion") else existing.get("brain", "advisor"),
        "knowledge": {"scope": scope, "folders": folders if scope in ("some", "except") else [], "avoid": avoid},
        "texts_first": bool(c.get("texts_first", existing.get("texts_first", False))),
        "learns": bool(c.get("learns", existing.get("learns", True))),   # notes down lasting facts about you (facts.py)
        "life": bool(c.get("life", existing.get("life", True))),         # has a life of their own (lives.py)
        "texts_per_day": _per_day(c.get("texts_per_day", existing.get("texts_per_day"))),   # None: the global setting
        "life_seed": str(c.get("life_seed", existing.get("life_seed", ""))).strip()[:600],  # their everyday life, in short
        "color": color,
    }

def _builtin(cfg):
    base = {"id": "buddy", "name": cfg.get("name", "Buddy"), "tagline": "Your closest friend", "persona": _read("persona.txt"),
            "appearance": "", "style": "photo",
            "voice": cfg.get("voice", "casual_female"), "brain": "advisor",
            "knowledge": {"scope": "all", "folders": [], "avoid": ""},
            "texts_first": True, "learns": True, "life": True, "texts_per_day": None, "life_seed": "",
            "color": COLORS[0], "created": 0}
    try:
        mine = json.load(open(os.path.join(MINE, "buddy.json")))
        base.update({k: v for k, v in clean(mine, existing=base, check_looks=False).items() if k != "persona" or v})
    except Exception:
        pass
    return {**base, "builtin": True, **_pics("buddy")}

def _pics(cid):
    """Versions (mtime in ms, 0 = none) of their profile picture, the one before it and their chat wallpaper."""
    return {"avatar": _avatar_version(cid), "avatar_prev": _avatar_version(cid, "prev"), "wallpaper": _avatar_version(cid, "wall")}

def all_characters(cfg):
    out = [_builtin(cfg)]
    if os.path.isdir(MINE):
        for f in sorted(os.listdir(MINE)):
            if f.endswith(".json") and f != "buddy.json":
                try:
                    c = json.load(open(os.path.join(MINE, f)))
                    out.append({**clean(c, check_looks=False), "id": f[:-5], "created": c.get("created", 0), "builtin": False,
                                **_pics(f[:-5])})
                except Exception:
                    pass
    return sorted(out, key=lambda c: (not c["builtin"], c["created"]))

def get(cid, cfg):
    return next((c for c in all_characters(cfg) if c["id"] == cid), None) or _builtin(cfg)

def save(c, cfg, known_folders=None):
    with _lock:
        os.makedirs(MINE, exist_ok=True); os.chmod(MINE, 0o700)
        ids = {x["id"] for x in all_characters(cfg)}
        cid = c.get("id") if c.get("id") in ids else None
        existing = get(cid, cfg) if cid else {}
        data = clean(c, known_folders, existing)
        if not cid:                                       # new: a unique id from the name, its own colour
            used = set(ids)                               # ...never one a deleted character's history still uses
            try:
                import social
                used |= {m.get("char") for m in social.thread()}
                chats = os.path.expanduser("~/Buddy/chats")
                if os.path.isdir(chats): used |= set(os.listdir(chats))
            except Exception:
                pass
            try:                                          # ...or whose life is still kept
                used |= {f[:-5] for f in os.listdir(os.path.join(MINE, "lives")) if f.endswith(".json")}
            except OSError:
                pass
            try:                                          # ...or whose facts about you are still in your notes
                known = os.path.expanduser("~/Buddy/Buddy knows")
                used |= {f[:-3] for f in os.listdir(known) if f.endswith(".md")}
            except OSError:
                pass
            base = _slug(data["name"]); cid = base; n = 2
            while cid in used: cid = f"{base}-{n}"; n += 1
            if not c.get("color"): data["color"] = COLORS[len(ids) % len(COLORS)]
        data["created"] = existing.get("created") or time.time()
        if cid == "buddy" and data["persona"] == _read("persona.txt"):
            data["persona"] = ""                          # unchanged: keep following persona.txt
        p = os.path.join(MINE, cid + ".json"); tmp = p + ".tmp"
        with open(tmp, "w") as f: json.dump(data, f, indent=2)   # (a failed last write raises here, before the swap)
        os.chmod(tmp, 0o600); os.replace(tmp, p)
        return get(cid, cfg)

def delete(cid):
    if cid == "buddy" or not re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)):
        return False
    for kind in ("img", "prev", "seed", "wall"):
        try: os.remove(avatar_path(cid, kind))
        except OSError: pass
    try:                                                  # their life goes with them
        import lives
        lives.delete(cid); lives.forget_ties(cid)
    except Exception:
        pass
    try: os.remove(os.path.join(MINE, cid + ".json")); return True
    except OSError: return False

def avatar_path(cid, kind="img"):
    """Their profile picture (my-characters/<id>.img), the one before it (.prev, for undo), its seed (.seed: a change
    to the same photo starts from it) and their chat wallpaper (.wall); ids are checked so nothing else can be read."""
    return os.path.join(MINE, f"{cid}.{kind}") if re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)) and \
        kind in ("img", "prev", "seed", "wall") else None

def _avatar_version(cid, kind="img"):
    p = avatar_path(cid, kind)
    return int(os.path.getmtime(p) * 1000) if p and os.path.exists(p) else 0     # ms: two changes in a second still differ

def _put(p, data):
    os.makedirs(MINE, exist_ok=True); os.chmod(MINE, 0o700)
    tmp = p + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f: f.write(data)
    os.chmod(tmp, 0o600); os.replace(tmp, p)

def set_avatar(cid, data, seed=None):
    """A new profile picture; the one before is kept for undo. seed: what it was made from (None: uploaded)."""
    with _lock:
        p = avatar_path(cid)
        if os.path.exists(p): os.replace(p, avatar_path(cid, "prev"))
        _put(p, data)
        if seed is None:
            try: os.remove(avatar_path(cid, "seed"))
            except OSError: pass
        else:
            _put(avatar_path(cid, "seed"), str(int(seed)).encode())

def avatar_seed(cid):
    try:
        with open(avatar_path(cid, "seed")) as f: return int(f.read().strip())
    except (OSError, ValueError, TypeError): return None

def undo_avatar(cid):
    """Back to the picture before (and the newer one becomes the one to go back to)."""
    with _lock:
        p, prev = avatar_path(cid), avatar_path(cid, "prev")
        if not (prev and os.path.exists(prev)): return False
        tmp = p + ".swap"
        if os.path.exists(p): os.replace(p, tmp)
        os.replace(prev, p)
        if os.path.exists(tmp): os.replace(tmp, prev)
        try: os.remove(avatar_path(cid, "seed"))         # (an adjustment starts from a new take after an undo)
        except OSError: pass
        return True

def set_wallpaper(cid, data):
    _put(avatar_path(cid, "wall"), data)

def remove_wallpaper(cid):
    try: os.remove(avatar_path(cid, "wall")); return True
    except (OSError, TypeError): return False

def memory_folders(c):
    """Which notes this character may draw on: None = everything; always its own past chats."""
    k = c.get("knowledge", {})
    if k.get("scope") in ("all", "except"):
        return None
    return (k.get("folders", []) if k.get("scope") == "some" else []) + [f"chats/{c['id']}"]

def memory_skip(c):
    """Folders kept from this character ("everything except these")."""
    k = c.get("knowledge", {})
    return list(k.get("folders", [])) if k.get("scope") == "except" else []

def avoid_terms(c):
    """What this character doesn't know about, as words/phrases ("my ex, work, health"): notes mentioning them are kept
    from it. Lists, bullets and quotes are fine; "my"/"our" in front is dropped so "my health" also catches "health"."""
    raw = str((c.get("knowledge") or {}).get("avoid", "")).replace("\u2019", "'").replace("\u2018", "'")
    out = []
    for t in re.split(r"[,;\n\u2022\u00b7|]+", raw):
        t = re.sub(r"^[\s\-\u2013\u2014*\"'\u201c\u201d]+|[\s\-\u2013\u2014*\"'\u201c\u201d.!?]+$", "", t)
        t = re.sub(r"^(my|our)\s+", "", t, flags=re.I).strip().lower()
        if len(t) >= 2 and t not in out:
            out.append(t)
    return out[:80]

# A persona that explicitly asks to be kept on track ("remind me to …", "keep me on track / accountable", "hold me
# accountable / to my goals", "follow up on what I said / whether I did"): their check-in texts first follow up on what
# you said you'd do (buddy_server.FOLLOW_UP). Only that explicit wording: "you remind me of summer", "cheers on my
# goals", "push me to try new games", "nudge me to draw more" or Buddy's "Follow up. If I mentioned…" don't count, so
# casual characters text exactly as before.
ON_TRACK = re.compile(r"\b(?:remind(?:s|ing)?\s+me\s+to\b|keep(?:s|ing)?\s+(?:me|you)\s+(?:on\s+track|accountable)|"
                      r"hold(?:s|ing)?\s+(?:me|you)\s+(?:accountable|to\s+(?:what|my|it|that|account)\b)|"
                      r"follow(?:s|ing)?\s+up\s+on\s+(?:what\s+i\b|whether\s+i\b|if\s+i\b|what\s+you\b|whether\s+you\b))",
                      re.I)
def keeps_on_track(c):
    return bool(ON_TRACK.search(f"{c.get('persona') or ''}\n{c.get('tagline') or ''}"))

def find(cid, cfg):
    """That exact character, or None (no falling back to Buddy)."""
    return next((c for c in all_characters(cfg) if c["id"] == cid), None)

CREATE = """Design character(s) for my private AI companion app, from this request: "{desc}"
Each one is a distinct ADULT person (over 18) I can talk to by voice and text, suited to a purpose.
Make several only if the request asks for several (at most 6). Return ONLY a JSON array, no prose, each item:
{{"name": "a first name or short name",
 "tagline": "max 8 words: what they're for",
 "persona": "150-250 words written to them in second person (You are ...): who they are, what they're expert in, how they
   talk and text (natural and short like a real person: a few words to a sentence or two, no lists or markdown; casual,
   or serious, formal or focused if that fits who they are or the request says so: then say so plainly), their opinions
   and quirks, and how they help me (if they're meant to remind me or keep me on track, say plainly that they follow up
   on what I said I'd do and hold me to my goals)",
 "voice": one of {voices},
 "appearance": "40-80 words describing how they look in photos: an ORIGINAL fictional adult aged 25-35 (never a real or
   famous person, and never 'looks like' anyone): face, hair, eyes, build, typical clothes and vibe; say woman or man,
   never girl or boy",
 "style": how their pictures look: "photo" (default), "illustration", "anime", "cartoon" (3D animated) or "painting",
 "brain": "advisor" (smart, careful, most characters) or "companion" ({companion}),
 "life_seed": "max 60 words: their own everyday adult life in short (city or kind of place, work, routine, hobbies, a
   few people in it, all fictional); this is who they are when they're not talking to me",
 "folders": which of my note folders they should know, from {folders}; ["*"] for everything; [] for none,
 "avoid": "topics, people or things from my life they must NOT know about, comma-separated, only if the request says so,
   else \"\""}}{rules}"""

def create_pieces(pub):
    """CREATE's parts that come from neither the request nor your folders, for an edition (kitparts gives them to
    the phone-only app)."""
    return {"voices": json.dumps([v for v, _ in VOICES]) + " (" + ", ".join(f"{v} = {l}" for v, l in VOICES) + ")",
            "companion": edition.CREATE_COMPANION if pub else "uncensored: intimate, edgy or roleplay characters",
            "rules": "\n" + edition.CREATE if pub else ""}

def create_prompt(desc, folders):
    """What the Advisor is asked (in the public edition: no haram personas, edition.py)."""
    return CREATE.format(desc=desc.strip()[:1000], folders=json.dumps(folders), **create_pieces(edition.PUBLIC))

def create(desc, cfg, ask, folders=None):
    """ask(prompt) -> model text. Returns the saved characters. folders: the note folders the model may give them
    (None: all of yours; [] for the free brain, which isn't told their names)."""
    if folders is None:
        try:
            import memory
            folders = memory.folders()
        except Exception:
            folders = []
    txt = ask(create_prompt(desc, folders))
    a, o = txt.find("["), txt.find("{")
    if a >= 0 and (o < 0 or a < o):
        items = json.loads(txt[a:txt.rfind("]") + 1])
    else:
        one = json.loads(txt[o:txt.rfind("}") + 1])
        items = one.get("characters") if isinstance(one.get("characters"), list) else [one]
    made = []
    for it in items[:6]:
        if not isinstance(it, dict) or not it.get("name") or not it.get("persona"):
            continue
        f = it.get("folders") or []
        scope = "all" if "*" in f else ("some" if f else "none")
        it["knowledge"] = {"scope": scope, "folders": [x for x in f if x != "*"], "avoid": str(it.get("avoid") or "")}
        it["texts_first"], it["texts_per_day"] = True, 1   # (now and then: about things in their own day)
        for k in ("id", "created", "builtin", "avatar"):
            it.pop(k, None)                               # the model can only ever make new characters
        try: made.append(save(it, cfg, folders))
        except ValueError: continue                       # e.g. looks that don't describe an adult
    if not made:
        raise ValueError("no characters in the reply")
    return made
