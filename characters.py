"""Characters: the different people you can talk to, each with their own voice, brain, knowledge and conversation.
"buddy" is built in (persona.txt, or your persona.local.txt). The ones you make live in my-characters/ (git-ignored,
readable only by you), so updates never touch them and they never end up in the repo."""
import json, os, re, threading, time

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

def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "character"

def clean(c, known_folders=None, existing=None):
    """Only valid, bounded values are ever stored."""
    existing = existing or {}
    looks = str(c.get("appearance", existing.get("appearance", ""))).strip()[:800]
    try:
        import images
        if images.too_young(looks):
            raise ValueError("Looks must describe an adult")
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
        "color": color,
    }

def _builtin(cfg):
    base = {"id": "buddy", "name": cfg.get("name", "Buddy"), "tagline": "Your closest friend", "persona": _read("persona.txt"),
            "appearance": "", "style": "photo",
            "voice": cfg.get("voice", "casual_female"), "brain": "advisor",
            "knowledge": {"scope": "all", "folders": [], "avoid": ""},
            "texts_first": True, "color": COLORS[0], "created": 0}
    try:
        mine = json.load(open(os.path.join(MINE, "buddy.json")))
        base.update({k: v for k, v in clean(mine, existing=base).items() if k != "persona" or v})
    except Exception:
        pass
    return {**base, "builtin": True, "avatar": _avatar_version("buddy")}

def all_characters(cfg):
    out = [_builtin(cfg)]
    if os.path.isdir(MINE):
        for f in sorted(os.listdir(MINE)):
            if f.endswith(".json") and f != "buddy.json":
                try:
                    c = json.load(open(os.path.join(MINE, f)))
                    out.append({**clean(c), "id": f[:-5], "created": c.get("created", 0), "builtin": False,
                                "avatar": _avatar_version(f[:-5])})
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
            base = _slug(data["name"]); cid = base; n = 2
            while cid in used: cid = f"{base}-{n}"; n += 1
            if not c.get("color"): data["color"] = COLORS[len(ids) % len(COLORS)]
        data["created"] = existing.get("created") or time.time()
        if cid == "buddy" and data["persona"] == _read("persona.txt"):
            data["persona"] = ""                          # unchanged: keep following persona.txt
        p = os.path.join(MINE, cid + ".json"); tmp = p + ".tmp"
        json.dump(data, open(tmp, "w"), indent=2); os.chmod(tmp, 0o600); os.replace(tmp, p)
        return get(cid, cfg)

def delete(cid):
    if cid == "buddy" or not re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)):
        return False
    try: os.remove(avatar_path(cid))
    except OSError: pass
    try: os.remove(os.path.join(MINE, cid + ".json")); return True
    except OSError: return False

def avatar_path(cid):
    """Their profile picture (my-characters/<id>.img); ids are checked so nothing else can be read."""
    return os.path.join(MINE, f"{cid}.img") if re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)) else None

def _avatar_version(cid):
    p = avatar_path(cid)
    return int(os.path.getmtime(p) * 1000) if p and os.path.exists(p) else 0     # ms: two changes in a second still differ

def set_avatar(cid, data):
    os.makedirs(MINE, exist_ok=True)
    p = avatar_path(cid); tmp = p + ".tmp"
    with open(tmp, "wb") as f: f.write(data)
    os.chmod(tmp, 0o600); os.replace(tmp, p)

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

def find(cid, cfg):
    """That exact character, or None (no falling back to Buddy)."""
    return next((c for c in all_characters(cfg) if c["id"] == cid), None)

CREATE = """Design character(s) for my private AI companion app, from this request: "{desc}"
Each one is a distinct ADULT person (over 18) I can talk to by voice and text, suited to a purpose.
Make several only if the request asks for several (at most 6). Return ONLY a JSON array, no prose, each item:
{{"name": "a first name or short name",
 "tagline": "max 8 words: what they're for",
 "persona": "150-250 words written to them in second person (You are ...): who they are, what they're expert in, how they
   talk out loud (natural, short spoken sentences, no lists or markdown), their opinions and quirks, and how they help me",
 "voice": one of {voices},
 "appearance": "40-80 words describing how they look in photos: an ORIGINAL fictional adult aged 25-40 (never a real or
   famous person): face, hair, eyes, build, typical clothes and vibe",
 "style": how their pictures look: "photo" (default), "illustration", "anime", "cartoon" (3D animated) or "painting",
 "brain": "advisor" (smart, careful, most characters) or "companion" (uncensored: intimate, edgy or roleplay characters),
 "folders": which of my note folders they should know, from {folders}; ["*"] for everything; [] for none,
 "avoid": "topics, people or things from my life they must NOT know about, comma-separated, only if the request says so,
   else \"\""}}"""

def create(desc, cfg, ask):
    """ask(prompt) -> model text. Returns the saved characters."""
    folders = None
    try:
        import memory
        folders = memory.folders()
    except Exception:
        folders = []
    txt = ask(CREATE.format(desc=desc.strip()[:1000], voices=json.dumps([v for v, _ in VOICES]) + " (" +
              ", ".join(f"{v} = {l}" for v, l in VOICES) + ")", folders=json.dumps(folders)))
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
        it["texts_first"] = False
        for k in ("id", "created", "builtin", "avatar"):
            it.pop(k, None)                               # the model can only ever make new characters
        try: made.append(save(it, cfg, folders))
        except ValueError: continue                       # e.g. looks that don't describe an adult
    if not made:
        raise ValueError("no characters in the reply")
    return made
