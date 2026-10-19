#!/usr/bin/env python3
"""Buddy server: brain, voice, hearing, memory, chat saving, the shared Mac/phone conversation and push.
Runs only on 127.0.0.1 (this Mac). Keys stay here, never sent to the page.
Advisor brain: Tinfoil (via the verified local proxy). Companion brain: Phala TEE."""
import base64, datetime, hashlib, json, math, os, random, re, select, socket, sys, threading, time, uuid, urllib.parse, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.umask(0o077)       # everything Buddy writes (chats, settings, temp files) is readable only by you, never other accounts
# Never through a proxy: the local Tinfoil Proxy, the image app and Ollama talk plain HTTP on this Mac, so a system or
# VPN proxy in between could read everything. (Phala and push are HTTPS anyway; requests/pywebpush follow NO_PROXY.)
# Each connection to a helper on this Mac is also checked to be the program of yours that was checked (localcheck.py).
import localcheck
urllib.request.install_opener(localcheck.opener())
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "*"
import http.cookies, shutil, subprocess
import backup, billing, characters, devices, edition, facts, images, lives, localcheck, memory, social, tailnet, tinfoilproxy
# The texts, models and lines phone mode's kit carries live in kitparts.py (one copy; it's pure, so the coming Buddy
# for phones site builds its kit from it without this server); used here exactly as before (and the tests read them
# as buddy_server.X).
import kitparts
from kitparts import (ADVISOR_MODELS, ALOUD, ALWAYS_THINKS, CALLING, CANT_SEE, COMPANION_MODELS, DESCRIBE, FACTS_HEAD,
                      FACTS_RULE, FILLERS, FOLLOW_UP, FOLLOW_UP_MOMENT, FREE_MODELS, GREETINGS, KIT_V, LATE_NOTE,
                      LENGTH_HINTS, LOOKED, MISSED, NO_PHOTOS, NO_THINKING, PHOTO_SAFETY, PROACTIVE, REAL, STT,
                      STT_NEXT, TEXT_CAPS, TEXTING, VISION_ORDER, VOICE_ASK, knows_ask, style_text, voice_list)
try:
    import near                                       # NEAR AI pictures (opt-in); Buddy works without it
except Exception:
    near = None

WEB = os.path.join(HERE, "web")
VAULT = os.path.expanduser("~/Buddy")
CHATS = os.path.join(VAULT, "chats")
# Tinfoil is reached only through its attestation-verifying proxy, which Buddy runs itself (tinfoilproxy.py).
PHALA = "https://inference.phala.com/v1"
# The free brain (opt-in, off by default, labelled "Less private" everywhere it shows): Cloudflare Workers AI with your
# own free Cloudflare account. Its servers can read what's sent (no enclave, nothing to verify), so it only ever gets
# the text of everyday (never private) chats, calls, texts first, their lives and new characters: never private chats,
# photos, recordings, notes, saved chats, facts or learning. Nothing falls back to it, and when it fails Buddy says so
# instead of switching to a paid brain. Its free allowance is 10,000 "neurons" a day (reset at 00:00 UTC).
CLOUDFLARE = "https://api.cloudflare.com/client/v4/accounts/"
FREE_NAME = "Cloudflare"
_free = {"limited": 0, "gone": {}}   # used up for today until (unix); model -> until when it isn't asked (it was missing)
PORT = 12400
BOOT = uuid.uuid4().hex[:12]     # this run of the server (the page reloads when it changes after a restore)
_thinking_refused = set()
ACTION = re.compile(r"[*(]\s*(?:laugh|chuckl|giggl|smil|grin|sigh|wink|blush|nod|shrug|whisper|gasp|paus|hug|kiss|"
                    r"smirk|sniff|yawn|cough|clear|lean|look|glanc|tilt|rais|roll|bit|hum|sing|sob|cr[iy]|grimac|"
                    r"frown|beam|blink|stretch)(?:s|es|d|ed|ing|[a-z]ing)?\b[^*()\n]{0,40}[*)]", re.I)   # (*huge* stays)
EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u20E3\uFE0F\u200D"
                   "\U000E0020-\U000E007F]")
def spoken(text):
    """Text as it should be said aloud: no emoji, no *laughs* / (smiles), no markdown symbols."""
    t = EMOJI.sub("", ACTION.sub("", str(text)))
    return re.sub(r"\s{2,}", " ", re.sub(r"[*_#`~]", "", t)).strip()
ABBREV = re.compile(r"(?:\b(?i:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|vs|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.$")   # ("Oh no." ends)
PHOTOS = ("You can send me a photo (a selfie, or what you're up to or looking at) by ending your message with "
          "[photo: what the photo shows]. At most one per message, and only when I ask or when it really fits "
          "(now and then, not all the time). Never describe anyone as under 25. Describe only what can be seen, never "
          "names, places or details from my notes or our chats, never a real or famous person, and never anyone from a "
          "photo I sent you.")
# Every way a model writes "here's a photo" instead of sending one, and nothing else:
# - square brackets (always a tag, never shown): [photo: …], [image: …], [Image of …], [selfie at …], [sends a photo
#   of …], [takes a mirror selfie], any length, one cut off at the end;
# - the action pairs ( ) * * ** ** _ _ { } < > 【 】 only when what's inside starts with a send/take/snap/attach/share/
#   show verb and has a photo word ("*sends a mirror selfie*", "(takes a selfie and sends it)", "*shows you a photo of
#   my cat*"), or is a photo word and ":" with a scene ("(image: me at the gym)", "*photo attached: me at the gym*");
#   emphasis ("*photo*", "**Photos:**") and asides ("(the photo of your dog killed me)", "_photo of the day_") stay words;
# - markdown ![…](…);
# - "📸 …" / "Photo: …" / "Image: …" lines only at a real line start of the reply and with a scene ("📸 me on my
#   balcony", never "📸 nice shot!", "Photos: love them" or "Image: the logo should be on the left");
# never one about your photo ("your pic", "the one you sent"), one still to come ("sending a pic soon") or one they
# talk about having sent ("(i sent the pic to my mom)").
_PIC_WORD = r"(?:photo(?:graph)?|pic(?:ture)?|image|img|selfie|snapshot)s?"
_PIC_VERB = (r"(?:i(?:['’]m|\s+am|\s+just)?\s+|just\s+|quickly\s+)?(?:(?:sends|sent|sending|takes|took|taking|snaps|"
             r"snapped|snapping|attach(?:es|ed|ing)|shares|shared|sharing|shows|showed|showing)\b(?!\s+(?:me|us)\b)"
             r"|here(?:['’]s|\s+is|\s+are)\b)")    # their own doing ("sends a selfie"), never asking or telling you to
                                                  # ("show me a pic", "send pics", "take a photo of the receipt")
_PIC_LABEL = rf"(?:(?:a|an|my|new|quick)\s+)?{_PIC_WORD}(?:\s+(?:attached|incoming|below))?(?:[ \t]*:|[ \t]+[-–—])"
_PIC_LEAD = r"(?:(?:a|an|my|another|one\s+more|new|quick|little|cute|random|blurry)\s+)*"    # ([a quick selfie …])
_CAM = "[\U0001F4F8\U0001F4F7\U0001F933]\uFE0F?"            # 📸 📷 🤳
_PIC_PAIRS = [(r"\(", ")"), (r"\{", "}"), ("<", ">"), ("【", "】"), (r"(?<!\w)\*\*?(?![ \t])", "*"),
              (r"(?<!\w)_(?![ \t])", "_")]                     # ("* Take photos…" is a bullet, not an action)
def _pic_re(o, c, final):
    end = re.escape(c) if not final else rf"(?:{re.escape(c)}|(?=\n)|$)"         # (never closed: to the end of the line)
    return re.compile(rf"(?:{_CAM}[ \t]*)?{o}[ \t]*(?P<act>(?:{_PIC_VERB}|{_PIC_LABEL})[^{re.escape(c)}\n]{{0,2000}})"
                      rf"{end}(?:[ \t]*{_CAM})?", re.I)
_PIC_TAGS = {final: [re.compile(r"!\[(?P<md>[^\]\n]{0,2000})\]\([^)\n]{0,500}\)"),       # (markdown: ![me](x.jpg))
                     re.compile(rf"(?:{_CAM}[ \t]*)?\[[ \t]*(?P<sq>[^\]]{{0,2000}})" + (r"(?:\]|$)" if final else r"\]")
                                + rf"(?:[ \t]*{_CAM})?")]
             + [_pic_re(o, c, final) for o, c in _PIC_PAIRS]
             + [re.compile(rf"(?mi)^[ \t]*(?:{_CAM}[ \t]*[:\-–—]?|{_PIC_WORD}[ \t]*:)[ \t]*(?P<line>[^\n]{{2,2000}})"
                           + ("$" if final else r"(?=\n)"))]
             for final in (True, False)}
_PIC_INTRO = re.compile(r"^(?:[:\-–—]|of\b|showing\b|shows\b|(?:description|desc|caption)\s*:)\s*", re.I)
_PIC_YOURS = re.compile(rf"\byour\s+(?:\w+\s+){{0,2}}{_PIC_WORD}\b|\b{_PIC_WORD}\s+(?:of|from)\s+your\b|"
                        r"\b(?:you|u)\s+(?:just\s+)?(?:sent|took|posted|shared|showed|uploaded)\b", re.I)
_PIC_LATER = re.compile(r"\b(?:soon|later|tomorrow|tonight|in\s+a\s+(?:bit|sec|second|min|minute|moment)|next\s+time|"
                        r"(?:when|once|after)\s+i(?:\s+(?:get|find|can|have|am)|['’]m))\b", re.I)
_PIC_BEFORE = re.compile(r"^(?:i\s+(?:just\s+)?)?(?:sent|shared|showed|took|snapped|attached)\s+(?:(?:you|u)\s+)?"
                         r"(?:the|that|this|those|these|it|them)\b", re.I)        # (a photo they talk about)
_PIC_SENDS_IT = re.compile(r"[\s,]*(?:and|then|&)\s+(?:sends?|shares?|shows?|attach(?:es)?)\s+(?:it|that|this|them|one)\b"
                           r"(?:\s+(?:over\s+)?to\s+(?:you|u))?\s*$", re.I)       # ("takes a selfie and sends it")
_SCENE_NOT = re.compile(r"\b(?:is|are|was|were|be|been|am|should|would|could|can|will|must|might|may|do|does|did|"
                        r"don['’]?t|isn['’]?t|i|you|u|it['’]s|that['’]s|love|hate)\b", re.I)
_SCENE_YES = re.compile(r"^(?:me|my|a|an|the|us|our|this|view|close-?up|mirror|selfie)\b|\b(?:at|in|on|from|with|by|near|"
                        r"under|over|outside|inside|wearing|holding|sitting|standing|lying|looking|showing)\b", re.I)
def _scene_like(s):
    """A scene ("me on my balcony at sunset", "a man with messy hair"), not a remark ("nice shot!", "love them, I take
    a ton", "the logo should be on the left", "no")."""
    first = re.split(r"[,.;!?…]", s, maxsplit=1)[0].strip()
    return len(first.split()) >= 2 and not _SCENE_NOT.search(first) and bool(_SCENE_YES.search(first))
def _pic_scene(inside, square=False):
    """What a tag's inside shows, or None when it isn't a photo they're sending now."""
    s = " ".join(inside.split())
    if _PIC_YOURS.search(s):
        return None                                   # (your photo: never theirs to send)
    verb = re.match(rf"{_PIC_VERB}\s*", s, re.I)
    if verb:                                          # "sends a mirror selfie", "takes a selfie and sends it"
        if not re.search(rf"\b{_PIC_WORD}\b", s, re.I) or _PIC_LATER.search(s) or _PIC_BEFORE.match(s):
            return None                               # ("*takes a deep breath*", "(sending a pic soon)")
        s = re.sub(r"^(?:(?:you|u|back|over)\s+)+", "", s[verb.end():], flags=re.I)
        s = _PIC_SENDS_IT.sub("", re.sub(r"^(?:a|an|another|one\s+more|this|the|that|some)\s+", "", s, flags=re.I))
    else:                                             # "photo: …", "Image of …", "a quick selfie at …"
        lead = re.match(rf"{_PIC_LEAD}(?={_PIC_WORD}\b)", s, re.I)
        if not lead:
            return None                               # ("[react: 😂]", "[laughs]")
        s = s[lead.end():]
    w = re.match(rf"{_PIC_WORD}\b(?:\s+(?:attached|incoming|below))?\s*", s, re.I)
    if w:                                             # ("photo of my cat": "my cat"; "selfie at the beach" stays)
        rest = s[w.end():]
        intro = _PIC_INTRO.match(rest)
        s = rest[intro.end():] if intro else s if rest else ""
    s = s.strip(" \t\"'“”*_,;")
    if not square and not verb and not _scene_like(s):
        return None                                   # ("**Photos:**", "(photo: not great tbh)")
    return s or "a casual selfie"                     # ("[selfie]", "*sends a pic*")
def pic_tags(text, final=True, line_start=True):
    """The photos a character meant to send, however they wrote them, and their words without them: (text, scenes).
    final: this is the whole reply (a tag cut off at the very end counts too). line_start: text starts a line of the
    reply (a "📸 …" or "Photo: …" line counts only there, never mid-line after a sentence)."""
    scenes = []
    def take(m):
        g = m.groupdict()
        if g.get("md") is not None:
            alt = " ".join(g["md"].split()).strip("\"'“”*_")
            scenes.append(alt if alt and not re.fullmatch(_PIC_WORD, alt, re.I) else "a casual selfie")
            return " "
        if g.get("line") is not None:
            scene = re.sub(r"\s+", " ", g["line"]).strip(" \t\"'“”*_")
            if (m.start() == 0 and not line_start) or _PIC_YOURS.search(scene) or not _scene_like(scene):
                return m.group(0)                     # ("Haha yes. 📸 moment", "📸 nice shot!", "Photos: love them")
            scenes.append(scene); return " "
        scene = _pic_scene(g["sq"] if g.get("sq") is not None else g["act"], square=g.get("sq") is not None)
        if scene is None:
            return m.group(0)
        scenes.append(scene); return " "
    for r in _PIC_TAGS[final]:
        text = r.sub(take, text)
    return re.sub(r"[ \t]{2,}", " ", text), scenes
# A photo tag still being written: the stream isn't split inside one, so it arrives whole ("[" always counts, see _chat).
_PIC_OPEN = re.compile(rf"(?:\(|\{{|<|【|(?<!\w)\*\*?(?![ \t])|(?<!\w)_(?![ \t]))[ \t]*(?:{_PIC_VERB}|{_PIC_LABEL})"
                       rf"(?:[^)}}>】*_\n]*\b{_PIC_WORD}\b[^)}}>】*_\n]*|[^)}}>】*_\n]{{0,40}})$", re.I)
                                    # (with a photo word, or still short: "(here's why: …" soon stops counting)
_PIC_STARTED = re.compile(rf"\[[ \t]*(?:[^\]\s]{{0,12}}|(?:{_PIC_VERB}|{_PIC_LEAD}{_PIC_WORD})[^\]]*)$", re.I)
def pic_open(text, line_start=True):
    """A photo has visibly started at the end of text and isn't finished: "[photo: me at", "*sends a selfie at",
    "(image: me", or a "📸 …" / "Photo: …" line still being written."""
    if _PIC_STARTED.search(text) or _PIC_OPEN.search(text):
        return True
    lines = text.rsplit("\n", 1)
    return (len(lines) > 1 or line_start) and bool(re.match(rf"[ \t]*(?:{_CAM}|{_PIC_WORD}[ \t]*:)", lines[-1], re.I))
_TAG_CUT = re.compile(rf"\[[ \t]*(?:\w+[ \t]*:|{_PIC_VERB}|{_PIC_LEAD}{_PIC_WORD})[^\]]*$", re.I)
def no_tags(text):
    """Without bracket tags ([react: …], [partner: …], stage directions), one being written that was cut off at the end
    ("[react: 😂" or "[photo: me at"; never an emoticon like ":[" with the rest of the text), or markdown."""
    return _TAG_CUT.sub("", re.sub(r"[*_#`]|\[[^\]]{0,300}\]", "", text))
# Photos you send: looked at only by a Tinfoil vision model through the verifying proxy (never Phala, NEAR or the image
# app), never used to make pictures, never in calls. Models that can look are found in Tinfoil's model list.
_no_vision = {}       # model -> back-off end (unix): a request with a picture to it failed
REFUSES_PICTURES = (400, 413, 415, 422)
def vision_failed(model, code=None):
    """A request with a picture to this model failed. It refuses pictures (400/413/415/422): not asked again for 6 h.
    Anything else (5xx, a timeout: Tinfoil or its proxy having a moment): a few minutes, so one hiccup doesn't leave
    every character unable to see photos for hours."""
    _no_vision[model] = time.time() + (6 * 3600 if code in REFUSES_PICTURES else 300)
PHOTO_EXPIRED = "that photo expired; attach it again"
# How long a texted reply should be, from what you sent: a few words get a few words back, like with a person.
DETAIL = re.compile(r"\b(?:explain|how (?:do|can|should|would|does) (?:i|you|it|we)|how to|why (?:is|are|do|does|did|would|"
                    r"should|not)|tell me (?:more|about|everything|all|how|what)|in detail|details?|step[- ]by[- ]step|"
                    r"steps|walk me through|help me (?:with|write|plan|figure|decide|understand)|write (?:me )?(?:a|an|the|"
                    r"my)|plan (?:for|my|a)|compare|pros and cons|recommend|advice|what should i|go deeper|longer)\b", re.I)
# A typed message that plainly asks for depth may let the model think first (see _chat): explicit asks only, never
# chit-chat like "why not", "how do i look", "what should i eat" or "tell me about your day" (DETAIL is only a length
# hint, and a false match there just allows a longer text; here it would cost time and thinking tokens).
DEEP = re.compile(r"\b(?:(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?explain|please\s+explain|"
                  r"explain\s+(?:to\s+me\s+)?(?:how|what|the\s+difference|why\s+(?!(?:you|u)\b))|walk me through|"
                  r"step[- ]by[- ]step|pros and cons|help me (?:decide|plan|write)|"
                  r"give me (?:some |your |any |good )?advice)\b", re.I)   # (never "explain yourself", "can't explain it")
def deep_question(text):
    t = str(text or "")
    return len(t.split()) >= 6 and bool(DEEP.search(t))
def length_hint(text, via):
    """One line for the end of the system prompt (texting only; calls have their own rule)."""
    if via == "call":
        return ""
    t = str(text or "")
    if DETAIL.search(t) or len(t) > 400:
        return LENGTH_HINTS["long"]
    w = len(t.split())
    if w <= 6:
        return LENGTH_HINTS["tiny"]
    return LENGTH_HINTS["short"] if w <= 30 else LENGTH_HINTS["medium"]
def long_enough(text, via):
    """Past this, a texted reply stops (at a sentence end): nobody sends a wall of texts unasked, and a few words get a
    few words back. (texts, words)"""
    t = str(text or "")
    if via == "call" or DETAIL.search(t) or len(t) > 400:
        return None
    w = len(t.split())
    return tuple(TEXT_CAPS["tiny" if w <= 6 else "short" if w <= 30 else "medium"])
REACTIONS = ("❤️", "😂", "👍", "😮", "😢", "🔥")      # the quick ones; any single emoji works
REACT_TAG = re.compile(r"\[react:\s*([^\]\s]{1,16})\s*\]", re.I)
_PICT = "\U0001F000-\U0001F1E5\U0001F200-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u00A9\u00AE\u203C\u2049\u2122\u2139\u3030\u303D\u3297\u3299"
ONE_EMOJI = re.compile(f"(?:[{_PICT}][\uFE0F\U0001F3FB-\U0001F3FF]*(?:\u200D[{_PICT}][\uFE0F\U0001F3FB-\U0001F3FF]*)*"
                       "|[0-9#*]\uFE0F?\u20E3|[\U0001F1E6-\U0001F1FF]{2})")
def reaction(e):
    """One emoji (any: with skin tones, joined ones like 👩‍💻, flags), however the model wrote it (❤ without its
    variation selector is ❤️), else None."""
    e = str(e or "").strip()
    quick = next((r for r in REACTIONS if e == r.replace("\ufe0f", "")), None)
    return quick or (e if 0 < len(e) <= 16 and ONE_EMOJI.fullmatch(e) else None)
def reacted_lately(cid, n=6):
    """They reacted to one of your last n messages: a real person doesn't react to everything. (This conversation only,
    since its last New chat: all phone mode has of it, wherever New chat was pressed.)"""
    t = [m for m in social.thread() if m.get("char", "buddy") == cid]
    t = t[max((i + 1 for i, m in enumerate(t) if m["role"] == "break"), default=0):]
    yours = [m["id"] for m in t if m["role"] == "user"][-n - 1:-1]          # (not the one being answered)
    return any(m["role"] == "reaction" and m.get("by") == cid and m.get("target") in yours for m in t)

def read(name, default=""):
    """Your own copy wins: persona.local.txt over persona.txt (local files are git-ignored, so updates keep them)."""
    stem, ext = os.path.splitext(name)
    for p in (os.path.join(HERE, stem + ".local" + ext), os.path.join(HERE, name)):
        if os.path.exists(p):
            return open(p).read().strip()
    return default

def local_cfg():
    try: return json.load(open(os.path.join(HERE, "config.local.json")))
    except Exception: return {}

def synced_by(path):
    """The cloud service that syncs this folder (and so could read what's in it), or "". Paths only, never contents."""
    home = os.path.expanduser("~")
    try: r = os.path.realpath(path)
    except OSError: return ""
    if r.startswith(home + "/Library/CloudStorage/"):        # Dropbox, Google Drive, OneDrive, Box... (macOS File Provider)
        name = re.split(r"[-_]", r[len(home) + 22:].split("/")[0])[0]
        return {"GoogleDrive": "Google Drive", "": "a cloud service"}.get(name, name)
    if r.startswith(home + "/Library/Mobile Documents/"):
        return "iCloud Drive"
    for d, name in (("Dropbox", "Dropbox"), ("Google Drive", "Google Drive"), ("OneDrive", "OneDrive"), ("Box", "Box")):
        if r == os.path.join(home, d) or r.startswith(os.path.join(home, d) + "/"):
            return name
    if any(r == os.path.join(home, d) or r.startswith(os.path.join(home, d) + "/") for d in ("Desktop", "Documents")) and \
            os.path.isdir(os.path.join(home, "Library/Mobile Documents/com~apple~CloudDocs/Documents")):
        return "iCloud Drive"                                # "Desktop & Documents" syncing is on
    p = r
    while p not in ("/", home, ""):                         # an old-style Dropbox folder anywhere
        if os.path.exists(os.path.join(p, ".dropbox")): return "Dropbox"
        p = os.path.dirname(p)
    return ""

def cfg():
    """Shipped defaults (config.json) overridden by your settings (config.local.json)."""
    try: c = json.load(open(os.path.join(HERE, "config.json")))
    except Exception: c = {}
    mine = local_cfg()
    if "pictures" not in mine and mine.get("images") == "off":   # (pictures were switched off before "pictures" existed)
        mine = {**mine, "pictures": "off"}
    return {**c, **mine}

_cfg_lock = threading.Lock()
def save_cfg(**changes):
    """Settings changes go only to config.local.json, never to the tracked defaults."""
    with _cfg_lock:
        c = {**local_cfg(), **changes}
        tmp = os.path.join(HERE, "config.local.json.tmp")
        with open(tmp, "w") as f: json.dump(c, f, indent=2)      # (a failed last write raises here, before the swap)
        os.replace(tmp, os.path.join(HERE, "config.local.json"))

def post(url, key, body, ctype="application/json", timeout=120):
    if url.startswith(PHALA):                       # only ever a Phala model that runs in an enclave (is_tee)
        j = json.loads(body) if ctype == "application/json" else {}
        if not j.get("model") or not images.phala_tee(j["model"], key):
            raise RuntimeError("that Companion model isn't confirmed to run in Phala's enclave, so nothing was sent")
        # and Phala's gateway must route it to attested hardware with no data kept (else it refuses, never falls back)
        j["provider"] = {**(j.get("provider") or {}), "aci_verified": True, "zdr": True}
        body = json.dumps(j).encode()
    elif url.startswith(CLOUDFLARE):                # the free brain: only while you have it on, and only chat text
        try: j = json.loads(body) if ctype == "application/json" else None
        except ValueError: j = None
        if not (cfg().get("free_brain") is True and isinstance(j, dict) and not has_media(j)
                and re.fullmatch(r"[0-9a-f]{32}/ai/v1/chat/completions", url[len(CLOUDFLARE):])):
            raise RuntimeError("that isn't something the free brain may get, so nothing was sent")
    elif not localcheck._local(urllib.parse.urlparse(url).hostname):
        raise RuntimeError("Buddy doesn't send anything there, so nothing was sent")   # (the allowlist, in code)
    localcheck.check(url)                           # the Tinfoil Proxy really is yours, not another account's
    req = urllib.request.Request(url, data=body, method="POST",
        headers={"Authorization": "Bearer " + key, "Content-Type": ctype})
    tin = not url.startswith(PHALA) and not url.startswith(CLOUDFLARE)   # (credits are Tinfoil's: billing.py)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        if tin: billing.refused(e)                  # (your Tinfoil credits ran out, or the key's spend limit: billing.py)
        raise
    if tin: billing.worked()
    return r

def has_media(j):
    """A request carries something other than text (a picture, audio, a file)."""
    def text_only(m):
        c = m.get("content") if isinstance(m, dict) else 0
        return c is None or isinstance(c, str) or (isinstance(c, list) and
                                                   all(isinstance(p, dict) and p.get("type") == "text" for p in c))
    msgs = j.get("messages")
    return not isinstance(msgs, list) or not all(text_only(m) for m in msgs)

# ---------- the free brain (Less private, opt-in): Cloudflare Workers AI ----------
class FreeError(RuntimeError):
    """Said to you as it is, in a chat and in a call (the free brain's limit or key, or a private chat it can't take)."""

PRIVATE_NOT_FREE = ("Private chats never go to the free brain: they need Tinfoil's sealed enclave, and there's no Tinfoil "
                    "key on your Mac, so this wasn't sent. To chat privately, add one on your Mac (Settings → Brain).")
FREE_MEMORY = ("Right now you don't have my notes or the facts I keep, only this conversation: if I ask what you know or "
               "remember about me, answer only from what we've said here, and never make anything up.")

def or_private():
    """The way back to Private, offered only when it would work (there's a Tinfoil key)."""
    return ", or switch Brain to Private." if read(".tinfoil_key") else "."

def free_key():
    """(account id, API token) from .cloudflare_key, or None. (Never returned to a page or written to a log.)"""
    acct, _, token = read(".cloudflare_key").partition(":")
    return (acct, token) if re.fullmatch(r"[0-9a-f]{32}", acct) and token else None

def free_on(c=None):
    """You chose the free brain (Settings → Brain; off unless you turned it on) and its key is here."""
    return (c or cfg()).get("free_brain") is True and free_key() is not None

def free_since(c=None):
    """When you last turned the free brain on: it's only ever given what was said from then on (social.for_free)."""
    t = (c or cfg()).get("free_since")
    if isinstance(t, bool) or not isinstance(t, (int, float)):
        t = time.time(); save_cfg(free_since=t)       # (turned on before Buddy kept this: from now on)
    return t

def free_model(c=None):
    now = time.time()
    order = [m for m in [(c or cfg()).get("free_model")] + FREE_MODELS if m and _free["gone"].get(m, 0) < now]
    return order[0] if order else FREE_MODELS[0]

def free_back_at():
    """When the free allowance comes back: 00:00 UTC, as this Mac's clock shows it."""
    return (datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            + datetime.timedelta(days=1)).timestamp()

def free_used_up():
    then = datetime.datetime.fromtimestamp(_free["limited"]).strftime("%H:%M")
    return (f"Today's free replies are used up (Cloudflare's daily limit). They come back at {then}. To keep talking "
            "now, " + ("switch Brain to Private in Settings (Tinfoil, paid)." if read(".tinfoil_key")
                       else "add a Tinfoil key on your Mac (Settings → Brain; private, paid)."))

def free_failed(e, model):
    """What to tell you when the free brain didn't answer: plainly, and nothing is sent to a paid brain instead."""
    code = getattr(e, "code", None)
    said = billing.said(e) if isinstance(e, urllib.error.HTTPError) else ""   # (read once, kept on the error)
    if code == 429 and re.search(r"3036|daily free allocation|neurons", said, re.I):
        _free["limited"] = free_back_at()
        return free_used_up()
    if code == 429:
        return "Cloudflare's free brain is busy right now. Try again in a minute."
    if code in (403, 404, 400) and re.search(r"5035|5007|3042|paid plan|no such model|model name is invalid", said, re.I):
        _free["gone"][model] = time.time() + 6 * 3600     # (that model isn't free, or isn't there: the next one next time)
        return "Cloudflare's free model wasn't available. Try again: Buddy will use another one."
    if code in (401, 403):
        return ("Cloudflare didn't accept your free key (account ID and token). Check it on your Mac: Settings → Brain → "
                "Free" + or_private())
    if code:
        return f"Cloudflare's free brain answered with an error ({code}). Try again in a bit."
    if isinstance(e, OSError):
        return "Can't reach Cloudflare's free brain right now. Check your internet connection and try again."
    return "Cloudflare's free brain sent an answer Buddy couldn't read. Try again?"

_models = {"at": 0, "ttl": 0, "ids": [], "meta": {}}
def tinfoil_models():
    """Model ids Tinfoil serves right now (asked through the verified proxy; every 6 h, or a minute after a failure)."""
    if time.time() - _models["at"] < _models["ttl"]:
        return _models["ids"]
    try:
        u = tinfoilproxy.url() + "/models"; localcheck.check(u)
        req = urllib.request.Request(u, headers={"Authorization": "Bearer " + read(".tinfoil_key")})
        data = [m for m in json.loads(urllib.request.urlopen(req, timeout=10).read())["data"] if isinstance(m, dict)]
        _models.update(at=time.time(), ttl=6 * 3600, ids=[m["id"] for m in data],   # (and which ones can look at pictures)
                       meta={m["id"]: {k: m[k] for k in ("multimodal", "type") if k in m} for m in data})
    except Exception:
        _models.update(at=time.time(), ttl=60)
    return _models["ids"]

def vision_models():
    """Tinfoil models that can look at a photo right now, best first ([] without a Tinfoil key or model list)."""
    if not read(".tinfoil_key"):
        return []
    ids, meta = tinfoil_models(), _models.get("meta") or {}
    if any("multimodal" in v for v in meta.values()):
        vis = [i for i in ids if meta.get(i, {}).get("multimodal") is True and meta.get(i, {}).get("type", "") in ("", "chat")]
    else:                                             # (newer proxies list ids only)
        vis = [m for m in VISION_ORDER if m in ids]
    now = time.time()                                 # (never one that always thinks: slow, and it can spend all its
    vis = [m for m in vis if _no_vision.get(m, 0) < now and m not in ALWAYS_THINKS]   # words on thinking)
    return sorted(vis, key=lambda m: VISION_ORDER.index(m) if m in VISION_ORDER else len(VISION_ORDER))

def describe(view):
    """A private look at a photo you sent: a Tinfoil vision model (in its enclave, through the verifying proxy)
    describes it in a few plain sentences. -> (description, model), or ("", None) if nobody can look right now."""
    pic = "data:image/jpeg;base64," + base64.b64encode(view).decode()
    for m in vision_models():
        body = {"model": m, "temperature": 0.2, "max_tokens": 300, "messages": [{"role": "user", "content": [
            {"type": "text", "text": DESCRIBE}, {"type": "image_url", "image_url": {"url": pic}}]}]}
        extra = NO_THINKING.get(m, {}) if m not in _thinking_refused else {}
        try:
            try:
                r = post(tinfoil() + "/chat/completions", read(".tinfoil_key"), json.dumps({**body, **extra}).encode(), timeout=60)
            except urllib.error.HTTPError as e:
                if e.code != 400 or not extra: raise
                r = post(tinfoil() + "/chat/completions", read(".tinfoil_key"), json.dumps(body).encode(), timeout=60)
            with r:
                txt = (json.loads(r.read())["choices"][0]["message"]["content"] or "")
            txt = re.sub(r"\s+", " ", re.sub(r"<think>.*?</think>", "", str(txt), flags=re.S)).strip()[:600]
            if txt:
                return txt, m
        except urllib.error.HTTPError as e:
            vision_failed(m, e.code)
            if e.code not in REFUSES_PICTURES:           # (5xx: most likely Tinfoil itself, not this model: stop here)
                break
        except RuntimeError:                             # (no key, or the proxy isn't verified yet: nobody can look)
            break
        except OSError:                                  # timed out, or no connection: the same, briefly
            vision_failed(m); break
        except Exception:                                # an answer it couldn't make sense of: the next one tries
            pass
    return "", None

def tinfoil():
    """Tinfoil's verified base URL, or a clear reason why not (no key yet, or not verified)."""
    if not read(".tinfoil_key"):
        raise RuntimeError("Buddy has no Tinfoil key yet: add it on your Mac (Settings → Brain)")
    tinfoilproxy.start()                              # (a key set from Terminal while Buddy runs: start verifying now)
    return tinfoilproxy.url()

_stt_down = {"at": 0}                              # when Whisper last failed that way: Voxtral for 10 minutes
# A refused transcription that's about the model, not the sound ("model 'x' not found", "unknown model"): a 400 is
# otherwise the sound (too short, only noise), so the list of models is fetched again only for these.
WHISPER_GONE = re.compile(r"model\W[^\n]{0,80}?(?:not.found|does ?n[o']t exist|not available|unavailable|not supported|"
                          r"unsupported|retired|deprecated)|model_not_found|(?:unknown|invalid|unsupported|no such)\W+model", re.I)
def whisper_said(e):
    """Why Tinfoil refused a transcription (its error text, read once; never anything you said)."""
    if not hasattr(e, "said"):
        try: e.said = e.read(2000).decode(errors="ignore")
        except Exception: e.said = ""
    return e.said

def tts_wav(text, voice):
    """Their voice as a WAV file (for a voice message they send): Tinfoil's enclave, like every voice."""
    voice = voice if voice in characters.VOICE_IDS else cfg().get("voice", "casual_female")
    model = "qwen3-tts" if voice[:1].isupper() else "voxtral-tts"
    body = json.dumps({"model": model, "voice": voice, "input": spoken(text)[:1500], "response_format": "wav"}).encode()
    with post(tinfoil() + "/audio/speech", read(".tinfoil_key"), body, timeout=90) as r:
        data = r.read()
    if images.audio_mime(data) != "audio/wav":
        raise RuntimeError("the voice didn't come back as a recording")
    return data

def wav_seconds(data):
    try:
        rate, bits, ch = int.from_bytes(data[24:28], "little"), int.from_bytes(data[34:36], "little"), int.from_bytes(data[22:24], "little")
        at = data.find(b"data"); size = int.from_bytes(data[at + 4:at + 8], "little")
        if size in (0, 0xFFFFFFFF): size = len(data) - at - 8   # (streamed files leave the size open)
        return round(size / (rate * ch * bits / 8), 1)
    except Exception:
        return 0

class Unclear(Exception):
    """Whisper got stuck repeating itself: nothing usable was heard."""

def looping(text):
    """Whisper stuck in a loop ("very, very, very, ..."): a unit of 1-4 words 6+ times in a row, or 20+ words of which
    under a fifth are different. What people say ("no, no, no", "ha ha ha ha", "bye bye") never counts."""
    w = re.findall(r"\w+", text.lower())
    if len(w) >= 20 and len(set(w)) < 0.2 * len(w):
        return True
    for n in range(1, 5):
        run = 0
        for i in range(n, len(w)):
            run = run + 1 if w[i] == w[i - n] else 0
            if run >= 5 * n:
                return True
    return False

def whisper(data, ct, char, hint="", context=""):
    """Words in a recording (Whisper in Tinfoil's enclave), asked plainly as when calls first understood you (Oct 8):
    the character's name as the prompt (names spelled right) and your `language` setting if you set one. hint (the
    device's language) and context (what they just said) are never sent: hints like that made Whisper loop
    ("very, very, very, ..."); context only drops a transcript that is just their own words back. A transcript stuck in
    a loop raises Unclear. Voxtral only when Whisper itself fails (missing, a 5xx, no answer). Raises urllib's HTTPError
    as it answered (e.gone: no model to hear with), RuntimeError when Tinfoil can't be reached."""
    ext = {"audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg"}.get(ct, "mp4")
    lang = str(cfg().get("language") or "")
    context = " ".join(spoken(context).split())[-160:]
    def once(model, lang=lang, prompt=True):
        fields = {"model": model, "prompt": f"{char['name']}." if char and prompt else "", "language": lang}
        b = uuid.uuid4().hex
        body = "".join(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n" for k, v in fields.items() if v)
        body = (body + f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.{ext}\"\r\n"
                f"Content-Type: {ct}\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
        with post(tinfoil() + "/audio/transcriptions", read(".tinfoil_key"), body,
                  f"multipart/form-data; boundary={b}", timeout=30) as r:
            return json.loads(r.read()).get("text", "").strip()
    def heard(model):
        try:
            return once(model)
        except urllib.error.HTTPError as e:
            why = whisper_said(e)
            if lang and e.code in (400, 422) and "language" in why.lower():
                return once(model, "")                # a language setting it doesn't know: without it
            if e.code in (400, 422) and "prompt" in why.lower():
                return once(model, lang, False)       # a model that takes no prompt: without it
            raise
    def new_words(text):
        if looping(text):
            raise Unclear("Whisper repeated itself")
        if context and len(text) > 12 and text.lower().strip(" .!?…") in context.lower():
            return ""                                 # (only their own words back: Whisper heard nothing new)
        return text
    model = stt_model()
    other = STT_NEXT if model == STT else STT if model == str(cfg().get("stt_model") or "") else None
    try:
        try:
            return new_words(heard(model))
        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            broken = (not isinstance(e, urllib.error.HTTPError) or e.code == 404 or e.code >= 500
                      or (e.code in (400, 422) and WHISPER_GONE.search(whisper_said(e))))
            if other is None or not broken:
                raise
            if model == STT:
                _stt_down["at"] = time.time()         # Whisper itself failed: Voxtral, now and for a while
            try:                                      # (the one in the stt_model setting failed: Whisper this time)
                return new_words(heard(other))
            except urllib.error.HTTPError as e2:
                if e2.code == 404 or (e2.code in (400, 422) and WHISPER_GONE.search(whisper_said(e2))):
                    e2.gone = True
                raise
    except urllib.error.HTTPError as e:
        if e.code == 404 or (e.code in (400, 422) and WHISPER_GONE.search(whisper_said(e))):
            e.gone = True
        raise
    except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
        raise RuntimeError("can't reach Tinfoil right now") from e

def stt_model():
    """What hears you: Whisper (or the model in the `stt_model` setting, e.g. to compare what another one costs),
    unless Whisper failed as missing or broken in the last 10 minutes (then Voxtral)."""
    chosen = str(cfg().get("stt_model") or "")
    if chosen and chosen != STT and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", chosen):
        return chosen
    return STT_NEXT if time.time() - _stt_down["at"] < 600 else STT

def pick_model(preferred, fallbacks, spoken=False):
    ids = tinfoil_models()
    order = [m for m in [preferred] + fallbacks if m and (not ids or m in ids)]
    if spoken:                                        # out loud: a model that always thinks first only as a last resort
        order = [m for m in order if m not in ALWAYS_THINKS] + [m for m in order if m in ALWAYS_THINKS]
    return order[0] if order else preferred

def companion_provider(c=None):
    """Companion runs on Tinfoil (verified) unless you chose Phala (fully uncensored; trusted, not verified).
    Installs that already had a Phala key keep Phala until changed in Settings."""
    c = c or cfg()
    p = c.get("companion_provider") or ("phala" if read(".phala_key") else "tinfoil")
    return "phala" if p == "phala" and read(".phala_key") else "tinfoil"

def brain(mode, spoken=False, free_ok=False):
    """Returns (base_url, key, model, mode_used). Raises if Tinfoil's verified connection isn't ready.
    free_ok: this job may go to the free brain (everyday chats, calls, texts first, lives, new characters; never
    private chats or learning), which it then does only if you turned it on. Then it's the free brain or nothing:
    used up or without its key, it says so (FreeError) instead of quietly using a paid brain. A Companion you put on
    Phala stays on Phala (Settings says so)."""
    c = cfg()
    if mode == "companion" and companion_provider(c) == "phala":
        return PHALA, read(".phala_key"), c.get("companion_model"), "companion"
    if free_ok and c.get("free_brain") is True:
        if not free_key():
            raise FreeError("The free brain is on but its key is missing. Add it again on your Mac (Settings → Brain → "
                            "Free)" + or_private())
        if time.time() < _free["limited"]:
            raise FreeError(free_used_up())
        return (CLOUDFLARE + free_key()[0] + "/ai/v1", free_key()[1], free_model(c),
                "companion" if mode == "companion" else "advisor")
    if mode == "companion":
        return (tinfoil(), read(".tinfoil_key"), pick_model(c.get("companion_tinfoil_model"), COMPANION_MODELS, spoken),
                "companion")
    return tinfoil(), read(".tinfoil_key"), pick_model(c.get("advisor_model"), ADVISOR_MODELS, spoken), "advisor"

def alternate(msgs):
    """Strict user/assistant turns (some models reject two in a row): merge repeats, start with the user."""
    out = []
    for m in msgs:
        if m.get("role") not in ("user", "assistant") or not str(m.get("content", "")).strip():
            continue
        if out and out[-1]["role"] == m["role"]:
            out[-1] = {"role": m["role"], "content": out[-1]["content"] + "\n" + m["content"]}
        else:
            out.append({"role": m["role"], "content": m["content"]})
    if out and out[0]["role"] == "assistant":
        out.insert(0, {"role": "user", "content": "(earlier)"})
    return out

def since_last_talk(char, skip_newest=True):
    """A friend knows if it's been a while ("you've been quiet for two days").
    skip_newest: the newest message is the one being answered right now."""
    prev = [m for m in social.thread() if m["role"] in ("user", "assistant") and m.get("char", "buddy") == char
            and not m.get("pending_photo")]
    prev = prev[:-1] if skip_newest else prev
    if not prev:
        return ""
    last = max(reversed(prev), key=lambda m: m["ts"])    # (the newest time: phone-mode messages keep their own)
    gap = time.time() - last["ts"]
    if gap < 3 * 3600:
        return ""
    when = f"{int(gap // 3600)} hours" if gap < 2 * 86400 else f"{int(gap // 86400)} days"
    left = (" It was yours, and I never answered it." if last["role"] == "assistant" else " It was mine.")
    return (f"Our last message before this was {when} ago.{left} React to that the way you really would, in character:"
            " notice it (look who's back, where have you been, a bit hurt or just glad to hear from me), don't carry on"
            " as if no time passed; keep it light, no lecture." if not skip_newest or gap >= 6 * 3600
            else f"Our last message before this was {when} ago.{left}")

SNIP = re.compile(r"\[([^\n]{1,300})\]\n")      # each note snippet starts with "[its path]" (memory._chunks)

def sources_of(snippets):
    """Which notes and saved chats a reply was given: paths only (never what's in them), best first."""
    n = {}
    for s in snippets:
        m = SNIP.match(s)
        if m: n[m.group(1)[:200]] = n.get(m.group(1)[:200], 0) + 1
    return [{"kind": "chat" if p.startswith("chats/") else "note", "path": p, "n": k} for p, k in n.items()][:10]

def system_prompt(char, mode_used, user_text, chat_file, via="mac", proactive=False, used=None, asking=False, spoken=None,
                  photos=True, extra=(), length="", notes=True):
    """used: a list that gets what this reply was given (facts and note paths, for "notes used"). asking: you asked
    what they know about you (they answer from their facts only, no notes this time). photos: they may send a picture
    this turn (if a picture maker is ready). extra: lines for this turn only. notes=False (the free brain): none of
    your notes, saved chats or facts, and no folder names.
    What stays the same from turn to turn comes first and what changes every turn last, so Tinfoil can reuse the start
    of the prompt it has already read (cheaper, and the first word comes sooner). Phone mode builds the same prompt in
    the same order from its kit (web/direct.js)."""
    pub = edition.PUBLIC                                          # the public copy: Islamic guidelines, always (edition.py)
    parts = [characters.persona_of(char), f"Your name is {char['name']}. You are an adult.",
             edition.COMPANION if pub and mode_used == "companion" else read(f"mode_{mode_used}.txt"),
             style_text(via, spoken),
             PHOTOS + (" " + edition.PHOTOS if pub else "") if photos and via != "call" and images.find(cfg())
             else NO_PHOTOS,                              # (said plainly, so they never describe one instead)
             life_block(char, via)]
    known, fsrc = facts.for_prompt(char, user_text, call=via == "call", everything=asking) if notes else ([], [])
    if known:      # (their own facts and the shared ones, minus anything they mustn't know about; in a fixed order)
        parts.append(FACTS_HEAD + "\n" + "\n".join("- " + f for f in known) + "\n" + FACTS_RULE)
    parts.extend(extra)                                   # (from here on, what changes every turn)
    if asking and notes:
        parts.append(knows_ask(char, bool(known), via in ("call", "mac") if spoken is None else spoken))
    snippets = [] if asking or not notes else recall(char, user_text, chat_file, live=via == "call")
    if snippets:   # (what they mustn't know is simply kept out; the list itself is never shown to them)
        parts.append("Things you remember about me (from my notes and past chats):\n\n" + "\n\n---\n\n".join(snippets))
    if used is not None:
        used.extend(fsrc + sources_of(snippets))
    if pub:        # (after everything they were given, so nothing above changes it, whatever the settings say)
        c = cfg()
        parts.append(edition.HALAL + "\n" + edition.romance(c.get("has_partner"), c.get("partner_at"), time.time(),
                                                            bool(c.get("partner_noask")),
                                                            quiet=not notes))   # (the free brain never learns your status)
    now = datetime.datetime.now().strftime("%A %d %B %Y, %H:%M")
    parts.append(f"Right now it's {now}. {since_last_talk(char['id'], skip_newest=not proactive)}".strip())
    parts.append(length)                                  # (last: how long this reply should be)
    return "\n\n".join(p for p in parts if p)

def life_busy(char):
    """What they're in the middle of in their own day (an event that started in the last 90 minutes), or ""."""
    if not has_life(char):
        return ""
    now = time.time(); today = lives.life_date(now)
    d = lives.day(lives.load(char["id"]), today)
    done = [e for e in (d["events"] if d else []) if lives.happened(e, now)]
    if not done or done[-1]["kind"] not in ("work", "social", "hobby", "errand", "notable"):
        return ""
    return done[-1]["what"] if now - lives._ts(today, done[-1]["at"]) < 90 * 60 else ""

def reply_delay(char, via):
    """How long a real person would take to answer this text, in seconds (0: at once, with typing). Never in a call or
    with "real_timing" off. In the middle of a conversation: at once. After a quiet while, sometimes a few minutes (more
    after days of silence), longer when they're busy in their own day. At most 20 minutes."""
    if via == "call" or not cfg().get("real_timing", True):
        return 0
    prev = [m for m in social.thread() if m.get("char", "buddy") == char["id"] and m["role"] in ("user", "assistant")
            and not m.get("pending_photo")][:-1]          # (the newest is the one being answered)
    gap = time.time() - max(m["ts"] for m in prev) if prev else 0   # (the newest time: phone mode's come in later, older)
    if gap < 10 * 60:
        return 0
    p, lo, hi = (0.25, 40, 180) if gap < 2 * 3600 else (0.45, 60, 420) if gap < 86400 else (0.6, 120, 900)
    if life_busy(char):
        p, lo, hi = max(p, 0.7), lo + 240, hi + 480
    return min(1200, random.uniform(lo, hi)) if random.random() < p else 0
_late = {}            # char id -> when the reply that's on its way comes (a later text answers in it too)
_late_lock = threading.Lock()

_live = {}            # (device, char id) -> (stop, done): the call answer being made right now
_talked = [0.0]       # when a call, Buddy's voice or hearing was last used: the daily backup waits 5 minutes after
_call_seen = {}       # char id -> when a call with them last started or had a turn

def call_turn(cid):
    now = time.time()
    for k in [k for k, t in list(_call_seen.items()) if t < now - 600]: _call_seen.pop(k, None)
    _call_seen[str(cid)[:40]] = now

def on_call(cid):
    """On a call with this character: answering right now, or a turn in the last 2 minutes (a call has pauses)."""
    return any(k[1] == cid for k in list(_live)) or time.time() - _call_seen.get(cid, 0) < 120
_call_mem = {}        # (char id, what they may know) -> (time, snippets): in a call, the last full search
_call_mem_busy = set()

def recall(char, query, chat_file, live=False):
    """Notes this character may know that fit what we're on about. live (a call): no waiting on Tinfoil: keyword
    search now (on this Mac, milliseconds) plus the previous full search, which is refreshed in the background."""
    args = dict(k=cfg().get("memory_snippets", 5), exclude=chat_file, folders=characters.memory_folders(char),
                own=f"chats/{char['id']}", skip=characters.memory_skip(char), avoid=characters.avoid_terms(char))
    if not live:
        return memory.search(query, **args)
    cid = (char["id"], social.gen(char["id"]),     # (a deleted conversation's notes are never used again)
           json.dumps([args["folders"], args["skip"], args["avoid"]], sort_keys=True, default=str))
    def full():
        try: _call_mem[cid] = (time.time(), memory.search(query, embed_timeout=6, **args))
        except Exception: pass
        finally: _call_mem_busy.discard(cid)
    if cid not in _call_mem_busy:
        _call_mem_busy.add(cid); threading.Thread(target=full, daemon=True).start()
    now = memory.search(query, meaning=False, **args)
    hit = _call_mem.get(cid)
    old = hit[1] if hit and time.time() - hit[0] < 1800 else []
    return list(dict.fromkeys(now[:3] + old + now[3:]))[:args["k"]]

def warm_call(char_id):
    """A call is starting: get everything ready so the first answer doesn't wait (model list, the connection to
    Tinfoil, the notes for what you've been talking about)."""
    char = characters.get(char_id, cfg())
    try: tinfoil_models()
    except Exception: pass
    msgs = social.recent_messages(10, char=char["id"])
    query = " ".join(m["content"] for m in msgs[-5:] if m["role"] == "user")
    if query:
        recall(char, query, chat_path(char, datetime.date.today().isoformat()), live=True)

STOCK = {*GREETINGS, *FILLERS, *(line for lines in MISSED.values() for line in lines)}
_stock = {}                          # (voice, text) -> (type, audio): these few lines sound the same every time
_tts_stream_refused = set()

def chat_path(char, session):
    safe = re.sub(r"[^0-9A-Za-z_-]", "", session)[:40] or "chat"
    return os.path.join(CHATS, char["id"], f"{safe}.md")      # each character's chats in its own folder

def _append_chat(char, session, text, when=None):
    """when: what a new file's header says (a turn from phone mode: when it was said there)."""
    p = chat_path(char, session)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    new = not os.path.exists(p)
    with open(p, "a", encoding="utf-8") as f:
        if new:
            f.write(f"# Chat with {char['name']}, {when or datetime.datetime.now():%d %B %Y %H:%M}\n\n")
        f.write(text)

def save_turn(char, session, user_text, reply, mode_used, when=None):
    _append_chat(char, session, f"**Me:** {user_text}\n\n**{char['name']}** ({mode_used}): {reply}\n\n", when)

def photo_said(desc, text=""):
    """A photo in saved chats: words only ("[sent a photo: …]"), never the picture."""
    desc = re.sub(r"[\[\]\s]+", " ", str(desc or "")).strip()
    return (f"[sent a photo: {desc}]" if desc else "[sent a photo]") + (f" {text}" if text else "")

_jobs_lock = threading.Lock()   # a finished picture waits until its "sending a photo…" marker is up
def send_photo(char, scene, private=False, via=None, g=None, **extra):
    """A picture from a character, made in the background (one at a time on this Mac; minutes with a local model).
    Meanwhile every device shows "<Name> is sending a photo…"; then the photo (or a note that it failed) arrives in
    the conversation. Returns the stream line for the page, or None (refused, or nothing can make it right now)."""
    c = cfg()
    try:                                              # (the whole description is checked; a long one is shortened after)
        prompt = images.prompt_for(char.get("appearance", ""), scene, style=char.get("style"))
        if len(scene) > 600:
            scene = scene[:600].rsplit(" ", 1)[0]
            prompt = images.prompt_for(char.get("appearance", ""), scene, style=char.get("style"))
    except ValueError:
        return None                                   # only adults: no picture at all
    g = social.gen(char["id"]) if g is None else g
    where = {k: v for k, v in {"private": private or None, "via": via, **extra}.items() if v is not None}
    seed, t0, w, h = random.randrange(2 ** 31), time.time(), 768, 1024
    def done(res):
        with _jobs_lock:                              # (only waits for its marker to be up; nothing slow under this lock)
            pass
        m = None
        try:
            if res["ok"]:
                mid = images.save(res["data"], private=private)
                m = social.add("assistant", "", gen=g, image=mid, photo_desc=scene, job=res["job"], made_by=res["made_by"],
                               w=w, h=h, char=char["id"], **({"seed": seed} if res["made_by"] == "local" else {}), **where)
                if m is None:
                    images.remove(mid)                # its conversation was deleted while it was being made
            else:
                social.add("assistant", "", gen=g, photo_failed=True, job=res["job"], why=res["why"], char=char["id"], **where)
        finally:
            social.unmark(res["job"])
        if m is not None and not private and cfg().get("save_chats", True):
            try: _append_chat(char, datetime.date.today().isoformat(), f"**{char['name']}**: {photo_said(scene)}\n\n")
            except OSError: pass
        if m is not None and extra.get("delivered") == "phone" and time.time() - t0 > 60:
            who, body = social.preview(cfg(), char["name"], photo=True, private=private)
            social.push(note=body, contact=cfg().get("push_contact", "mailto:buddy@example.com"), title=who)
    with _jobs_lock:
        try:
            j = images.submit("photo", char["id"], prompt, w, h, seed, done, c)
        except RuntimeError as e:
            social.add("assistant", "", gen=g, photo_failed=True, why=images.why_not(c) if str(e) == "no picture maker"
                       else "too many pictures are being made; try later", char=char["id"], **where)
            return None
        # (a local job always ends within its 15 minutes, with the photo or a note; NEAR's check + picture within ~4)
        until = time.time() + (j["eta"] + 960 if j["provider"] == "local" else j["eta"] + 300)
        social.mark(char["id"], j["job"], j["eta"], until, **where)
    return {"photo": "pending", "job": j["job"], "eta": j["eta"], "until": until}

def follow_up(char, moment=False):
    """What an on-track character's text-first instruction gets added ("" for everyone else)."""
    return "\n" + (FOLLOW_UP_MOMENT if moment else FOLLOW_UP) if characters.keeps_on_track(char) else ""

def proactive_text(reason, idle):
    """One of the characters allowed to text first (you choose which) writes to you.
    Returns (character id, text, photo scene or None, what it was given): a photo is made afterwards, in the background."""
    c = cfg()
    allowed = [x for x in characters.all_characters(c) if x.get("texts_first")]
    if not allowed or billing.paused():               # (your Tinfoil credits ran out: background work waits a while)
        return None
    char = random.choice(allowed)
    txt, scene, given = first_text(char, PROACTIVE.format(reason=reason, idle=idle,
                                   now=datetime.datetime.now().strftime("%A %H:%M")) + follow_up(char), idle)
    return char["id"], txt, scene, given, on_phala(char)

def on_phala(char):
    """{"brain": "phala"} when this character's texts are written by Phala (a Companion put on Phala), else {}: the
    free brain is never given a conversation Phala had (social.for_free)."""
    return {"brain": "phala"} if char.get("brain") == "companion" and companion_provider() == "phala" else {}

def first_text(char, instruction, idle):
    """What a character texts you first, from an instruction. Returns (text, photo scene or None, what it was given)."""
    c = cfg()
    url, key, model, used = brain(char["brain"] if char["brain"] == "companion" else c.get("proactive_mode", "advisor"),
                                  free_ok=True)       # (never private: texts first only see everyday chats)
    given, free = [], url.startswith(CLOUDFLARE)
    since = free_since(c) if free else None           # (the free brain: only what was said since you turned it on)
    hint = " ".join(m["content"] for m in social.recent_messages(6, char=char["id"], since=since))
    sysmsg = system_prompt(char, used, hint or "recent plans, people, worries, events in my life", None,
                           via="phone" if idle >= 3 else "mac", proactive=True, used=given, notes=not free,
                           extra=[FREE_MEMORY] if free else ())
    txt = complete(url, key, {"model": model, "temperature": 1.0, "messages": [{"role": "system", "content": sysmsg}]
        + alternate(social.recent_messages(20, char=char["id"], since=since) + [{"role": "user", "content": instruction}])},
        cap=400, timeout=120)
    txt, scenes = pic_tags(txt)                       # (however they wrote a photo: never shown as words)
    txt = re.sub(r"[ \t]+", " ", no_tags(txt)).strip().strip('"').strip()
    return txt, scenes[0] if scenes else None, given

# ---------- their own lives (lives.py): one plan a day each, texts about moments in it ----------
_plan_lock = threading.Lock()         # one day is planned at a time

def has_life(char, c=None):
    return bool((c or cfg()).get("lives", True)) and char.get("life", True)

def life_chars(c=None):
    c = c or cfg()
    return [x for x in characters.all_characters(c) if x.get("life", True)] if c.get("lives", True) else []

def life_block(char, via):
    """Their own life for system_prompt (no model call; microseconds, fine in calls)."""
    c = cfg()
    if not has_life(char, c):
        return ""
    fr = [(o["name"], how, lives.load(o["id"])) for o, how in lives.ties(char["id"], life_chars(c))]
    return lives.context(lives.load(char["id"]), time.time(), short=via == "call", friends=fr,
                         avoid=characters.avoid_terms(char))

def own_lines(cid, date, since=None):
    """What this character told me (never private) on that day of their life: what they made up is now true.
    since (the free brain): only what social.for_free allows."""
    return [m["content"] for m in social.thread() if m.get("char", "buddy") == cid and m["role"] == "assistant"
            and not m.get("private") and m.get("content") and lives.life_date(m["ts"]) == date
            and (since is None or social.for_free(m, since))]

def plan_day(cid, lazy=False, asked=False):
    """Plans their day (one model call) if it's due: texting characters in the morning, the others on your first chat or
    call with them that day (lazy). asked: you asked for it (Redo today). True if a day was planned."""
    if any(on_call(x) for x in list(_call_seen) + [k[1] for k in list(_live)]):
        return False                                  # (never during a call: nothing may slow down hearing you)
    if billing.paused() and not asked:
        return False                                  # (your Tinfoil credits ran out: background work waits a while)
    if not _plan_lock.acquire(blocking=False):
        return False                                  # (another one is being planned; asked again next minute or chat)
    try:
        c = cfg(); char = characters.find(cid, c)
        if not char or not has_life(char, c):
            return False
        now, t = time.time(), social.thread()
        st, log = lives.thread_state(t, now), lives.load(cid)
        if not lives.needs_plan(log, char, c, now, st, lazy):
            return False
        lives.change(cid, lambda lg: lives.attempted(lg, now))
        chars = life_chars(c); w = lives.world()
        logs = {x["id"]: lives.load(x["id"]) for x in chars}
        today = lives.life_date(now)
        n = lives.quota(char, c, st["unanswered"].get(cid, 0)) if char.get("texts_first") and c.get("proactive", True) else 0
        if n == 2 and random.random() < 0.3: n = 3     # ("some": now and then a chattier day)
        others = [m["due"] for x, lg in logs.items() if x != cid for d in [lives.day(lg, today)] if d
                  for m in d["moments"] if m["state"] == "pending"]
        photos, rh = bool(images.find(c)), lives.rhythm(t, now)
        strangers = lives.undecided(cid, chars, w)
        url, key, model, _ = brain("companion" if char["brain"] == "companion" else "advisor", free_ok=True)
        phala, free = url.startswith(PHALA), url.startswith(CLOUDFLARE)   # (other characters' taglines are yours: only
        since = free_since(c) if free else None                           # to Tinfoil's enclave)
        prompt, _ = lives.plan_prompt(char, log, now, c, own_lines(cid, today - datetime.timedelta(days=1), since), n,
                                      photos, own_lines(cid, today, since),
                                      friends=lives.friends_text(cid, chars, logs, now, w, avoid=characters.avoid_terms(char)),
                                      strangers=[(x["name"], "" if phala or free else x.get("tagline", "")) for x in strangers],
                                      active="" if free else lives.active_text(rh, c), voice=True)   # (nor when you text)
        j = lives.parse(complete(url, key, {"model": model, "temperature": 0.9, "messages": [{"role": "user", "content": prompt}]},
                                 cap=1500))
        if not characters.find(cid, cfg()):
            return False                              # (deleted while it was being planned)
        lives.change(cid, lambda lg: lives.apply_plan(lg, j, char, time.time(), c, n, others, photos, rh=rh, voice=True))
        if strangers: lives.decide(cid, j, strangers)
        return True
    except Exception:
        return False                                  # (tried again in 20 minutes, at most 3 times a day)
    finally:
        _plan_lock.release()

def plan_soon(cid, lazy=True):
    threading.Thread(target=plan_day, args=(cid, lazy), daemon=True).start()

def life_tick(idle, came_back):
    """Every minute (social.start_proactive, outside quiet hours, texting first on): plan the days that are due, then
    send the moment that's due now, if any. Returns the messages sent."""
    if billing.paused():
        return []                                     # (your Tinfoil credits ran out: background work waits a while)
    c = cfg(); now = time.time()
    if c.get("free_brain") is True and now < _free["limited"]:
        return []                                     # (the free brain is used up for today: no moment is wasted on it)
    chars = {x["id"]: x for x in life_chars(c)}
    t = social.thread(); st = lives.thread_state(t, now)
    st["busy"] = st["busy"] or any(on_call(x) for x in chars)
    logs = {x: lives.load(x) for x in chars}
    for cid, ch in chars.items():
        if lives.needs_plan(logs[cid], ch, c, now, st):
            plan_soon(cid, lazy=False); break         # (one at a time; the next one next minute)
    cid, m, expired = lives.pick(logs, chars, now, c, st, ahead=3600 if came_back else 0)
    for x, mid in expired:
        lives.change(x, lambda lg, mid=mid: lives.mark(lg, lives.life_date(now).isoformat(), mid, "skipped"))
    if not cid:
        return []
    date = lives.life_date(now).isoformat()
    log = lives.change(cid, lambda lg: lives.mark(lg, date, m["id"], "skipped"))   # (never twice, even if writing fails)
    char = chars[cid]
    moment = lives.moment_prompt(log, date, m, now, photos=bool(images.find(c)))
    instruction = moment + follow_up(char, moment=True) if moment else PROACTIVE.format(
        reason="check in", idle=int(idle), now=datetime.datetime.now().strftime("%A %H:%M")) + follow_up(char)
    g = social.gen(cid)
    txt, scene, given = first_text(char, instruction, idle)
    if not txt and not scene:
        return []
    where = "mac" if idle < 3 else "phone"
    tag = {"proactive": True, "delivered": where, "char": cid, "life": f"{date}/{m['id']}"}
    sent, voice = [], None
    if m["angle"] == "voice" and txt:                 # a voice message, in their own voice
        try:
            wav = tts_wav(txt, char.get("voice"))
            voice = {"voice": images.save_audio(wav), "dur": wav_seconds(wav)}
        except Exception:
            voice = None
    parts = [txt] if voice else [p.strip() for p in re.split(r"\n\s*\n", txt) if p.strip()]
    parts = parts[:2] + ([" ".join(parts[2:])] if len(parts) > 2 else [])
    for i, p in enumerate(parts):
        if i: time.sleep(random.uniform(2.5, 6))      # (two quick texts in a row, like people send them)
        msg = social.add("assistant", p, gen=g, **tag, **(voice or {}), **({"sources": given} if given and not i else {}),
                         **on_phala(char))
        if msg is None:
            if voice: images.remove(voice["voice"])
            return sent                               # (that conversation was deleted meanwhile)
        sent.append(msg)
    if sent:
        lives.change(cid, lambda lg: lives.mark(lg, date, m["id"], "sent", sent[0]["id"]))
        if c.get("save_chats", True):
            try: _append_chat(char, datetime.date.today().isoformat(), f"**{char['name']}** (texted first): "
                              + ("🎤 " if voice else "") + " ".join(parts) + "\n\n")
            except OSError: pass
    if scene:
        proactive_photo(cid, scene, where)
    if sent and idle >= 3:
        who, body = social.preview(c, char["name"], " ".join(parts))
        social.push(note=body, contact=c.get("push_contact", "mailto:buddy@example.com"), title=who)
    return sent

def proactive_photo(char_id, scene, where):
    char = characters.find(char_id, cfg())
    if char and images.find(cfg()):
        send_photo(char, scene, proactive=True, delivered=where)

def complete(url, key, body, cap=None, timeout=180):
    """A question in the background (facts learning, a new character, a day's plan, a text first) -> the answer's text.
    On Tinfoil and the free brain it goes with thinking switched off where the model has a switch, and a generous cap on how long the
    answer may be (only for a model that won't think first, so the cap never eats the answer). A model that refuses
    those (HTTP 400) is asked again without them; an answer the cap cut off is asked for again without the cap."""
    model, extra = body.get("model"), {}
    if not url.startswith(PHALA) and model not in _thinking_refused:
        extra = dict(NO_THINKING.get(model, {}))
        if cap and model not in ALWAYS_THINKS and (extra or model not in NO_THINKING):
            extra["max_tokens"] = cap
    def once(b):
        with post(url + "/chat/completions", key, json.dumps(b).encode(), timeout=timeout) as r:
            ch = json.loads(r.read())["choices"][0]
        return ch["message"]["content"] or "", ch.get("finish_reason")
    if not extra:
        return once(body)[0]
    try:
        txt, why = once({**body, **extra})
    except urllib.error.HTTPError as e:
        if e.code != 400: raise
        txt = once(body)[0]
        _thinking_refused.add(model)                  # it doesn't take those switches (asked plainly, it works)
        return txt
    if why == "length" and "max_tokens" in extra:     # (longer than the cap after all: never a cut-off answer)
        txt = once({**body, **{k: v for k, v in extra.items() if k != "max_tokens"}})[0]
    return txt

def ask(prompt, temperature=0.9, cap=None, free_ok=False):
    """A one-off question to the Advisor brain (Tinfoil enclave; free_ok: or the free brain, if it's on). cap: how long
    the answer may be (see complete)."""
    url, key, model, _ = brain("advisor", free_ok=free_ok)
    return complete(url, key, {"model": model, "temperature": temperature,
                               "messages": [{"role": "user", "content": prompt}]}, cap=cap)

def learn_ask(prompt):
    """Facts learning (facts.py): the Advisor on Tinfoil only, careful, a short JSON answer."""
    return ask(prompt, 0.2, cap=800)

# ---------- phone mode: the phone talks to Tinfoil itself while this Mac can't be reached (web/direct.js) ----------
# GET /api/phonekit gives a paired phone what it needs to answer like this Mac; POST /api/thread/import brings back what
# was said there. Never in the kit: keys, notes, knowledge settings, avoid lists, looks, private messages.
SHELL_FILES = ("chat.html", "sw.js", "manifest.json", "pcm-tap.js", "direct.js", "vendor/tinfoil.mjs",
               "default-icons/icon-180.png", "default-icons/icon-192.png", "default-icons/icon-512.png")   # (the app
IMPORT_MAX_ITEMS, IMPORT_MAX_BYTES = 200, 24_000_000                       # code the phone keeps: web/sw.js's SHELL)
CID = re.compile(r"[A-Za-z0-9_-]{16,64}")               # the phone's own id for a message it wrote (dedupes retries)
TZ_RE = re.compile(r"[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+){0,2}")
SEEN_BY = re.compile(r"[A-Za-z0-9._:/@+-]{1,80}")

PHONE_FREE = ("Phone mode is off: it only ever uses Tinfoil (private, paid), never the free brain, and Buddy is set to "
              "the free brain without a Tinfoil key. To use phone mode, add a Tinfoil key on your Mac (Settings → Brain).")

def phone_free(c=None):
    """You chose the free brain and there's no Tinfoil key on this Mac: phone mode, which is Tinfoil only, stays off."""
    return (c or cfg()).get("free_brain") is True and not read(".tinfoil_key")

def kit_edition(c, parts):
    """The public edition's rules for phone mode (parts: kitparts.edition_parts, exactly as system_prompt adds them:
    HALAL, the Companion's text and every romance() variant, the phone picking one by your status as romance() does),
    and your relationship status. The private edition: nothing but that it isn't the public one."""
    if not parts["public"]:
        return {"public": False}
    at = c.get("partner_at")
    at = float(at) if isinstance(at, (int, float)) and math.isfinite(float(at)) else None
    return {**{k: parts[k] for k in ("public", "halal", "companion", "recheck", "romance")},
            "partner": {"has": c.get("has_partner") if c.get("has_partner") in ("yes", "no") else "", "at": at,
                        "noask": bool(c.get("partner_noask"))}}

def phonekit(have="", now=None):
    """What a phone needs to answer like this Mac while the Mac is away (phone mode): no keys, no notes, no avoid
    lists, no settings it doesn't use. kit: changes rarely (etag); context: each character's current conversation."""
    now = time.time() if now is None else now
    c = cfg(); chars = characters.all_characters(c); lc = life_chars(c)
    kc = []
    for x in chars:
        own, shared = facts.visible(x)                   # (already without what it mustn't know about)
        life = None
        if has_life(x, c):
            avoid = characters.avoid_terms(x)            # (friends' days reach it without those too)
            life = {"log": lives.slim(lives.load(x["id"]), now),
                    "friends": [{"id": o["id"], "name": o["name"], "how": how,
                                 "log": lives.slim(lives._without(lives.load(o["id"]), avoid), now, friend=True)}
                                for o, how in lives.ties(x["id"], lc)[:4]]}
        kc.append({"id": x["id"], "name": x["name"], "tagline": x.get("tagline", ""), "color": x["color"],
                   "avatar": x.get("avatar", 0), "wallpaper": x.get("wallpaper", 0), "builtin": bool(x.get("builtin")),
                   "brain": x["brain"], "voice": x["voice"], "persona": characters.persona_of(x),
                   "facts": {"own": [{"text": f["text"], "date": f["date"]} for f in own],
                             "shared": [{"text": f["text"], "date": f["date"]} for f in shared]},
                   "knows_ask": {"phone": {"have": knows_ask(x, True, False), "none": knows_ask(x, False, False)},
                                 "call": {"have": knows_ask(x, True, True), "none": knows_ask(x, False, True)}},
                   "life": life})
    tz = lives.tz_name().lstrip(":")
    stt = str(c.get("stt_model") or "")
    s = kitparts.static_kit("public" if edition.PUBLIC else "private")   # (what isn't yours: the same for every Mac)
    ms = s["models"]
    kit = {"v": s["v"], "name": c.get("name", "Buddy"), "tz": tz if TZ_RE.fullmatch(tz) else "",
           "see_photos": bool(c.get("see_photos", True)), "companion_on_phala": companion_provider(c) == "phala",
           "chars": kc, "voices": s["voices"],
           "voice": {"default": c.get("voice", "casual_female"), "ids": s["voice"]["ids"]},
           "prompts": {"modes": {m: read(f"mode_{m}.txt") for m in ("advisor", "companion")},   # (your own copy wins)
                       **{k: s["prompts"][k] for k in kitparts.PHONE_PROMPTS}},
           "facts_paths": s["facts_paths"],
           "models": {"advisor": {"preferred": c.get("advisor_model"), **ms["advisor"]},
                      "companion": {"preferred": c.get("companion_tinfoil_model"), **ms["companion"]},
                      **{k: v for k, v in ms.items() if k not in ("advisor", "companion")}},
           "tinfoil": {"ids": list(_models["ids"]), "meta": dict(_models.get("meta") or {})},   # (as last fetched;
           "stt": {"language": str(c.get("language") or ""),                                  # never fetched here)
                   "model": stt if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", stt) else ""},     # (the stt_model setting)
           "call": s["call"], "texting": s["texting"],
           "edition": kit_edition(c, s["edition"]), "billing": {k: s["billing"][k] for k in ("out", "limit")}}
    etag = hashlib.sha256(json.dumps(kit, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:32]
    return {"v": 1, "etag": etag, "kit": None if have == etag else kit, "generated_at": now,
            "context": social.phone_context([x["id"] for x in chars])}   # (one locked read: epochs match messages)

def _b64(s, limit):
    """Base64 text -> bytes; None if it isn't valid base64 or would be over limit bytes (checked before decoding)."""
    if not isinstance(s, str) or len(s) > (limit + 2) // 3 * 4:
        return None
    try: return base64.b64decode(s, validate=True)
    except ValueError: return None

def _check_import(it, chars, now):
    """One message from a phone -> (None, normalised item) or (why it's dropped, None). The first failing check wins."""
    if not isinstance(it, dict) or not isinstance(it.get("cid"), str) or not CID.fullmatch(it["cid"]):
        return "bad id", None
    if it.get("private"):                                # (the phone never sends them; private never leaves memory)
        return "private", None
    role = it.get("role")
    if role not in ("user", "assistant", "break", "reaction"):
        return "bad role", None
    char = chars.get(it.get("char")) if isinstance(it.get("char"), str) else None
    if not char:
        return "no such character", None
    if "content" in it and not isinstance(it["content"], str):
        return "bad content", None
    text, photo, voice = (it.get("content") or "").strip(), it.get("photo"), it.get("voice")
    if not text and (role == "assistant" or (role == "user" and photo is None and voice is None)):
        return "empty", None
    ts = it.get("ts")
    if isinstance(ts, bool) or not isinstance(ts, (int, float)) or (isinstance(ts, float) and not math.isfinite(ts)) \
            or ts <= 0:
        return "bad time", None
    if ts < now - 400 * 86400:
        return "too old", None
    if isinstance(it.get("epoch"), bool) or not isinstance(it.get("epoch"), int):
        return "bad epoch", None
    x = {"cid": it["cid"], "role": role, "char": char["id"], "ts": min(ts, now), "epoch": it["epoch"],
         "content": text[:4000] if role == "user" else text[:20000] if role == "assistant" else ""}
    if photo is not None:                                # checked and stripped again, like an upload from the page
        if role != "user" or not isinstance(photo, dict):
            return "bad photo", None
        full, view = _b64(photo.get("full"), 12_000_000), _b64(photo.get("view"), 3_000_000)
        try:
            if full is None or view is None: raise ValueError("not base64")
            full, (w, h) = images.clean_photo(full, 4096, 12_000_000)    # (the size comes from the photo itself)
            view, _ = images.clean_photo(view, 1536, 3_000_000)
        except Exception:
            return "bad photo", None
        x["_photo"] = (full, view, w, h)
        desc = re.sub(r"\s+", " ", str(it["photo_desc"])).strip()[:600] if it.get("photo_desc") is not None else ""
        if desc:
            x["photo_desc"] = desc
            if isinstance(it.get("seen_by"), str) and SEEN_BY.fullmatch(it["seen_by"]): x["seen_by"] = it["seen_by"]
        elif it.get("seen") is False:
            x["seen"] = False
    if voice is not None:
        dur = voice.get("dur") if isinstance(voice, dict) else None
        if role not in ("user", "assistant") or not isinstance(voice, dict) or \
                (dur is not None and (isinstance(dur, bool) or not isinstance(dur, (int, float)))):
            return "bad voice", None
        data = _b64(voice.get("data"), 12_000_000)
        if not data or len(data) > 12_000_000 or not images.audio_mime(data):
            return "bad voice", None
        x["_voice"] = (data, wav_seconds(data) if images.audio_mime(data) == "audio/wav"
                       else float(max(0, min(dur or 0, 600))))     # (0-600 s; NaN or a huge number can't break it)
    if role == "reaction":
        by, e, tgt, tcid = it.get("by"), it.get("emoji"), it.get("target"), it.get("target_cid")
        rx = "" if e == "" else reaction(e)
        to_id = isinstance(tgt, int) and not isinstance(tgt, bool)
        to_cid = isinstance(tcid, str) and bool(CID.fullmatch(tcid))
        if by not in ("you", char["id"]) or rx is None or (rx == "" and by != "you") or not (to_id or to_cid):
            return "bad reaction", None
        x.update(emoji=rx, by=by, **({"target_cid": tcid} if to_cid else {"target": tgt}))
    if role in ("user", "assistant") and it.get("call") is True:
        x["call"] = True
    if role == "assistant":
        x["mode"] = it["mode"] if it.get("mode") in ("advisor", "companion") else char["brain"]
        if isinstance(it.get("reply_to"), str) and CID.fullmatch(it["reply_to"]):
            x["reply_to"] = it["reply_to"]
        src = [{"kind": "facts", "path": s["path"], "n": s["n"]} for s in
               (it["sources"] if isinstance(it.get("sources"), list) else [])
               if isinstance(s, dict) and s.get("kind") == "facts" and isinstance(s.get("path"), str)
               and len(s["path"]) <= 200 and isinstance(s.get("n"), int) and not isinstance(s["n"], bool)
               and 0 <= s["n"] <= 1000][:10]
        if src: x["sources"] = src
        if it.get("knows") is True: x["knows"] = True
    return None, x

def check_imports(raw, c):
    """-> (results, good): results has one entry per item, None where it's good, else {"cid", "dropped": why};
    good = [(index, normalised item)], media decoded and cleaned again (never trusted from the phone)."""
    now, chars = time.time(), {x["id"]: x for x in characters.all_characters(c)}
    results, good = [None] * len(raw), []
    for i, it in enumerate(raw):
        if isinstance(it, dict) and it.get("role") == "partner":
            continue                                     # (your relationship status, not a message: import_partner)
        why, x = _check_import(it, chars, now)
        if why:
            ok = isinstance(it, dict) and isinstance(it.get("cid"), str) and CID.fullmatch(it["cid"])
            results[i] = {"cid": it["cid"] if ok else None, "dropped": why}
        else:
            good.append((i, x))
    return results, good

_looks = {}   # message id -> a look still running at an imported photo (its reply may come in a later request)

def start_looks(added, c):
    """Photos from phone mode that nobody looked at yet (the look was still running there, or the app was closed): the
    same private look _chat starts, in the background. -> {message id: {"done", "desc"}}."""
    looks = {}
    for it, m in added:
        if m["role"] != "user" or not m.get("image") or m.get("photo_desc") or "seen" in m:
            continue
        if not c.get("see_photos", True):                # (sending photos is off: nobody looks)
            social.update(m["id"], seen=False); continue
        look = looks[m["id"]] = _looks[m["id"]] = {"done": threading.Event(), "desc": ""}
        def looker(view=it["_photo"][1], mid=m["id"], look=look):
            model = None
            try: look["desc"], model = describe(view)
            except Exception: pass
            finally: look["done"].set()
            try: social.update(mid, **({"photo_desc": look["desc"], "seen_by": model} if look["desc"] else {"seen": False}))
            finally: _looks.pop(mid, None)               # (after the update: a later reply reads it from the thread)
        threading.Thread(target=looker, daemon=True).start()
    return looks

def save_imported(added, c, looks):
    """Saved chats for phone-mode turns, like _chat saves turns made here: on the day the question was asked, a
    texted reply on one line (its separate texts joined), photos as words, 🎤 for voice messages."""
    if not c.get("save_chats", True):
        return
    batch = {it["cid"]: m for it, m in added}
    for it, m in added:
        if m["role"] != "assistant" or not it.get("reply_to"):
            continue
        q = batch.get(it["reply_to"]) or social.by_cid(it["reply_to"])
        char = characters.find(m["char"], c)
        if not q or q["role"] != "user" or q.get("char", "buddy") != m["char"] or not char:
            continue
        reply = " ".join(p for p in m["content"].split("\n\n") if p)
        when = datetime.datetime.fromtimestamp(q["ts"])
        mode, session = m.get("mode") or char["brain"], when.date().isoformat()
        look = None
        if q.get("image") and not q.get("photo_desc") and "seen" not in q:
            look = looks.get(q["id"]) or _looks.get(q["id"])   # (the phone sends a photo's reply in a later request)
            if not look: q = social.find(q["id"]) or q     # (its look ended meanwhile: what it saw is in the thread)
        if look:                                         # being looked at now: saved once it's known what's in it
            def later(look, char, q, reply, mode, session, when, g):
                look["done"].wait(10)
                if social.gen(char["id"]) > g:           # deleted meanwhile: nothing comes back
                    return
                try: save_turn(char, session, photo_said(look["desc"], q["content"]), reply, mode, when=when)
                except OSError: pass
            threading.Thread(target=later, args=(look, char, q, reply, mode, session, when, it["epoch"]),
                             daemon=True).start()
            continue
        if q.get("image"):
            asked, said = photo_said(q.get("photo_desc"), q["content"]), reply
        else:
            asked = ("🎤 " if q.get("voice") else "") + q["content"]
            said = ("🎤 " if m.get("voice") else "") + reply
        try: save_turn(char, session, asked, said, mode, when=when)
        except OSError: pass

def import_partner(it):
    """[partner: …] said in phone mode (the public edition): your relationship status as the phone left it, applied
    the way _chat applies the tag -> its result. "noask": they stop asking; a yes/no counts only if it's at least as new
    as what this Mac knows (a change made here later wins). The phone sends a "no" only from an everyday chat (a
    private one may only make it stricter), and never the words that were said. A disk error isn't caught: like a
    message's, the request is a 5xx and the phone sends it again."""
    cid = it.get("cid")
    if not isinstance(cid, str) or not CID.fullmatch(cid):
        return {"cid": None, "dropped": "bad id"}
    if not edition.PUBLIC:
        return {"cid": cid, "dropped": "not this edition"}
    has, at, noask = it.get("has"), it.get("at"), it.get("noask")
    if has not in (None, "yes", "no") or noask not in (None, True, False):
        return {"cid": cid, "dropped": "bad partner"}
    if has and (isinstance(at, bool) or not isinstance(at, (int, float)) or not math.isfinite(at) or at <= 0):
        return {"cid": cid, "dropped": "bad time"}
    if not has and noask is not True:
        return {"cid": cid, "dropped": "empty"}
    known = cfg().get("partner_at")
    known = known if isinstance(known, (int, float)) and not isinstance(known, bool) else 0
    if noask is True:
        save_cfg(partner_noask=True)
    if has and min(at, time.time()) >= known:
        save_cfg(has_partner=has, partner_at=min(at, time.time()))
    return {"cid": cid, "applied": True}

def import_messages(dev, j):
    """POST /api/thread/import: messages, reactions and New-chat breaks written on a phone in phone mode (at most one
    photo or voice message per request), and your relationship status as a character heard it there (role "partner",
    the public edition: import_partner). -> (HTTP code, answer)."""
    if dev["kind"] == "mac":
        return 403, {"error": "only phones have phone-mode messages"}
    if not isinstance(j, dict) or not isinstance(j.get("messages"), list):
        return 400, {"error": "bad request"}
    raw = j["messages"]
    if not 1 <= len(raw) <= IMPORT_MAX_ITEMS:
        return 400, {"error": "send 1 to 200 messages at a time"}
    if sum(1 for it in raw if isinstance(it, dict) and (it.get("photo") is not None or it.get("voice") is not None)) > 1:
        return 400, {"error": "one photo or voice message at a time"}
    c = cfg()
    results, good = check_imports(raw, c)
    res, added = social.add_imported([it for _, it in good])
    for (i, _), r in zip(good, res):
        results[i] = r
    for i, it in enumerate(raw):
        if isinstance(it, dict) and it.get("role") == "partner":
            results[i] = import_partner(it)
    looks = start_looks(added, c)
    save_imported(added, c, looks)
    for cid in dict.fromkeys(m["char"] for _, m in added if m["role"] in ("user", "assistant") and not m.get("private")):
        facts.kick(cid)                                  # (maybe there's something to remember)
    return 200, {"ok": True, "results": results, "upto": max((m["id"] for _, m in added), default=0)}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):  # no logs: keeps your words out of the terminal
        pass

    def allowed(self):
        """Only this Mac (127.0.0.1) and your own tailnet (*.ts.net via tailscale serve). Blocks other websites
        from reading your conversation through DNS-rebinding or cross-site requests, and the public internet."""
        name = self.headers.get("Host", "").rsplit(":", 1)[0] if "]" not in self.headers.get("Host", "") else ""
        if not (name in ("127.0.0.1", "localhost") or name.endswith(".ts.net")):
            self.send_error(403); return False
        if self.headers.get("Tailscale-Funnel-Request"):  # Tailscale Funnel = the public internet: never
            self.send_error(403); return False
        if self.path.startswith("/api/") and self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
            self.send_error(403); return False            # another website (even one on your tailnet) asking
        origin = self.headers.get("Origin")                # sent by browsers on cross-site requests (and POSTs)
        if origin is not None and urllib.parse.urlparse(origin).netloc not in (
                self.headers.get("Host"), self.headers.get("X-Forwarded-Host")):
            self.send_error(403); return False
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        photo = ctype == "image/jpeg" and self.path.split("?")[0] == "/api/photo"   # (a photo you're sending: only there)
        if self.command == "POST" and not (ctype == "application/json" or ctype.startswith("audio/") or photo):
            self.send_error(415); return False            # forms/plain text could be sent cross-site without asking
        return True

    def translate_path(self, path):
        """Only files inside web/ are ever served (keys, notes and the thread live outside it)."""
        p = urllib.parse.unquote(path.split("?", 1)[0])
        if p.startswith("/icons/"):
            out = os.path.join(WEB, "default-icons", p[len("/icons/"):].lstrip("/"))
        elif p in ("/", "", "/phone", "/phone/"):           # the same chat page on the Mac and the phone
            out = os.path.join(WEB, "chat.html")
        else:
            out = os.path.join(WEB, p.lstrip("/"))
        web = os.path.realpath(WEB)
        if ".." in p or not (os.path.realpath(out) + os.sep).startswith(web + os.sep):
            return os.path.join(WEB, "chat.html")
        return out

    CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; "
           "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    # The phone's page alone may also reach Tinfoil (phone mode: attestation, then sealed requests to the enclave)
    PHONE_CSP = CSP.replace("connect-src 'self'", "connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh")
    # (Python 3.9's mimetypes may not know .mjs, and nosniff blocks a script served with the wrong type)
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")             # nothing kept in browser caches
        phone = getattr(self, "path", "").split("?")[0] in ("/phone", "/phone/")   # (no path yet: a bad request line)
        self.send_header("Content-Security-Policy", self.PHONE_CSP if phone else self.CSP)   # nothing loads from
        # anywhere else (the phone's page: Tinfoil too, for phone mode); no framing
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")   # other sites can't embed pictures/data
        super().end_headers()

    def cookie(self):
        """The key in the 'buddy' cookie, or None."""
        try:
            c = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
            return c["buddy"].value if "buddy" in c else None
        except http.cookies.CookieError:
            return None

    def device(self):
        """The paired device making this request (its key is in the 'buddy' cookie), or None."""
        tok = self.cookie()
        return devices.check(tok) if tok else None

    def pair_cookie(self, token):
        secure = "; Secure" if self.headers.get("Host", "").split(":")[0].endswith(".ts.net") else ""
        return ("Set-Cookie", f"buddy={token}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict{secure}")

    def locked(self):
        """True (and answered with 401) unless a paired device is asking."""
        self.dev = self.device()
        if self.dev: return False
        self.json(401, {"error": "pair", "message": "This device isn't paired with Buddy yet."})
        return True

    def json(self, code, obj, headers=()):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        for k, v in headers: self.send_header(k, v)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def line(self, obj):
        self.wfile.write((json.dumps(obj) + "\n").encode()); self.wfile.flush()

    def start_stream(self):
        if getattr(self, "_streaming", False): return     # (a late answer started it already)
        self._streaming = True
        self.send_response(200); self.send_header("Content-Type", "application/x-ndjson"); self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == "/api/status" and not self.device():   # the updater's health check: alive, nothing else
            return self.json(200, {"ok": True, "pid": os.getpid(), "paired": False})
        if self.path == "/api/me":                       # is this device paired? (the page asks first)
            tok = self.cookie(); d = devices.check(tok) if tok else None
            renew = d and d["kind"] == "phone" and re.fullmatch(r"[A-Za-z0-9_-]{1,200}", tok)   # (a phone in use stays
            return self.json(200, {"paired": bool(d), "device": d},                  # paired: its key, 400 more days)
                             headers=[self.pair_cookie(tok)] if renew else [])
        if self.path.startswith("/api/hello?"):           # the Mac app checking it's really talking to this Buddy.
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)   # No key needed or sent: the answer is
            return self.json(200, {"proof": devices.proof((q.get("nonce") or [""])[0][:200])})   # an HMAC of a fresh nonce
        if self.path.startswith("/api/") and self.locked():
            return
        if self.path.split("?")[0] == "/api/phonekit":   # phone mode: what a phone needs while this Mac is away
            if self.dev["kind"] != "phone": return self.json(403, {"error": "phone mode is for phones"})
            if not cfg().get("phone_mode", True):
                return self.json(403, {"error": "phone mode is off on your Mac", "phone_mode": False})
            if phone_free():                             # (the free brain without a Tinfoil key: phone mode is Tinfoil only)
                return self.json(403, {"error": PHONE_FREE, "phone_mode": False, "free": True})
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try: return self.json(200, phonekit((q.get("have") or [""])[0][:64]))
            except Exception as e: return self.json(500, {"error": type(e).__name__})
        if self.path.startswith("/api/backup"):          # encrypted backups (backup.py): the Mac only (paths, keys)
            if self.dev["kind"] != "mac": return self.json(403, {"error": "Backups are set up on the Mac."})
            try: out = backup.get(self.path.split("?")[0])
            except Exception as e: return self.json(500, {"error": type(e).__name__})
            return self.json(200, out) if out is not None else self.json(404, {"error": "not found"})
        if self.path == "/api/devices":
            return self.json(200, {"devices": devices.listing(), "me": self.dev["id"]})
        if self.path.split("?")[0] == "/api/thread":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self.json(200, social.thread(int((q.get("after") or ["0"])[0])))
        if self.path == "/api/push/key":
            return self.json(200, {"key": social.vapid_public()})
        if self.path == "/api/version":                  # the phone reloads itself (and keeps a new copy) when this
            h = hash(backup.restored_at())                # changes (and after a restore, so phones reload too)
            for f in SHELL_FILES:
                try: h = hash((h, os.path.getmtime(os.path.join(WEB, f)), os.path.getsize(os.path.join(WEB, f))))
                except OSError: pass
            return self.json(200, {"version": format(h & 0xFFFFFFFF, "08x")})
        if self.path == "/api/settings":
            c = cfg()
            return self.json(200, {"proactive": bool(c.get("proactive", True)), "push_ready": bool(social.vapid_public()),
                                   "phones": social.phone_count(), "learn_facts": bool(c.get("learn_facts", True)),
                                   "push_preview": bool(c.get("push_preview", True)), "lives": bool(c.get("lives", True)),
                                   "real_timing": bool(c.get("real_timing", True)),
                                   "life_texts": c.get("life_texts", "some") if c.get("life_texts") in ("few", "some", "lots")
                                   else "some", "quiet_from": c.get("quiet_from", 23.0), "quiet_until": c.get("quiet_until", 8.5),
                                   "pictures": images.setting(c), "see_photos": bool(c.get("see_photos", True)),
                                   "free_brain": c.get("free_brain") is True,
                                   "has_partner": c.get("has_partner") if c.get("has_partner") in ("yes", "no") else "",
                                   "partner_at": c.get("partner_at") or None, "partner_noask": bool(c.get("partner_noask"))})
        if self.path.split("?")[0] == "/api/knows":       # what one character knows about you (your own data)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            c = characters.find((q.get("char") or [""])[0], cfg())
            if not c: return self.json(404, {"error": "no such character"})
            return self.json(200, knows_info(c))
        if self.path.split("?")[0] == "/api/lives":       # one character's own life (and who they know)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            c = characters.find((q.get("char") or [""])[0], cfg())
            if not c: return self.json(404, {"error": "no such character"})
            return self.json(200, life_info(c))
        if self.path == "/api/stored":                   # everything Buddy keeps: counts, sizes and where, never contents
            return self.json(200, stored_info())
        if self.path.startswith("/api/media/") or (self.path.startswith("/api/characters/") and
                                                     self.path.split("?")[0].split("/")[-1] in ("avatar", "wallpaper")):
            data = None
            if self.path.startswith("/api/media/"):
                mid = self.path.split("/")[3].split("?")[0]
                view = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("v") == ["1"]
                data = images.from_memory(mid, view=view)    # a photo from a private chat (memory only)
                p = (view and images.view_path(mid)) or images.path(mid)   # (?v=1: the smaller copy, if there is one)
            else:                                         # /api/characters/<id>/avatar|wallpaper
                p = characters.avatar_path(self.path.split("/")[3],
                                           "wall" if self.path.split("?")[0].endswith("/wallpaper") else "img")
            if data is None and (not p or not os.path.exists(p)):
                return self.json(404, {"error": "no picture"})
            data = data if data is not None else open(p, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", images.media_type(data) or "application/octet-stream")
            self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if self.path == "/api/images":                   # who makes pictures, and who can look at the ones you send
            c = cfg(); p = images.setting(c); f = images.find(c); v = vision_models()
            return self.json(200, {"available": bool(f), "provider": f and f["provider"], "pictures": p,
                "label": f and f["label"], "eta_s": f and f["eta_s"],
                "local": images.local_status(c) if p == "local" else None,
                "near": images.near_status(wait=False) if p == "near" else None, "near_key": bool(read(".near_key")),
                "vision": {"available": bool(v), "model": v[0] if v else None}, "see_photos": bool(c.get("see_photos", True))})
        if self.path == "/api/characters":
            out = characters.all_characters(cfg())
            with _jobs_lock:
                for k in [k for k, v in _avatar_jobs.items() if "error" in v and time.time() - v["at"] > 600]:
                    _avatar_jobs.pop(k, None)
                for c in out:
                    c["avatar_job"] = _avatar_jobs.get(c["id"])
                    c["wall_job"] = _avatar_jobs.get(c["id"] + "/wall")
            return self.json(200, out)
        if self.path == "/api/knowledge":                # folder names only, never what's in them
            return self.json(200, {"folders": memory.folders()})
        if self.path == "/api/voices":
            return self.json(200, voice_list())
        if self.path == "/api/status":
            mem = memory.health()
            c = cfg()
            fon = free_on(c)
            return self.json(200, {"name": c.get("name"), "voice": c.get("voice"), "paired": True,
                "companion_ready": bool(read(".tinfoil_key") or read(".phala_key") or fon), "companion_provider": companion_provider(c),
                "phala_key": bool(read(".phala_key")), "tinfoil_key": bool(read(".tinfoil_key")), "tinfoil": tinfoilproxy.status(),
                "near_key": bool(read(".near_key")), "credits": billing.status(), "credits_note": billing.message(),
                "edition": "public" if edition.PUBLIC else "private",
                "free": {"name": FREE_NAME, "on": fon, "chosen": c.get("free_brain") is True, "key": free_key() is not None,
                         "limited_until": int(_free["limited"]) if _free["limited"] > time.time() else 0,
                         "back_at": int(free_back_at())},          # (the free brain: booleans and times only, never the key)
                "memory_notes": mem["notes"], "memory": mem, "pid": os.getpid(), "boot": BOOT,
                "synced": {"notes": synced_by(VAULT), "buddy": synced_by(HERE)}, "sync_e2e": bool(c.get("sync_e2e")),
                "tailnet": {**tailnet.status(), "on": bool(c.get("phone_tailnet"))}})
        if self.path == "/api/tailnet":                  # phone access through Buddy's own Tailscale node
            return self.json(200, {**tailnet.status(mac=self.dev["kind"] == "mac"), "on": bool(cfg().get("phone_tailnet"))})
        return super().do_GET()

    def chat(self, j):
        """In a call, one answer at a time per device and character: a new turn first stops the answer still being
        made (you cut in) and waits for it to be saved, so the conversation stays in the order things were said."""
        if j.get("via") != "call":
            return self._chat(j)
        _talked[0] = time.time()
        lk = ((getattr(self, "dev", None) or {}).get("id"), str(j.get("char") or "buddy"))
        call_turn(lk[1])
        prev = _live.get(lk)
        if prev:
            prev[0].set(); prev[1].wait(3)
        live = _live[lk] = (threading.Event(), threading.Event())
        try:
            return self._chat(j, live[0])
        finally:
            live[1].set(); _talked[0] = time.time(); call_turn(lk[1])
            if _live.get(lk) is live: _live.pop(lk, None)

    def _chat(self, j, cancel=None):
        private = bool(j.get("private", False))
        via = j.get("via") if j.get("via") in ("phone", "call") else "mac"
        char = characters.get(str(j.get("char") or "buddy"), cfg())
        user_text = str(j.get("text", "")).strip()[:4000]
        pid = j.get("photo") if isinstance(j.get("photo"), str) and j.get("photo") else None
        if pid and via == "call":
            return self.json(400, {"error": "no photos in calls"})
        vid = j.get("voice") if isinstance(j.get("voice"), str) and re.fullmatch(r"[0-9a-f]{32}", j.get("voice")) else None
        if vid and (via == "call" or not (images.path(vid) or vid in images._mem)):
            return self.json(400, {"error": "that voice message isn't here any more"})
        if not user_text and not pid and not vid:
            return self.json(400, {"error": "empty"})
        photo = None
        if pid:                                           # a photo you sent along (uploaded while you typed)
            if not cfg().get("see_photos", True):
                return self.json(403, {"error": "sending photos is off (Settings)"})
            known = pid in _pending_photos
            photo = take_photo(pid, self.dev["id"])
            if not photo:                                 # (gone: Buddy restarted, or it waited over 30 minutes)
                return self.json(400, {"error": "that photo isn't ready" if known else PHOTO_EXPIRED})
            mid = images.save(photo["full"], private=private, view=photo["view"])   # (private: memory only)
        um = social.add("user", user_text, private=private, via=via, char=char["id"],
                        **({"image": mid, "w": photo["w"], "h": photo["h"]} if photo else {}),
                        **({"voice": vid, "dur": min(600.0, max(0.0, float(j.get("dur") or 0)))} if vid else {}),
                        **({"from": "phone" if j.get("from") == "phone" else "mac"} if via == "call" else {}))
        look = None
        if photo:      # always looked at privately (Tinfoil's enclave): for this reply if needed, later turns, saved chats
            look = {"done": threading.Event(), "desc": "", "model": None}
            def looker(view=photo["view"], mid=um["id"]):
                try: look["desc"], look["model"] = describe(view)
                except Exception: pass
                finally: look["done"].set()
                social.update(mid, **({"photo_desc": look["desc"], "seen_by": look["model"]} if look["desc"] else {"seen": False}))
            threading.Thread(target=looker, daemon=True).start()
        if has_life(char): plan_soon(char["id"])          # (their day, if it isn't planned yet: ready for the next reply)
        g = social.gen(char["id"])                        # if you delete this conversation meanwhile, the reply is dropped
        late = 0 if photo or vid or j.get("now") else reply_delay(char, via)   # (a real person doesn't always answer at once)
        with _late_lock:
            due = _late.get(char["id"], 0)
            if due > time.time():                         # their answer is on its way: it answers this too
                self.start_stream(); self.line({"later": round(due - time.time())}); return
            if late: _late[char["id"]] = time.time() + late
        if late:                                          # the page stops waiting; the answer comes like a text
            self.start_stream()
            try: self.line({"later": round(late)})
            except OSError: pass
            end = time.time() + late
            while time.time() < end and social.gen(char["id"]) == g:
                time.sleep(1)
            with _late_lock: _late.pop(char["id"], None)
            if social.gen(char["id"]) != g:
                return                                    # (the conversation was deleted meanwhile)
            t = [m for m in social.thread() if m.get("char", "buddy") == char["id"] and (private or not m.get("private"))]
            back = next((i for i in range(len(t) - 1, -1, -1) if t[i]["role"] in ("assistant", "break")), -1)
            if not any(m["role"] == "user" for m in t[back + 1:]):
                return                                    # (answered meanwhile, e.g. in phone mode, or a New chat)
            user_text = " ".join(m["content"] for m in t[back + 1:] if m["role"] == "user" and m["content"])[:4000]
        spoken_reply = via == "call" or (via == "mac" and j.get("spoken") is not False)   # out loud: no silent thinking
        try:                                              # (private: never the free brain)
            url, key, model, mode_used = brain(j.get("mode") or char["brain"], spoken=spoken_reply, free_ok=not private)
        except RuntimeError as e:                         # e.g. Tinfoil's verified connection isn't ready yet
            if private and free_on() and not read(".tinfoil_key") and not isinstance(e, FreeError):
                e = FreeError(PRIVATE_NOT_FREE)           # (you're on the free brain, without a Tinfoil key)
            self.start_stream(); self.line({"error": str(e), **({"plain": True} if isinstance(e, FreeError) else {})})
            return
        if url.startswith(PHALA):                         # (a conversation Phala has never goes to the free brain)
            social.update(um["id"], brain="phala")
        free = url.startswith(CLOUDFLARE)                 # the free brain: no notes, facts or pictures for it, and only
        msgs = social.recent_messages(30, include_private=private, char=char["id"],    # what was said since it was
                                      since=free_since() if free else None)            # turned on (private: never)
        heard = j.get("heard")
        if via == "call" and isinstance(heard, str):      # you cut off their last reply: they know what you heard
            last = len(msgs) - 2 if len(msgs) >= 2 and msgs[-2]["role"] == "assistant" else None
            if last is not None:
                msgs[last] = {**msgs[last], "content": (heard.strip()[:2000] + " … (you cut me off here)").strip()}
        opened = j.get("opened")
        if via == "call" and isinstance(opened, str) and opened.strip():   # what they said picking up (not saved)
            msgs = msgs[:-1] + [{"role": "assistant", "content": opened.strip()[:200]}] + msgs[-1:]
        session = datetime.date.today().isoformat()
        query = " ".join(m["content"] for m in msgs[-5:] if m["role"] == "user")   # recall what we're on about
        asking, used = facts.is_knows_question(user_text) and not free, []   # "what do you know about me?": facts only
        turn, sees = [], False
        if late:
            busy = life_busy(char)
            turn = [LATE_NOTE.format(busy=f" (you've been busy: {busy})" if busy else "")]
        def heard_of(desc):                               # this turn's message for a brain that can't look itself
            nonlocal turn
            if msgs and msgs[-1]["role"] == "user":
                msgs[-1] = {"role": "user", "content": LOOKED.format(desc=desc, text=user_text).strip() if desc
                            else (msgs[-1]["content"] or "(I sent you a photo)")}
            turn = [PHOTO_SAFETY] + ([] if desc else [CANT_SEE])
        if photo:
            sees = url != PHALA and not free and model in vision_models()   # (Phala and the free brain never get pixels)
            if sees:
                turn = [PHOTO_SAFETY]
                if msgs and msgs[-1]["role"] == "user":
                    msgs[-1] = {"role": "user", "content": user_text or "(I sent you a photo)"}
            elif free:                                    # the free brain: only that you sent one, never what's in it
                heard_of("")
            else:                                         # look first, then talk
                look["done"].wait(25); heard_of(look["desc"])
        # they may send a picture back on a photo turn unless what you sent is already known to be unfit (nobody could
        # look, or it shows someone young); whether they actually do is decided once it's been looked at (below)
        photos_ok = not photo or not look["done"].is_set() or (bool(look["desc"]) and not images.too_young(look["desc"]))
        def request(with_pic):
            used.clear()                                  # (asked again, e.g. without the picture: given once)
            sysmsg = system_prompt(char, mode_used, query, chat_path(char, session), via, used=used, asking=asking,
                                   spoken=spoken_reply, photos=photos_ok, extra=turn + ([FREE_MEMORY] if free else []),
                                   length="" if asking else length_hint(user_text, via), notes=not free)
            conv = alternate(msgs)
            if with_pic and conv and conv[-1]["role"] == "user":   # the picture itself (the smaller copy), inline
                conv[-1] = {"role": "user", "content": [{"type": "text", "text": conv[-1]["content"]}, {"type": "image_url",
                            "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(photo["view"]).decode()}}]}
            return {"model": model, "temperature": 0.9, "stream": True, "messages": [{"role": "system", "content": sysmsg}] + conv}
        base = request(sees)
        # (no silent thinking first where the model has a switch, in calls and texts alike: the first word comes sooner;
        # only a typed, unspoken message that plainly asks for depth (deep_question: "can you explain how …", "help me
        # decide …", 6+ words) may think first on Tinfoil: never read aloud on the Mac, in a call, on Phala or free)
        deep = not spoken_reply and via != "call" and not free and url != PHALA and deep_question(user_text)
        extra = dict(NO_THINKING.get(model, {})) if url != PHALA and model not in _thinking_refused and not deep else {}
        if (via == "call" and url != PHALA and model not in ALWAYS_THINKS and model not in _thinking_refused
                and (extra or model not in NO_THINKING)):
            extra["max_tokens"] = 300                     # (a call reply is a few sentences; never if it may still think)
        gone = False
        def out(obj):                                     # best effort: if you close the app, the reply still finishes
            nonlocal gone
            if gone: return
            try: self.line(obj)
            except OSError: gone = True
        self.start_stream()
        voice_reply = via != "call" and bool(vid or VOICE_ASK.search(user_text))   # (you sent one, or asked for one)
        out({"mode": mode_used})
        if voice_reply: out({"voice_reply": True})        # (the page shows "recording a voice message…")
        if used: out({"sources": used})                  # which notes and facts it was given (paths and counts only)
        if asking: out({"knows": char["id"]})
        buf, full, texts = "", [], []                     # texts: the separate texts a texted reply is made of
        tail, budget = None, 0                            # past the cap: a photo that had started, till it ends
        offered = via != "call" and photos_ok and images.setting(cfg()) != "off" and bool(images.find(cfg()))
        tags = []
        reacts = []
        partner = []                                      # (public edition: you said you're married, or single)
        cap = None if asking else long_enough(user_text, via)
        def emit(s, new_text=False, line=True):                   # (line: s starts a line of the reply)
            s, pics = pic_tags(s, line_start=line); tags.extend(pics)  # a photo however they wrote it: never as words
            reacts.extend(REACT_TAG.findall(s)); partner.extend(edition.PARTNER_TAG.findall(s))
            s = no_tags(spoken(s) if via == "call" else s).strip()    # no markdown, tags or stage directions
            if s:
                new_text = new_text and bool(texts)
                if new_text or not texts: texts.append([])
                texts[-1].append(s); full.append(s)
                if not voice_reply: out({"s": s, **({"p": 1} if new_text else {})})   # (p: a new text; a voice
                                                                                     # message arrives whole)
        def enough():
            return bool(cap) and (len(texts) > cap[0] or len(" ".join(full).split()) > cap[1])
        def ask_model(b):
            try:
                return post(url + "/chat/completions", key, json.dumps({**b, **extra}).encode())
            except urllib.error.HTTPError as e:
                if e.code != 400 or not extra: raise
                r = post(url + "/chat/completions", key, json.dumps(b).encode())
                _thinking_refused.add(model)                  # it doesn't take those switches (asked plainly, it works)
                return r
        try:
            try:
                r = ask_model(base)
            except urllib.error.HTTPError as e:
                if not (sees and (e.code in REFUSES_PICTURES or e.code >= 500)): raise
                vision_failed(model, e.code)                  # it can't look at pictures right now: it hears about it
                look["done"].wait(25); heard_of(look["desc"])
                r = ask_model(request(False))
            finished = False                                  # (a stream cut off mid-answer just ends: no [DONE])
            next_text, at_line = False, True                  # (at_line: buf starts a line of the reply)
            with r:
                for raw in r:
                    if via == "call" and not gone and select.select([self.connection], [], [], 0)[0]:
                        try: gone = not self.connection.recv(1, socket.MSG_PEEK)   # (the page let go of this answer)
                        except OSError: gone = True
                    if cancel is not None and cancel.is_set(): gone = True        # (your next turn started)
                    if gone and via == "call":
                        break
                    raw = raw.decode(errors="ignore").strip()
                    finished = finished or raw.endswith("[DONE]")
                    if not raw.startswith("data:") or raw.endswith("[DONE]"):
                        continue
                    ch = json.loads(raw[5:]).get("choices") or []
                    finished = finished or bool(ch and ch[0].get("finish_reason"))
                    piece = (ch[0].get("delta", {}).get("content") or "") if ch else ""
                    if tail is not None:                      # (past the cap: only the photo that had started, till
                        tail += piece                         # it closes, and a few hundred characters at most)
                        if len(tail) > budget or not pic_open(tail, at_line): break
                        continue
                    buf += piece
                    while True:                               # sentence by sentence, never inside a [photo: ...] (nor
                        m = next((x for x in re.finditer(r"(?<=[.!?…])\s+|[ \t]*\n\s*", buf)   # "(image: …" or "*sends a
                                  if buf[:x.start()].count("[") <= buf[:x.start()].count("]")    # selfie…" till the line
                                  and ("\n" in x.group() or not (ABBREV.search(buf[:x.start()])  # ends, nor after "Dr.",
                                                                 or _PIC_OPEN.search(buf[:x.start()])))), None)   # "p.m.";
                        if not m: break                                                          # a new line = a new text)
                        emit(buf[:m.start()], new_text=next_text, line=at_line); buf = buf[m.end():]
                        next_text = at_line = "\n" in m.group()
                        if enough(): break
                    if gone and via == "call":                # you hung up or cut them off: stop talking
                        break
                    if enough():                              # (a wall of texts nobody asked for: stop there, as
                        found = pic_tags(buf, final=False, line_start=at_line)[1] if offered and not tags else []
                        if found or not offered or tags or not pic_open(buf, at_line):   # always; only a photo
                            tags.extend(found); buf = ""; break       # visibly being written at that moment, when one
                        tail, budget, buf = buf, len(buf) + 300, ""   # can be made, is read on to its end: <= 300 chars)
            if not (gone and via == "call"):
                emit(buf, new_text=next_text, line=at_line)
            if tail:
                tags.extend(pic_tags(tail, line_start=at_line)[1])
            if via == "call" and not gone and not finished:   # (in a call they say so; what they'd said is kept)
                raise RuntimeError(("Phala" if url.startswith(PHALA) else FREE_NAME if free else "Tinfoil") + "'s answer broke off")
        except Exception as e:                            # headers are already sent: report it in the stream
            who = "Phala" if url.startswith(PHALA) else FREE_NAME if free else "Tinfoil"
            code = getattr(e, "code", None)
            if who == "Tinfoil" and code in (400, 404): _models.update(at=0)   # maybe that model was retired
            bill = billing.kind(e) if who == "Tinfoil" else None              # (credits ran out: said plainly)
            if free and not isinstance(e, RuntimeError):  # the free brain's limit, key or connection: said as it is
                out({"error": free_failed(e, model), "plain": True})          # (and never a paid brain instead)
            elif bill:
                out({"error": billing.message(bill), "credits": True})
            else:
                out({"error": str(e) if isinstance(e, RuntimeError) else f"{who} returned {code}" if code else f"Can't reach {who}"})
        said = partner[-1].lower() if partner and edition.PUBLIC else ""   # you told them you're married / single, it
        try:                                              # changed, or to stop asking (the tag is never shown, kept or said)
            if said == "noask":
                save_cfg(partner_noask=True)
            elif said == "yes" or (said == "no" and not private):   # (a private chat may only make it stricter)
                save_cfg(has_partner=said, partner_at=time.time())
        except OSError:
            pass
        vextra = {}
        if voice_reply and full:                          # their answer as a voice message, in their own voice
            try:
                wav = tts_wav(" ".join(full), char.get("voice"))
                vextra = {"voice": images.save_audio(wav, private=private), "dur": wav_seconds(wav)}
            except Exception:
                for s in full: out({"s": s})              # (the voice didn't work out: it's a text after all)
        rx = next((reaction(e) for e in reacts if reaction(e)), None)
        if rx and full and reacted_lately(char["id"]):
            rx = None                                     # (they reacted a moment ago: a real person doesn't every time)
        if rx and via != "call" and social.add("reaction", "", gen=g, target=um["id"], emoji=rx, by=char["id"],
                                               char=char["id"], **({"private": True} if private else {})) is not None:
            out({"react": rx})                            # they reacted to your message (maybe instead of a reply)
        said = " ".join(full) if via == "call" or vextra else "\n\n".join(" ".join(t) for t in texts)   # (separate texts)
        kept = bool(full) and social.add("assistant", said, gen=g, private=private, mode=mode_used, via=via, **({"brain": "phala"} if url.startswith(PHALA) else {}),
                                         char=char["id"], **({"sources": used} if used else {}), **vextra,
                                         **({"knows": True} if asking else {}),
                                         **({"late": True, "delivered": via} if late else {})) is not None
        if kept and late and (via == "phone" or social.mac_idle_seconds() >= 180):   # (a late answer arrives like a text)
            who, body = social.preview(cfg(), char["name"], said, private=private)
            social.push(note=body, contact=cfg().get("push_contact", "mailto:buddy@example.com"), title=who)
        if vextra:
            if kept: out({"voice": vextra["voice"]})
            else: images.remove(vextra["voice"])          # (its conversation was deleted meanwhile)
        if kept and not private and cfg().get("save_chats", True):
            if photo:                                     # (what was in it, once it's been looked at: words only)
                reply = " ".join(full)
                def save_later():
                    look["done"].wait(10)
                    if social.gen(char["id"]) != g:       # you deleted this conversation meanwhile: nothing comes back
                        return
                    try: save_turn(char, session, photo_said(look["desc"], user_text), reply, mode_used)
                    except OSError: pass
                threading.Thread(target=save_later, daemon=True).start()
            else:
                save_turn(char, session, ("🎤 " if vid else "") + user_text, ("🎤 " if vextra else "") + " ".join(full),
                          mode_used)                      # (never the sources: see knows_info)
        if kept and not private:                          # maybe there's something to remember (never from Private)
            facts.kick(char["id"], urgent=facts.remember_asked(user_text) and not asking)
        if photo and tags:                                # a picture back only once what you sent is known to be fine
            look["done"].wait(12)
            photos_ok = look["done"].is_set() and bool(look["desc"]) and not images.too_young(look["desc"])
        if tags and via != "call" and photos_ok and images.setting(cfg()) != "off":
            line = send_photo(char, tags[0], private=private, via=via, g=g)   # made privately in the background, then
            if line: out(line)                                                # it appears in the conversation

    def audio(self, ctype, data):
        self.send_response(200); self.send_header("Content-Type", ctype)
        if ctype == "audio/pcm": self.send_header("X-Sample-Rate", "24000")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def speak(self, j):
        """Their voice for a piece of text. stream: raw 24 kHz 16-bit mono PCM, passed on as Tinfoil makes it (the
        first words play while the rest is still being made); otherwise (or if Tinfoil won't stream) a WAV file."""
        voice = j.get("voice") if j.get("voice") in characters.VOICE_IDS else cfg().get("voice", "casual_female")
        model = "qwen3-tts" if voice[:1].isupper() else "voxtral-tts"   # Qwen voices are capitalised (Vivian, Serena…)
        text = spoken(j.get("text") or "")[:2000]
        if not text:
            self.send_response(204); self.end_headers(); return
        stock = (voice, text, j.get("stream") is True) if text in STOCK else None
        if stock in _stock:
            return self.audio(*_stock[stock])
        url, key, base = tinfoil() + "/audio/speech", read(".tinfoil_key"), {"model": model, "voice": voice, "input": text}
        refused = False
        if j.get("stream") is True and model not in _tts_stream_refused:
            try:
                r = post(url, key, json.dumps({**base, "response_format": "pcm", "stream_format": "audio",
                                               **({"initial_codec_chunk_frames": 4} if model == "qwen3-tts" else {})}).encode(),
                         timeout=60)
            except urllib.error.HTTPError as e:
                if billing.kind(e): raise                    # (credits ran out: a file wouldn't come either)
                refused = e.code in (400, 422); r = None     # (anything else: a whole file this time)
            if r is not None:
                with r:
                    if "wav" in (r.headers.get("Content-Type") or ""):   # (a whole file after all)
                        data = r.read()
                        if stock: _stock[stock] = ("audio/wav", data)
                        return self.audio("audio/wav", data)
                    self.send_response(200); self.send_header("Content-Type", "audio/pcm")
                    self.send_header("X-Sample-Rate", "24000"); self.end_headers()
                    keep, read1 = [], getattr(r, "read1", r.read)
                    while True:
                        try: b = read1(8192)
                        except Exception: return                # it broke off: end ours (never an error after the headers)
                        if not b: break
                        try: self.wfile.write(b); self.wfile.flush()
                        except OSError: return                  # you stopped listening: stop making it
                        if stock: keep.append(b)
                    if stock: _stock[stock] = ("audio/pcm", b"".join(keep))
                    return
        with post(url, key, json.dumps({**base, "response_format": "wav"}).encode(), timeout=60) as r:
            data = r.read()
        if refused: _tts_stream_refused.add(model)          # this voice can't stream (it can make files): files from now on
        if stock: _stock[stock] = ("audio/wav", data)
        self.audio("audio/wav", data)

    def stt(self, data):
        ct = (self.headers.get("Content-Type") or "audio/mp4").split(";")[0].strip().lower()
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        char = characters.find((q.get("char") or [""])[0], cfg())
        last = next((m["content"] for m in reversed(social.recent_messages(6, char=char["id"]))
                     if m["role"] == "assistant"), "") if char and q.get("call") == ["1"] else ""   # (a call: what they just said)
        try:
            text = whisper(data, ct, char, (q.get("lang") or [""])[0], last)
        except Unclear:                                   # (a loop, not words: the call says it didn't catch that)
            return self.json(422, {"error": "Couldn't make out any words.", "unclear": True, "detail": "Whisper repeated itself"})
        except urllib.error.HTTPError as e:               # Whisper couldn't use that sound (too short, only noise...):
            if billing.kind(e):                           # (your credits ran out: said as it is, never "you cut out")
                return self.json(e.code, {"error": billing.message(billing.kind(e)), "credits": True})
            why = " ".join(whisper_said(e).split())[:160]   # nothing's wrong, it just didn't catch any words; anything
            detail = f"Tinfoil returned {e.code}" + (f": {why}" if why else "")   # else is an error (detail: calldebug)
            if e.code in (400, 413, 422) and not getattr(e, "gone", False):
                return self.json(422, {"error": "Couldn't make out any words.", "unclear": True, "detail": detail})
            return self.json(502, {"error": f"Tinfoil returned {e.code}", "detail": detail})
        self.json(200, {"text": text})

    def voice_upload(self, data):
        """A voice message you send: kept as you recorded it (private chats: memory only), and heard privately by
        Whisper in Tinfoil's enclave so the character gets your words. -> {voice, text}; text may be "" (not made out)."""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        char, private = characters.get((q.get("char") or ["buddy"])[0], cfg()), (q.get("private") or ["0"])[0] == "1"
        if not images.audio_mime(data) or len(data) > 12_000_000:
            return self.json(400, {"error": "that isn't a voice recording Buddy can keep (or it's too long)"})
        ct = images.audio_mime(data)
        try:
            text = whisper(data, ct, char, (q.get("lang") or [""])[0])
        except Unclear:
            text = ""                                     # (a loop: sent anyway, they'll ask)
        except urllib.error.HTTPError as e:
            if e.code not in (400, 413, 422) or getattr(e, "gone", False): raise
            text = ""                                     # (only noise, or too short: sent anyway, they'll ask)
        return self.json(200, {"voice": images.save_audio(data, private=private), "text": text})

    def photo_upload(self, data):
        """A photo you're about to send: two copies, both re-encoded on your device (no location or camera details):
        part=full (the one kept in the chat, long edge up to 4096) and then part=view (up to 1536, what a model looks
        at). Checked and stripped again here, then held only in memory until you send it (30 minutes at most)."""
        if not cfg().get("see_photos", True):
            return self.json(403, {"error": "sending photos is off (Settings)"})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        part = (q.get("part") or [""])[0]
        if part not in ("full", "view"):
            return self.json(400, {"error": "which copy is this?"})
        big = part == "full"
        try:
            if len(data) != int(self.headers.get("Content-Length", -1)):
                raise ValueError("cut off")
            pic, (w, h) = images.clean_photo(data, 4096 if big else 1536, 12_000_000 if big else 3_000_000)
        except ValueError:
            return self.json(400, {"error": "that isn't a photo Buddy can use"})
        if big:
            return self.json(200, {"photo": hold_photo(self.dev["id"], pic, w, h)})
        pid = (q.get("photo") or [""])[0]
        got = add_view(pid, self.dev["id"], pic)
        if got is None:
            return self.json(400, {"error": "that photo isn't ready"})
        if not got:
            return self.json(403, {"error": "that photo was sent from another device"})
        return self.json(200, {"photo": pid, "ready": True})

    def do_HEAD(self):                                    # same gate as everything else; nothing in Buddy uses HEAD
        if not self.allowed():
            return
        if self.path.startswith("/api/"):
            return self.send_error(405)
        super().do_HEAD()

    def do_POST(self):
        if not self.allowed():
            return
        if self.path == "/api/thread/import":            # (too big: answered before reading it; the connection closes)
            try: n = int(self.headers.get("Content-Length") or 0)
            except ValueError: n = -1
            if n < 0: return self.json(400, {"error": "bad request"})
            if n > IMPORT_MAX_BYTES: return self.json(413, {"error": "too much at once"})
        data = self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 30_000_000))
        if self.path == "/api/pair":                      # a phone/tablet pairing with the code shown on the Mac
            j = json.loads(data or b"{}")
            got = devices.pair(j.get("code", ""), j.get("name", ""), "phone")
            if not got:
                return self.json(403, {"error": "That code didn't work. Make a new one on your Mac and try again."})
            token, dev = got
            return self.json(200, {"ok": True, "device": dev}, headers=[self.pair_cookie(token)])
        if self.locked():
            return
        try:
            if self.path == "/api/thread/import":         # what a phone said in phone mode joins the thread
                return self.json(*import_messages(self.dev, json.loads(data)))
            if self.path.split("?")[0] == "/api/photo":   # a photo you're about to send (before anything is parsed)
                return self.photo_upload(data)
            if self.path == "/api/photo/drop":            # you took it off again
                return self.json(200, {"ok": drop_photo(str(json.loads(data).get("photo") or ""), self.dev["id"])})
            if self.path == "/api/pair/start":            # only the Mac app can let a new device in
                if self.dev["kind"] != "mac": return self.json(403, {"error": "pair new devices from the Mac"})
                code, ttl = devices.start_pairing()
                return self.json(200, {"code": code, "expires_in": ttl, **tailnet_address()})
            if self.path == "/api/setup/key":              # a key typed into the Mac app (never shown back, never logged)
                if self.dev["kind"] != "mac": return self.json(403, {"error": "keys can only be set on the Mac"})
                j = json.loads(data)
                if not isinstance(j, dict) or j.get("provider") not in KEY_FILES or not isinstance(j.get("key", ""), str) \
                        or not isinstance(j.get("account", ""), str):
                    return self.json(400, {"error": "that doesn't look like an API key"})
                return self.json(200, {"ok": set_key(j["provider"], j.get("key", ""), remove=j.get("remove") is True,
                                                     account=j.get("account", ""))})
            if self.path == "/api/near/check":            # check NEAR AI's sealed servers again now (nothing is sent)
                if self.dev["kind"] != "mac": return self.json(403, {"error": "check this on the Mac"})
                return self.json(200, images.near_status(fresh=True, wait=True))
            if self.path in ("/api/tailnet", "/api/tailnet/signout"):   # phone access: turned on and off on the Mac
                if self.dev["kind"] != "mac": return self.json(403, {"error": "change this on the Mac"})
                if self.path == "/api/tailnet/signout":
                    save_cfg(phone_tailnet=False)
                    if not tailnet.sign_out():
                        return self.json(200, {**tailnet.status(mac=True), "on": False, "signout_failed": True})
                elif json.loads(data).get("on") is True:
                    save_cfg(phone_tailnet=True); tailnet.start()
                else:
                    save_cfg(phone_tailnet=False); tailnet.stop()
                return self.json(200, {**tailnet.status(mac=True), "on": bool(cfg().get("phone_tailnet"))})
            if self.path.startswith("/api/backup/"):     # set up, back up now, check and restore a backup (backup.py)
                if self.dev["kind"] != "mac": return self.json(403, {"error": "Backups are set up on the Mac."})
                j, name = json.loads(data or b"{}"), self.path[len("/api/backup/"):]
                if not isinstance(j, dict): raise ValueError("bad request")
                out = backup.post(name, j, restart=restart_soon)
                if out is None: return self.json(404, {"error": "not found"})
                return self.json(200, {**out, "boot": BOOT} if name == "restore" else out)
            if self.path == "/api/devices/remove":
                if self.dev["kind"] != "mac": return self.json(403, {"error": "remove devices from the Mac"})
                return self.json(200, {"ok": devices.remove(str(json.loads(data).get("id") or ""))})
            if self.path in ("/api/speak", "/api/call/start") or self.path.split("?")[0] == "/api/stt":
                _talked[0] = time.time()                  # (between the turns of a call nothing else says one is on)
            if self.path == "/api/chat":
                return self.chat(json.loads(data))
            if self.path == "/api/speak":
                return self.speak(json.loads(data))
            if self.path.split("?")[0] == "/api/stt":
                return self.stt(data)
            if self.path.split("?")[0] == "/api/voice":     # a voice message you're sending (raw audio)
                return self.voice_upload(data)
            if self.path == "/api/call/start":            # a call is starting: get ready (answers at once)
                cid = str(json.loads(data or b"{}").get("char") or "buddy")
                call_turn(cid)                            # (no learning for them while you're on the call)
                threading.Thread(target=warm_call, args=(cid,), daemon=True).start()
                return self.json(200, {"greetings": GREETINGS, "fillers": FILLERS, "missed": MISSED})
            if self.path == "/api/push/subscribe":
                social.subscribe(json.loads(data), self.dev["id"]); return self.json(200, {"ok": True})
            if self.path == "/api/push/test":
                return self.json(200, {"sent": social.push("Test: Buddy can reach your phone",
                                                           cfg().get("push_contact", "mailto:buddy@example.com"))})
            if self.path == "/api/react":                # your ❤️ 😂 👍 😮 😢 🔥 on a message ("" takes it back)
                j = json.loads(data or b"{}"); e = reaction(j.get("emoji")) or ""
                m = social.find(j.get("id")) if isinstance(j.get("id"), int) else None
                if not m or m["role"] not in ("user", "assistant") or (j.get("emoji") and not e):
                    return self.json(404, {"error": "no such message"})
                social.add("reaction", "", target=m["id"], emoji=e, by="you", char=m.get("char", "buddy"),
                           **({"private": True} if m.get("private") else {}))
                return self.json(200, {"ok": True})
            if self.path == "/api/newchat":              # fresh start for that character; the thread itself stays
                char = characters.get(str(json.loads(data or b"{}").get("char") or "buddy"), cfg())
                social.add("break", "", char=char["id"]); return self.json(200, {"ok": True})
            if self.path == "/api/characters/create":    # the AI writes one or several new characters
                desc = str(json.loads(data).get("description", "")).strip()
                if len(desc) < 3:
                    return self.json(400, {"error": "describe who you want"})
                free = free_on()                          # (the free brain isn't told your note folders' names)
                return self.json(200, {"created": characters.create(desc, cfg(), lambda p: ask(p, 1.0, cap=4000, free_ok=True),
                                                                    folders=[] if free else None)})
            if self.path == "/api/characters/save":
                c = json.loads(data).get("character") or {}
                was = characters.find(str(c.get("id") or ""), cfg()) if isinstance(c, dict) else None
                if was and c.get("learns") and not was.get("learns", True):
                    facts.resume([was["id"]])             # back on: nothing said while it was off is ever learned
                return self.json(200, {"ok": True, "character": characters.save(c, cfg(), memory.folders())})
            if self.path == "/api/characters/avatar":    # a new profile picture, made privately in the background
                j = json.loads(data); c = characters.find(str(j.get("id") or ""), cfg())
                if not c:
                    return self.json(404, {"error": "that character doesn't exist any more"})
                scene = str(j.get("scene") or "").strip()[:200]           # optional: where/how, e.g. "at a café, laughing"
                first = not c.get("avatar")                               # the first one is the same for the same looks;
                seed = int(hashlib.md5(c["id"].encode()).hexdigest()[:6], 16) % 100000 if first else random.randrange(2 ** 31)
                if j.get("adjust") and characters.avatar_seed(c["id"]) is not None:   # change this one: same start,
                    seed = characters.avatar_seed(c["id"])                # the change in words (on this Mac it stays close)
                try:                                                      # ...after that, each one is a new take
                    prompt = images.prompt_for(c.get("appearance", ""), (scene + ", " if scene else "")
                             + "head and shoulders portrait, looking at the camera, soft blurred background", selfie=False,
                             style=c.get("style"))
                except ValueError as e:
                    return self.json(400, {"error": str(e)})
                code, body = make_avatar(c["id"], prompt, seed)
                return self.json(code, body)
            if self.path == "/api/characters/avatar/upload":   # your own picture for them (re-encoded on your device)
                j = json.loads(data); c = characters.find(str(j.get("id") or ""), cfg())
                if not c:
                    return self.json(404, {"error": "that character doesn't exist any more"})
                try: pic = base64.b64decode(str(j.get("image") or "").split(",")[-1], validate=True)
                except Exception: pic = b""
                if not (pic[:3] == b"\xff\xd8\xff" or pic[:8] == b"\x89PNG\r\n\x1a\n") or len(pic) > 6_000_000:
                    return self.json(400, {"error": "that isn't a JPEG or PNG picture (or it's over 6 MB)"})
                if j.get("wallpaper"):                    # (or their chat wallpaper)
                    characters.set_wallpaper(c["id"], pic)
                    return self.json(200, {"ok": True, "wallpaper": characters._avatar_version(c["id"], "wall")})
                characters.set_avatar(c["id"], pic)
                return self.json(200, {"ok": True, "avatar": characters._avatar_version(c["id"])})
            if self.path in ("/api/characters/avatar/undo", "/api/characters/wallpaper", "/api/characters/wallpaper/remove"):
                j = json.loads(data); c = characters.find(str(j.get("id") or ""), cfg())
                if not c:
                    return self.json(404, {"error": "that character doesn't exist any more"})
                if self.path == "/api/characters/avatar/undo":   # back to the photo before
                    if not characters.undo_avatar(c["id"]): return self.json(404, {"error": "there's no photo before this one"})
                    return self.json(200, {"ok": True, "avatar": characters._avatar_version(c["id"])})
                if self.path == "/api/characters/wallpaper/remove":
                    characters.remove_wallpaper(c["id"]); return self.json(200, {"ok": True})
                try:                                      # a wallpaper for your chat with them, made privately
                    prompt = images.wall_prompt(str(j.get("scene") or ""), c.get("style"))
                except ValueError as e:
                    return self.json(400, {"error": str(e)})
                code, body = make_avatar(c["id"], prompt, random.randrange(2 ** 31), wall=True)
                return self.json(code, body)
            if self.path == "/api/characters/delete":
                j = json.loads(data); cid = j.get("id"); ok = characters.delete(cid)
                if ok and j.get("forget"): forget_char(cid)   # ...and everything you two said
                elif ok: social.add("break", "", char=cid)   # its old context never carries over
                return self.json(200, {"ok": ok})
            if self.path == "/api/characters/forget":         # delete the conversation, keep the character
                cid = str(json.loads(data).get("id") or "")
                if not characters.find(cid, cfg()): return self.json(404, {"error": "no such character"})
                n = forget_char(cid)                     # (epoch: what phone-mode messages from now on carry)
                return self.json(200, {"ok": True, "deleted": n, "epoch": social.gen(cid)})
            if self.path in ("/api/lives/save", "/api/lives/today", "/api/lives/reset"):   # (any paired device)
                j = json.loads(data)
                if not isinstance(j, dict): raise ValueError("bad request")
                c = characters.find(str(j.get("char") or ""), cfg())
                if not c: return self.json(404, {"error": "no such character"})
                if self.path == "/api/lives/reset":       # start their life over (a new one is planned when due)
                    lives.delete(c["id"])
                elif self.path == "/api/lives/today":     # redo today (one model call; takes a little while)
                    today = lives.life_date(time.time()).isoformat()
                    lives.change(c["id"], lambda lg: {**lg, "attempt": {},
                                                      "days": [d for d in lg["days"] if d["date"] != today]})
                    if not plan_day(c["id"], lazy=True, asked=True):
                        return self.json(503, {"error": billing.message() or "Couldn't plan their day right now. Try again in a minute?",
                                               **life_info(c)})
                else:
                    lives.change(c["id"], lambda lg: lives.edit(lg, c["id"], j, time.time()))
                    for t in j.get("ties") or [] if isinstance(j.get("ties"), list) else []:
                        o = isinstance(t, dict) and characters.find(str(t.get("id") or ""), cfg())
                        if o and t.get("know") in (True, False, None):
                            lives.set_tie(c["id"], o["id"], t["know"], str(t.get("how") or ""))
                return self.json(200, {"ok": True, **life_info(c)})
            if self.path in ("/api/knows/fact", "/api/knows/chat/delete", "/api/knows/preview"):
                j = json.loads(data)
                if not isinstance(j, dict): raise ValueError("bad request")
                c = characters.find(str(j.get("char") or ""), cfg())
                if not c: return self.json(404, {"error": "no such character"})
                if self.path == "/api/knows/fact":        # add, edit, delete, move or clear a fact (any paired device)
                    try: return self.json(200, {"ok": True, "facts": facts.change(c, j)})
                    except facts.Changed: return self.json(409, {"error": "changed", "facts": facts.listing(c)})
                if self.path == "/api/knows/chat/delete":
                    delete_chat(c, str(j.get("file") or ""))
                    return self.json(200, {"ok": True, "chats": saved_chats(c)})
                q = str(j.get("query") or "").strip()     # what would come up for a topic: paths only
                if not 1 <= len(q) <= 200: raise ValueError("Type a topic (up to 200 characters).")
                return self.json(200, {"sources": facts.for_prompt(c, q)[1] + sources_of(recall(c, q, None))})
            if self.path == "/api/settings":
                j = json.loads(data)
                if not isinstance(j, dict): raise ValueError("bad request")
                if "free_brain" in j:                     # the free brain (Less private): on only with its key, which
                    if j["free_brain"] is True:           # only the Mac sets (so it was chosen there; then any device
                        if not free_key():                # may turn it back on); back to Private from any device
                            return self.json(400, {"error": "Add your Cloudflare account ID and token on the Mac first."
                                                   if self.dev["kind"] == "mac" else "Turn the free brain on from your Mac."})
                    turned_on = j["free_brain"] is True and cfg().get("free_brain") is not True
                    save_cfg(free_brain=j["free_brain"] is True,   # (it only gets what's said from now on)
                             **({"free_since": time.time()} if turned_on else {}))
                if "pictures" in j:                       # who makes pictures: off, this Mac, or NEAR AI (your key)
                    if j["pictures"] not in ("off", "local", "near"):
                        return self.json(400, {"error": "unknown picture maker"})
                    if j["pictures"] == "near" and not read(".near_key"):
                        return self.json(400, {"error": "Add your NEAR AI key on the Mac first"})
                    save_cfg(pictures=j["pictures"]); images.forget_found()
                if "see_photos" in j:                     # characters can look at photos you send
                    save_cfg(see_photos=bool(j["see_photos"]))
                if "proactive" in j:
                    save_cfg(proactive=bool(j["proactive"]))
                if "push_preview" in j:                   # notifications show who and the message (or not)
                    save_cfg(push_preview=bool(j["push_preview"]))
                if "lives" in j:                          # characters have lives of their own (and text about them)
                    save_cfg(lives=bool(j["lives"]))
                if "real_timing" in j:                    # sometimes they take a while to answer, like a person
                    save_cfg(real_timing=bool(j["real_timing"]))
                if j.get("life_texts") in ("few", "some", "lots"):   # how much they text first, all together
                    save_cfg(life_texts=j["life_texts"])
                for k in ("quiet_from", "quiet_until"):   # no texts first between these hours
                    if k in j:
                        v = j[k]
                        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v < 24:
                            return self.json(400, {"error": "quiet hours are 0-24"})
                        save_cfg(**{k: round(float(v), 2)})
                if "learn_facts" in j:                    # characters note down lasting facts about you
                    if j["learn_facts"] and not cfg().get("learn_facts", True):   # (back on: nothing said while it
                        facts.resume([c["id"] for c in characters.all_characters(cfg())])   # was off is learned)
                    save_cfg(learn_facts=bool(j["learn_facts"]))
                if "sync_e2e" in j:                       # "my synced folder is end-to-end encrypted": no more warning
                    save_cfg(sync_e2e=bool(j["sync_e2e"]))
                if j.get("companion_provider") in ("tinfoil", "phala"):   # Companion: verified (Tinfoil) or Phala
                    save_cfg(companion_provider=j["companion_provider"])
                if "has_partner" in j:                    # married or in a relationship? (the public edition's romance rule)
                    if j["has_partner"] not in ("yes", "no", ""):
                        return self.json(400, {"error": "has_partner is yes, no or \"\""})
                    save_cfg(has_partner=j["has_partner"], partner_at=time.time() if j["has_partner"] else None)
                if "partner_noask" in j:                  # "don't keep asking": they don't, and it's on you to say
                    save_cfg(partner_noask=bool(j["partner_noask"]))
                return self.json(200, {"ok": True})
            self.json(404, {"error": "not found"})
        except urllib.error.HTTPError as e:
            if (e.url or "").startswith(CLOUDFLARE):      # (e.g. making characters on the free brain)
                try: self.json(502, {"error": free_failed(e, free_model())})
                except Exception: pass
                return
            msg = "Phala" if PHALA in (e.url or "") else "Tinfoil"
            bill = billing.kind(e) if msg == "Tinfoil" else None   # (your Tinfoil credits ran out: said plainly)
            try:
                if bill: self.json(e.code, {"error": billing.message(bill), "credits": True})
                else: self.json(502, {"error": f"{msg} returned {e.code}"})
            except Exception: pass
        except (BrokenPipeError, ConnectionResetError):
            pass
        except RuntimeError as e:                              # refused on purpose (e.g. the proxy isn't yours)
            try: self.json(503, {"error": str(e)})
            except Exception: pass
        except (ValueError, KeyError, TypeError) as e:          # bad input (e.g. a fake push address)
            try: self.json(400, {"error": str(e) or type(e).__name__})
            except Exception: pass
        except Exception as e:
            try: self.json(500, {"error": type(e).__name__})
            except Exception: pass

PRIVATE_FILES = (".thread.json", ".memory_index.json", ".vapid.json", ".push_subs.json", ".tinfoil_key", ".phala_key", ".near_key",
                 "config.local.json", "persona.local.txt", ".devices.json", ".mac_token", ".update.log", ".update_result",
                 ".tinfoil_cache_secret", ".tinfoil_proxy.pid", ".update_from", ".backup_key", ".backup_state.json",
                 ".facts_state.json", ".gens.json", ".cloudflare_key")

def tighten():
    """Files made before Buddy locked things down get owner-only permissions too (other macOS accounts can't read them):
    Buddy's own folder and private files, and the chats it saved in your notes (the rest of your notes is left alone).
    The notes folder is made on first run (owner-only), so Buddy works without Obsidian."""
    if not os.path.exists(VAULT):
        os.makedirs(VAULT, mode=0o700, exist_ok=True)
    for path, mode in [(HERE, 0o700)] + [(os.path.join(HERE, f), 0o600) for f in PRIVATE_FILES]:
        try:
            if os.path.exists(path): os.chmod(path, mode)
        except OSError: pass
    for root, dirs, files in [w for top in (CHATS, facts.DIR, lives.LIVES) for w in os.walk(top)]:   # (what they know
                                                                                                   # about you, their lives)
        for d in dirs + ["."]:
            try: os.chmod(os.path.join(root, d), 0o700)
            except OSError: pass
        for f in files:
            try: os.chmod(os.path.join(root, f), 0o600)
            except OSError: pass

KEY_FILES = {"tinfoil": ".tinfoil_key", "phala": ".phala_key", "near": ".near_key", "cloudflare": ".cloudflare_key"}

def set_key(provider, key, remove=False, account=""):
    """Saves (or removes) an API key typed into the Mac app: readable only by you, never returned or logged.
    cloudflare (the free brain): account = your Cloudflare account ID, kept with the token ("<account>:<token>")."""
    path = os.path.join(HERE, KEY_FILES[provider])
    if remove:
        try: os.remove(path)
        except OSError: pass
        if provider == "near":
            near_key_changed()
            if images.setting(cfg()) == "near": save_cfg(pictures="local")   # (NEAR can't be used without it)
        if provider == "cloudflare" and "free_brain" in local_cfg():
            save_cfg(free_brain=False)                    # (the free brain is off without it: back to Private)
        return True
    key = str(key).strip()
    if not (16 <= len(key) <= 400) or not key.isascii() or any(ch.isspace() or not ch.isprintable() for ch in key):
        raise ValueError("that doesn't look like an API key")
    if provider == "cloudflare":
        account = str(account or "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{32}", account):
            raise ValueError("that doesn't look like a Cloudflare account ID (32 letters and digits, on the Workers AI page)")
        key = account + ":" + key
        _free.update(limited=0, gone={})                  # (maybe another account: its own allowance)
    import tempfile
    fd, tmp = tempfile.mkstemp(dir=HERE, prefix=KEY_FILES[provider] + ".", suffix=".tmp")   # new, 0600, unique
    try:
        with os.fdopen(fd, "w") as f:
            f.write(key); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    if provider == "tinfoil":
        _models.update(at=0, ids=[]); images.forget_found()
        tinfoilproxy.start()                              # verify Tinfoil's enclave now that there's a key
    if provider == "near":
        near_key_changed(check=True)
    return True

def near_key_changed(check=False):
    """A NEAR AI key was set or removed: forget the last check of NEAR's servers; with a new key, check them now in
    the background (and install Buddy's NEAR checker first if this Mac doesn't have it yet)."""
    images.forget_found()
    if near is None:
        return
    try: near.forget()
    except Exception: pass
    if not check:
        return
    def later():
        try:
            if not near.ready()[0] and os.path.exists("/bin/zsh"):
                subprocess.run(["/bin/zsh", os.path.join(HERE, "scripts", "deps.sh")], capture_output=True, timeout=900)
            images.near_status(wait=False)
        except Exception:
            pass
    threading.Thread(target=later, daemon=True).start()

# ---------- photos you send: held in memory until they're sent (never on disk before that) ----------
_pending_photos = {}   # photo id -> {"ts", "dev", "full", "view", "w", "h"}
_pp_lock = threading.Lock()

def _prune_photos():
    """(with _pp_lock) Older than 30 minutes, more than 6 per device or 150 MB in all: the oldest go."""
    now = time.time()
    for k in [k for k, v in _pending_photos.items() if v["ts"] < now - 1800]:
        _pending_photos.pop(k, None)
    by_age = sorted(_pending_photos.items(), key=lambda kv: kv[1]["ts"])
    per = {}
    for k, v in reversed(by_age):
        per[v["dev"]] = per.get(v["dev"], 0) + 1
        if per[v["dev"]] > 6: _pending_photos.pop(k, None)
    total = sum(len(v["full"]) + len(v["view"] or b"") for v in _pending_photos.values())
    for k, v in sorted(_pending_photos.items(), key=lambda kv: kv[1]["ts"]):
        if total <= 150_000_000: break
        total -= len(v["full"]) + len(v["view"] or b""); _pending_photos.pop(k, None)

def hold_photo(dev, full, w, h):
    pid = uuid.uuid4().hex
    with _pp_lock:
        _pending_photos[pid] = {"ts": time.time(), "dev": dev, "full": full, "view": None, "w": w, "h": h}
        _prune_photos()
    return pid

def add_view(pid, dev, view):
    """None: no such photo (or it expired); False: it's another device's; True: ready to send."""
    with _pp_lock:
        _prune_photos()
        p = _pending_photos.get(str(pid))
        if not p: return None
        if p["dev"] != dev: return False
        p["view"] = view
        return True

def take_photo(pid, dev):
    """The photo you're sending now (taken out of the waiting ones), or None if it isn't ready or isn't yours."""
    with _pp_lock:
        _prune_photos()
        p = _pending_photos.get(str(pid))
        if not p or p["dev"] != dev or not p["view"]:
            return None
        return _pending_photos.pop(str(pid))

def drop_photo(pid, dev):
    with _pp_lock:
        p = _pending_photos.get(str(pid))
        if p and p["dev"] == dev:
            _pending_photos.pop(str(pid), None); return True
    return False

# ---------- profile pictures, made in the background ----------
_avatar_jobs = {}      # char id -> {"job", "since", "eta"} while one is being made; {"error", "at"} for 10 min if it failed

def make_avatar(cid, prompt, seed, wall=False):
    """Hands in a new profile picture (1024x1024), or with wall=True a chat wallpaper (768x1344). -> (HTTP code, answer);
    the picture is saved when it's done."""
    key = cid + "/wall" if wall else cid
    def done(res):
        if res["ok"] and characters.find(cid, cfg()):
            try:
                if wall: characters.set_wallpaper(cid, res["data"])
                else: characters.set_avatar(cid, res["data"], seed=seed if res.get("made_by") == "local" else None)
            except OSError: res = {**res, "ok": False, "why": "the picture couldn't be saved"}
        with _jobs_lock:                                  # (after make_avatar noted the job: it holds this lock)
            cur = _avatar_jobs.get(key) or {}
            if res["ok"]:
                if cur.get("job") == res["job"]: _avatar_jobs.pop(key, None)
            elif cur.get("job") == res["job"]:
                _avatar_jobs[key] = {"error": res["why"], "at": time.time()}
    with _jobs_lock:
        cur = _avatar_jobs.get(key) or {}
        if cur.get("job"):                                # one is already being made: that's the one
            return 202, {"ok": True, "job": cur["job"], "eta": cur["eta"]}
        try:
            j = images.submit("wallpaper" if wall else "avatar", cid, prompt, *((768, 1344) if wall else (1024, 1024)),
                              seed, done, cfg())
        except RuntimeError as e:
            return 503, {"error": images.why_not(cfg()) if str(e) == "no picture maker"
                         else "too many pictures are being made; try again in a bit"}
        _avatar_jobs[key] = {"job": j["job"], "since": time.time(), "eta": j["eta"]}
    return 202, {"ok": True, "job": j["job"], "eta": j["eta"]}

def forget_char(cid):
    """Everything said with a character: the shared thread (both of you, private too), their photos, and the chats
    Buddy saved in your notes for them (~/Buddy/chats/<id>/). Your other notes are never touched."""
    if not re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)):
        return 0
    n = social.forget(cid)
    folder = os.path.realpath(os.path.join(CHATS, cid))
    if folder.startswith(os.path.realpath(CHATS) + os.sep) and os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    if cid == "buddy" and os.path.isdir(CHATS):           # Buddy's chats from before each character had its own folder
        for f in os.listdir(CHATS):
            p = os.path.join(CHATS, f)
            if f.endswith(".md") and os.path.isfile(p) and not os.path.islink(p):
                try: os.remove(p)
                except OSError: pass
    memory.forget_chats(cid)
    facts.forget(cid)                                     # what they learned about you (never the shared facts)
    lives.delete(cid)                                     # their days so far (what they told you is part of them)
    for k in [k for k in list(_call_mem) if k[0] == cid]: _call_mem.pop(k, None)
    return n

def restart_soon(delay=0.5):
    """Restarts this server in place, after a restore (it's put in place first thing at start: backup.finish_restore).
    Same pid and command line, so the Mac app and the updater still know it; its helpers are stopped first (exec
    doesn't run atexit) and start again with it."""
    def go():
        time.sleep(delay)                                 # (the answer to the page goes out first)
        try:
            tinfoilproxy.stop(); tailnet.stop()
            sys.stdout.flush(); sys.stderr.flush()
            os.execv(sys.executable, [sys.executable] + sys.argv)
        except OSError:
            backup.restart_failed()                       # the restore then finishes at the next start
            if read(".tinfoil_key"): tinfoilproxy.start()
            if cfg().get("phone_tailnet"): tailnet.start()
    threading.Thread(target=go, daemon=True).start()

def _tilde(p):
    home = os.path.expanduser("~")
    return "~" + p[len(home):] if p == home or p.startswith(home + os.sep) else p

def _chat_files(c):
    """This character's saved chats in your notes: (published name, real path); for Buddy also the old top-level ones."""
    cid, real, out = c["id"], os.path.realpath(CHATS), []
    for d, rel in [(os.path.join(CHATS, cid), f"chats/{cid}")] + ([(CHATS, "chats")] if cid == "buddy" else []):
        try: names = os.listdir(d)
        except OSError: continue
        for f in names:
            p = os.path.join(d, f)
            if f.endswith(".md") and re.fullmatch(r"[0-9A-Za-z_-]{1,40}", f[:-3]) and not os.path.islink(p) \
                    and os.path.isfile(p) and os.path.realpath(p).startswith(real + os.sep):
                out.append((f"{rel}/{f[:-3]}", p))
    return out

def saved_chats(c):
    """Names, sizes and how many turns, newest first (nothing from inside them)."""
    files = []
    for rel, p in _chat_files(c):
        try: files.append((os.stat(p), rel, p))
        except OSError: pass
    out = []
    for st, rel, p in sorted(files, key=lambda x: -x[0].st_mtime)[:400]:
        try:
            with open(p, encoding="utf-8", errors="ignore") as f:
                turns = sum(1 for line in f.read(2_000_000).splitlines() if line.startswith("**Me:**"))
        except OSError:
            continue
        out.append({"file": rel.rsplit("/", 1)[1], "path": rel, "bytes": st.st_size, "turns": turns, "modified": int(st.st_mtime)})
    return out

def delete_chat(c, file):
    """Deletes one saved chat from your notes (the conversation on screen stays)."""
    if not re.fullmatch(r"[0-9A-Za-z_-]{1,40}", file):
        raise ValueError("no such saved chat")
    p = os.path.join(CHATS, c["id"], file + ".md")
    if c["id"] == "buddy" and not os.path.lexists(p):
        p = os.path.join(CHATS, file + ".md")            # (Buddy's chats from before each character had a folder)
    if os.path.islink(p) or not os.path.isfile(p) or not os.path.realpath(p).startswith(os.path.realpath(CHATS) + os.sep):
        raise ValueError("no such saved chat")
    os.remove(p)
    memory.forget_path(p)
    for k in [k for k in list(_call_mem) if k[0] == c["id"]]: _call_mem.pop(k, None)

def knows_info(c):
    """Everything about what one character knows of you, for the "What X knows" sheet: the facts (yours to see and
    change), which notes it can read (counts), its saved chats, photo and private-message counts."""
    cid, k = c["id"], c.get("knowledge") or {}
    cov = memory.coverage(characters.memory_folders(c), f"chats/{cid}", characters.memory_skip(c), characters.avoid_terms(c))
    names = memory.folders(); names += [f for f in sorted(cov["folders"]) if f not in names]
    pc = social.private_counts(cid)
    return {"char": cid, "name": c["name"], "learns": bool(c.get("learns", True)),
            "learning": bool(cfg().get("learn_facts", True)), "paused": facts.paused(cid),
            "files": {"mine": f"{facts.FOLDER}/{cid}.md", "everyone": f"{facts.FOLDER}/{facts.EVERYONE}.md"},
            "facts": facts.listing(c),
            "notes": {"scope": k.get("scope", "all"),
                      "folders": [{"name": f, "notes": cov["folders"].get(f, [0, 0])[0], "readable": cov["folders"].get(f, [0, 0])[1]}
                                  for f in names],
                      "root": {"notes": cov["root"][0], "readable": cov["root"][1]}, "own_chats": cov["own_chats"],
                      "avoided": cov["avoided"], "avoid": characters.avoid_terms(c), "indexed": memory.stats()[0]},
            "chats": saved_chats(c),
            "photos": {"from_them": sum(1 for m in social.thread() if m.get("char", "buddy") == cid and m.get("image")
                                        and not m.get("private"))},
            "private_now": {"messages": pc["messages"], "photos": pc["photos"], "fades_in_h":
                            round(max(0.0, 12 - (time.time() - pc["last_ts"]) / 3600), 1) if pc["last_ts"] else 0}}

def life_info(char):
    """Their own life as the app shows it (your own data: nothing about you is in it)."""
    c, now = cfg(), time.time()
    log, w = lives.load(char["id"]), lives.world()
    today = lives.life_date(now).isoformat()
    days = []
    for d in reversed(log["days"][-7:]):
        texted = {m["event"] for m in d["moments"] if m["state"] == "sent"}
        days.append({"date": d["date"], "to": d["to"], "summary": d["summary"], "today": d["date"] == today,
                     "events": [{**e, "past": d["date"] != today or lives.happened(e, now), "texted": e["id"] in texted}
                                for e in d["events"]],
                     "moments": [{"at": m["at"], "angle": m["angle"], "state": m["state"]} for m in d["moments"]]})
    ties = [{"id": x["id"], "name": x["name"], "life": x.get("life", True),
             **w.get(lives.pair(char["id"], x["id"]), {"know": None, "how": "", "by": "ai"})}
            for x in characters.all_characters(c) if x["id"] != char["id"]]
    return {"char": char["id"], "name": char["name"], "on": bool(c.get("lives", True)), "life": bool(char.get("life", True)),
            "texts_first": bool(char.get("texts_first")), "texts_per_day": char.get("texts_per_day"),
            "life_seed": char.get("life_seed", ""), "about": log["about"], "people": log["people"],
            "ongoing": log["ongoing"], "days": days, "weeks": log["weeks"][-4:][::-1], "months": log["months"][-6:][::-1],
            "ties": ties, "planned_today": bool(lives.day(log, lives.life_date(now)))}

def stored_info():
    """Everything Buddy keeps, as counts, sizes and places (never what's in them)."""
    size = lambda p: os.path.getsize(p) if os.path.isfile(p) else 0
    t = social._load(social.THREAD, [])
    by = {}
    for m in t:
        if m.get("role") in ("user", "assistant"): by[m.get("char", "buddy")] = by.get(m.get("char", "buddy"), 0) + 1
    media = [os.path.join(images.MEDIA, f) for f in (os.listdir(images.MEDIA) if os.path.isdir(images.MEDIA) else [])
             if not f.endswith(".tmp")]
    chats = {}
    for c in characters.all_characters(cfg()) + [{"id": d} for d in (os.listdir(CHATS) if os.path.isdir(CHATS) else [])
                                                 if re.fullmatch(r"[a-z0-9-]{1,40}", d)]:
        if c["id"] in chats: continue
        fs = _chat_files(c)
        if fs: chats[c["id"]] = {"files": len(fs), "bytes": sum(size(p) for _, p in fs)}
    chars = characters.all_characters(cfg())
    notes, chunks = memory.stats()
    pc = social.private_counts()
    return {"thread": {"messages": sum(by.values()), "by_char": by, "bytes": size(social.THREAD), "where": _tilde(social.THREAD)},
            "private_now": {"messages": pc["messages"], "photos": pc["photos"], "where": "Buddy's memory only"},
            "photos": {"files": len(media), "bytes": sum(size(p) for p in media), "where": _tilde(images.MEDIA) + "/"},
            "chats": {"by_char": chats, "where": _tilde(CHATS) + "/"},
            "facts": {"by_char": facts.counts(), "where": _tilde(facts.DIR) + "/"},
            "characters": {"count": len(chars), "avatars": sum(1 for c in chars if c.get("avatar")),
                           "where": _tilde(characters.MINE) + "/"},
            "lives": {"count": len(lf := [f for f in (os.listdir(lives.LIVES) if os.path.isdir(lives.LIVES) else [])
                                          if f.endswith(".json") and f != "_world.json"]),
                      "bytes": sum(size(os.path.join(lives.LIVES, f)) for f in lf), "where": _tilde(lives.LIVES) + "/"},
            "memory_index": {"notes": notes, "chunks": chunks, "bytes": size(memory.INDEX), "smart_by": memory.STATE["by"],
                             "where": _tilde(memory.INDEX)},
            "devices": sum(1 for d in devices.listing() if d.get("kind") != "mac"), "push_subscriptions": social.phone_count(),
            "learn_state": _tilde(facts.STATE), "synced": {"notes": synced_by(VAULT), "buddy": synced_by(HERE)}}

def tailnet_address():
    """The address your phone opens (https://<name>.<tailnet>.ts.net/phone) and whether it's on: from Buddy's own
    Tailscale node ("buddy") when phone access is on in Buddy, else from the Tailscale app on this Mac (whose name
    becomes public in certificate logs once HTTPS is on, so it's shown)."""
    if cfg().get("phone_tailnet"):
        st = tailnet.STATE
        if st["state"] == "ready" and st["host"]:
            return {"url": f"https://{st['host']}/phone", "tailscale": True, "builtin": True, "serving": True,
                    "host": st["host"].split(".")[0]}
        return {"url": None, "tailscale": True, "builtin": True, "state": st["state"]}
    exe = next((p for p in ("/Applications/Tailscale.app/Contents/MacOS/Tailscale", shutil.which("tailscale") or "")
                if p and os.path.exists(p)), None)
    if not exe:
        return {"url": None, "tailscale": False}
    try:
        st = json.loads(subprocess.run([exe, "status", "--json"], capture_output=True, text=True, timeout=5).stdout)
        dns = (st.get("Self") or {}).get("DNSName", "").rstrip(".")
        serve = subprocess.run([exe, "serve", "status"], capture_output=True, text=True, timeout=5).stdout
        return {"url": f"https://{dns}/phone" if dns else None, "tailscale": True, "host": dns.split(".")[0],
                "serving": "12400" in serve}
    except Exception:
        return {"url": None, "tailscale": True}

if __name__ == "__main__":
    # The port first: if another Buddy is already running here, stop now, before touching its files or its proxy.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    backup.finish_restore()                           # a restore checked before the restart goes in place first
    tighten()
    devices.ensure()
    social.forget_private_on_disk()
    social.ensure_vapid()
    memory.start_background()
    social.start_proactive(cfg, proactive_text, proactive_photo,
                           lambda cid: (characters.find(cid, cfg()) or {}).get("name") or "Buddy", life=life_tick)
    facts.start_background(cfg, learn_ask,                               # learning: the Advisor on Tinfoil only
                           lambda: characters.all_characters(cfg()),
                           on_call)                              # (not during a call with them)
    in_call = lambda: bool(_live) or time.time() - _talked[0] < 300
    backup.start(cfg, save_cfg, synced_by, busy=in_call, idle=social.mac_idle_seconds)   # daily, when idle, not in a call
    import signal
    signal.signal(signal.SIGTERM, lambda *a: (tinfoilproxy.stop(), tailnet.stop(), sys.exit(0)))   # and its helpers
    if read(".tinfoil_key"):
        tinfoilproxy.start()                          # nothing contacts Tinfoil before there's a key
    if cfg().get("phone_tailnet"):
        tailnet.start()                               # nothing contacts Tailscale unless you turned phone access on
    print(f"Buddy is ready at http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
